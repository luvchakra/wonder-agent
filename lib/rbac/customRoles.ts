import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { listPermissionCatalog } from "./permissionCatalog";
import { escalationIn, permissionDiff, validateRoleInput, type RoleInput } from "./roleRules";

/**
 * FOUNDATION-P0-25 — system and custom roles (spec §15–17, 21–22).
 *
 * Reads use the member's own client: RLS shows system roles and the
 * caller's own tenant's custom roles, and every query also filters by the
 * server-resolved tenant. Writes use the service role (roles and
 * role_permissions have no client write policies) and touch only custom
 * roles of that tenant — re-read and checked before every change. System
 * roles cannot be changed here at all; the database refuses it too
 * (migration 0098). Designing a role never escalates: a role gains only
 * permissions its designer holds.
 */

export type RoleSummary = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  custom: boolean;
  status: "active" | "inactive";
  permissionCount: number;
  holderCount: number;
};

export type RoleHolder = { userId: string; name: string; email: string; status: string };

export type RoleDetail = RoleSummary & {
  permissions: string[];
  holders: RoleHolder[];
  createdBy: string | null;
  copiedFrom: { id: string; displayName: string } | null;
  updatedAt: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RoleRow = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  tenant_id: string | null;
  status: "active" | "inactive";
  created_by: string | null;
  copied_from: string | null;
  updated_at: string;
  role_permissions: { permissions: { key: string } | null }[];
};

const ROLE_SELECT = "id, name, display_name, description, tenant_id, status, created_by, copied_from, updated_at, role_permissions(permissions(key))";

async function holderCounts(tenantId: string): Promise<Map<string, number>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("user_roles").select("role_id, user_id").eq("tenant_id", tenantId).returns<{ role_id: string; user_id: string }[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const by = new Map<string, Set<string>>();
  for (const r of data ?? []) {
    if (!by.has(r.role_id)) by.set(r.role_id, new Set());
    by.get(r.role_id)!.add(r.user_id);
  }
  return new Map([...by].map(([k, v]) => [k, v.size]));
}

function toSummary(r: RoleRow, holders: number): RoleSummary {
  return {
    id: r.id,
    name: r.name,
    displayName: r.display_name,
    description: r.description,
    custom: r.tenant_id !== null,
    status: r.status,
    permissionCount: r.role_permissions.filter((rp) => rp.permissions).length,
    holderCount: holders,
  };
}

/** Every role this tenant can use: system roles first, then its custom roles. */
export async function listRoles(tenantId: string): Promise<RoleSummary[]> {
  const supabase = await supabaseServer();
  const [{ data, error }, counts] = await Promise.all([
    supabase.from("roles").select(ROLE_SELECT).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order("display_name").returns<RoleRow[]>(),
    holderCounts(tenantId),
  ]);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => toSummary(r, counts.get(r.id) ?? 0)).sort((a, b) => Number(a.custom) - Number(b.custom) || a.displayName.localeCompare(b.displayName));
}

