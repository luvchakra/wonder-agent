import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getSessionUser } from "@/lib/tenant/session";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import type { TenantContext } from "@/lib/shared/types/foundation";
import { grantActive, tenantWidePermissions, type AuthorizationPolicy, type Grant, type ScopeType } from "@/lib/rbac/authorizeCore";

export const TENANT_COOKIE_NAME = "wa_tenant";

export type Membership = {
  tenantId: string;
  name: string;
  slug: string;
};

type MembershipRow = {
  tenant_id: string;
  tenants: { name: string; slug: string } | null;
};

type RoleOf = { id: string; name: string; display_name: string; status: string; role_permissions: { permissions: { key: string } | null }[] } | null;

/** An assignment's terms (FOUNDATION-P0-19, migration 0100): scope, validity, condition. */
type Terms = { scope_type: ScopeType; scope_values: string[]; starts_at: string | null; expires_at: string | null; requires_mfa: boolean };

type RoleRow = Terms & { tenant_id: string; roles: RoleOf };

const ROLE_SELECT = "roles(id, name, display_name, status, role_permissions(permissions(key)))";
const TERMS_SELECT = "scope_type, scope_values, starts_at, expires_at, requires_mfa";

/**
 * The current user's active tenant memberships, once per request. The
 * customer shell's organization switcher lists these too; it used to run
 * its own copy of the same query.
 *
 * `user_id` is filtered explicitly, not left to RLS: the tenant_memberships
 * policy is tenant-scoped (every member of a tenant can read that tenant's
 * membership rows), so without this the list is every colleague's
 * membership, not this user's own.
 */
export const getMyMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants(name, slug)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .returns<MembershipRow[]>();
  return (data ?? []).map((m) => ({
    tenantId: m.tenant_id,
    name: m.tenants?.name ?? m.tenant_id,
    slug: m.tenants?.slug ?? "",
  }));
});

/**
 * The current user's role rows across every tenant they belong to, once
 * per request. Fetched without a tenant filter so it can run in parallel
 * with the membership lookup rather than after it; the caller picks the
 * active tenant's rows out of the result.
 *
 * Filtered by user_id for the same reason as the membership query: the
 * user_roles RLS policy is tenant-scoped, so without this the caller
 * inherits the union of EVERY role held by EVERY member of the tenant — a
 * READ_ONLY user in a tenant that also contains a TENANT_SUPER_ADMIN would
 * resolve with role.manage, agent.create and the rest. Privilege
 * escalation, not just a cosmetic over-fetch.
 */
const getMyRoleRows = cache(async (): Promise<RoleRow[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("user_roles")
    .select(`tenant_id, ${TERMS_SELECT}, ${ROLE_SELECT}`)
    .eq("user_id", user.id)
    .returns<RoleRow[]>();
  return data ?? [];
});

type GroupRoleRow = {
  tenant_id: string;
  groups: { name: string; status: string; group_roles: (Terms & { roles: RoleOf })[] } | null;
};

/**
 * FOUNDATION-P0-26 — the roles the user holds through groups, resolved per
 * request like direct roles, so joining or leaving a group applies on the
 * next request. Filtered by user_id for the same reason as above (the
 * group_members RLS policy is tenant-scoped); RLS limits the rows to
 * tenants where the user is an active member.
 */
const getMyGroupRoleRows = cache(async (): Promise<GroupRoleRow[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("group_members")
    .select(`tenant_id, groups(name, status, group_roles(${TERMS_SELECT}, ${ROLE_SELECT}))`)
    .eq("user_id", user.id)
    .returns<GroupRoleRow[]>();
  return data ?? [];
});

type PolicyRow = {
  id: string;
  tenant_id: string;
  name: string;
  effect: AuthorizationPolicy["effect"];
  permissions: string[];
  scope_type: ScopeType;
  scope_values: string[];
  exempt_role_ids: string[];
};

/**
 * FOUNDATION-P0-19 — the active explicit authorization policies of the
 * tenants the user belongs to (RLS), once per request. If they cannot be
 * read, the context fails closed: see getTenantContext().
 */
const getMyPolicyRows = cache(async (): Promise<PolicyRow[] | null> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("authorization_policies")
    .select("id, tenant_id, name, effect, permissions, scope_type, scope_values, exempt_role_ids")
    .eq("status", "active")
    .returns<PolicyRow[]>();
  return error ? null : (data ?? []);
});

