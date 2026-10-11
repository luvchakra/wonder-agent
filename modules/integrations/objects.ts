import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IntegrationObject, IntegrationObjectType } from "@/lib/shared/types/integrations";
import { toIntegrationObject } from "./mappers";

/**
 * INTEGRATION-P0-18: objects a complete full sync found gone from the source
 * (`missing_at_source_at`) are left out unless a reader asks for them, so a
 * consumer sees what the source holds now.
 */
export type ObjectReadOptions = { includeMissing?: boolean };

/** The most objects one read returns (the engine's own `maxRecords` default). */
export const OBJECTS_READ_CAP = 50_000;
/** PostgREST returns at most 1000 rows a request, so reads page. */
const PAGE = 1000;

type ObjectsClient = ReturnType<typeof supabaseServiceRole> | Awaited<ReturnType<typeof supabaseServer>>;

async function readObjects(
  db: ObjectsClient,
  tenantId: string,
  integrationId: string,
  objectType: IntegrationObjectType,
  options: ObjectReadOptions,
): Promise<IntegrationObject[]> {
  const out: IntegrationObject[] = [];
  for (let from = 0; from < OBJECTS_READ_CAP; from += PAGE) {
    let query = db
      .from("integration_objects")
      .select()
      .eq("integration_id", integrationId)
      .eq("tenant_id", tenantId)
      .eq("object_type", objectType);
    if (!options.includeMissing) query = query.is("missing_at_source_at", null);
    const { data, error } = await query
      .order("imported_at", { ascending: false })
      .order("id")
      .range(from, Math.min(from + PAGE, OBJECTS_READ_CAP) - 1);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    out.push(...(data ?? []).map(toIntegrationObject));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/**
 * The sanctioned way Identity/Access agents read imported data — see
 * CLAUDE.md non-negotiable #6 and this module's "Published contracts"
 * section. Never query integration_objects directly from another module.
 * Reads as the user under RLS, every page (a single request stops at 1000
 * rows, which would make a reconciliation treat the rest as gone).
 */
export async function getNormalizedObjects(
  tenantId: string,
  integrationId: string,
  objectType: IntegrationObjectType,
  options: ObjectReadOptions = {},
): Promise<IntegrationObject[]> {
  return readObjects(await supabaseServer(), tenantId, integrationId, objectType, options);
}

/**
 * INTEGRATION-P0-19: the same read for work WonderID runs itself after a
 * sync, with no session (a scheduled run). Service role, so `tenantId` must
 * be the connection's own tenant, which the caller read from the job row;
 * every page filters by it (§14).
 */
export async function getNormalizedObjectsAsSystem(
  tenantId: string,
  integrationId: string,
  objectType: IntegrationObjectType,
  options: ObjectReadOptions = {},
): Promise<IntegrationObject[]> {
  return readObjects(supabaseServiceRole(), tenantId, integrationId, objectType, options);
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

export async function getNormalizedObjectsForTenant(tenantId: string, objectType: IntegrationObjectType, options: ObjectReadOptions = {}): Promise<IntegrationObject[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("integration_objects").select().eq("tenant_id", tenantId).eq("object_type", objectType);
  if (!options.includeMissing) query = query.is("missing_at_source_at", null);
  const { data, error } = await query
    .order("imported_at", { ascending: false })
    .limit(TENANT_OBJECTS_CAP);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toIntegrationObject);
}
