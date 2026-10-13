// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: async () => ({}) }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));

import { groupManaged, type ManagedTenant } from "./manage";

const t = (tenantId: string, name: string, environment: string, parentTenantId: string | null = null): ManagedTenant => ({
  tenantId,
  name,
  slug: tenantId,
  status: "active",
  disabledByOwner: false,
  environment,
  parentTenantId,
});

describe("groupManaged (owner request 2026-10-13)", () => {
  it("puts each organization first with its environments in order, organizations by name", () => {
    const groups = groupManaged([
      t("b-stg", "Beta (Staging)", "staging", "b"),
      t("b", "Beta", "production"),
      t("a", "Acme", "development"),
      t("b-dev", "Beta (Dev)", "development", "b"),
      t("a-test", "Acme (Test)", "test", "a"),
    ]);
    expect(groups.map((g) => [g.tenantId, g.environments.map((e) => e.tenantId)])).toEqual([
      ["a", ["a-test"]],
      ["b", ["b-dev", "b-stg"]],
    ]);
  });

  it("an environment whose organization is not listed stands on its own", () => {
    expect(groupManaged([t("x-dev", "X (Dev)", "development", "x")]).map((g) => g.tenantId)).toEqual(["x-dev"]);
  });
});
