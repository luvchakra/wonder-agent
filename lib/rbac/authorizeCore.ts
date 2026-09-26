/**
 * FOUNDATION-P0-19 — the authorization engine's deterministic core
 * (docs/requirements/WonderID_Tenant_User_Permissioning_Model.md §18–23,
 * 33). Pure: the facts come in (the subject's grants, the tenant's
 * policies, the request), a decision with its reasons comes out. No
 * database, no clock of its own, no model — the same facts always give the
 * same answer, and the answer carries everything needed to explain it
 * (FOUNDATION-P0-20).
 *
 * Evaluation order (§21): grant validity (start, expiry) → permission →
 * scope → conditions (MFA) → explicit policies (deny, require approval)
 * → decision. Tenant, authentication, membership and user status are
 * settled before this runs (getTenantContext(): only active members of the
 * resolved tenant get grants at all).
 *
 * Scope. A grant scoped to the tenant applies everywhere. A narrower grant
 * (an environment, applications, agents) applies only when the request
 * names a resource inside it: a check that names no resource ("may they
 * do this at all?", which is what requirePermission() asks) counts only
 * tenant-wide grants. So a scoped grant never widens into tenant-wide
 * access through a route that does not say which resource it touches.
 */

export const SCOPE_TYPES = ["tenant", "environment", "application", "agent"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];
export const ENVIRONMENTS = ["production", "staging", "development"] as const;

export type GrantSource = "DIRECT" | "GROUP";

export type Grant = {
  roleId: string;
  role: string;
  roleDisplayName: string;
  source: GrantSource;
  /** The group it comes through, for GROUP grants. */
  via: string | null;
  permissions: readonly string[];
  scopeType: ScopeType;
  /** Environments, application ids or agent ids; empty for the tenant. */
  scopeValues: readonly string[];
  startsAt: string | null;
  expiresAt: string | null;
  requiresMfa: boolean;
};

export type PolicyEffect = "DENY" | "REQUIRE_APPROVAL";

export type AuthorizationPolicy = {
  id: string;
  name: string;
  effect: PolicyEffect;
  /** Permission keys, or a prefix ending in `*` (e.g. `runtime.*`). */
  permissions: readonly string[];
  scopeType: ScopeType;
  scopeValues: readonly string[];
  /** Roles (by id) the policy does not apply to — a break-glass role, say. */
  exemptRoleIds: readonly string[];
};

/** The resource a request acts on, with the attributes scopes match on. */
export type ResourceRef = {
  type: "agent" | "application";
  id: string;
  environment?: string | null;
  /** For an agent: the applications it is approved for. */
  applicationIds?: readonly string[];
};

export type AuthorizationRequest = {
  permission: string;
  resource?: ResourceRef | null;
  now: Date;
  /** The session's authenticator assurance level. */
  aal: "aal1" | "aal2" | null;
};

export type ReasonCode =
  | "PERMISSION_MATCH"
  | "PERMISSION_MISSING"
  | "SCOPE_MATCH"
  | "OUT_OF_SCOPE"
  | "GRANT_NOT_STARTED"
  | "GRANT_EXPIRED"
  | "MFA_SATISFIED"
  | "MFA_REQUIRED"
  | "POLICY_DENY"
  | "POLICY_REQUIRES_APPROVAL"
  | "POLICY_EXEMPT";

export type Decision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type MatchedGrant = { role: string; roleDisplayName: string; source: GrantSource; via: string | null; scope: string };

export type AuthorizationResult = {
  decision: Decision;
  reasons: ReasonCode[];
  permission: string;
  /** Grants that allow the permission here (empty on a DENY for lack of one). */
  matched: MatchedGrant[];
  /** Grants that hold the permission but did not apply, and why. */
  notApplied: (MatchedGrant & { reason: ReasonCode })[];
  /** Policies that decided the outcome, or that the subject is exempt from. */
  policies: { id: string; name: string; effect: PolicyEffect; exempt: boolean }[];
};

export function describeScope(type: ScopeType, values: readonly string[]): string {
  if (type === "tenant") return "Entire organization";
  const label = type === "environment" ? "Environment" : type === "application" ? "Applications" : "Agents";
  return `${label}: ${values.join(", ") || "none"}`;
}

export function permissionMatches(pattern: string, permission: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return permission.startsWith(pattern.slice(0, -1));
  return pattern === permission;
}

