import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { FeatureFlag } from "@/lib/shared/types/platform";
import { toFeatureFlag } from "./mappers";
import { writePlatformAudit } from "./auditLog";

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
  const supabase = supabaseServiceRole();
  const { data: override, error: overrideError } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .eq("flag_key", flagKey)
    .maybeSingle();
  if (overrideError) throw new ApiError(500, "QUERY_FAILED", overrideError.message);
  if (override) return override.enabled;

  const { data: catalogEntry, error: catalogError } = await supabase.from("platform_feature_flags").select("default_enabled").eq("key", flagKey).maybeSingle();
  if (catalogError) throw new ApiError(500, "QUERY_FAILED", catalogError.message);
  return catalogEntry?.default_enabled ?? false;
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
