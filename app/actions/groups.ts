"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";
import { termsFromForm } from "@/lib/rbac/assignmentForm";
import { addGroupMember, addGroupRole, createGroup, deleteGroup, getGroup, removeGroupMember, removeGroupRole, updateGroup } from "@/lib/users/groups";

/**
 * FOUNDATION-P0-26 — the Groups screens' server actions. Tenant and actor
 * from the session; each checks the permission for exactly what it does.
 * Adding someone to a group that carries roles hands them those roles, so
 * it also needs role assignment (roles.assign, or the legacy role.manage);
 * so does giving a group a role. The service refuses self-escalation, and
 * the database refuses it again.
 */

export type GroupActionState = {
  ok: boolean;
  message: string | null;
  errors?: Record<string, string>;
};

const ASSIGN = ["roles.assign", "role.manage"];
const canAssign = (ctx: TenantContext) => ctx.permissions.some((p) => ASSIGN.includes(p));

function refused(err: unknown): GroupActionState {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  throw err;
}

function revalidate(groupId: string, userId?: string) {
  revalidatePath("/settings/groups");
  revalidatePath(`/settings/groups/${groupId}`);
  if (userId) revalidatePath(`/settings/users/${userId}`);
}

export async function saveGroupAction(_prev: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const groupId = String(formData.get("groupId") ?? "");
  const input = {
    name: formData.get("name"),
    description: formData.get("description"),
  };
  let result;
  try {
    const ctx = await requirePermission(groupId ? "groups.update" : "groups.create");
    result = groupId ? await updateGroup(ctx.tenantId!, ctx.userId, groupId, input) : await createGroup(ctx.tenantId!, ctx.userId, input);
  } catch (err) {
    return refused(err);
  }
  if (!result.ok)
    return {
      ok: false,
      message: "Check the highlighted fields.",
      errors: result.errors,
    };
  revalidate(result.groupId);
  if (groupId) return { ok: true, message: "Saved." };
  redirect(`/settings/groups/${result.groupId}?created=1`);
}

export async function deleteGroupAction(_prev: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const groupId = String(formData.get("groupId") ?? "");
  try {
    const ctx = await requirePermission("groups.delete");
    await deleteGroup(ctx.tenantId!, ctx.userId, groupId);
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/groups");
  redirect("/settings/groups?deleted=1");
}

export async function addGroupMemberAction(_prev: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const groupId = String(formData.get("groupId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { ok: false, message: "Choose a person." };
  try {
    const ctx = await requirePermission("groups.manage_members");
    const group = await getGroup(ctx.tenantId!, groupId);
    if (group && group.roleAssignments.length && !canAssign(ctx)) {
      return {
        ok: false,
        message: "This group carries roles, so adding people to it needs role assignment. Ask an administrator who can assign roles.",
      };
    }
    await addGroupMember(ctx.tenantId!, ctx.userId, groupId, userId);
  } catch (err) {
    return refused(err);
  }
  revalidate(groupId, userId);
  return {
    ok: true,
    message: "Added. They get the group's roles on their next request.",
  };
}

export async function removeGroupMemberAction(_prev: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const groupId = String(formData.get("groupId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  try {
    const ctx = await requirePermission("groups.manage_members");
    await removeGroupMember(ctx.tenantId!, ctx.userId, groupId, userId);
  } catch (err) {
    return refused(err);
  }
  revalidate(groupId, userId);
  return {
    ok: true,
    message: "Removed. They lose the group's roles on their next request.",
  };
}

export async function addGroupRoleAction(_prev: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const groupId = String(formData.get("groupId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!role) return { ok: false, message: "Choose a role." };
  const terms = termsFromForm(formData, role);
  if (!terms.ok) return { ok: false, message: "Check the assignment's scope and dates.", errors: terms.errors };
  try {
    const ctx = await requireAnyPermission(ASSIGN);
    await addGroupRole(ctx.tenantId!, ctx.userId, groupId, role, terms.terms);
  } catch (err) {
    return refused(err);
  }
  revalidate(groupId);
  return {
    ok: true,
    message: "Role given to the group. Its members get it on their next request.",
  };
}

export async function removeGroupRoleAction(_prev: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const groupId = String(formData.get("groupId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  try {
    const ctx = await requireAnyPermission(ASSIGN);
    await removeGroupRole(ctx.tenantId!, ctx.userId, groupId, roleId);
  } catch (err) {
    return refused(err);
  }
  revalidate(groupId);
  return { ok: true, message: "Role removed from the group." };
}