/** Whether a scope covers the resource. Tenant scope covers everything, including "no resource". */
export function scopeCovers(type: ScopeType, values: readonly string[], resource: ResourceRef | null | undefined): boolean {
  if (type === "tenant") return true;
  if (!resource) return false;
  switch (type) {
    case "environment":
      return !!resource.environment && values.includes(resource.environment);
    case "application":
      return resource.type === "application" ? values.includes(resource.id) : (resource.applicationIds ?? []).some((a) => values.includes(a));
    case "agent":
      return resource.type === "agent" && values.includes(resource.id);
  }
}

export function grantActive(g: Pick<Grant, "startsAt" | "expiresAt">, now: Date): "ACTIVE" | "GRANT_NOT_STARTED" | "GRANT_EXPIRED" {
  if (g.startsAt && new Date(g.startsAt).getTime() > now.getTime()) return "GRANT_NOT_STARTED";
  if (g.expiresAt && new Date(g.expiresAt).getTime() <= now.getTime()) return "GRANT_EXPIRED";
  return "ACTIVE";
}

function matchedOf(g: Grant): MatchedGrant {
  return { role: g.role, roleDisplayName: g.roleDisplayName, source: g.source, via: g.via, scope: describeScope(g.scopeType, g.scopeValues) };
}

export function authorize(grants: readonly Grant[], policies: readonly AuthorizationPolicy[], req: AuthorizationRequest): AuthorizationResult {
  const holding = grants.filter((g) => g.permissions.includes(req.permission));
  const matched: Grant[] = [];
  const notApplied: AuthorizationResult["notApplied"] = [];
  for (const g of holding) {
    const active = grantActive(g, req.now);
    if (active !== "ACTIVE") notApplied.push({ ...matchedOf(g), reason: active });
    else if (!scopeCovers(g.scopeType, g.scopeValues, req.resource)) notApplied.push({ ...matchedOf(g), reason: "OUT_OF_SCOPE" });
    else if (g.requiresMfa && req.aal !== "aal2") notApplied.push({ ...matchedOf(g), reason: "MFA_REQUIRED" });
    else matched.push(g);
  }

  const base = { permission: req.permission, matched: matched.map(matchedOf), notApplied };
  if (!matched.length) {
    // The most specific reason a held permission did not apply; otherwise it is simply missing.
    const order: ReasonCode[] = ["MFA_REQUIRED", "OUT_OF_SCOPE", "GRANT_EXPIRED", "GRANT_NOT_STARTED"];
    const reason = order.find((r) => notApplied.some((n) => n.reason === r)) ?? "PERMISSION_MISSING";
    return { ...base, decision: "DENY", reasons: [reason], policies: [] };
  }

  const reasons: ReasonCode[] = ["PERMISSION_MATCH", "SCOPE_MATCH"];
  if (matched.some((g) => g.requiresMfa)) reasons.push("MFA_SATISFIED");
  const roleIds = new Set(matched.map((g) => g.roleId));
  const applicable = policies.filter((p) => p.permissions.some((pat) => permissionMatches(pat, req.permission)) && scopeCovers(p.scopeType, p.scopeValues, req.resource));
  const decided: AuthorizationResult["policies"] = [];
  let decision: Decision = "ALLOW";
  for (const p of applicable) {
    // Holding one exempt role that allows the action is the exception (§21's break-glass administrator).
    const exempt = p.exemptRoleIds.some((r) => roleIds.has(r));
    decided.push({ id: p.id, name: p.name, effect: p.effect, exempt });
    if (exempt) continue;
    if (p.effect === "DENY") decision = "DENY";
    else if (decision === "ALLOW") decision = "REQUIRE_APPROVAL";
  }
  if (decided.some((p) => p.exempt)) reasons.push("POLICY_EXEMPT");
  if (decision === "DENY") reasons.push("POLICY_DENY");
  if (decision === "REQUIRE_APPROVAL") reasons.push("POLICY_REQUIRES_APPROVAL");
  return { ...base, decision, reasons, policies: decided };
}

/**
 * Every permission the subject may use without naming a resource: what
 * TenantContext.permissions holds, and what requirePermission() checks.
 */
export function tenantWidePermissions(grants: readonly Grant[], policies: readonly AuthorizationPolicy[], now: Date, aal: AuthorizationRequest["aal"]): string[] {
  const keys = new Set(grants.flatMap((g) => g.permissions));
  return [...keys].filter((permission) => authorize(grants, policies, { permission, now, aal }).decision === "ALLOW").sort();
}
