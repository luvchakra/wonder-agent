import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import type {
  Policy,
  PolicyAction,
  PolicyCategory,
  PolicyCondition,
  PolicyException,
  PolicyExceptionScopeType,
  PolicyRule,
  PolicyRuleType,
  PolicySeverity,
  PolicyVersionRecord,
  UpdatePolicyInput,
} from "@/lib/shared/types/access-governance";
import { toPolicy, toPolicyException, toPolicyRule, toPolicyVersionRecord } from "./mappers";

export type CreatePolicyInput = {
  name: string;
  description?: string;
  policyCategory: PolicyCategory;
  scope?: Record<string, unknown>;
  severity?: PolicySeverity;
  action: PolicyAction;
  exceptionProcess?: string;
  ownerId?: string;
};

/** ACCESS-P0-02.1 (higher bar). Client-facing tenant-scoped RLS (migration 0029). */
export async function createPolicy(tenantId: string, input: CreatePolicyInput): Promise<Policy> {
  if (!input.name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("policies")
    .insert({
      tenant_id: tenantId,
      name: input.name,
      description: input.description ?? null,
      policy_category: input.policyCategory,
      scope: input.scope ?? {},
      severity: input.severity ?? "medium",
      action: input.action,
      exception_process: input.exceptionProcess ?? null,
      owner_id: input.ownerId ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create policy");
  return toPolicy(data);
}

export async function listPolicies(tenantId: string): Promise<Policy[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("policies").select().eq("tenant_id", tenantId).limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicy);
}

export async function getPolicy(policyId: string): Promise<Policy | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("policies").select().eq("id", policyId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toPolicy(data) : null;
}

/**
 * ACCESS-P0-05. Runs as the calling user — `policies` already grants a
 * client-facing UPDATE policy (migration 0029), so this is a normal RLS
 * write like createPolicy(), not a service-role path. Snapshots the row's
 * full prior state into `policy_versions` before applying the patch, and
 * bumps `version`. `policy_versions` insert also runs as the calling user
 * (client-facing INSERT policy, migration 0042) — it is append-only by
 * construction (no UPDATE/DELETE policy exists on that table at all), so
 * a client can add history but never rewrite or erase it.
 */
export async function updatePolicy(
  tenantId: string,
  actorId: string,
  policyId: string,
  patch: UpdatePolicyInput,
): Promise<Policy> {
  const current = await getPolicy(policyId);
  if (!current || current.tenantId !== tenantId) throw new ApiError(404, "POLICY_NOT_FOUND");

  const supabase = await supabaseServer();

  const { error: versionError } = await supabase.from("policy_versions").insert({
    policy_id: policyId,
    version: current.version,
    snapshot: current,
    changed_by: actorId,
  });
  if (versionError) throw new ApiError(500, "CREATE_FAILED", versionError.message);

  const update: Record<string, unknown> = { version: current.version + 1 };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.scope !== undefined) update.scope = patch.scope;
  if (patch.severity !== undefined) update.severity = patch.severity;
  if (patch.action !== undefined) update.action = patch.action;
  if (patch.exceptionProcess !== undefined) update.exception_process = patch.exceptionProcess;
  if (patch.ownerId !== undefined) update.owner_id = patch.ownerId;
  if (patch.expiryDate !== undefined) update.expiry_date = patch.expiryDate;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.priority !== undefined) update.priority = patch.priority;

  const { data, error } = await supabase.from("policies").update(update).eq("id", policyId).select().single();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update policy");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "policy.updated",
    objectType: "policy",
    objectId: policyId,
    outcome: "success",
    metadata: { fromVersion: current.version, toVersion: current.version + 1, changedFields: Object.keys(patch) },
  });

  return toPolicy(data);
}

export async function listPolicyVersions(policyId: string): Promise<PolicyVersionRecord[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("policy_versions")
    .select()
    .eq("policy_id", policyId)
    .order("version", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicyVersionRecord);
}

export async function addPolicyRule(
  policyId: string,
  ruleType: PolicyRuleType,
  condition: PolicyCondition,
): Promise<PolicyRule> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("policy_rules")
    .insert({ policy_id: policyId, rule_type: ruleType, condition })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to add policy rule");
  return toPolicyRule(data);
}

export async function listPolicyRules(policyId: string): Promise<PolicyRule[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("policy_rules").select().eq("policy_id", policyId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicyRule);
}

