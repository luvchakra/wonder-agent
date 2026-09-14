import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { EvidenceType, FindingFilter, ResolutionType, RiskFinding, RogueCategory } from "@/lib/shared/types/risk";
import { toRiskEvidence, toRiskFinding } from "./mappers";

/**
 * risk_findings/risk_evidence grant client SELECT only (migration 0034) —
 * reads run as the calling user; tenant_id is still filtered explicitly as
 * defense-in-depth per CLAUDE.md §14.
 */
export async function getFindings(tenantId: string, filter: FindingFilter = {}): Promise<RiskFinding[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("risk_findings").select().eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (filter.agentId) query = query.eq("agent_id", filter.agentId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.category) query = query.eq("category", filter.category);
  if (filter.severity) query = query.eq("severity", filter.severity);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRiskFinding);
}

export async function getFinding(tenantId: string, findingId: string): Promise<RiskFinding | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("risk_findings").select().eq("tenant_id", tenantId).eq("id", findingId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;

  const { data: evidenceRows, error: evidenceError } = await supabase
    .from("risk_evidence")
    .select()
    .eq("finding_id", findingId)
    .order("created_at", { ascending: true });
  if (evidenceError) throw new ApiError(500, "QUERY_FAILED", evidenceError.message);

  return { ...toRiskFinding(data), evidence: (evidenceRows ?? []).map(toRiskEvidence) };
}

type EvidenceInput = { evidenceType: EvidenceType; referenceId: string; summary: string };

/**
 * RISK-P0-01.2's dedup rule: an existing open/assigned/remediation_in_progress
 * finding for the same agent+category is updated (new evidence appended,
 * severity/score/explanation refreshed) rather than duplicated. Used only by
 * modules/risk/rules.ts's detection engine — writes go through the
 * service-role client since risk_findings/risk_evidence have no
 * client-facing write policy at all (migration 0034's comment: a forgeable
 * finding would undermine the same evidentiary guarantee every other
 * findings-style table in this build protects).
 */
export async function createOrUpdateFinding(
  tenantId: string,
  agentId: string,
  category: RogueCategory,
  fields: { severity: string; riskScore: number; reasons: string[]; title: string; explanation: string; recommendation: string; policyId?: string | null },
  evidence: EvidenceInput[],
): Promise<{ finding: RiskFinding; created: boolean }> {
  const supabase = supabaseServiceRole();

  const { data: existing, error: existingError } = await supabase
    .from("risk_findings")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .eq("category", category)
    .in("status", ["open", "assigned", "remediation_in_progress"])
    .maybeSingle();
  if (existingError) throw new ApiError(500, "QUERY_FAILED", existingError.message);

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("risk_findings")
      .update({
        severity: fields.severity,
        risk_score: fields.riskScore,
        reasons: fields.reasons,
        explanation: fields.explanation,
        recommendation: fields.recommendation,
      })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId)
      .select()
      .single();
    if (updateError || !updated) throw new ApiError(500, "UPDATE_FAILED", updateError?.message ?? "Failed to update finding");

    const { data: existingEvidence, error: existingEvidenceError } = await supabase
      .from("risk_evidence")
      .select("reference_id")
      .eq("finding_id", existing.id);
    if (existingEvidenceError) throw new ApiError(500, "QUERY_FAILED", existingEvidenceError.message);
    const knownRefs = new Set((existingEvidence ?? []).map((e: { reference_id: string }) => e.reference_id));
    const newEvidence = evidence.filter((e) => !knownRefs.has(e.referenceId));
    if (newEvidence.length > 0) {
      const { error: insertEvidenceError } = await supabase
        .from("risk_evidence")
        .insert(newEvidence.map((e) => ({ finding_id: existing.id, evidence_type: e.evidenceType, reference_id: e.referenceId, summary: e.summary })));
      if (insertEvidenceError) throw new ApiError(500, "CREATE_FAILED", insertEvidenceError.message);
    }

    return { finding: toRiskFinding(updated), created: false };
  }

  const { data: created, error: createError } = await supabase
    .from("risk_findings")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      category,
      severity: fields.severity,
      risk_score: fields.riskScore,
      reasons: fields.reasons,
      title: fields.title,
      explanation: fields.explanation,
      recommendation: fields.recommendation,
      policy_id: fields.policyId ?? null,
    })
    .select()
    .single();
  if (createError || !created) throw new ApiError(500, "CREATE_FAILED", createError?.message ?? "Failed to create finding");

  if (evidence.length > 0) {
    const { error: insertEvidenceError } = await supabase
      .from("risk_evidence")
      .insert(evidence.map((e) => ({ finding_id: created.id, evidence_type: e.evidenceType, reference_id: e.referenceId, summary: e.summary })));
    if (insertEvidenceError) throw new ApiError(500, "CREATE_FAILED", insertEvidenceError.message);
  }

  await writeAudit({
    tenantId,
    actorId: null,
    actorType: "system",
    action: "risk.finding_created",
    objectType: "risk_finding",
    objectId: created.id,
    outcome: "success",
    metadata: { agentId, category, severity: fields.severity },
  });

  return { finding: toRiskFinding(created), created: true };
}

