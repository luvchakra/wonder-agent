/**
 * Owner request (2026-10-13): one-click switching between an organization's
 * environments. Pure (tested): which of a person's own organizations are
 * environments of the same organization.
 *
 * - Linked by the platform (migration 0156): an environment and its
 *   production organization share the production organization's id.
 * - Not linked (each chosen at sign-up, migration 0157): organizations whose
 *   addresses differ only by the environment suffix (`acme`, `acme-dev`,
 *   `acme-test`, `acme-staging`) belong together.
 * Only the person's own memberships are ever grouped, so this reveals nothing.
 */
export type EnvironmentMember = { tenantId: string; slug: string; environment: string | null; parentTenantId: string | null };

const ORDER = ["production", "development", "test", "staging", "sandbox"];
const SUFFIX = /-(dev|test|staging)$/;

export function environmentFamilyKey(m: EnvironmentMember, all: EnvironmentMember[]): string {
  if (m.parentTenantId) return `id:${m.parentTenantId}`;
  if (all.some((o) => o.parentTenantId === m.tenantId)) return `id:${m.tenantId}`;
  return `slug:${m.slug.replace(SUFFIX, "")}`;
}

/** The current organization's environments (itself included), production first; empty when it has no others. */
export function environmentSiblings<T extends EnvironmentMember>(currentId: string, all: T[]): T[] {
  const current = all.find((m) => m.tenantId === currentId);
  if (!current) return [];
  const key = environmentFamilyKey(current, all);
  const family = all.filter((m) => environmentFamilyKey(m, all) === key);
  if (family.length < 2) return [];
  const rank = (e: string | null) => {
    const i = ORDER.indexOf(e ?? "production");
    return i < 0 ? ORDER.length : i;
  };
  return [...family].sort((a, b) => rank(a.environment) - rank(b.environment));
}