export type GovernanceExceptionInput = {
  reason: string;
  agentId?: string;
  expiresAt?: string;
  businessJustification?: string;
  compensatingControl?: string;
  residualRisk?: "low" | "medium" | "high" | "critical";
};

/**
 * ACCESS-P0-07: `policy_exceptions` is now the canonical governance
 * exception model, not scoped to access policy alone (governance
 * requirements reconciliation, 2026-09-15). This helper stays the
 * policy-scoped entry point (`scopeType: "policy"`, `policyId` required) —
 * existing callers only need to start passing `tenantId`.
 */
export async function addPolicyException(
  tenantId: string,
  policyId: string,
  approvedBy: string,
  input: GovernanceExceptionInput,
): Promise<PolicyException> {
  return createGovernanceException(tenantId, approvedBy, {
    scopeType: "policy",
    policyId,
    ...input,
  });
}

/**
 * The general entry point any module can use once it has a real exception
 * to record against something other than an access policy (e.g.
 * Compliance's planned control-mapping exceptions) — a `scopeId` pointing
 * at the target row instead of `policyId`. Every exception still requires
 * an approver today (`approvedBy`), matching P0's "minimal, manually-
 * approved" scope — the full async request/approval workflow is
 * `ACCESS-P1-04`, not this function.
 */
export async function createGovernanceException(
  tenantId: string,
  approvedBy: string,
  input: GovernanceExceptionInput & { scopeType: PolicyExceptionScopeType; policyId?: string; scopeId?: string },
): Promise<PolicyException> {
  if (!input.reason.trim()) throw new ApiError(400, "INVALID_INPUT", "reason is required");
  if (input.scopeType === "policy" && !input.policyId) {
    throw new ApiError(400, "INVALID_INPUT", "policyId is required when scopeType is 'policy'");
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("policy_exceptions")
    .insert({
      tenant_id: tenantId,
      scope_type: input.scopeType,
      policy_id: input.policyId ?? null,
      scope_id: input.scopeId ?? null,
      agent_id: input.agentId ?? null,
      reason: input.reason,
      business_justification: input.businessJustification ?? null,
      approved_by: approvedBy,
      compensating_control: input.compensatingControl ?? null,
      residual_risk: input.residualRisk ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to add governance exception");

  await writeAudit({
    tenantId,
    actorId: approvedBy,
    actorType: "user",
    action: "governance_exception.created",
    objectType: "policy_exception",
    objectId: data.id,
    outcome: "success",
    metadata: { scopeType: input.scopeType, policyId: input.policyId, scopeId: input.scopeId, agentId: input.agentId },
  });

  return toPolicyException(data);
}

export async function listPolicyExceptions(policyId: string): Promise<PolicyException[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("policy_exceptions").select().eq("policy_id", policyId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicyException);
}

export async function listGovernanceExceptions(
  tenantId: string,
  filter?: { scopeType?: PolicyExceptionScopeType; scopeId?: string; agentId?: string },
): Promise<PolicyException[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("policy_exceptions").select().eq("tenant_id", tenantId);
  if (filter?.scopeType) query = query.eq("scope_type", filter.scopeType);
  if (filter?.scopeId) query = query.eq("scope_id", filter.scopeId);
  if (filter?.agentId) query = query.eq("agent_id", filter.agentId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicyException);
}

/**
 * No client UPDATE policy exists on `policy_exceptions` (migration `0053`
 * removed it entirely) — revocation is integrity-sensitive the same way a
 * lifecycle transition is, so it runs via the service-role client with an
 * explicit tenant check, not a client-facing update.
 */
export async function revokeException(tenantId: string, actorId: string, exceptionId: string): Promise<void> {
  const supabase = supabaseServiceRole();
  const { data: existing, error: fetchError } = await supabase
    .from("policy_exceptions")
    .select("id, status")
    .eq("id", exceptionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (fetchError) throw new ApiError(500, "QUERY_FAILED", fetchError.message);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Exception not found");
  if (existing.status === "revoked") throw new ApiError(409, "ALREADY_REVOKED", "Exception already revoked");

  const { error } = await supabase
    .from("policy_exceptions")
    .update({ status: "revoked" })
    .eq("id", exceptionId)
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "governance_exception.revoked",
    objectType: "policy_exception",
    objectId: exceptionId,
    outcome: "success",
  });
}
