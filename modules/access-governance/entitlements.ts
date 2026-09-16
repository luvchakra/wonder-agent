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
