import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { writePlatformAudit } from "./auditLog";
import { validateOrganizationProfile, type OrganizationProfile } from "./organizationProfileRules";

/**
 * Owner request (2026-10-13): an organization's details in the platform
 * console: name and description, a contact person, the company's contacts
 * and company details. Vendor-side (platform_organization_profiles,
 * migration 0162, no client policies); callers have passed
 * requirePlatformAdmin(). Every change is audited with what changed.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS: Record<keyof OrganizationProfile, string> = {
  description: "description",
  contactName: "contact_name",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
  companyName: "company_name",
  companyEmail: "company_email",
  companyPhone: "company_phone",
  industry: "industry",
  userBaseSize: "user_base_size",
  country: "country",
  website: "website",
};

export async function getOrganizationProfile(tenantId: string): Promise<OrganizationProfile | null> {
  if (!UUID.test(tenantId)) return null;
  const { data, error } = await supabaseServiceRole().from("platform_organization_profiles").select().eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", "The organization's details could not be read");
  if (!data) return null;
  const row = data as Record<string, string | null>;
  return Object.fromEntries(Object.entries(COLUMNS).map(([key, col]) => [key, row[col] ?? null])) as OrganizationProfile;
}

export async function saveOrganizationProfile(actorId: string, tenantId: string, raw: Record<string, unknown>): Promise<OrganizationProfile> {
  if (!UUID.test(tenantId)) throw new ApiError(404, "TENANT_NOT_FOUND");
  const result = validateOrganizationProfile(raw);
  if (!result.ok) throw new ApiError(400, "INVALID_INPUT", Object.values(result.errors)[0]);
  const supabase = supabaseServiceRole();
  const { data: parent } = await supabase.from("platform_tenants").select("parent_tenant_id").eq("tenant_id", tenantId).maybeSingle();
  if (parent?.parent_tenant_id) throw new ApiError(400, "INVALID_INPUT", "Details belong to the organization, not to one of its environments");
  const previous = await getOrganizationProfile(tenantId);
  const row = Object.fromEntries(Object.entries(COLUMNS).map(([key, col]) => [col, result.value[key as keyof OrganizationProfile]]));
  const { error } = await supabase
    .from("platform_organization_profiles")
    .upsert({ tenant_id: tenantId, ...row, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) {
    await writePlatformAudit({ actorId, tenantId, action: "platform.organization_profile_updated", result: "failure" });
    throw new ApiError(error.code === "23503" ? 404 : 500, "UPDATE_FAILED", error.code === "23503" ? "Organization not found" : "The details could not be saved");
  }
  const changed = (Object.keys(COLUMNS) as (keyof OrganizationProfile)[]).filter((k) => (previous?.[k] ?? null) !== result.value[k]);
  await writePlatformAudit({
    actorId,
    tenantId,
    action: "platform.organization_profile_updated",
    oldValue: previous ? Object.fromEntries(changed.map((k) => [k, previous[k]])) : undefined,
    newValue: Object.fromEntries(changed.map((k) => [k, result.value[k]])),
    result: "success",
  });
  return result.value;
}

/** Renames an organization; its environments' names follow (migration 0162). */
export async function renameOrganization(actorId: string, tenantId: string, name: string): Promise<void> {
  if (!UUID.test(tenantId)) throw new ApiError(404, "TENANT_NOT_FOUND");
  const { data, error } = await supabaseServiceRole().rpc("platform_rename_organization", { p_tenant: tenantId, p_name: name });
  if (error) {
    await writePlatformAudit({ actorId, tenantId, action: "platform.organization_renamed", newValue: { name }, result: "failure" });
    if (error.code === "22023")
      throw new ApiError(
        400,
        "INVALID_INPUT",
        error.message.replace(/^./, (c) => c.toUpperCase()),
      );
    if (error.code === "P0002") throw new ApiError(404, "TENANT_NOT_FOUND");
    throw new ApiError(500, "UPDATE_FAILED", "The organization could not be renamed");
  }
  await writePlatformAudit({ actorId, tenantId, action: "platform.organization_renamed", oldValue: { name: data }, newValue: { name: name.trim() }, result: "success" });
}
