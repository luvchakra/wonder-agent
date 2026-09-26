/**
 * FOUNDATION-P0-24 — the permission catalog's vocabulary and filtering
 * (pure; the database read is permissionCatalog.ts).
 */

export const PERMISSION_MODULES = ["DISCOVER", "UNDERSTAND", "GOVERN", "PROTECT", "ASSURE", "ADMINISTRATION"] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export const SENSITIVITIES = ["standard", "sensitive", "privileged"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const MODULE_LABEL: Record<PermissionModule, string> = {
  DISCOVER: "Discover",
  UNDERSTAND: "Understand",
  GOVERN: "Govern",
  PROTECT: "Protect",
  ASSURE: "Assure",
  ADMINISTRATION: "Administration",
};

export type CatalogPermission = {
  key: string;
  label: string;
  description: string;
  resource: string;
  action: string;
  module: PermissionModule;
  sensitivity: Sensitivity;
  roles: string[];
};

/** Filter the catalog for the screen: free text over key, label, resource and description. */
export function filterCatalog(items: CatalogPermission[], f: { q?: string; module?: string; sensitivity?: string }): CatalogPermission[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return items.filter(
    (p) =>
      (!f.module || p.module === f.module) &&
      (!f.sensitivity || p.sensitivity === f.sensitivity) &&
      (!q || p.key.includes(q) || p.label.toLowerCase().includes(q) || p.resource.includes(q) || p.description.toLowerCase().includes(q)),
  );
}
