import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";

export type TenantMemberWithRoles = {
  userId: string;
  email: string;
  displayName: string | null;
  roles: string[];
};

/** FOUNDATION-P0-04.3 — tenant-scoped member + assigned-role listing. */
export async function listTenantMembersWithRoles(tenantId: string): Promise<TenantMemberWithRoles[]> {
  const supabase = await supabaseServer();

  const { data: memberships, error: membershipsError } = await supabase
    .from("tenant_memberships")
    .select("user_id, status, users(email, display_name)")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .returns<{ user_id: string; users: { email: string; display_name: string | null } | null }[]>();
  if (membershipsError) throw new ApiError(500, "QUERY_FAILED", membershipsError.message);

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("user_id, roles(name)")
    .eq("tenant_id", tenantId)
    .returns<{ user_id: string; roles: { name: string } | null }[]>();
  if (rolesError) throw new ApiError(500, "QUERY_FAILED", rolesError.message);

  const rolesByUser = new Map<string, string[]>();
  for (const row of roleRows ?? []) {
    if (!row.roles) continue;
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.roles.name);
    rolesByUser.set(row.user_id, list);
  }

  return (memberships ?? []).map((m) => ({
    userId: m.user_id,
    email: m.users?.email ?? "",
    displayName: m.users?.display_name ?? null,
    roles: rolesByUser.get(m.user_id) ?? [],
  }));
}

/** The system role catalog available for assignment (P0: no per-tenant custom roles — see backlog P1). */
export async function listAssignableRoles(): Promise<{ id: string; name: string }[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("roles")
    .select("id, name")
    .is("tenant_id", null)
    .order("name")
    .returns<{ id: string; name: string }[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ?? [];
}

// FOUNDATION-P0-23: roles can be managed for any member still in the
// organization (invited, suspended and deactivated included — only an
// active membership makes them effective); never for a removed one. Read
// with the service role, since members who are not active are outside the
// caller's RLS view, and filtered by the verified tenant.
async function assertTenantMember(tenantId: string, userId: string) {
  const { data } = await supabaseServiceRole()
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .neq("status", "removed")
    .maybeSingle();
  if (!data) throw new ApiError(404, "NOT_FOUND", "User is not a member of this tenant");
}

// Migration 0096's guards (last administrator, self-grant), as answers.
function refusalFrom(error: { message?: string } | null): ApiError | null {
  const msg = error?.message ?? "";
  if (msg.includes("LAST_TENANT_ADMIN")) {
    return new ApiError(409, "LAST_TENANT_ADMIN", "This would leave the organization without a Tenant Administrator. Assign another administrator first.");
  }
  if (msg.includes("user_roles_no_self_grant")) return new ApiError(403, "SELF_ESCALATION", "You can't assign a role to yourself.");
  return null;
}

/**
 * Assigns a system role to a tenant member. `user_roles` has no client
 * INSERT policy (role assignment is a privileged, audited action gated by
 * `role.manage`), so this writes via the service-role client — the caller
 * must have already verified `requirePermission('role.manage')` and passed
 * the verified tenantId, never a client-supplied one (CLAUDE.md §14).
 */
export async function assignRole(
  tenantId: string,
  actorId: string,
  targetUserId: string,
  roleName: string,
): Promise<void> {
  // Nobody grants themselves a role (spec §30); the database refuses it too.
  if (actorId === targetUserId) {
    await writeAudit({ tenantId, actorId, actorType: "user", action: "role.assigned", objectType: "user_role", objectId: targetUserId, outcome: "failure", metadata: { role: roleName, refused: "SELF_ESCALATION" } });
    throw new ApiError(403, "SELF_ESCALATION", "You can't assign a role to yourself. Another administrator must do it.");
  }
  await assertTenantMember(tenantId, targetUserId);

  const supabase = supabaseServiceRole();
  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .is("tenant_id", null)
    .eq("name", roleName)
    .maybeSingle<{ id: string }>();
  if (!role) throw new ApiError(400, "UNKNOWN_ROLE", `Unknown role: ${roleName}`);

  const { error } = await supabase
    .from("user_roles")
    .insert({ tenant_id: tenantId, user_id: targetUserId, role_id: role.id, granted_by: actorId });
  // unique(tenant_id, user_id, role_id) makes a duplicate assignment a
  // harmless no-op from the caller's point of view.
  if (error && error.code !== "23505") throw refusalFrom(error) ?? new ApiError(500, "ASSIGN_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "role.assigned",
    objectType: "user_role",
    objectId: targetUserId,
    outcome: "success",
    metadata: { role: roleName, targetUserId },
  });
}

/** Removes a system role from a tenant member (same service-role/audit pattern as assignRole). */
export async function removeRole(
  tenantId: string,
  actorId: string,
  targetUserId: string,
  roleName: string,
): Promise<void> {
  await assertTenantMember(tenantId, targetUserId);

  const supabase = supabaseServiceRole();
  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .is("tenant_id", null)
    .eq("name", roleName)
    .maybeSingle<{ id: string }>();
  if (!role) throw new ApiError(400, "UNKNOWN_ROLE", `Unknown role: ${roleName}`);

  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", targetUserId)
    .eq("role_id", role.id);
  if (error) {
    const refusal = refusalFrom(error);
    if (refusal) {
      await writeAudit({ tenantId, actorId, actorType: "user", action: "role.removed", objectType: "user_role", objectId: targetUserId, outcome: "failure", metadata: { role: roleName, refused: refusal.code } });
      throw refusal;
    }
    throw new ApiError(500, "REMOVE_FAILED", error.message);
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "role.removed",
    objectType: "user_role",
    objectId: targetUserId,
    outcome: "success",
    metadata: { role: roleName, targetUserId },
  });
}
