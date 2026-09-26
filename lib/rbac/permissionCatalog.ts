import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * FOUNDATION-P0-24 — the permission catalog (spec §13–14, 28). Every
 * stable permission id with its resource and action, product module,
 * label and sensitivity (migration 0097), and the system roles that grant
 * it. Read with the member's own client: the catalog and system roles are
 * readable to every member, and a tenant's custom roles (FOUNDATION-P0-25)
 * will appear only to their own tenant through the same RLS.
 */

import type { CatalogPermission, PermissionModule, Sensitivity } from "./catalog";

export { MODULE_LABEL, PERMISSION_MODULES, SENSITIVITIES, filterCatalog, type CatalogPermission, type PermissionModule, type Sensitivity } from "./catalog";

type Row = {
  key: string;
  label: string;
  description: string;
  resource: string;
  action: string;
  module: PermissionModule;
  sensitivity: Sensitivity;
  role_permissions: { roles: { name: string; tenant_id: string | null } | null }[];
};

export async function listPermissionCatalog(): Promise<CatalogPermission[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("permissions")
    .select("key, label, description, resource, action, module, sensitivity, role_permissions(roles(name, tenant_id))")
    .order("module")
    .order("resource")
    .order("key")
    .returns<Row[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    resource: r.resource,
    action: r.action,
    module: r.module,
    sensitivity: r.sensitivity,
    roles: r.role_permissions
      .map((rp) => rp.roles?.name)
      .filter((n): n is string => !!n)
      .sort(),
  }));
}
