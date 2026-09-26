"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { createRole, deleteRole, setRoleStatus, updateRole } from "@/lib/rbac/customRoles";

/**
 * FOUNDATION-P0-25 — the Roles screens' server actions. Tenant and actor
 * come from the session; each checks the permission for exactly what it
 * does (roles.create / roles.update / roles.delete); the service checks the
 * role is this tenant's custom role and that a role never gains a
 * permission its designer lacks. Refusals come back as messages.
 */

export type RoleActionState = { ok: boolean; message: string | null; errors?: Record<string, string> };

function refused(err: unknown): RoleActionState {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  throw err;
}

export async function saveRoleAction(_prev: RoleActionState, formData: FormData): Promise<RoleActionState> {
  const roleId = String(formData.get("roleId") ?? "");
  const input = { name: formData.get("name"), description: formData.get("description"), permissions: formData.getAll("permissions").map(String) };
  let result;
  try {
    const ctx = await requirePermission(roleId ? "roles.update" : "roles.create");
    const actor = { userId: ctx.userId, permissions: ctx.permissions };
    result = roleId ? await updateRole(ctx.tenantId!, actor, roleId, input) : await createRole(ctx.tenantId!, actor, input, String(formData.get("copyFrom") ?? "") || null);
  } catch (err) {
    return refused(err);
  }
  if (!result.ok) return { ok: false, message: "Check the highlighted fields.", errors: result.errors };
  revalidatePath("/settings/roles");
  redirect(`/settings/roles/${result.roleId}?saved=${roleId ? "updated" : "created"}`);
}

export async function setRoleStatusAction(_prev: RoleActionState, formData: FormData): Promise<RoleActionState> {
  const roleId = String(formData.get("roleId") ?? "");
  const status = formData.get("status") === "active" ? "active" : "inactive";
  try {
    const ctx = await requirePermission("roles.update");
    await setRoleStatus(ctx.tenantId!, ctx.userId, roleId, status);
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/roles");
  revalidatePath(`/settings/roles/${roleId}`);
  return { ok: true, message: status === "active" ? "Activated. Its holders have its permissions again." : "Deactivated. Its holders lose its permissions on their next request." };
}

export async function deleteRoleAction(_prev: RoleActionState, formData: FormData): Promise<RoleActionState> {
  const roleId = String(formData.get("roleId") ?? "");
  try {
    const ctx = await requirePermission("roles.delete");
    await deleteRole(ctx.tenantId!, ctx.userId, roleId);
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/roles");
  redirect("/settings/roles?deleted=1");
}