function grantOf(terms: Terms, role: NonNullable<RoleOf>, source: Grant["source"], via: string | null): Grant {
  return {
    roleId: role.id,
    role: role.name,
    roleDisplayName: role.display_name,
    source,
    via,
    permissions: role.role_permissions.map((rp) => rp.permissions?.key).filter((k): k is string => !!k),
    scopeType: terms.scope_type ?? "tenant",
    scopeValues: terms.scope_values ?? [],
    startsAt: terms.starts_at ?? null,
    expiresAt: terms.expires_at ?? null,
    requiresMfa: !!terms.requires_mfa,
  };
}

/**
 * Resolves the current request's tenant context. Tenant context comes ONLY
 * from the authenticated user's active tenant_memberships rows (via RLS) —
 * never from a URL param, header, or request body. See
 * CLAUDE.md non-negotiable #2 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-02.5.
 *
 * The `wa_tenant` cookie only *chooses among* memberships the database
 * says the user holds; a cookie naming a tenant they are not a member of
 * is ignored. On a tenant's own address the hostname fixes the candidate
 * instead (FOUNDATION-P0-22) — still only among the user's memberships.
 *
 * Resolved once per request (`cache()`): the layout, the page, and the
 * service calls under them all share it. The two lookups it needs run in
 * parallel, so the whole thing is one database round trip after the
 * (local) session check rather than the three sequential ones it used to
 * be.
 */
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const user = await getSessionUser();
  if (!user) {
    return { userId: "", tenantId: null, tenantSlug: null, roles: [], permissions: [] };
  }

  const [memberships, directRoleRows, groupRoleRows, policyRows, cookieStore, host] = await Promise.all([
    getMyMemberships(),
    getMyRoleRows(),
    getMyGroupRoleRows(),
    getMyPolicyRows(),
    cookies(),
    getHostTenant(),
  ]);

  // FOUNDATION-P0-22 — on a tenant's own address (`<slug>.<BASE_APP_HOST>`)
  // that tenant is the only candidate: the user must hold an active
  // membership in it, or there is no tenant context at all (never a
  // fallback to another of their organizations). Elsewhere the cookie
  // chooses among the user's memberships, as before.
  let activeMembership: Membership | null;
  if (host.target.kind === "subdomain" || host.target.kind === "invalid") {
    activeMembership = host.tenant ? (memberships.find((m) => m.tenantId === host.tenant!.tenantId) ?? null) : null;
  } else {
    const requestedTenantId = cookieStore.get(TENANT_COOKIE_NAME)?.value ?? null;
    activeMembership = memberships.find((m) => m.tenantId === requestedTenantId) ?? memberships[0] ?? null;
  }

  if (!activeMembership) {
    return { userId: user.id, tenantId: null, tenantSlug: null, roles: [], permissions: [] };
  }

  const tenantId = activeMembership.tenantId;
  // FOUNDATION-P0-19 — the engine's facts for this tenant: every role
  // assignment, direct and through active groups, with its terms. An
  // inactive role grants nothing (FOUNDATION-P0-25).
  const grants: Grant[] = [];
  for (const row of directRoleRows) {
    if (row.tenant_id === tenantId && row.roles && row.roles.status === "active") grants.push(grantOf(row, row.roles, "DIRECT", null));
  }
  for (const g of groupRoleRows) {
    if (g.tenant_id !== tenantId || g.groups?.status !== "active") continue;
    for (const gr of g.groups.group_roles) if (gr.roles && gr.roles.status === "active") grants.push(grantOf(gr, gr.roles, "GROUP", g.groups.name));
  }
  // Policies that cannot be read are never permission (CLAUDE.md §17.4):
  // the context then carries no permissions at all.
  if (policyRows === null) {
    return { userId: user.id, tenantId, tenantSlug: activeMembership.slug || null, roles: [], permissions: [], grants: [], policies: [], aal: user.aal };
  }
  const policies: AuthorizationPolicy[] = policyRows
    .filter((p) => p.tenant_id === tenantId)
    .map((p) => ({ id: p.id, name: p.name, effect: p.effect, permissions: p.permissions, scopeType: p.scope_type, scopeValues: p.scope_values, exemptRoleIds: p.exempt_role_ids }));
  const now = new Date();
  // Roles and permissions in effect across the whole tenant; scoped grants
  // count only where a resource is named (lib/rbac/authorize.ts).
  const permissions = tenantWidePermissions(grants, policies, now, user.aal);
  const roles = [...new Set(grants.filter((g) => g.scopeType === "tenant" && isLive(g, now, user.aal)).map((g) => g.role))];

  return {
    userId: user.id,
    tenantId,
    tenantSlug: activeMembership.slug || null,
    roles,
    permissions,
    grants,
    policies,
    aal: user.aal,
  };
});

function isLive(g: Grant, now: Date, aal: "aal1" | "aal2" | null): boolean {
  return grantActive(g, now) === "ACTIVE" && (!g.requiresMfa || aal === "aal2");
}
