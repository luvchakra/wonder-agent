import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { FeatureFlag } from "@/lib/shared/types/platform";
import { toFeatureFlag } from "./mappers";
import { writePlatformAudit } from "./auditLog";
import { recordConfigVersion } from "./configVersions";

/**
 * Published contract (docs/plan/09-PLATFORM-AGENT-BACKLOG.md): every other
 * module checks this before exposing a flag-gated feature. Falls back to
 * `platform_feature_flags.default_enabled` when no per-tenant row exists,
 * per PLATFORM-P0-02.3. Uses the service-role client because
 * `feature_flags`/`platform_feature_flags` grant no client-facing policy
 * at all (this is platform-admin-owned configuration, not tenant business
 * data) — safe for any module to call server-side regardless of the
 * calling user's own permissions, since it only ever returns a boolean.
 */
export async function isFeatureEnabled(tenantId: string, flagKey: string): Promise<boolean> {
  return (await getFeatureFlags(tenantId, [flagKey]))[flagKey];
}

/**
 * PLATFORM-P0-12 — several flags for one tenant in one parallel round trip:
 * the tenant's overrides and the catalog defaults are read together. A key
 * with no override takes its catalog default; a key missing from the
 * catalog is off. Any read failure throws, and the caller must treat that
 * as "not enabled", never as permission.
 */
export async function getFeatureFlags(tenantId: string, flagKeys: string[]): Promise<Record<string, boolean>> {
  const supabase = supabaseServiceRole();
  const [overrides, catalog] = await Promise.all([
    supabase.from("feature_flags").select("tenant_id, flag_key, enabled").eq("tenant_id", tenantId).in("flag_key", flagKeys),
    supabase.from("platform_feature_flags").select("key, default_enabled").in("key", flagKeys),
  ]);
  if (overrides.error) throw new ApiError(500, "QUERY_FAILED", overrides.error.message);
  if (catalog.error) throw new ApiError(500, "QUERY_FAILED", catalog.error.message);
  return resolveFlags(
    flagKeys,
    ((overrides.data ?? []) as Array<{ tenant_id: string; flag_key: string; enabled: boolean }>).filter((o) => o.tenant_id === tenantId),
    (catalog.data ?? []) as Array<{ key: string; default_enabled: boolean }>,
  );
}

/** Pure: an override wins, else the catalog default, else off. */
export function resolveFlags(
  flagKeys: string[],
  overrides: Array<{ flag_key: string; enabled: boolean }>,
  catalog: Array<{ key: string; default_enabled: boolean }>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of flagKeys) {
    const override = overrides.find((o) => o.flag_key === key);
    out[key] = override ? override.enabled : (catalog.find((c) => c.key === key)?.default_enabled ?? false);
  }
  return out;
}

/** Throws 403 FEATURE_DISABLED unless the flag is on for the tenant. */
export async function requireFeature(tenantId: string, flagKey: string): Promise<void> {
  if (!(await isFeatureEnabled(tenantId, flagKey))) {
    throw new ApiError(403, "FEATURE_DISABLED", `The ${flagKey} feature is not enabled for this organization`);
  }
}

export async function listFlagCatalog(): Promise<FeatureFlag[]> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("platform_feature_flags").select().order("key");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toFeatureFlag);
}

export async function listTenantFlagOverrides(tenantId: string): Promise<Record<string, boolean>> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("feature_flags").select("flag_key, enabled").eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return Object.fromEntries((data ?? []).map((row: { flag_key: string; enabled: boolean }) => [row.flag_key, row.enabled]));
}

export async function setFeatureFlag(actorId: string, tenantId: string, flagKey: string, enabled: boolean): Promise<void> {
  const supabase = supabaseServiceRole();
  const { error } = await supabase
    .from("feature_flags")
    .upsert({ tenant_id: tenantId, flag_key: flagKey, enabled, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,flag_key" });
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);

  await writePlatformAudit({ actorId, tenantId, action: "platform.feature_flag_changed", newValue: { flagKey, enabled }, result: "success" });
}

/**
 * PLATFORM-P0-05.3 — versions the platform-wide *default* for a flag
 * (`platform_feature_flags.default_enabled`), distinct from a per-tenant
 * override above. No such update path existed before this story; adding
 * it is what makes the catalog's default value itself change-controlled
 * rather than a one-time seed from migration 0038.
 */
export async function updateFeatureFlagDefault(actorId: string, flagKey: string, defaultEnabled: boolean): Promise<FeatureFlag> {
  const supabase = supabaseServiceRole();
  const { data: previous, error: fetchError } = await supabase.from("platform_feature_flags").select().eq("key", flagKey).maybeSingle();
  if (fetchError) throw new ApiError(500, "QUERY_FAILED", fetchError.message);
  if (!previous) throw new ApiError(404, "FLAG_NOT_FOUND");

  const { data, error } = await supabase.from("platform_feature_flags").update({ default_enabled: defaultEnabled }).eq("key", flagKey).select().single();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update flag default");

  await recordConfigVersion(actorId, "feature_flag_default", flagKey, { defaultEnabled: previous.default_enabled }, { defaultEnabled });
  await writePlatformAudit({ actorId, action: "platform.feature_flag_default_changed", oldValue: { flagKey, defaultEnabled: previous.default_enabled }, newValue: { flagKey, defaultEnabled }, result: "success" });

  return toFeatureFlag(data);
}
