"use server";

import { revalidatePath } from "next/cache";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { importConfigBundle, previewConfigBundle, restoreTenantConfigVersion, updateTenantConfig } from "@/lib/config/tenantConfig";
import { CONFIG_SETTINGS, formatConfigValue, settingFor } from "@/lib/config/registry";
import { readConfigBundle } from "@/lib/config/bundle";

export type ConfigFormState = { ok: boolean; message: string | null; errors?: Record<string, string> };

const VIEW = ["tenant.settings", "tenant.security.manage"];

async function context(): Promise<{ ok: true; tenantId: string; userId: string; permissions: string[]; aal: "aal1" | "aal2" | null } | { ok: false; message: string }> {
  try {
    const ctx = await requireAnyPermission(VIEW);
    return { ok: true, tenantId: ctx.tenantId!, userId: ctx.userId, permissions: ctx.permissions, aal: ctx.aal ?? null };
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
  const result = await updateTenantConfig(ctx.tenantId, ctx, input);
  if (!result.ok) return { ok: false, message: result.message, errors: result.errors };
  revalidatePath("/", "layout");
  if (result.changes.length === 0) return { ok: true, message: "Nothing changed." };
  return { ok: true, message: `Saved as version ${result.version}. ${result.changes.length === 1 ? "1 setting" : `${result.changes.length} settings`} changed.` };
}

/** Puts back an earlier version's values, as a new version. */
export async function restoreConfigAction(_prev: ConfigFormState, formData: FormData): Promise<ConfigFormState> {
  const ctx = await context();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const result = await restoreTenantConfigVersion(ctx.tenantId, ctx, Number(formData.get("version")));
  if (!result.ok) return { ok: false, message: result.errors ? `You can't restore this version: ${Object.values(result.errors)[0]}` : result.message };
  revalidatePath("/", "layout");
  return { ok: true, message: result.changes.length ? `Restored as version ${result.version}.` : "That version matches the current settings." };
}

// PLATFORM-P0-13 — importing a configuration bundle: first what it would
// change, then (with the same file) the import, which re-verifies it.
export type BundleFormState =
  | { step: "idle" }
  | { step: "preview"; text: string; source: string; exportedAt: string; changes: { label: string; from: string; to: string }[] }
  | { step: "done"; message: string }
  | { step: "error"; message: string };

async function bundleText(formData: FormData): Promise<string> {
  const file = formData.get("bundle");
  if (file && typeof file === "object" && "text" in file) return file.size > 64 * 1024 ? " ".repeat(64 * 1024 + 1) : await file.text();
  return String(formData.get("bundleText") ?? "");
}

export async function previewBundleAction(_prev: BundleFormState, formData: FormData): Promise<BundleFormState> {
  const ctx = await context();
  if (!ctx.ok) return { step: "error", message: ctx.message };
  const text = await bundleText(formData);
  const read = readConfigBundle(text);
  if (!read.ok) return { step: "error", message: read.message };
  const preview = await previewConfigBundle(ctx.tenantId, ctx, read.bundle);
  if (!preview.ok) return { step: "error", message: preview.errors ? `${preview.message} ${Object.entries(preview.errors).map(([k, v]) => `${settingFor(k)?.label ?? k}: ${v}`).join(" ")}` : preview.message };
  return {
    step: "preview",
    text,
    source: [preview.source.organization, preview.source.environment].filter(Boolean).join(" · "),
    exportedAt: preview.exportedAt,
    changes: preview.changes.map((c) => ({ label: settingFor(c.key)?.label ?? c.key, from: `${formatConfigValue(c.from, c.key)} ${settingFor(c.key)?.unit ?? ""}`.trim(), to: `${formatConfigValue(c.to, c.key)} ${settingFor(c.key)?.unit ?? ""}`.trim() })),
  };
}

export async function importBundleAction(_prev: BundleFormState, formData: FormData): Promise<BundleFormState> {
  const ctx = await context();
  if (!ctx.ok) return { step: "error", message: ctx.message };
  const read = readConfigBundle(String(formData.get("bundleText") ?? ""));
  if (!read.ok) return { step: "error", message: read.message };
  const result = await importConfigBundle(ctx.tenantId, ctx, read.bundle);
  if (!result.ok) return { step: "error", message: result.errors ? `${result.message} ${Object.values(result.errors)[0]}` : result.message };
  revalidatePath("/", "layout");
  return { step: "done", message: result.changes.length ? `Imported as version ${result.version}. ${result.changes.length === 1 ? "1 setting" : `${result.changes.length} settings`} changed.` : "This organization already has these settings. Nothing changed." };
}