/** RISK-P0-03.1. */
export async function assignFinding(tenantId: string, actorId: string, findingId: string, assigneeId: string): Promise<RiskFinding> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("risk_findings")
    .update({ assigned_to: assigneeId, status: "assigned" })
    .eq("id", findingId)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "FINDING_NOT_FOUND");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.finding_assigned",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { assigneeId },
  });

  return toRiskFinding(data);
}

/**
 * RISK-P0-03.2. Risk Agent never revokes access itself (non-negotiable
 * #6/#15). Access Agent has not published a remediation-initiation
 * contract yet (checked: modules/access-governance/service.ts exports no
 * such function as of this session) — per the backlog's own explicit
 * instruction for this exact situation, this records the dependency and
 * leaves the finding at its current status with a note, rather than
 * fabricating a hand-off or silently flipping status to
 * 'remediation_in_progress' without an actual remediation path behind it.
 */
export async function remediateFinding(tenantId: string, actorId: string, findingId: string): Promise<{ finding: RiskFinding; wired: boolean }> {
  const supabase = supabaseServiceRole();
  const { data: finding, error } = await supabase.from("risk_findings").select().eq("id", findingId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!finding) throw new ApiError(404, "FINDING_NOT_FOUND");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.remediation_requested",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "failure",
    metadata: { reason: "Access Agent has not published a remediation-initiation contract yet; no automated hand-off performed." },
  });

  return { finding: toRiskFinding(finding), wired: false };
}

/**
 * RISK-P0-03.3. `reevaluate` must be the same detection rule that created
 * this finding, re-run against current evidence — the caller (the API
 * route) passes whether that re-check still triggers, since the actual
 * re-run lives in rules.ts (which needs the full evaluation context). This
 * function only enforces the "verified_fixed requires the rule to no
 * longer trigger" invariant and performs the status transition + audit.
 */
export async function resolveFinding(
  tenantId: string,
  actorId: string,
  findingId: string,
  resolution: { type: ResolutionType; reason?: string; stillTriggered?: boolean },
): Promise<RiskFinding> {
  if (resolution.type === "verified_fixed" && resolution.stillTriggered) {
    throw new ApiError(412, "PRECONDITION_FAILED", "The underlying evidence still triggers this finding's rule — cannot resolve as verified_fixed");
  }
  if (resolution.type === "accepted_risk" && !resolution.reason?.trim()) {
    throw new ApiError(400, "INVALID_INPUT", "accepted_risk resolution requires a reason");
  }

  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("risk_findings")
    .update({
      status: "resolved",
      resolution_type: resolution.type,
      resolution_reason: resolution.reason ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", findingId)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "FINDING_NOT_FOUND");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.finding_resolved",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { resolutionType: resolution.type },
  });

  return toRiskFinding(data);
}
