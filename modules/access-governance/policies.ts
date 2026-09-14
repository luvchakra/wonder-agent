import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type {
  Policy,
  PolicyAction,
  PolicyCategory,
  PolicyCondition,
  PolicyException,
  PolicyRule,
  PolicyRuleType,
  PolicySeverity,
} from "@/lib/shared/types/access-governance";
import { toPolicy, toPolicyException, toPolicyRule } from "./mappers";

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
  const { data, error } = await supabase.from("policies").select().eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicy);
}

export async function getPolicy(policyId: string): Promise<Policy | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("policies").select().eq("id", policyId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toPolicy(data) : null;
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

export async function addPolicyException(
  policyId: string,
  approvedBy: string,
  reason: string,
  agentId?: string,
  expiresAt?: string,
): Promise<PolicyException> {
  if (!reason.trim()) throw new ApiError(400, "INVALID_INPUT", "reason is required");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("policy_exceptions")
    .insert({ policy_id: policyId, agent_id: agentId ?? null, reason, approved_by: approvedBy, expires_at: expiresAt ?? null })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to add policy exception");
  return toPolicyException(data);
}

export async function listPolicyExceptions(policyId: string): Promise<PolicyException[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("policy_exceptions").select().eq("policy_id", policyId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicyException);
}
