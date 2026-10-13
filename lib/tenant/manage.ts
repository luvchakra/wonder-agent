import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * Owner request (2026-10-13): "Manage organizations". An organization's
 * owner (TENANT_SUPER_ADMIN of the organization) renames it, disables it,
 * and disables or enables each of its environments. Every check is in the
 * database (migration 0161) and runs as the signed-in person, so nobody
 * else's organization can be named here; each change is audited.
 */
export type ManagedTenant = {
  tenantId: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  disabledByOwner: boolean;
  environment: string;
  parentTenantId: string | null;
};

export type ManagedOrganization = ManagedTenant & { environments: ManagedTenant[] };

const ORDER = ["production", "development", "test", "staging", "sandbox"];

/** Organizations first, each with its environments (by kind). */
export function groupManaged(rows: ManagedTenant[]): ManagedOrganization[] {
  const ids = new Set(rows.map((r) => r.tenantId));
  const roots = rows.filter((r) => !r.parentTenantId || !ids.has(r.parentTenantId));
  return roots
    .map((root) => ({
      ...root,
      environments: rows.filter((r) => r.parentTenantId === root.tenantId).sort((a, b) => ORDER.indexOf(a.environment) - ORDER.indexOf(b.environment)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMyManagedOrganizations(): Promise<ManagedOrganization[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_managed_organizations");
  if (error) throw new ApiError(500, "QUERY_FAILED", "Your organizations could not be read");
  const rows = (
    (data ?? []) as { tenant_id: string; name: string; slug: string; status: "active" | "suspended"; disabled_by_owner: boolean; environment: string; parent_tenant_id: string | null }[]
  ).map((r) => ({
    tenantId: r.tenant_id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    disabledByOwner: r.disabled_by_owner,
    environment: r.environment,
    parentTenantId: r.parent_tenant_id,
  }));
  return groupManaged(rows);
}

function refused(error: { code?: string; message: string }, fallback: string): ApiError {
  if (error.code === "42501") return new ApiError(403, "FORBIDDEN", error.message);
  if (error.code === "P0002") return new ApiError(404, "NOT_FOUND", "Organization not found");
  if (error.code === "22023") return new ApiError(400, "INVALID_INPUT", error.message);
  return new ApiError(500, "UPDATE_FAILED", fallback);
}

export async function renameMyOrganization(actorId: string, tenantId: string, name: string): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("owner_rename_organization", { p_tenant: tenantId, p_name: name });
  if (error) throw refused(error, "The organization could not be renamed");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "tenant.renamed",
    objectType: "tenant",
    objectId: tenantId,
    outcome: "success",
    metadata: { from: data, to: name.trim(), by: "owner" },
  });
}

/** Disables (or enables) an organization with its environments, or one environment. Returns how many changed. */
export async function setMyOrganizationDisabled(actorId: string, tenantId: string, disabled: boolean): Promise<number> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("owner_set_organization_disabled", { p_tenant: tenantId, p_disabled: disabled });
  if (error) throw refused(error, disabled ? "It could not be disabled" : "It could not be enabled");
  const changed = ((data ?? []) as unknown[]).map((r) => (typeof r === "string" ? r : (r as { owner_set_organization_disabled: string }).owner_set_organization_disabled));
  await Promise.all(
    changed.map((id) =>
      writeAudit({
        tenantId: id,
        actorId,
        actorType: "user",
        action: disabled ? "tenant.disabled_by_owner" : "tenant.enabled_by_owner",
        objectType: "tenant",
        objectId: id,
        outcome: "success",
        metadata: { requestedFor: tenantId },
      }),
    ),
  );
  return changed.length;
}
