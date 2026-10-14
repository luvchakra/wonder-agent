import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * COMPLIANCE-P0-11 — Foundation's published read of the organization's role
 * assignments, for Compliance's access reviews. One row per role a member
 * holds, directly or through a group. Active people only: automation
 * credentials are reviewed on their own page, and a delegation's
 * time-bound copies end with the delegation. Service role, every query
 * pinned to the tenant (§14).
 */
export type ReviewableRoleAssignment = {
  userId: string;
  roleId: string;
  roleName: string;
  roleDisplayName: string;
  privileged: boolean;
  source: "direct" | "group";
  groupId: string | null;
  groupName: string | null;
  scopeType: string | null;
  expiresAt: string | null;
};

type RoleRow = { id: string; name: string; display_name: string; status: string };

export async function listRoleAssignmentsForReview(tenantId: string, opts: { privilegedOnly?: boolean } = {}, now = new Date()): Promise<ReviewableRoleAssignment[]> {
  const db = supabaseServiceRole();
  const [members, direct, groupRoles, groupMembers] = await Promise.all([
    db.from("tenant_memberships").select("user_id, account_type").eq("tenant_id", tenantId).eq("status", "active").limit(10000),
    db.from("user_roles").select("tenant_id, user_id, role_id, scope_type, starts_at, expires_at, roles(id, name, display_name, status)").eq("tenant_id", tenantId).is("delegation_id", null).limit(20000),
    db.from("group_roles").select("tenant_id, group_id, role_id, scope_type, starts_at, expires_at, roles(id, name, display_name, status), groups(id, name, status)").eq("tenant_id", tenantId).limit(5000),
    db.from("group_members").select("tenant_id, group_id, user_id").eq("tenant_id", tenantId).limit(20000),
  ]);
  for (const r of [members, direct, groupRoles, groupMembers]) if (r.error) throw new ApiError(500, "QUERY_FAILED", r.error.message);

  const people = new Set(((members.data ?? []) as { user_id: string; account_type: string }[]).filter((m) => m.account_type !== "automation").map((m) => m.user_id));
  const live = (r: { starts_at?: string | null; expires_at?: string | null }) => (!r.starts_at || new Date(r.starts_at) <= now) && (!r.expires_at || new Date(r.expires_at) > now);

  const out: ReviewableRoleAssignment[] = [];
  type DirectRow = { tenant_id: string; user_id: string; role_id: string; scope_type: string | null; starts_at: string | null; expires_at: string | null; roles: RoleRow | null };
  for (const r of (direct.data ?? []) as unknown as DirectRow[]) {
    if (r.tenant_id !== tenantId || !people.has(r.user_id) || !r.roles || r.roles.status !== "active" || !live(r)) continue;
    out.push({ userId: r.user_id, roleId: r.role_id, roleName: r.roles.name, roleDisplayName: r.roles.display_name, privileged: false, source: "direct", groupId: null, groupName: null, scopeType: r.scope_type, expiresAt: r.expires_at });
  }
  type GroupRoleRow = { tenant_id: string; group_id: string; role_id: string; scope_type: string | null; starts_at: string | null; expires_at: string | null; roles: RoleRow | null; groups: { id: string; name: string; status: string } | null };
  const membersOf = new Map<string, string[]>();
  for (const m of (groupMembers.data ?? []) as { tenant_id: string; group_id: string; user_id: string }[]) {
    if (m.tenant_id !== tenantId) continue;
    membersOf.set(m.group_id, [...(membersOf.get(m.group_id) ?? []), m.user_id]);
  }
  for (const g of (groupRoles.data ?? []) as unknown as GroupRoleRow[]) {
    if (g.tenant_id !== tenantId || !g.roles || g.roles.status !== "active" || !g.groups || g.groups.status !== "active" || !live(g)) continue;
    for (const userId of membersOf.get(g.group_id) ?? []) {
      if (!people.has(userId)) continue;
      out.push({ userId, roleId: g.role_id, roleName: g.roles.name, roleDisplayName: g.roles.display_name, privileged: false, source: "group", groupId: g.group_id, groupName: g.groups.name, scopeType: g.scope_type, expiresAt: g.expires_at });
    }
  }

  // A role is privileged when any of its permissions is (the permission catalogue's sensitivity).
  const roleIds = [...new Set(out.map((a) => a.roleId))];
  const privileged = new Set<string>();
  for (let i = 0; i < roleIds.length; i += 500) {
    const { data, error } = await db.from("role_permissions").select("role_id, permissions(sensitivity)").in("role_id", roleIds.slice(i, i + 500));
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const rp of (data ?? []) as unknown as { role_id: string; permissions: { sensitivity: string } | null }[]) if (rp.permissions?.sensitivity === "privileged") privileged.add(rp.role_id);
  }
  const rows = out.map((a) => ({ ...a, privileged: privileged.has(a.roleId) }));
  return opts.privilegedOnly ? rows.filter((a) => a.privileged) : rows;
}
