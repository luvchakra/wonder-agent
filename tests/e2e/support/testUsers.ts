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

export type TestUserKey = "adminOne" | "readOnly" | "requester" | "adminTwo" | "platformAdmin" | "signOutOnly" | "passwordResetOnly" | "multiOrg";

export type TestUserSpec = {
  email: string;
  password: string;
  /** System role template name to grant (see supabase/migrations/0003_foundation_rbac.sql). Null for the platform-admin identity, which has no tenant membership at all. */
  role: string | null;
  tenant: typeof TENANT_ONE | typeof TENANT_TWO | null;
  isPlatformAdmin: boolean;
  /** A second membership, for the one identity that belongs to two organizations. */
  alsoIn?: { tenant: typeof TENANT_ONE | typeof TENANT_TWO; role: string };
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
  // Used by exactly one test: auth.spec.ts's password-reset round trip. Its
  // whole point is to actually change this identity's password via the
  // real flow, so — same reasoning as signOutOnly — it needs an identity no
  // other spec's stored auth state or fresh sign-in depends on. Excluded
  // from auth.setup.ts's signInAndSaveState loop for the same reason.
  passwordResetOnly: { email: "e2e-password-reset@e2e.wonderagent.test", password: E2E_PASSWORD, role: "READ_ONLY", tenant: TENANT_ONE, isPlatformAdmin: false },
  // QA-P0-17 — a member of BOTH organizations, with a different role in
  // each: READ_ONLY in Tenant One, TENANT_SUPER_ADMIN in Tenant Two. Used
  // only by multi-org-isolation.spec.ts, which proves the active
  // organization alone decides what is seen and what the role allows.
  multiOrg: {
    email: "e2e-multi-org@e2e.wonderagent.test",
    password: E2E_PASSWORD,
    role: "READ_ONLY",
    tenant: TENANT_ONE,
    isPlatformAdmin: false,
    alsoIn: { tenant: TENANT_TWO, role: "TENANT_SUPER_ADMIN" },
  },
};

export function authFile(key: TestUserKey): string {
  return `tests/e2e/.auth/${key}.json`;
}
