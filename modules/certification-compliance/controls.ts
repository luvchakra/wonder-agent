import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { hasOpenPolicyViolation } from "@/modules/access-governance/service";
import type { Control, ControlEvidence, ControlEvidenceType, ControlFramework, ControlMapping, ControlStatus } from "@/lib/shared/types/compliance";
import { toControl, toControlEvidence, toControlFramework, toControlMapping } from "./mappers";

/**
 * No per-control review cadence exists in the schema (COMPLIANCE-P0-02.1's
 * sketch has no such column) — a fixed 90-day default is used for "is this
 * evidence still current," matching Runtime Agent's own documented
 * 90-day default for a similar "no cadence source yet" gap. Flagged, not
 * silently assumed.
 */
const DEFAULT_EVIDENCE_CADENCE_DAYS = 90;

export async function listControlFrameworks(): Promise<ControlFramework[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("control_frameworks").select().order("id");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toControlFramework);
}

export async function listControls(frameworkId: string): Promise<Control[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("controls").select().eq("framework_id", frameworkId).order("control_ref");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toControl);
}

export async function createControlMapping(tenantId: string, actorId: string, controlId: string, policyId?: string, ownerId?: string): Promise<ControlMapping> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("control_mappings")
    .insert({ tenant_id: tenantId, control_id: controlId, policy_id: policyId ?? null, owner_id: ownerId ?? null })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create control mapping");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "compliance.control_mapping_created",
    objectType: "control_mapping",
    objectId: data.id,
    outcome: "success",
    metadata: { controlId, policyId },
  });

  return toControlMapping(data);
}

/**
 * Deliberately NOT given a `DEFAULT_LIST_LIMIT` cap (2026-09-16 pagination
 * pass): `posture.ts`'s governance posture score and `evidencePack.ts`/
 * `operations/reports.ts`'s compliance reports all depend on this
 * returning every mapping to compute correct coverage — a silent
 * truncation would be a correctness/compliance-integrity bug, not just a
 * performance one.
 */
export async function listControlMappings(tenantId: string): Promise<ControlMapping[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("control_mappings").select().eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toControlMapping);
}

export async function listControlEvidence(tenantId: string, mappingId: string): Promise<ControlEvidence[]> {
  const supabase = await supabaseServer();
  const { data: mapping, error: mappingError } = await supabase.from("control_mappings").select("id").eq("id", mappingId).eq("tenant_id", tenantId).maybeSingle();
  if (mappingError) throw new ApiError(500, "QUERY_FAILED", mappingError.message);
  if (!mapping) throw new ApiError(404, "MAPPING_NOT_FOUND");

  const { data, error } = await supabase.from("control_evidence").select().eq("control_mapping_id", mappingId).order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toControlEvidence);
}

/**
 * COMPLIANCE-P0-02.2 (higher bar). Adds an evidence row and recomputes
 * `status` from evidence alone — never a bare human-typed status flip.
 *
 * Resolved 2026-09-16: Access Agent published `hasOpenPolicyViolation()`
 * — a policy-scoped (not agent-scoped) query over its own
 * `policy_evaluations` table, checking each evaluated agent's MOST RECENT
 * result so a stale, since-fixed violation can't keep a mapping flagged
 * forever. When the mapping has a `policyId` and that policy currently
 * has an open violation, status computes to `non_compliant` even without
 * an explicit human attestation. `not_applicable` is still only ever set
 * by an explicit `manual_attestation` evidence row naming it — there is
 * no automated signal for "this control doesn't apply here."
 *
 * Word-choice reminder (CLAUDE.md §10 — hard product-boundary rule, not a
 * copywriting nicety): this `status` value is scoped to one control for
 * one agent — never surface it as "certified compliant" or "ISO
 * compliant" at the tenant level.
 */
export async function addControlEvidence(
  tenantId: string,
  actorId: string,
  mappingId: string,
  evidenceType: ControlEvidenceType,
  summary: string,
  referenceId?: string,
  manualStatus?: ControlStatus,
): Promise<{ evidence: ControlEvidence; mapping: ControlMapping }> {
  if (!summary.trim()) throw new ApiError(400, "INVALID_INPUT", "summary is required");

  const supabase = supabaseServiceRole();
  const { data: mappingRow, error: mappingError } = await supabase.from("control_mappings").select().eq("id", mappingId).eq("tenant_id", tenantId).maybeSingle();
  if (mappingError) throw new ApiError(500, "QUERY_FAILED", mappingError.message);
  if (!mappingRow) throw new ApiError(404, "MAPPING_NOT_FOUND");

  const { data: evidenceRow, error: evidenceError } = await supabase
    .from("control_evidence")
    .insert({ control_mapping_id: mappingId, evidence_type: evidenceType, reference_id: referenceId ?? null, summary })
    .select()
    .single();
  if (evidenceError || !evidenceRow) throw new ApiError(500, "CREATE_FAILED", evidenceError?.message ?? "Failed to add evidence");

  let status: ControlStatus;
  if (evidenceType === "manual_attestation" && manualStatus && (manualStatus === "non_compliant" || manualStatus === "not_applicable")) {
    // The only path to `not_applicable` — an explicit human attestation,
    // never inferred. A manual `non_compliant` attestation is honored the
    // same way, even though the live-violation check below could also
    // produce it — an explicit human call always takes precedence.
    status = manualStatus;
  } else if (mappingRow.policy_id && (await hasOpenPolicyViolation(tenantId, mappingRow.policy_id))) {
    status = "non_compliant";
  } else {
    status = "compliant";
  }

  const { data: updatedMapping, error: updateError } = await supabase
    .from("control_mappings")
    .update({ status })
    .eq("id", mappingId)
    .select()
    .single();
  if (updateError || !updatedMapping) throw new ApiError(500, "UPDATE_FAILED", updateError?.message ?? "Failed to update mapping status");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "compliance.control_evidence_added",
    objectType: "control_mapping",
    objectId: mappingId,
    outcome: "success",
    metadata: { evidenceType, status },
  });

  return { evidence: toControlEvidence(evidenceRow), mapping: toControlMapping(updatedMapping) };
}

/**
 * Recomputes `status` -> `partial` for any mapping whose newest evidence
 * has aged past DEFAULT_EVIDENCE_CADENCE_DAYS and is currently `compliant`
 * — a scheduled/periodic pass would call this; no scheduler exists in this
 * codebase yet (same gap Integration Agent flagged for sync jobs), so this
 * is exposed as a callable function rather than wired to a cron.
 */
export async function recomputeStaleControlMappings(tenantId: string): Promise<number> {
  const supabase = supabaseServiceRole();
  const cutoff = new Date(Date.now() - DEFAULT_EVIDENCE_CADENCE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: mappings, error } = await supabase.from("control_mappings").select("id, status").eq("tenant_id", tenantId).eq("status", "compliant");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  let staleCount = 0;
  for (const mapping of mappings ?? []) {
    const { data: latestEvidence } = await supabase
      .from("control_evidence")
      .select("created_at")
      .eq("control_mapping_id", mapping.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latestEvidence || latestEvidence.created_at < cutoff) {
      await supabase.from("control_mappings").update({ status: "partial" }).eq("id", mapping.id);
      staleCount += 1;
    }
  }
  return staleCount;
}
