import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getSessionUser } from "@/lib/tenant/session";
import type { TenantContext } from "@/lib/shared/types/foundation";

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

type RoleRow = {
  tenant_id: string;
  roles: { name: string; role_permissions: { permissions: { key: string } }[] } | null;
};

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
    .select("tenant_id, roles(name, role_permissions(permissions(key)))")
    .eq("user_id", user.id)
    .returns<RoleRow[]>();
  return data ?? [];
});

/**
 * Resolves the current request's tenant context. Tenant context comes ONLY
 * from the authenticated user's active tenant_memberships rows (via RLS) —
 * never from a URL param, header, or request body. See
 * CLAUDE.md non-negotiable #2 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-02.5.
 *
 * The `wa_tenant` cookie only *chooses among* memberships the database
 * says the user holds; a cookie naming a tenant they are not a member of
 * is ignored.
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

  const [memberships, roleRows, cookieStore] = await Promise.all([getMyMemberships(), getMyRoleRows(), cookies()]);

  const requestedTenantId = cookieStore.get(TENANT_COOKIE_NAME)?.value ?? null;
  const activeMembership = memberships.find((m) => m.tenantId === requestedTenantId) ?? memberships[0] ?? null;

  if (!activeMembership) {
    return { userId: user.id, tenantId: null, tenantSlug: null, roles: [], permissions: [] };
  }

  const tenantId = activeMembership.tenantId;
  const roles = new Set<string>();
  const permissions = new Set<string>();
  for (const row of roleRows) {
    if (row.tenant_id !== tenantId || !row.roles) continue;
    roles.add(row.roles.name);
    for (const rp of row.roles.role_permissions ?? []) {
      if (rp.permissions?.key) permissions.add(rp.permissions.key);
    }
  }

  return {
    userId: user.id,
    tenantId,
    tenantSlug: activeMembership.slug || null,
    roles: [...roles],
    permissions: [...permissions],
  };
});
