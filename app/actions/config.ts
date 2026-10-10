"use server";

import { revalidatePath } from "next/cache";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { restoreTenantConfigVersion, updateTenantConfig } from "@/lib/config/tenantConfig";
import { CONFIG_SETTINGS } from "@/lib/config/registry";

export type ConfigFormState = { ok: boolean; message: string | null; errors?: Record<string, string> };

const VIEW = ["tenant.settings", "tenant.security.manage"];

async function context(): Promise<{ ok: true; tenantId: string; userId: string; permissions: string[] } | { ok: false; message: string }> {
  try {
    const ctx = await requireAnyPermission(VIEW);
    return { ok: true, tenantId: ctx.tenantId!, userId: ctx.userId, permissions: ctx.permissions };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, message: err.status === 403 ? "You don't have permission to change the configuration." : err.message };
    throw err;
  }
}

/**
 * Admin › Global Configuration: saves the changed settings. The tenant and
 * the permissions come from the session; the service checks each changed
 * setting's own permission and refuses the whole save on any error.
 */
export async function saveConfigAction(_prev: ConfigFormState, formData: FormData): Promise<ConfigFormState> {
  const ctx = await context();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const input: Record<string, unknown> = {};
  for (const s of CONFIG_SETTINGS) {
    const v = formData.get(s.key);
    if (v !== null) input[s.key] = v;
  }
  const result = await updateTenantConfig(ctx.tenantId, ctx.userId, ctx.permissions, input);
  if (!result.ok) return { ok: false, message: result.message, errors: result.errors };
  revalidatePath("/", "layout");
  if (result.changes.length === 0) return { ok: true, message: "Nothing changed." };
  return { ok: true, message: `Saved as version ${result.version}. ${result.changes.length === 1 ? "1 setting" : `${result.changes.length} settings`} changed.` };
}

/** Puts back an earlier version's values, as a new version. */
export async function restoreConfigAction(_prev: ConfigFormState, formData: FormData): Promise<ConfigFormState> {
  const ctx = await context();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const result = await restoreTenantConfigVersion(ctx.tenantId, ctx.userId, ctx.permissions, Number(formData.get("version")));
  if (!result.ok) return { ok: false, message: result.errors ? "You can't restore this version: it changes a setting you can't change." : result.message };
  revalidatePath("/", "layout");
  return { ok: true, message: result.changes.length ? `Restored as version ${result.version}.` : "That version matches the current settings." };
}
