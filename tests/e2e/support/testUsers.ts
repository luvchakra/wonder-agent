/**
 * QA Agent's Playwright suite — the fixed set of seeded test identities
 * every spec authenticates as. All emails/slugs live under the `e2e-*`
 * namespace (and `.test` TLD, reserved for testing per RFC 2606) so they
 * can never collide with the `fixture-tenant-*`/`aaaaaaaa-*`/`bbbbbbbb-*`
 * namespace every `tests/**\/*.sql` module fixture already uses in this
 * same dev Supabase project — see docs/design/qa-agent-backlog-audit.md.
 */

export const E2E_PASSWORD = "E2E-Test-Passw0rd!1";

export const TENANT_ONE = { name: "E2E Tenant One", slug: "e2e-tenant-one" };
export const TENANT_TWO = { name: "E2E Tenant Two", slug: "e2e-tenant-two" };

export type TestUserKey = "adminOne" | "readOnly" | "requester" | "adminTwo" | "platformAdmin" | "signOutOnly";

export type TestUserSpec = {
  email: string;
  password: string;
  /** System role template name to grant (see supabase/migrations/0003_foundation_rbac.sql). Null for the platform-admin identity, which has no tenant membership at all. */
  role: string | null;
  tenant: typeof TENANT_ONE | typeof TENANT_TWO | null;
  isPlatformAdmin: boolean;
};

export const TEST_USERS: Record<TestUserKey, TestUserSpec> = {
  // TENANT_SUPER_ADMIN in Tenant One — the primary identity for CRUD/decision-flow specs.
  adminOne: { email: "e2e-admin-1@e2e.wonderagent.test", password: E2E_PASSWORD, role: "TENANT_SUPER_ADMIN", tenant: TENANT_ONE, isPlatformAdmin: false },
  // READ_ONLY in Tenant One — negative-permission checks (every *.read only).
  readOnly: { email: "e2e-readonly@e2e.wonderagent.test", password: E2E_PASSWORD, role: "READ_ONLY", tenant: TENANT_ONE, isPlatformAdmin: false },
  // REQUESTER in Tenant One — the most restrictive named role (agent.read + integration.read only).
  requester: { email: "e2e-requester@e2e.wonderagent.test", password: E2E_PASSWORD, role: "REQUESTER", tenant: TENANT_ONE, isPlatformAdmin: false },
  // TENANT_SUPER_ADMIN in Tenant Two — a second, separate tenant for cross-tenant UI isolation checks.
  adminTwo: { email: "e2e-admin-2@e2e.wonderagent.test", password: E2E_PASSWORD, role: "TENANT_SUPER_ADMIN", tenant: TENANT_TWO, isPlatformAdmin: false },
  // Used by exactly one test: auth.spec.ts's sign-out flow. It needs an
  // identity no other spec shares, because signOutAction() calls
  // supabase.auth.signOut(), whose default scope in supabase-js v2 is
  // "global" — it revokes every refresh token the user holds, on every
  // device. Pointing that test at a shared identity therefore logged out
  // every other parallel spec mid-run.
  signOutOnly: { email: "e2e-signout@e2e.wonderagent.test", password: E2E_PASSWORD, role: "READ_ONLY", tenant: TENANT_ONE, isPlatformAdmin: false },
  // Vendor-only platform_admins row, deliberately zero tenant memberships — see platform-admin.spec.ts.
  platformAdmin: { email: "e2e-platform-admin@e2e.wonderagent.test", password: E2E_PASSWORD, role: null, tenant: null, isPlatformAdmin: true },
};

export function authFile(key: TestUserKey): string {
  return `tests/e2e/.auth/${key}.json`;
}
