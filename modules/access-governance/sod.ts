import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";

export type SoDCheckResult =
  | { conflict: false }
  | { conflict: true; policyId: string; blocking: boolean; conflictingAction: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ACCESS-P0-02.3, wired by ACCESS-P0-14 (codebase-map D5, 2026-09-25).
 * SoD as a specialization of rule_type='rbac' policy_rules on active
 * `identity` policies: a rule's `condition` is `{ conflictingActions:
 * string[] }`, two or more audit `action` values that the same user must
 * not all perform for the same agent. A plain two-action check against
 * Foundation's audit_logs (the "who did what" record), not a conflict-graph
 * solver, per the backlog's DO-NOT-IMPLEMENT.
 *
 * ACCESS-P0-14 corrections:
 * - A prior action matches the agent whether the audit row's object is
 *   the agent itself or carries it as `metadata.agentId`. Access requests
 *   and grants are audited against their own ids, so the old
 *   `object_id = agentId` match could never see "requested, then
 *   approved".
 * - It reads with the service role, filtered by tenant (§14). It is a
 *   security control, so it must not depend on whether the acting user can
 *   read the audit log.
 *
 * Default is advisory unless the owning policy's `action` is 'block'.
 */
export async function checkSoD(tenantId: string, userId: string, action: string, agentId: string): Promise<SoDCheckResult> {
  if (!UUID.test(agentId) || !UUID.test(userId)) return { conflict: false };
  const supabase = supabaseServiceRole();

  const { data: policyRows, error: policyError } = await supabase
    .from("policies")
    .select("id, tenant_id, action, policy_rules(rule_type, condition)")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("policy_category", "identity")
    .returns<{ id: string; tenant_id: string; action: string; policy_rules: { rule_type: string; condition: unknown }[] }[]>();
  if (policyError) throw new ApiError(500, "QUERY_FAILED", policyError.message);

  // Every matching policy is checked: an advisory policy must never hide a
  // blocking one that also matches (found 2026-09-26, when a leftover flag
  // policy let an approval through a blocking policy). The first blocking
  // conflict wins; otherwise the first advisory one is reported.
  let advisory: SoDCheckResult | null = null;
  for (const policy of (policyRows ?? []).filter((p) => p.tenant_id === tenantId)) {
    for (const rule of policy.policy_rules ?? []) {
      if (rule.rule_type !== "rbac") continue;
      const conflictingActions = ((rule.condition as { conflictingActions?: unknown })?.conflictingActions ?? []) as unknown[];
      if (!Array.isArray(conflictingActions) || !conflictingActions.includes(action)) continue;
      const otherActions = conflictingActions.filter((a): a is string => typeof a === "string" && a !== action);
      if (otherActions.length === 0) continue;

      const { data: prior, error: auditError } = await supabase
        .from("audit_logs")
        .select("action, tenant_id")
        .eq("tenant_id", tenantId)
        .eq("actor_id", userId)
        .in("action", otherActions)
        .or(`object_id.eq.${agentId},metadata->>agentId.eq.${agentId}`)
        .limit(1)
        .maybeSingle<{ action: string; tenant_id: string }>();
      if (auditError) throw new ApiError(500, "QUERY_FAILED", auditError.message);

      if (prior && prior.tenant_id === tenantId) {
        const found = { conflict: true as const, policyId: policy.id, blocking: policy.action === "block", conflictingAction: prior.action };
        if (found.blocking) return found;
        advisory ??= found;
      }
    }
  }

  return advisory ?? { conflict: false };
}

/**
 * ACCESS-P0-14 — the call made where access is requested or granted.
 * Every conflict is audited. A blocking policy refuses the action (409
 * SOD_CONFLICT), audited as a failure, so the action never happens. An
 * advisory policy lets it proceed and records the conflict for review.
 */
export async function enforceSoD(tenantId: string, actorId: string, action: string, agentId: string): Promise<SoDCheckResult> {
  const result = await checkSoD(tenantId, actorId, action, agentId);
  if (!result.conflict) return result;
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.sod_conflict",
    objectType: "agent",
    objectId: agentId,
    outcome: result.blocking ? "failure" : "success",
    metadata: { agentId, attemptedAction: action, conflictingAction: result.conflictingAction, policyId: result.policyId, blocking: result.blocking },
  });
  if (result.blocking) {
    throw new ApiError(
      409,
      "SOD_CONFLICT",
      `Separation of duties: you already performed ${result.conflictingAction} for this agent, so you cannot also perform ${action}. Ask another person.`,
    );
  }
  return result;
}
