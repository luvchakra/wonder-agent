"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assignRole, removeRole } from "@/lib/rbac/roles";

export async function assignRoleAction(formData: FormData) {
  const ctx = await requirePermission("role.manage");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || !role) throw new Error("userId and role are required");
  await assignRole(ctx.tenantId!, ctx.userId, userId, role);
  revalidatePath("/settings/roles");
}

export async function removeRoleAction(formData: FormData) {
  const ctx = await requirePermission("role.manage");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || !role) throw new Error("userId and role are required");
  await removeRole(ctx.tenantId!, ctx.userId, userId, role);
  revalidatePath("/settings/roles");
}
