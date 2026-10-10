import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { PolicyStatus } from "@/lib/shared/types/access-governance";

/**
 * The SoD rules and the conflicts they caught, for the SOD pages (owner
 * request, 2026-10-10). A rule is what `checkSoD()` enforces (sod.ts): an
 * `rbac` rule on an `identity` policy whose condition names two or more
 * `conflictingActions`. Rules are listed whatever the policy's status, so
 * a draft or disabled one is visible too; only an active policy enforces.
 */
export type SoDRule = {
  ruleId: string;
  policyId: string;
  policyName: string;
  policyStatus: PolicyStatus;
  /** The policy's action is `block`: a conflict refuses the action. Otherwise it is advisory. */
  blocking: boolean;
  conflictingActions: string[];
  createdAt: string;
};

type PolicyRow = {
  id: string;
  tenant_id: string;
  name: string;
  status: PolicyStatus;
  action: string;
  policy_rules: { id: string; rule_type: string; condition: unknown; created_at: string }[] | null;
};

/** The SoD rules among an organization's identity policies, in the shape `checkSoD()` reads them. */
export function sodRulesFrom(tenantId: string, rows: PolicyRow[]): SoDRule[] {
  const rules: SoDRule[] = [];
  for (const policy of rows) {
    if (policy.tenant_id !== tenantId) continue;
    for (const rule of policy.policy_rules ?? []) {
      if (rule.rule_type !== "rbac") continue;
      const raw = (rule.condition as { conflictingActions?: unknown } | null)?.conflictingActions;
      const actions = Array.isArray(raw) ? [...new Set(raw.filter((a): a is string => typeof a === "string" && a.length > 0))] : [];
      if (actions.length < 2) continue;
      rules.push({
        ruleId: rule.id,
        policyId: policy.id,
        policyName: policy.name,
        policyStatus: policy.status,
        blocking: policy.action === "block",
        conflictingActions: actions,
        createdAt: rule.created_at,
      });
    }
  }
  const order: Record<string, number> = { active: 0, draft: 1 };
  return rules.sort((a, b) => (order[a.policyStatus] ?? 2) - (order[b.policyStatus] ?? 2) || a.policyName.localeCompare(b.policyName));
}

/** Read as the signed-in user, under RLS and filtered by tenant (§14). */
export async function listSoDRules(tenantId: string): Promise<SoDRule[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("policies")
    .select("id, tenant_id, name, status, action, policy_rules(id, rule_type, condition, created_at)")
    .eq("tenant_id", tenantId)
    .eq("policy_category", "identity")
    .limit(500)
    .returns<PolicyRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return sodRulesFrom(tenantId, data ?? []);
}

/** The audit action `enforceSoD()` writes for every conflict it finds. */
export const SOD_CONFLICT_ACTION = "access.sod_conflict";

export type SoDConflict = {
  id: string;
  at: string;
  actorId: string | null;
  agentId: string | null;
  attemptedAction: string | null;
  conflictingAction: string | null;
  policyId: string | null;
  /** True when the action was refused; false when it went ahead and was recorded for review. */
  blocked: boolean;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** One audited conflict, read from its audit entry (written by `enforceSoD()`). */
export function toSoDConflict(entry: { id: string; createdAt: string; actorId: string | null; objectId: string; outcome: string; metadata: Record<string, unknown> }): SoDConflict {
  const m = entry.metadata ?? {};
  return {
    id: entry.id,
    at: entry.createdAt,
    actorId: entry.actorId,
    agentId: str(m.agentId) ?? str(entry.objectId),
    attemptedAction: str(m.attemptedAction),
    conflictingAction: str(m.conflictingAction),
    policyId: str(m.policyId),
    blocked: m.blocking === true || entry.outcome === "failure",
  };
}
