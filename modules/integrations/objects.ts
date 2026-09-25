import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IntegrationObject, IntegrationObjectType } from "@/lib/shared/types/integrations";
import { toIntegrationObject } from "./mappers";

/**
 * The sanctioned way Identity/Access agents read imported data — see
 * CLAUDE.md non-negotiable #6 and this module's "Published contracts"
 * section. Never query integration_objects directly from another module.
 */
export async function getNormalizedObjects(
  tenantId: string,
  integrationId: string,
  objectType: IntegrationObjectType,
): Promise<IntegrationObject[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_objects")
    .select()
    .eq("integration_id", integrationId)
    .eq("tenant_id", tenantId)
    .eq("object_type", objectType)
    .order("imported_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toIntegrationObject);
}

/**
 * The tenant-wide counterpart of `getNormalizedObjects()`: every object of
 * one type across all of the tenant's integrations, in one query, for a
 * consumer that reconciles them all at once (Identity's discovery inbox).
 * Replaces one query per integration (CLAUDE.md §15). Reads as the user
 * under RLS, with the tenant filtered explicitly (§14). Capped: a tenant
 * with more imported objects than this sees the newest.
 */
export const TENANT_OBJECTS_CAP = 5000;

export async function getNormalizedObjectsForTenant(tenantId: string, objectType: IntegrationObjectType): Promise<IntegrationObject[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_objects")
    .select()
    .eq("tenant_id", tenantId)
    .eq("object_type", objectType)
    .order("imported_at", { ascending: false })
    .limit(TENANT_OBJECTS_CAP);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toIntegrationObject);
}
