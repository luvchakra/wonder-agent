import "server-only";

import type { PolicyCondition } from "@/lib/shared/types/access-governance";

/**
 * ACCESS-P0-02.2's deterministic rule interpreter. `undefined` means "this
 * field isn't known yet" (e.g. agent.external_communication or
 * agent.days_since_last_certification, which depend on modules/data that
 * don't exist yet) — treated as "cannot evaluate," never coerced to
 * true/false, per the backlog's explicit "record as a known limitation,
 * don't fabricate." An LLM is never part of this path (non-negotiable #9).
 */
export function evaluateCondition(
  condition: PolicyCondition,
  facts: Record<string, unknown>,
): boolean | undefined {
  if ("all" in condition) {
    const results = condition.all.map((c) => evaluateCondition(c, facts));
    if (results.some((r) => r === false)) return false;
    if (results.some((r) => r === undefined)) return undefined;
    return true;
  }

  if ("any" in condition) {
    const results = condition.any.map((c) => evaluateCondition(c, facts));
    if (results.some((r) => r === true)) return true;
    if (results.every((r) => r === false)) return false;
    return undefined;
  }

  const actual = facts[condition.field];
  if (actual === undefined) return undefined;

  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "ne":
      return actual !== condition.value;
    case "gt":
      return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "gte":
      return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
    case "lt":
      return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    case "lte":
      return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case "contains":
      return Array.isArray(actual) && actual.includes(condition.value);
    default:
      return undefined;
  }
}
