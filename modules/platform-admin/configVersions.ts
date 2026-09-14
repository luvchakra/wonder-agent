import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

export type ConfigType = "branding" | "feature_flag_default";

export type ConfigVersion = {
  id: string;
  configType: ConfigType;
  configKey: string | null;
  oldValue: unknown;
  newValue: unknown;
  actorId: string;
  createdAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */
function toConfigVersion(row: any): ConfigVersion {
  return {
    id: row.id,
    configType: row.config_type,
    configKey: row.config_key,
    oldValue: row.old_value,
    newValue: row.new_value,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

/**
 * PLATFORM-P0-05.3. The only sanctioned way any Platform Agent function
 * versions a config write — a leaf function with no dependency on
 * branding.ts/featureFlags.ts (they call this, not the other way around,
 * to avoid a circular import); `configRollback.ts` is the layer above
 * that knows how to apply a version back.
 */
export async function recordConfigVersion(actorId: string, configType: ConfigType, configKey: string | null, oldValue: unknown, newValue: unknown): Promise<void> {
  const supabase = supabaseServiceRole();
  const { error } = await supabase.from("platform_config_versions").insert({
    config_type: configType,
    config_key: configKey,
    old_value: oldValue ?? null,
    new_value: newValue,
    actor_id: actorId,
  });
  if (error) throw new ApiError(500, "CREATE_FAILED", error.message);
}

export async function listConfigVersions(configType: ConfigType, configKey: string | null = null): Promise<ConfigVersion[]> {
  const supabase = supabaseServiceRole();
  let query = supabase.from("platform_config_versions").select().eq("config_type", configType).order("created_at", { ascending: false });
  query = configKey === null ? query.is("config_key", null) : query.eq("config_key", configKey);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toConfigVersion);
}

export async function getConfigVersion(versionId: string): Promise<ConfigVersion | null> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("platform_config_versions").select().eq("id", versionId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toConfigVersion(data) : null;
}
