import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IntegrationMapping } from "@/lib/shared/types/integrations";
import { toIntegrationMapping } from "./mappers";

/**
 * INTEGRATION-P0-01.4 / INTEGRATION-P0-03.2. `integration_mappings` has
 * client-facing RLS (scoped via a join to integrations.tenant_id — see
 * migration 0024), so this runs as the calling user.
 */
export async function createMapping(
  integrationId: string,
  objectType: string,
  sourceField: string,
  targetField: string,
): Promise<IntegrationMapping> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integration_mappings")
    .insert({ integration_id: integrationId, object_type: objectType, source_field: sourceField, target_field: targetField })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create mapping");
  }
  return toIntegrationMapping(data);
}

export async function listMappings(integrationId: string, objectType?: string): Promise<IntegrationMapping[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("integration_mappings").select().eq("integration_id", integrationId);
  if (objectType) query = query.eq("object_type", objectType);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toIntegrationMapping);
}

function getByDotPath(source: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

/**
 * Applies a set of stored field mappings to one raw record, producing a
 * plain object keyed by each mapping's target_field. Used by the sync
 * executor to fill in `normalized` for connectors (Generic REST) that don't
 * know the customer's field names natively. Intentionally a straight
 * field-to-field copy — no scripted transforms, per the backlog's explicit
 * "DO NOT IMPLEMENT a general-purpose visual mapping/transform DSL" (P0
 * scope; INTEGRATION-P0-03.2).
 */
export function applyMappings(
  raw: Record<string, unknown>,
  mappings: IntegrationMapping[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const mapping of mappings) {
    normalized[mapping.targetField] = getByDotPath(raw, mapping.sourceField);
  }
  return normalized;
}