async function readRole(tenantId: string, roleId: string): Promise<RoleRow | null> {
  if (!UUID_RE.test(roleId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("roles").select(ROLE_SELECT).eq("id", roleId).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).maybeSingle<RoleRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data;
}

export async function getRoleDetail(tenantId: string, roleId: string): Promise<RoleDetail | null> {
  const r = await readRole(tenantId, roleId);
  if (!r) return null;
  const supabase = await supabaseServer();
  const { data: assigned, error } = await supabase.from("user_roles").select("user_id").eq("tenant_id", tenantId).eq("role_id", r.id).returns<{ user_id: string }[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const ids = [...new Set((assigned ?? []).map((a) => a.user_id))];
  // Names and statuses of people holding it in *this* tenant (ids came from this tenant's assignments).
  const db = supabaseServiceRole();
  const [{ data: people }, { data: memberships }, copied] = await Promise.all([
    ids.length ? db.from("users").select("id, email, display_name").in("id", ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from("tenant_memberships").select("user_id, status").eq("tenant_id", tenantId).in("user_id", ids) : Promise.resolve({ data: [] }),
    r.copied_from ? readRole(tenantId, r.copied_from) : Promise.resolve(null),
  ]);
  const statusOf = new Map(((memberships ?? []) as { user_id: string; status: string }[]).map((m) => [m.user_id, m.status]));
  const holders = ((people ?? []) as { id: string; email: string; display_name: string | null }[])
    .map((p) => ({ userId: p.id, name: p.display_name || p.email, email: p.email, status: statusOf.get(p.id) ?? "removed" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...toSummary(r, holders.length),
    permissions: r.role_permissions
      .map((rp) => rp.permissions?.key)
      .filter((k): k is string => !!k)
      .sort(),
    holders,
    createdBy: r.created_by,
    copiedFrom: copied ? { id: copied.id, displayName: copied.display_name } : null,
    updatedAt: r.updated_at,
  };
}

type Actor = { userId: string; permissions: readonly string[] };

async function catalogKeys(): Promise<string[]> {
  return (await listPermissionCatalog()).map((p) => p.key);
}

function refusal(error: { message?: string; code?: string } | null): ApiError | null {
  const msg = error?.message ?? "";
  if (msg.includes("ROLE_NAME_RESERVED")) return new ApiError(409, "ROLE_NAME_RESERVED", "That is a system role's name. Choose another.");
  if (error?.code === "23505") return new ApiError(409, "ROLE_NAME_TAKEN", "A role with that name already exists in this organization.");
  if (msg.includes("SYSTEM_ROLE_PROTECTED")) return new ApiError(403, "SYSTEM_ROLE_PROTECTED", "System roles can't be changed.");
  return null;
}

async function writePermissions(roleId: string, keys: string[], previous: string[]) {
  const db = supabaseServiceRole();
  const { added, removed } = permissionDiff(keys, previous);
  if (removed.length) {
    const { data: ids } = await db.from("permissions").select("id").in("key", removed);
    const { error } = await db
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId)
      .in(
        "permission_id",
        ((ids ?? []) as { id: string }[]).map((i) => i.id),
      );
    if (error) throw refusal(error) ?? new ApiError(500, "UPDATE_FAILED", error.message);
  }
  if (added.length) {
    const { data: ids } = await db.from("permissions").select("id").in("key", added);
    const { error } = await db.from("role_permissions").insert(((ids ?? []) as { id: string }[]).map((i) => ({ role_id: roleId, permission_id: i.id })));
    if (error) throw refusal(error) ?? new ApiError(500, "UPDATE_FAILED", error.message);
  }
  return { added, removed };
}

export type RoleResult = { ok: true; roleId: string } | { ok: false; errors: Record<string, string> };

/** Create a custom role, optionally copied from another role this tenant can see. */
export async function createRole(tenantId: string, actor: Actor, input: RoleInput, copyFromId?: string | null): Promise<RoleResult> {
  const parsed = validateRoleInput(input, await catalogKeys());
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const escalated = escalationIn(v.permissions, [], actor.permissions);
  if (escalated.length) {
    await writeAudit({
      tenantId,
      actorId: actor.userId,
      actorType: "user",
      action: "role.created",
      objectType: "role",
      objectId: "new",
      outcome: "failure",
      metadata: { refused: "ROLE_ESCALATION", permissions: escalated },
    });
    return { ok: false, errors: { permissions: `You can only include permissions you hold yourself. Not held: ${escalated.join(", ")}` } };
  }
  const source = copyFromId ? await readRole(tenantId, copyFromId) : null;
  const { data, error } = await supabaseServiceRole()
    .from("roles")
    .insert({ tenant_id: tenantId, name: v.name, display_name: v.name, description: v.description, is_system: false, created_by: actor.userId, copied_from: source?.id ?? null })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    const r = refusal(error);
    if (r && (r.code === "ROLE_NAME_RESERVED" || r.code === "ROLE_NAME_TAKEN")) return { ok: false, errors: { name: r.message } };
    throw r ?? new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create the role");
  }
  try {
    await writePermissions(data.id, v.permissions, []);
  } catch (err) {
    // A role without its permissions is not what was asked for: undo it.
    await supabaseServiceRole().from("roles").delete().eq("id", data.id).eq("tenant_id", tenantId);
    throw err;
  }
  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: "role.created",
    objectType: "role",
    objectId: data.id,
    outcome: "success",
    metadata: { name: v.name, permissions: v.permissions, copiedFrom: source?.name ?? null },
  });
  return { ok: true, roleId: data.id };
}

async function customRoleIn(tenantId: string, roleId: string): Promise<RoleRow> {
  const r = await readRole(tenantId, roleId);
  if (!r) throw new ApiError(404, "NOT_FOUND", "No such role in this organization");
  if (r.tenant_id === null) throw new ApiError(403, "SYSTEM_ROLE_PROTECTED", "System roles can't be changed. Copy it into a custom role instead.");
  if (r.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such role in this organization");
  return r;
}

/** Change a custom role's name, description or permissions. Holders are affected on their next request. */
export async function updateRole(tenantId: string, actor: Actor, roleId: string, input: RoleInput): Promise<RoleResult> {
  const r = await customRoleIn(tenantId, roleId);
  const parsed = validateRoleInput(input, await catalogKeys());
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const previous = r.role_permissions.map((rp) => rp.permissions?.key).filter((k): k is string => !!k);
  const escalated = escalationIn(v.permissions, previous, actor.permissions);
  if (escalated.length) {
    await writeAudit({
      tenantId,
      actorId: actor.userId,
      actorType: "user",
      action: "role.updated",
      objectType: "role",
      objectId: r.id,
      outcome: "failure",
      metadata: { refused: "ROLE_ESCALATION", permissions: escalated },
    });
    return { ok: false, errors: { permissions: `You can only add permissions you hold yourself. Not held: ${escalated.join(", ")}` } };
  }
  const { error } = await supabaseServiceRole().from("roles").update({ name: v.name, display_name: v.name, description: v.description }).eq("id", r.id).eq("tenant_id", tenantId);
  if (error) {
    const ref = refusal(error);
    if (ref && (ref.code === "ROLE_NAME_RESERVED" || ref.code === "ROLE_NAME_TAKEN")) return { ok: false, errors: { name: ref.message } };
    throw ref ?? new ApiError(500, "UPDATE_FAILED", error.message);
  }
  const diff = await writePermissions(r.id, v.permissions, previous);
  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: "role.updated",
    objectType: "role",
    objectId: r.id,
    outcome: "success",
    metadata: { name: v.name, renamedFrom: r.name !== v.name ? r.name : null, ...diff },
  });
  return { ok: true, roleId: r.id };
}

