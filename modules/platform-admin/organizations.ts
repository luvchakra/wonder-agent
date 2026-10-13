/**
 * Owner request (2026-10-13): the platform console shows organizations,
 * each holding its environments. Pure (tested): groups the platform's
 * tenants into organizations. An organization is its production tenant plus
 * the environments linked to it (migration 0156), or, when not linked, the
 * tenants whose addresses differ only by the environment suffix
 * (`acme`, `acme-dev`, …; the same rule the shell uses).
 */
import type { PlatformTenant } from "@/lib/shared/types/platform";
import { environmentFamilyKey } from "@/lib/tenant/environmentFamily";

const ORDER = ["production", "staging", "test", "development", "sandbox"];

export type Organization = { id: string; name: string; primary: PlatformTenant; environments: PlatformTenant[] };

export function groupOrganizations(tenants: PlatformTenant[]): Organization[] {
  const members = tenants.map((t) => ({ tenantId: t.tenantId, slug: t.slug ?? "", environment: t.environment, parentTenantId: t.parentTenantId ?? null }));
  const groups = new Map<string, PlatformTenant[]>();
  for (const t of tenants) {
    const key = environmentFamilyKey({ tenantId: t.tenantId, slug: t.slug ?? "", environment: t.environment, parentTenantId: t.parentTenantId ?? null }, members);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const rank = (e: string) => {
    const i = ORDER.indexOf(e);
    return i < 0 ? ORDER.length : i;
  };
  return [...groups.values()].map((list) => {
    // The organization is the tenant its environments link to, whatever its own
    // environment (one set up as development holds its test and staging, 0161);
    // without links, the production one first.
    const root = list.find((t) => !t.parentTenantId && list.some((o) => o.parentTenantId === t.tenantId));
    const environments = [...list].sort((a, b) => (a === root ? -1 : b === root ? 1 : rank(a.environment) - rank(b.environment)));
    const primary = environments[0];
    return { id: primary.tenantId, name: primary.name ?? primary.tenantId, primary, environments };
  });
}
