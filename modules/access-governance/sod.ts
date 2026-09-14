import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

export type SoDCheckResult =
  | { conflict: false }
  | { conflict: true; policyId: string; blocking: boolean; conflictingAction: string };

/**
 * ACCESS-P0-02.3. SoD as a specialization of rule_type='rbac' policy_rules,
 * evaluated against user actions rather than agent facts — deliberately a
 * plain two-action conflict check against Foundation's own audit_logs
 * (the "who did what" system of record already exists there; no need for a
 * second tracking table), not a general conflict-graph solver, per the
 * backlog's explicit DO-NOT-IMPLEMENT. A `rule_type: 'rbac'` row's
 * `condition` is shaped `{ conflictingActions: string[] }` — a flat list of
 * two-or-more audit `action` values that must not all be performed by the
 * same user against the same agent.
 *
 * Default is advisory (the caller decides what to do with `conflict: true,
 * blocking: false`) unless the owning policy's `action` is 'block'.
 */
export async function checkSoD(
  tenantId: string,
  userId: string,
  action: string,
  agentId: string,
): Promise<SoDCheckResult> {
  const supabase = await supabaseServer();

  const { data: policyRows, error: policyError } = await supabase
    .from("policies")
    .select("id, action, policy_rules(id, condition)")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("policy_category", "identity")
    .returns<{ id: string; action: string; policy_rules: { id: string; condition: unknown }[] }[]>();
  if (policyError) throw new ApiError(500, "QUERY_FAILED", policyError.message);

  for (const policy of policyRows ?? []) {
    for (const rule of policy.policy_rules ?? []) {
      const condition = rule.condition as { conflictingActions?: string[] };
      const conflictingActions = condition.conflictingActions ?? [];
      if (!conflictingActions.includes(action)) continue;

      const otherActions = conflictingActions.filter((a) => a !== action);
      if (otherActions.length === 0) continue;

      const { data: priorAudit, error: auditError } = await supabase
        .from("audit_logs")
        .select("action")
        .eq("tenant_id", tenantId)
        .eq("actor_id", userId)
        .eq("object_id", agentId)
        .in("action", otherActions)
        .limit(1)
        .maybeSingle();
      if (auditError) throw new ApiError(500, "QUERY_FAILED", auditError.message);

      if (priorAudit) {
        return {
          conflict: true,
          policyId: policy.id,
          blocking: policy.action === "block",
          conflictingAction: priorAudit.action,
        };
      }
    }
  }

  return { conflict: false };
}
