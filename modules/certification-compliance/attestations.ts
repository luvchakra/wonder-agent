import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type {
  AttestationChecklistItem,
  AttestationDecision,
  AttestationEvidenceReference,
  GovernanceAttestation,
} from "@/lib/shared/types/compliance";
import { toGovernanceAttestation } from "./mappers";

export type RecordAttestationInput = {
  policyRequirement: string;
  checklist: AttestationChecklistItem[];
  decision: AttestationDecision;
  comments?: string;
  evidenceReferences?: AttestationEvidenceReference[];
  validUntil?: string;
};

/**
 * COMPLIANCE-P0-08 — Governance Attestation (broad). Written once,
 * server-mediated, immutable — governance_attestations has no client-facing
 * write policy at all (migration 0055), same lockdown as
 * certification_decisions: a correction is a new attestation row, never an
 * edit (non-negotiable #11). Uses the service-role client since there is no
 * client INSERT policy; the agent's tenant membership is verified manually
 * before the write, per CLAUDE.md §14's service-role guardrail.
 */
export async function recordAttestation(
  tenantId: string,
  approverId: string,
  agentId: string,
  input: RecordAttestationInput,
): Promise<GovernanceAttestation> {
  if (!input.policyRequirement.trim()) throw new ApiError(400, "INVALID_INPUT", "policyRequirement is required");

  const supabase = supabaseServiceRole();

  // Manual tenant verification — supabaseServiceRole() bypasses RLS.
  const { data: agentRow, error: agentError } = await supabase
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (agentError) throw new ApiError(500, "QUERY_FAILED", agentError.message);
  if (!agentRow) throw new ApiError(404, "AGENT_NOT_FOUND");

  const { data, error } = await supabase
    .from("governance_attestations")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      policy_requirement: input.policyRequirement,
      checklist: input.checklist,
      approver_id: approverId,
      decision: input.decision,
      comments: input.comments ?? null,
      evidence_references: input.evidenceReferences ?? [],
      valid_until: input.validUntil ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to record attestation");

  const attestation = toGovernanceAttestation(data);

  await writeAudit({
    tenantId,
    actorId: approverId,
    actorType: "user",
    action: "compliance.attestation_recorded",
    objectType: "governance_attestation",
    objectId: attestation.id,
    outcome: "success",
    metadata: { agentId, decision: input.decision, policyRequirement: input.policyRequirement },
  });

  return attestation;
}

export async function listAttestationsForAgent(tenantId: string, agentId: string): Promise<GovernanceAttestation[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("governance_attestations")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .order("decided_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toGovernanceAttestation);
}

/**
 * The most recent attestation decision for an agent, optionally scoped to
 * one policy/requirement (an agent can be attested against several
 * independent requirements over time). Used by COMPLIANCE-P0-09's evidence
 * pack assembly.
 */
export async function getLatestAttestation(
  tenantId: string,
  agentId: string,
  policyRequirement?: string,
): Promise<GovernanceAttestation | null> {
  const all = await listAttestationsForAgent(tenantId, agentId);
  const filtered = policyRequirement ? all.filter((a) => a.policyRequirement === policyRequirement) : all;
  return filtered[0] ?? null;
}