/** Activate or deactivate a custom role. An inactive role grants nothing, and cannot be assigned. */
export async function setRoleStatus(tenantId: string, actorId: string, roleId: string, status: "active" | "inactive"): Promise<void> {
  const r = await customRoleIn(tenantId, roleId);
  if (r.status === status) return;
  const { error } = await supabaseServiceRole().from("roles").update({ status }).eq("id", r.id).eq("tenant_id", tenantId).eq("status", r.status);
  if (error) throw refusal(error) ?? new ApiError(500, "UPDATE_FAILED", error.message);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: status === "active" ? "role.activated" : "role.deactivated",
    objectType: "role",
    objectId: r.id,
    outcome: "success",
    metadata: { name: r.name },
  });
}

/** Delete a custom role that nobody holds. (Deactivate one that is in use.) */
export async function deleteRole(tenantId: string, actorId: string, roleId: string): Promise<void> {
  const r = await customRoleIn(tenantId, roleId);
  const { count } = await supabaseServiceRole().from("user_roles").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("role_id", r.id);
  if (count) throw new ApiError(409, "ROLE_IN_USE", `${count} ${count === 1 ? "person holds" : "people hold"} this role. Remove it from them, or deactivate the role instead.`);
  const { error } = await supabaseServiceRole().from("roles").delete().eq("id", r.id).eq("tenant_id", tenantId);
  if (error) throw refusal(error) ?? new ApiError(500, "DELETE_FAILED", error.message);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "role.deleted", objectType: "role", objectId: r.id, outcome: "success", metadata: { name: r.name } });
}
