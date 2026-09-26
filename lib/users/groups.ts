import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * FOUNDATION-P0-26 — groups (spec §11–12): people grouped to manage
 * access at scale; a group's roles apply to every member, on their next
 * request (getTenantContext() resolves direct and group roles together).
 *
 * Reads use the member's own client (RLS: this tenant's groups only, plus
 * an explicit tenant filter). Writes use the service role, re-checking that
 * the group, the person and the role all belong to this tenant. No
 * escalation through groups: nobody adds themselves, and nobody gives a
 * role to a group they are in — checked here, and refused by the database
 * too (migration 0099).
 */

export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  memberCount: number;
  roles: string[];
};
export type GroupMember = {
  userId: string;
  name: string;
  email: string;
  status: string;
  addedAt: string;
};
export type GroupRole = {
  roleId: string;
  name: string;
  displayName: string;
  custom: boolean;
  grantedAt: string;
};
export type GroupDetail = GroupSummary & {
  members: GroupMember[];
  roleAssignments: GroupRole[];
  createdAt: string;
  updatedAt: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  group_members: { user_id: string; created_at: string }[];
  group_roles: {
    role_id: string;
    created_at: string;
    roles: {
      name: string;
      display_name: string;
      tenant_id: string | null;
    } | null;
  }[];
};

const GROUP_SELECT =
  "id, name, description, status, created_at, updated_at, group_members(user_id, created_at), group_roles(role_id, created_at, roles(name, display_name, tenant_id))";

function summary(g: GroupRow): GroupSummary {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    status: g.status,
    memberCount: g.group_members.length,
    roles: g.group_roles
      .map((r) => r.roles?.display_name)
      .filter((n): n is string => !!n)
      .sort(),
  };
}

export async function listGroups(tenantId: string): Promise<GroupSummary[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("groups").select(GROUP_SELECT).eq("tenant_id", tenantId).order("name").limit(500).returns<GroupRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(summary);
}

