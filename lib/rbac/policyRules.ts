import { ENVIRONMENTS, SCOPE_TYPES, permissionMatches, type PolicyEffect, type ScopeType } from "./authorizeCore";

/**
 * FOUNDATION-P0-19 — explicit authorization policies (spec §21): deny, or
 * require approval, for a set of permissions in a scope, with exempt
 * roles. Pure validation; migration 0100 enforces the lockout rule again.
 *
 * Lockout rule: a policy never covers `tenant.security.manage`, the
 * permission that manages policies, so a mistaken policy can always be
 * undone by the people allowed to write one.
 */

export const LOCKOUT_PERMISSION = "tenant.security.manage";
export const POLICY_EFFECTS: readonly PolicyEffect[] = ["DENY", "REQUIRE_APPROVAL"];

export type PolicyInput = {
  name: string;
  description: string | null;
  effect: PolicyEffect;
  permissions: string[];
  scopeType: ScopeType;
  scopeValues: string[];
  exemptRoleIds: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATTERN_RE = /^[a-z][a-z_]*(\.[a-z][a-z_]*)*(\.\*)?$/;

const list = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : []).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))];

export function validatePolicy(
  input: { name?: unknown; description?: unknown; effect?: unknown; permissions?: unknown; scopeType?: unknown; scopeValues?: unknown; exemptRoleIds?: unknown },
  catalog: readonly string[],
): { ok: true; value: PolicyInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 120) errors.name = "Name the policy (2–120 characters).";
  const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;
  if (description && description.length > 500) errors.description = "At most 500 characters.";
  const effect = input.effect as PolicyEffect;
  if (!POLICY_EFFECTS.includes(effect)) errors.effect = "Choose deny or require approval.";

  const permissions = list(input.permissions);
  if (!permissions.length) errors.permissions = "Choose at least one permission.";
  else if (permissions.length > 50) errors.permissions = "At most 50.";
  else {
    const unknown = permissions.filter((p) => !PATTERN_RE.test(p) || !catalog.some((k) => permissionMatches(p, k)));
    if (unknown.length) errors.permissions = `Not a permission, or a prefix of one: ${unknown.join(", ")}`;
    else if (permissions.some((p) => permissionMatches(p, LOCKOUT_PERMISSION))) {
      errors.permissions = "A policy can't cover tenant.security.manage — that would stop anyone from undoing it.";
    }
  }

  const scopeType = (input.scopeType ?? "tenant") as ScopeType;
  const scopeValues = list(input.scopeValues);
  if (!(SCOPE_TYPES as readonly string[]).includes(scopeType)) errors.scopeType = "Choose where the policy applies.";
  else if (scopeType === "tenant" ? scopeValues.length > 0 : scopeValues.length === 0) errors.scopeValues = scopeType === "tenant" ? "An organization-wide policy names nothing." : "Choose at least one.";
  else if (scopeType === "environment" && scopeValues.some((v) => !(ENVIRONMENTS as readonly string[]).includes(v))) errors.scopeValues = "Unknown environment.";
  else if ((scopeType === "application" || scopeType === "agent") && scopeValues.some((v) => !UUID_RE.test(v))) errors.scopeValues = "Unknown application or agent.";

  const exemptRoleIds = list(input.exemptRoleIds);
  if (exemptRoleIds.some((v) => !UUID_RE.test(v))) errors.exemptRoleIds = "Unknown role.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, description, effect, permissions, scopeType, scopeValues, exemptRoleIds } };
}
