import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { getAgent } from "@/modules/agent-identity/service";
import type { Policy, PolicyEvaluationResult, PolicyRule } from "@/lib/shared/types/access-governance";
import { toPolicy, toPolicyEvaluationResult, toPolicyRule } from "./mappers";
import { getEffectiveAccess } from "./grants";
import { evaluateCondition } from "./conditions";

export async function listPolicyEvaluations(tenantId: string, agentId: string): Promise<PolicyEvaluationResult[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("policy_evaluations")
    .select()
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .order("evaluated_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicyEvaluationResult);
}

function policyScopeMatches(policy: Policy, agent: { criticality: string; agentType: string }): boolean {
  const scope = policy.scope as Record<string, unknown>;
  if (!scope || Object.keys(scope).length === 0) return true;
  return Object.entries(scope).every(([key, value]) => {
    if (!Array.isArray(value)) return true;
    const agentValue = key === "criticality" ? agent.criticality : key === "agent_type" ? agent.agentType : undefined;
    return agentValue !== undefined && value.includes(agentValue);
  });
}

/**
 * ACCESS-P0-02.2 (higher bar). Loads every active, in-scope policy for the
 * agent, evaluates each of its rules deterministically, and writes one
 * policy_evaluations row per policy. `policy_evaluations` has no
 * client-facing write policy at all (migration 0030) — evidentiary
 * integrity, same reasoning as access_grants — so writes use the
 * service-role client after this function has already done its own
 * reads via the RLS-respecting client (reads are safe: policies/
 * access_grants/agents all grant client-facing SELECT).
 */
export async function evaluatePolicies(tenantId: string, agentId: string): Promise<PolicyEvaluationResult[]> {
  const agent = await getAgent(tenantId, agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND");

  const supabase = await supabaseServer();
  const { data: policyRows, error: policyError } = await supabase
    .from("policies")
    .select()
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  if (policyError) throw new ApiError(500, "QUERY_FAILED", policyError.message);

  const policies = (policyRows ?? []).map(toPolicy).filter((p) => policyScopeMatches(p, agent));
  if (policies.length === 0) return [];

  const effectiveAccess = await getEffectiveAccess(tenantId, agentId);

  const agentFacts: Record<string, unknown> = {
    "agent.data_classification": agent.dataClassification ?? undefined,
    "agent.criticality": agent.criticality,
    "agent.environment": agent.environment,
    // Not modeled by any module yet — deliberately left unknown rather than
    // guessed, per ACCESS-P0-02.2's explicit instruction.
    "agent.external_communication": undefined,
    "agent.days_since_last_certification": undefined,
  };

  const admin = supabaseServiceRole();
  const results: PolicyEvaluationResult[] = [];

  for (const policy of policies) {
    const { data: ruleRows, error: ruleError } = await supabase
      .from("policy_rules")
      .select()
      .eq("policy_id", policy.id);
    if (ruleError) throw new ApiError(500, "QUERY_FAILED", ruleError.message);
    const rules = (ruleRows ?? []).map(toPolicyRule);

    const { violated, evidence } = evaluatePolicyRules(rules, agentFacts, effectiveAccess);

    const { data: exceptionRows, error: exceptionError } = await supabase
      .from("policy_exceptions")
      .select()
      .eq("policy_id", policy.id)
      .or(`agent_id.eq.${agentId},agent_id.is.null`);
    if (exceptionError) throw new ApiError(500, "QUERY_FAILED", exceptionError.message);
    const hasActiveException = (exceptionRows ?? []).some(
      (e: { expires_at: string | null }) => !e.expires_at || new Date(e.expires_at) > new Date(),
    );

    const result = !violated ? "pass" : hasActiveException ? "exempted" : "violation";

    const { data: inserted, error: insertError } = await admin
      .from("policy_evaluations")
      .insert({
        tenant_id: tenantId,
        policy_id: policy.id,
        agent_id: agentId,
        result,
        evidence,
        // ACCESS-P0-05/06 — the policy's version at evaluation time, so a
        // stored evaluation is reproducible against the exact rule set
        // that produced it.
        policy_version: policy.version,
      })
      .select()
      .single();
    if (insertError || !inserted) {
      throw new ApiError(500, "CREATE_FAILED", insertError?.message ?? "Failed to write policy evaluation");
    }
    results.push(toPolicyEvaluationResult(inserted));
  }

  return results;
}

function evaluatePolicyRules(
  rules: PolicyRule[],
  agentFacts: Record<string, unknown>,
  effectiveAccess: Awaited<ReturnType<typeof getEffectiveAccess>>,
): { violated: boolean; evidence: Record<string, unknown> } {
  for (const rule of rules) {
    if (rule.ruleType === "abac" || rule.ruleType === "time") {
      if (evaluateCondition(rule.condition, agentFacts) === true) {
        return { violated: true, evidence: { ruleId: rule.id, ruleType: rule.ruleType, facts: agentFacts } };
      }
    }

    if (rule.ruleType === "resource") {
      for (const grant of effectiveAccess) {
        const rowFacts: Record<string, unknown> = {
          "access.entitlement.application": grant.application,
          "access.entitlement.name": grant.entitlementName,
          "access.entitlement.data_classification": grant.dataClassification,
          "access.granted": true,
        };
        if (evaluateCondition(rule.condition, rowFacts) === true) {
          return {
            violated: true,
            evidence: { ruleId: rule.id, ruleType: rule.ruleType, accessGrantId: grant.id, facts: rowFacts },
          };
        }
      }
    }

    // rule_type 'rbac' is evaluated only via checkSoD() (ACCESS-P0-02.3) —
    // it concerns user actions, not agent facts, so it contributes nothing
    // to an agent-scoped policy evaluation here.
  }

  return { violated: false, evidence: {} };
}
