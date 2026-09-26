import "server-only";

import { MODULE_LABEL, PERMISSION_MODULES, listPermissionCatalog } from "@/lib/rbac/permissionCatalog";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { loadScopeOptions } from "../roles/scopeOptions";

/** FOUNDATION-P0-19 — what the policy form offers: the catalog by module, the roles, and scope targets. */
export async function loadPolicyFormData(tenantId: string) {
  const [catalog, roles, scope] = await Promise.all([listPermissionCatalog(), listAssignableRoles(tenantId), loadScopeOptions(tenantId)]);
  return {
    catalog: PERMISSION_MODULES.map((m) => ({
      module: m,
      label: MODULE_LABEL[m],
      permissions: catalog.filter((p) => p.module === m).map((p) => ({ key: p.key, label: p.label })),
    })).filter((g) => g.permissions.length),
    roles: roles.map((r) => ({ id: r.id, label: r.displayName })),
    ...scope,
  };
}
