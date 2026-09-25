import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Entitlement, PrivilegeLevel } from "@/lib/shared/types/access-governance";
import { toEntitlement } from "./mappers";

/** ACCESS-P0-01.1. Client-facing tenant-scoped RLS (migration 0027). */
export async function createEntitlement(
  tenantId: string,
  applicationId: string,
  name: string,
  dataClassification?: string,
  privilegeLevel: PrivilegeLevel = "standard",
): Promise<Entitlement> {
  if (!name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("entitlements")
    .insert({
      tenant_id: tenantId,
      application_id: applicationId,
      name,
      data_classification: dataClassification ?? null,
      privilege_level: privilegeLevel,
    })
    .select()
    .single();
  // QA-P0-17: 0076's same-tenant foreign keys refuse a reference to another
  // organization's row (23503). Say so, rather than a generic 500.
  if (error?.code === "23503") throw new ApiError(404, "NOT_FOUND", "That application is not in this organization");
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create entitlement");
  return toEntitlement(data);
}

export async function getEntitlement(tenantId: string, entitlementId: string): Promise<Entitlement | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("entitlements").select().eq("id", entitlementId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toEntitlement(data) : null;
}

export async function listEntitlementsForApplication(
  tenantId: string,
  applicationId: string,
): Promise<Entitlement[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("entitlements")
    .select()
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toEntitlement);
}

/**
 * OPERATIONS-P0-03.1's "entitlement" search object type — the tenant-wide
 * counterpart to `listEntitlementsForApplication()` above, same reasoning
 * as Identity Agent's `listOwnersForTenant()`/`listIdentitiesForTenant()`:
 * the embed is a real FK (`entitlements.application_id -> applications(id)`).
 */
export type EntitlementWithContext = Entitlement & { applicationName: string };

export async function listEntitlementsForTenant(tenantId: string): Promise<EntitlementWithContext[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("entitlements")
    .select("*, applications(name)")
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((row: Record<string, unknown> & { applications: { name: string } | null }) => ({
    ...toEntitlement(row),
    applicationName: row.applications?.name ?? "",
  }));
}
