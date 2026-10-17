// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner decision 2026-10-17: a failed read while resolving access is never
 * "no access" or "no organization". Nothing is permitted, and the context
 * says it could not be checked (`unavailable`).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/tenant/session", () => ({ getSessionUser: async () => ({ id: "u1", aal: "aal1" }) }));
vi.mock("@/lib/tenant/hostTenant", () => ({ getHostTenant: async () => ({ target: { kind: "main" }, tenant: null }) }));
vi.mock("@/lib/security/automationCredentials", () => ({ getAutomationAccess: async () => null }));

type Result = { data: unknown; error: { code?: string; message?: string } | null };
let results: Record<string, Result>;
const ok = (data: unknown): Result => ({ data, error: null });
const fail: Result = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };

function query(table: string) {
  const q = { select: () => q, eq: () => q, returns: async () => results[table] };
  return q;
}
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ rpc: async () => results.my_memberships, from: (t: string) => query(t) }),
}));

const role = { id: "r1", name: "TENANT_SUPER_ADMIN", display_name: "Tenant Administrator", status: "active", role_permissions: [{ permissions: { key: "agent.read" } }] };
const terms = { scope_type: "tenant", scope_values: [], starts_at: null, expires_at: null, requires_mfa: false };

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  results = {
    my_memberships: ok([{ tenant_id: "t1", name: "Acme", slug: "acme", account_type: "internal", mfa_required: false }]),
    user_roles: ok([{ tenant_id: "t1", ...terms, roles: role }]),
    group_members: ok([]),
    authorization_policies: ok([]),
  };
});

async function resolve() {
  const { getTenantContext } = await import("./getTenantContext");
  return getTenantContext();
}

describe("getTenantContext when a read fails", () => {
  it("resolves normally when every read succeeds", async () => {
    const ctx = await resolve();
    expect(ctx).toMatchObject({ tenantId: "t1", permissions: ["agent.read"] });
    expect(ctx.unavailable).toBeUndefined();
  });

  for (const table of ["my_memberships", "user_roles", "group_members", "authorization_policies"]) {
    it(`a failed ${table} read is unavailable, with no permissions`, async () => {
      results[table] = fail;
      const ctx = await resolve();
      expect(ctx.unavailable).toBe(true);
      expect(ctx.permissions).toEqual([]);
      expect(ctx.roles).toEqual([]);
    });
  }

  it("an empty but successful read is still plain no access, not unavailable", async () => {
    results.my_memberships = ok([]);
    const ctx = await resolve();
    expect(ctx).toMatchObject({ tenantId: null, permissions: [] });
    expect(ctx.unavailable).toBeUndefined();
  });
});
