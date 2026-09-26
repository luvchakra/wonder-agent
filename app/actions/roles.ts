"use server";

import { revalidatePath } from "next/cache";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { assignRole, removeRole } from "@/lib/rbac/roles";
import { ApiError } from "@/lib/shared/types/foundation";

export async function assignRoleAction(formData: FormData) {
  const ctx = await requireAnyPermission(["roles.assign", "role.manage"]);
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || !role) throw new Error("userId and role are required");
  await assignRole(ctx.tenantId!, ctx.userId, userId, role);
  revalidatePath("/settings/roles");
}

// Returns the refusal (e.g. the last Tenant Administrator, FOUNDATION-P0-23)
// rather than throwing: a thrown server-action error reaches the browser
// redacted in production, and the person needs to know why.
export async function removeRoleAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireAnyPermission(["roles.assign", "role.manage"]);
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || !role) return { ok: false, error: "userId and role are required" };
  try {
    await removeRole(ctx.tenantId!, ctx.userId, userId, role);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/settings/roles");
  revalidatePath(`/settings/users/${userId}`);
  return { ok: true };
}
