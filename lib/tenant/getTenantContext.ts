import "server-only";

import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import type { TenantContext } from "@/lib/shared/types/foundation";

export const TENANT_COOKIE_NAME = "wa_tenant";

type MembershipRow = {
  tenant_id: string;
  tenants: { slug: string } | null;
};

/**
 * Resolves the current request's tenant context. Tenant context comes ONLY
 * from the authenticated user's active tenant_memberships rows (via RLS) —
 * never from a URL param, header, or request body. See
 * CLAUDE.md non-negotiable #2 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-02.5.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: "", tenantId: null, tenantSlug: null, roles: [], permissions: [] };
  }

  const { data: memberships } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants(slug)")
    .eq("status", "active")
    .returns<MembershipRow[]>();

  const cookieStore = await cookies();
  const requestedTenantId = cookieStore.get(TENANT_COOKIE_NAME)?.value ?? null;

  const activeMembership =
    memberships?.find((m) => m.tenant_id === requestedTenantId) ?? memberships?.[0] ?? null;

  if (!activeMembership) {
    return { userId: user.id, tenantId: null, tenantSlug: null, roles: [], permissions: [] };
  }

  const tenantId = activeMembership.tenant_id;

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name, role_permissions(permissions(key)))")
    .eq("tenant_id", tenantId)
    .returns<
      { roles: { name: string; role_permissions: { permissions: { key: string } }[] } }[]
    >();

  const roles = new Set<string>();
  const permissions = new Set<string>();
  for (const row of roleRows ?? []) {
    if (!row.roles) continue;
    roles.add(row.roles.name);
    for (const rp of row.roles.role_permissions ?? []) {
      if (rp.permissions?.key) permissions.add(rp.permissions.key);
    }
  }

  return {
    userId: user.id,
    tenantId,
    tenantSlug: activeMembership.tenants?.slug ?? null,
    roles: [...roles],
    permissions: [...permissions],
  };
}
