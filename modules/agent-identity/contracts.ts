import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type {
  AgentEnvironment,
  AgentContract,
  AutonomyLevel,
  CertificationFrequency,
  MaximumRisk,
} from "@/lib/shared/types/agent-identity";
import { toAgentContract } from "./mappers";

export type ContractInput = {
  purpose: string;
  ownerSummary?: string;
  approvedApplications?: string[];
  approvedData?: string[];
  prohibitedData?: string[];
  approvedActions?: string[];
  prohibitedActions?: string[];
  certificationFrequency?: CertificationFrequency;
  maximumRisk?: MaximumRisk;
  // IDENTITY-P0-07 — Human Oversight / Autonomy Model fields. Every field
  // defaults to the most conservative value (see createContractVersion())
  // rather than silently unrestricted.
  autonomyLevel?: AutonomyLevel;
  allowedTools?: string[];
  actionsRequiringApproval?: string[];
  requiredMonitoring?: string;
  requiredComplianceControls?: string[];
  // IDENTITY-P0-13 — empty lists mean "not restricted", like the fields above.
  approvedUsers?: string[];
  approvedDelegators?: string[];
  allowedEnvironments?: AgentEnvironment[];
  /** ISO date-time after which this contract no longer authorizes the agent. */
  expiresAt?: string | null;
};

const ENVIRONMENTS: AgentEnvironment[] = ["production", "staging", "development"];
const REVIEW_MONTHS: Record<CertificationFrequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/**
 * IDENTITY-P0-13 — when the agent is next due for review: one
 * certification period after the contract takes effect, or the contract's
 * expiry if that comes first. Pure.
 */
export function nextReviewAt(from: Date, frequency: CertificationFrequency, contractExpiresAt: string | null): string {
  const due = new Date(from);
  due.setUTCMonth(due.getUTCMonth() + REVIEW_MONTHS[frequency]);
  if (contractExpiresAt && new Date(contractExpiresAt).getTime() < due.getTime()) return new Date(contractExpiresAt).toISOString();
  return due.toISOString();
}

/**
 * IDENTITY-P0-03.1. `agent_contracts` grants no client SELECT restriction
 * beyond tenant scoping (see migration 0016), so this can safely use the
 * request-scoped, RLS-respecting client.
 */
export async function getAgentContract(agentId: string, tenantId: string): Promise<AgentContract | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_contracts")
    .select()
    .eq("agent_id", agentId)
    // QA-P0-17: RLS alone admits every organization a multi-org user
    // belongs to.
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toAgentContract(data) : null;
}

export async function listContractVersions(
  tenantId: string,
  agentId: string,
): Promise<AgentContract[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("agent_contracts")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .order("version", { ascending: true });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAgentContract);
}

/**
 * IDENTITY-P0-03.1 (higher bar): "editing an active contract creates a new
 * row (version + 1), marks the previous one superseded." Uses the
 * service-role client because agent_contracts has no client INSERT/UPDATE
 * policy (migration 0016) — the versioning invariant (exactly one active row
 * per agent, enforced additionally by a partial unique index) is this
 * function's responsibility, not RLS's. Every query below explicitly
 * scopes to tenantId/agentId for that reason.
 */
export async function createContractVersion(
  tenantId: string,
  agentId: string,
  actorId: string,
  input: ContractInput,
): Promise<AgentContract> {
  if (!input.purpose.trim()) {
    throw new ApiError(400, "INVALID_INPUT", "purpose is required");
  }
  if (input.autonomyLevel !== undefined && (input.autonomyLevel < 0 || input.autonomyLevel > 4)) {
    throw new ApiError(400, "INVALID_INPUT", "autonomyLevel must be between 0 and 4");
  }
  if ((input.allowedEnvironments ?? []).some((e) => !ENVIRONMENTS.includes(e))) {
    throw new ApiError(400, "INVALID_INPUT", `allowedEnvironments: any of ${ENVIRONMENTS.join(", ")}`);
  }
  if (input.expiresAt) {
    const t = new Date(input.expiresAt).getTime();
    if (Number.isNaN(t) || t <= Date.now()) throw new ApiError(400, "INVALID_INPUT", "expiresAt: a date in the future");
  }

  const supabase = supabaseServiceRole();

  const { data: agentRow, error: agentError } = await supabase
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (agentError) throw new ApiError(500, "QUERY_FAILED", agentError.message);
  if (!agentRow) throw new ApiError(404, "AGENT_NOT_FOUND");

  const { data: previousActive, error: previousError } = await supabase
    .from("agent_contracts")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .eq("status", "active")
    .maybeSingle();
  if (previousError) throw new ApiError(500, "QUERY_FAILED", previousError.message);

  if (previousActive) {
    const { error: supersedeError } = await supabase
      .from("agent_contracts")
      .update({ status: "superseded", superseded_at: new Date().toISOString() })
      .eq("id", previousActive.id)
      .eq("tenant_id", tenantId);
    if (supersedeError) throw new ApiError(500, "UPDATE_FAILED", supersedeError.message);
  }

  const nextVersion = previousActive ? previousActive.version + 1 : 1;

  const { data: newContract, error: insertError } = await supabase
    .from("agent_contracts")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      purpose: input.purpose,
      owner_summary: input.ownerSummary ?? null,
      approved_applications: input.approvedApplications ?? [],
      approved_data: input.approvedData ?? [],
      prohibited_data: input.prohibitedData ?? [],
      approved_actions: input.approvedActions ?? [],
      prohibited_actions: input.prohibitedActions ?? [],
      certification_frequency: input.certificationFrequency ?? "quarterly",
      maximum_risk: input.maximumRisk ?? "medium",
      status: "active",
      version: nextVersion,
      // Conservative-by-default (IDENTITY-P0-07): lowest autonomy, no
      // implicit tool access, nothing pre-approved-without-review.
      autonomy_level: input.autonomyLevel ?? 0,
      allowed_tools: input.allowedTools ?? [],
      actions_requiring_approval: input.actionsRequiringApproval ?? [],
      required_monitoring: input.requiredMonitoring ?? null,
      required_compliance_controls: input.requiredComplianceControls ?? [],
      approved_users: input.approvedUsers ?? [],
      approved_delegators: input.approvedDelegators ?? [],
      allowed_environments: input.allowedEnvironments ?? [],
      expires_at: input.expiresAt ?? null,
    })
    .select()
    .single();
  if (insertError || !newContract) {
    throw new ApiError(500, "CREATE_FAILED", insertError?.message ?? "Failed to create contract");
  }

  // IDENTITY-P0-13: the agent's next review follows from this contract's
  // certification frequency and expiry. It used to be set by nothing.
  const reviewDue = nextReviewAt(new Date(), newContract.certification_frequency, newContract.expires_at ?? null);
  const { error: reviewError } = await supabase.from("agents").update({ next_review_at: reviewDue }).eq("id", agentId).eq("tenant_id", tenantId);
  if (reviewError) throw new ApiError(500, "UPDATE_FAILED", reviewError.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent.contract_updated",
    objectType: "agent_contract",
    objectId: newContract.id,
    outcome: "success",
    metadata: {
      agentId,
      previousVersion: previousActive ? toAgentContract(previousActive) : null,
      newVersion: toAgentContract(newContract),
      nextReviewAt: reviewDue,
    },
  });

  return toAgentContract(newContract);
}
