import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";

/**
 * FOUNDATION-P0-28 — the active members of ONE tenant who hold a permission
 * tenant-wide (directly or through an active group), for addressing
 * notifications to the people who can act on them (billing alerts to
 * billing administrators, privacy deadlines to privacy staff) instead of
 * broadcasting to the whole tenant.
 *
 * Service-role read: every query below is filtered to `tenantId`, the
 * server-resolved tenant the caller passes (§14). It never decides
 * authorization — requirePermission() does — it only picks recipients.
 */
export async function listPermissionHolders(tenantId: string, permissionKey: string): Promise<string[]> {
  const supabase = supabaseServiceRole();
  const { data: perm } = await supabase.from("permissions").select("id").eq("key", permissionKey).maybeSingle();
  if (!perm) return [];
  const { data: rp } = await supabase.from("role_permissions").select("role_id, roles!inner(status)").eq("permission_id", perm.id).eq("roles.status", "active");
  const roleIds = (rp ?? []).map((r) => r.role_id as string);
  if (!roleIds.length) return [];

  const now = new Date().toISOString();
  const valid = (row: { scope_type: string; starts_at: string | null; expires_at: string | null }) =>
    row.scope_type === "tenant" && (!row.starts_at || row.starts_at <= now) && (!row.expires_at || row.expires_at > now);

  const [{ data: direct }, { data: viaGroups }, { data: members }] = await Promise.all([
    supabase.from("user_roles").select("user_id, scope_type, starts_at, expires_at").eq("tenant_id", tenantId).in("role_id", roleIds),
    supabase
      .from("group_roles")
      .select("group_id, scope_type, starts_at, expires_at, groups!inner(status, group_members(user_id))")
      .eq("tenant_id", tenantId)
      .eq("groups.status", "active")
      .in("role_id", roleIds),
    supabase.from("tenant_memberships").select("user_id").eq("tenant_id", tenantId).eq("status", "active"),
  ]);

  const active = new Set((members ?? []).map((m) => m.user_id as string));
  const holders = new Set<string>();
  for (const row of direct ?? []) if (valid(row)) holders.add(row.user_id as string);
  for (const row of (viaGroups ?? []) as unknown as { scope_type: string; starts_at: string | null; expires_at: string | null; groups: { group_members: { user_id: string }[] } | null }[]) {
    if (!valid(row)) continue;
    for (const m of row.groups?.group_members ?? []) holders.add(m.user_id);
  }
  return [...holders].filter((u) => active.has(u));
}
