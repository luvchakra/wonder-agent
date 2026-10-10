import "server-only";

import { cache } from "react";
import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { DEFAULT_CONFIG, planConfigChange, resolveConfig, type ConfigChange, type TenantConfig } from "./registry";

/**
 * An organization's Global Configuration (lib/config/registry.ts; migration
 * 0116). Read with the service role because modules use it outside a
 * member's request too (risk evaluation, runtime alerts); every query is
 * pinned to the one tenant (§14). Values are not secret.
 *
 * If the store cannot be read, the defaults apply: they are the behaviour
 * WonderID had before these settings existed, and for sessions the global
 * limits proxy.ts enforces anyway. The failure is logged, never hidden as
 * a saved value.
 */
async function load(tenantId: string): Promise<{ config: TenantConfig; version: number }> {
  const db = supabaseServiceRole();
  const [settings, latest] = await Promise.all([
    db.from("tenant_settings").select("tenant_id, settings").eq("tenant_id", tenantId).maybeSingle<{ tenant_id: string; settings: Record<string, unknown> | null }>(),
    db.from("tenant_config_versions").select("version").eq("tenant_id", tenantId).order("version", { ascending: false }).limit(1).maybeSingle<{ version: number }>(),
  ]);
  if (settings.error || latest.error) throw new Error(settings.error?.message ?? latest.error?.message);
  const row = settings.data && settings.data.tenant_id === tenantId ? settings.data : null;
  return { config: resolveConfig(row?.settings?.config), version: latest.data?.version ?? 0 };
}

/** The organization's settings, once per request. */
export const getTenantConfig = cache(async (tenantId: string): Promise<TenantConfig> => {
  try {
    return (await load(tenantId)).config;
  } catch (err) {
    console.error("tenant config unreadable; defaults apply", { tenantId, error: err instanceof Error ? err.message : "unknown" });
    return { ...DEFAULT_CONFIG };
  }
});

export type ConfigVersion = {
  version: number;
  changes: ConfigChange[];
  restoredFrom: number | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
};

/** The latest saved versions, newest first, read as the member under RLS (it admits only those who manage settings). */
export async function listTenantConfigVersions(tenantId: string, limit = 20): Promise<ConfigVersion[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tenant_config_versions")
    .select("tenant_id, version, changes, restored_from, created_by, created_at")
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((r) => r.tenant_id === tenantId);
  const ids = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabaseServiceRole().from("users").select("id, email, display_name").in("id", ids);
    for (const p of (people ?? []) as { id: string; email: string | null; display_name: string | null }[]) names.set(p.id, p.display_name || p.email || "A former member");
  }
  return rows.map((r) => ({
    version: r.version as number,
    changes: Array.isArray(r.changes) ? (r.changes as ConfigChange[]) : [],
    restoredFrom: (r.restored_from as number | null) ?? null,
    createdAt: r.created_at as string,
    createdBy: r.created_by ? { id: r.created_by as string, name: names.get(r.created_by as string) ?? "A former member" } : null,
  }));
}

export type SaveConfigResult = { ok: true; version: number | null; changes: ConfigChange[] } | { ok: false; message: string; errors?: Record<string, string> };

async function save(tenantId: string, actorId: string, permissions: readonly string[], input: Record<string, unknown>, restoredFrom: number | null): Promise<SaveConfigResult> {
  let current;
  try {
    current = await load(tenantId);
  } catch {
    return { ok: false, message: "The configuration could not be read. Nothing was saved; try again." };
  }
  const plan = planConfigChange(current.config, input, permissions);
  if (!plan.ok) return { ok: false, message: "Nothing was saved. Fix the highlighted settings.", errors: plan.errors };
  if (plan.changes.length === 0) return { ok: true, version: null, changes: [] };

  const { data: version, error } = await supabaseServiceRole().rpc("save_tenant_config", {
    p_tenant: tenantId,
    p_actor: actorId,
    p_expected_version: current.version,
    p_config: plan.next,
    p_changes: plan.changes,
    p_restored_from: restoredFrom,
  });
  if (error) {
    return {
      ok: false,
      message: error.code === "40001" ? "Someone else saved the configuration while you were editing. Nothing was saved; reload and try again." : "The configuration could not be saved. Try again.",
    };
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: restoredFrom === null ? "tenant.config_updated" : "tenant.config_restored",
    objectType: "tenant_config",
    objectId: tenantId,
    outcome: "success",
    metadata: { version, restoredFrom, changes: plan.changes },
  });
  return { ok: true, version: version as number, changes: plan.changes };
}

/**
 * Saves changed settings. The caller has passed the page's permission gate;
 * each changed setting is checked again here against its own permission
 * (sessions need tenant.security.manage), and any invalid value refuses the
 * whole save (§17.5: never part-applied, never reported as saved).
 */
export function updateTenantConfig(tenantId: string, actorId: string, permissions: readonly string[], input: Record<string, unknown>) {
  return save(tenantId, actorId, permissions, input, null);
}

/** Puts back the values of an earlier version, as a new version. Each setting it changes needs its permission. */
export async function restoreTenantConfigVersion(tenantId: string, actorId: string, permissions: readonly string[], version: number): Promise<SaveConfigResult> {
  if (!Number.isInteger(version) || version < 1) return { ok: false, message: "Not a saved version." };
  const { data, error } = await supabaseServiceRole()
    .from("tenant_config_versions")
    .select("tenant_id, config")
    .eq("tenant_id", tenantId)
    .eq("version", version)
    .maybeSingle<{ tenant_id: string; config: unknown }>();
  if (error) return { ok: false, message: "That version could not be read. Try again." };
  if (!data || data.tenant_id !== tenantId) return { ok: false, message: "Not a saved version." };
  return save(tenantId, actorId, permissions, resolveConfig(data.config), version);
}