async function readGroup(tenantId: string, groupId: string): Promise<GroupRow | null> {
  if (!UUID_RE.test(groupId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("groups").select(GROUP_SELECT).eq("tenant_id", tenantId).eq("id", groupId).maybeSingle<GroupRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data;
}

export async function getGroup(tenantId: string, groupId: string): Promise<GroupDetail | null> {
  const g = await readGroup(tenantId, groupId);
  if (!g) return null;
  const ids = g.group_members.map((m) => m.user_id);
  const db = supabaseServiceRole();
  const [{ data: people }, { data: memberships }] = await Promise.all([
    ids.length ? db.from("users").select("id, email, display_name").in("id", ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from("tenant_memberships").select("user_id, status").eq("tenant_id", tenantId).in("user_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const personOf = new Map(
    (
      (people ?? []) as {
        id: string;
        email: string;
        display_name: string | null;
      }[]
    ).map((p) => [p.id, p]),
  );
  const statusOf = new Map(((memberships ?? []) as { user_id: string; status: string }[]).map((m) => [m.user_id, m.status]));
  return {
    ...summary(g),
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    members: g.group_members
      .map((m) => {
        const p = personOf.get(m.user_id);
        return {
          userId: m.user_id,
          name: p?.display_name || p?.email || "A former member",
          email: p?.email ?? "",
          status: statusOf.get(m.user_id) ?? "removed",
          addedAt: m.created_at,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    roleAssignments: g.group_roles
      .filter((r) => r.roles)
      .map((r) => ({
        roleId: r.role_id,
        name: r.roles!.name,
        displayName: r.roles!.display_name,
        custom: r.roles!.tenant_id !== null,
        grantedAt: r.created_at,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

/** The groups a person is in, with each group's roles — for their user page and effective permissions. */
export type UserGroup = {
  id: string;
  name: string;
  status: string;
  roles: { id: string; name: string; displayName: string; status: string }[];
};

export async function groupsOfUser(tenantId: string, userId: string): Promise<UserGroup[]> {
  if (!UUID_RE.test(userId)) return [];
  const { data, error } = await supabaseServiceRole()
    .from("group_members")
    .select("group_id, groups(id, name, status, group_roles(roles(id, name, display_name, status)))")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .returns<
      {
        group_id: string;
        groups: {
          id: string;
          name: string;
          status: string;
          group_roles: {
            roles: {
              id: string;
              name: string;
              display_name: string;
              status: string;
            } | null;
          }[];
        } | null;
      }[]
    >();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? [])
    .filter((r) => r.groups)
    .map((r) => ({
      id: r.groups!.id,
      name: r.groups!.name,
      status: r.groups!.status,
      roles: r
        .groups!.group_roles.filter((gr) => gr.roles)
        .map((gr) => ({
          id: gr.roles!.id,
          name: gr.roles!.name,
          displayName: gr.roles!.display_name,
          status: gr.roles!.status,
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function cleanName(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

export type GroupResult = { ok: true; groupId: string } | { ok: false; errors: Record<string, string> };

function validate(input: { name?: unknown; description?: unknown }): { ok: true; name: string; description: string | null } | { ok: false; errors: Record<string, string> } {
  const name = cleanName(input.name);
  const description = cleanName(input.description) || null;
  const errors: Record<string, string> = {};
  if (name.length < 2 || name.length > 80) errors.name = "Give the group a name of 2 to 80 characters.";
  if (description && description.length > 500) errors.description = "Keep the description under 500 characters.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, name, description };
}

export async function createGroup(tenantId: string, actorId: string, input: { name?: unknown; description?: unknown }): Promise<GroupResult> {
  const v = validate(input);
  if (!v.ok) return v;
  const { data, error } = await supabaseServiceRole()
    .from("groups")
    .insert({
      tenant_id: tenantId,
      name: v.name,
      description: v.description,
      created_by: actorId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    if (error?.code === "23505")
      return {
        ok: false,
        errors: { name: "A group with that name already exists." },
      };
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create the group");
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "group.created",
    objectType: "group",
    objectId: data.id,
    outcome: "success",
    metadata: { name: v.name },
  });
  return { ok: true, groupId: data.id };
}

async function groupIn(tenantId: string, groupId: string): Promise<GroupRow> {
  const g = await readGroup(tenantId, groupId);
  if (!g) throw new ApiError(404, "NOT_FOUND", "No such group in this organization");
  return g;
}

export async function updateGroup(tenantId: string, actorId: string, groupId: string, input: { name?: unknown; description?: unknown }): Promise<GroupResult> {
  const g = await groupIn(tenantId, groupId);
  const v = validate(input);
  if (!v.ok) return v;
  const { error } = await supabaseServiceRole().from("groups").update({ name: v.name, description: v.description }).eq("tenant_id", tenantId).eq("id", g.id);
  if (error) {
    if (error.code === "23505")
      return {
        ok: false,
        errors: { name: "A group with that name already exists." },
      };
    throw new ApiError(500, "UPDATE_FAILED", error.message);
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "group.updated",
    objectType: "group",
    objectId: g.id,
    outcome: "success",
    metadata: { name: v.name, renamedFrom: g.name !== v.name ? g.name : null },
  });
  return { ok: true, groupId: g.id };
}

/** Delete a group: its members lose its roles on their next request. */
export async function deleteGroup(tenantId: string, actorId: string, groupId: string): Promise<void> {
  const g = await groupIn(tenantId, groupId);
  const { error } = await supabaseServiceRole().from("groups").delete().eq("tenant_id", tenantId).eq("id", g.id);
  if (error) throw new ApiError(500, "DELETE_FAILED", error.message);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "group.deleted",
    objectType: "group",
    objectId: g.id,
    outcome: "success",
    metadata: {
      name: g.name,
      members: g.group_members.length,
      roles: g.group_roles.map((r) => r.roles?.name).filter(Boolean),
    },
  });
}

export async function addGroupMember(tenantId: string, actorId: string, groupId: string, userId: string): Promise<void> {
  const g = await groupIn(tenantId, groupId);
  if (actorId === userId) {
    await writeAudit({
      tenantId,
      actorId,
      actorType: "user",
      action: "group.member_added",
      objectType: "group",
      objectId: g.id,
      outcome: "failure",
      metadata: { refused: "SELF_ESCALATION" },
    });
    throw new ApiError(403, "SELF_ESCALATION", "You can't add yourself to a group. Another administrator must do it.");
  }
  if (!UUID_RE.test(userId)) throw new ApiError(404, "NOT_FOUND", "No such user in this organization");
  const { data: m } = await supabaseServiceRole().from("tenant_memberships").select("status").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle<{ status: string }>();
  if (!m || m.status === "removed") throw new ApiError(404, "NOT_FOUND", "No such user in this organization");
  const { error } = await supabaseServiceRole().from("group_members").insert({
    group_id: g.id,
    tenant_id: tenantId,
    user_id: userId,
    added_by: actorId,
  });
  if (error && error.code !== "23505") throw new ApiError(500, "ADD_FAILED", error.message);
  if (error) return; // already a member
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "group.member_added",
    objectType: "user",
    objectId: userId,
    outcome: "success",
    metadata: { group: g.name, groupId: g.id },
  });
}

export async function removeGroupMember(tenantId: string, actorId: string, groupId: string, userId: string): Promise<void> {
  const g = await groupIn(tenantId, groupId);
  const { data, error } = await supabaseServiceRole().from("group_members").delete().eq("tenant_id", tenantId).eq("group_id", g.id).eq("user_id", userId).select("user_id");
  if (error) throw new ApiError(500, "REMOVE_FAILED", error.message);
  if (!data?.length) return;
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "group.member_removed",
    objectType: "user",
    objectId: userId,
    outcome: "success",
    metadata: { group: g.name, groupId: g.id },
  });
}

export async function addGroupRole(tenantId: string, actorId: string, groupId: string, roleName: string): Promise<void> {
  const g = await groupIn(tenantId, groupId);
  if (g.group_members.some((m) => m.user_id === actorId)) {
    await writeAudit({
      tenantId,
      actorId,
      actorType: "user",
      action: "group.role_assigned",
      objectType: "group",
      objectId: g.id,
      outcome: "failure",
      metadata: { role: roleName, refused: "SELF_ESCALATION" },
    });
    throw new ApiError(403, "SELF_ESCALATION", "You're in this group, so you can't give it roles. Another administrator must do it.");
  }
  const { data: role } = await supabaseServiceRole()
    .from("roles")
    .select("id, status, display_name")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq("name", roleName)
    .maybeSingle<{ id: string; status: string; display_name: string }>();
  if (!role) throw new ApiError(400, "UNKNOWN_ROLE", `Unknown role: ${roleName}`);
  if (role.status !== "active") throw new ApiError(409, "ROLE_INACTIVE", "That role is inactive. Activate it before assigning it.");
  const { error } = await supabaseServiceRole().from("group_roles").insert({
    group_id: g.id,
    tenant_id: tenantId,
    role_id: role.id,
    granted_by: actorId,
  });
  if (error && error.code !== "23505") {
    if ((error.message ?? "").includes("SELF_ESCALATION")) throw new ApiError(403, "SELF_ESCALATION", "Members of a group can't give it roles.");
    throw new ApiError(500, "ASSIGN_FAILED", error.message);
  }
  if (error) return;
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "group.role_assigned",
    objectType: "group",
    objectId: g.id,
    outcome: "success",
    metadata: { role: roleName, group: g.name },
  });
}

export async function removeGroupRole(tenantId: string, actorId: string, groupId: string, roleId: string): Promise<void> {
  const g = await groupIn(tenantId, groupId);
  const { data, error } = await supabaseServiceRole().from("group_roles").delete().eq("tenant_id", tenantId).eq("group_id", g.id).eq("role_id", roleId).select("role_id");
  if (error) throw new ApiError(500, "REMOVE_FAILED", error.message);
  if (!data?.length) return;
  const name = g.group_roles.find((r) => r.role_id === roleId)?.roles?.name ?? roleId;
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "group.role_removed",
    objectType: "group",
    objectId: g.id,
    outcome: "success",
    metadata: { role: name, group: g.name },
  });
}
