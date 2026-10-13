// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ORG = "aaaaaaaa-1630-4000-8000-000000000001";
let parentOf: string | null = null;
const children = [{ tenant_id: "env-dev" }, { tenant_id: "env-gone" }];
function from(table: string) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain,
    in: chain,
    neq: chain,
    eq: chain,
    maybeSingle: async () => ({ data: { parent_tenant_id: parentOf }, error: null }),
    then: (resolve: (v: unknown) => void) => resolve(table === "platform_tenants" ? { data: children, error: null } : { data: [{ id: "env-dev" }], error: null }),
  });
  return b;
}
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from }) }));
const { changePlan, createSubscription, getSubscription } = vi.hoisted(() => ({
  changePlan: vi.fn(),
  createSubscription: vi.fn(),
  getSubscription: vi.fn(),
}));
vi.mock("./subscriptions", () => ({ changePlan, createSubscription, getSubscription }));

import { ApiError } from "@/lib/shared/types/foundation";
import { inheritOrganizationPlan, setOrganizationPlan } from "./organizationPlan";

beforeEach(() => {
  parentOf = null;
  changePlan.mockReset().mockResolvedValue({});
  createSubscription.mockReset().mockResolvedValue({});
  getSubscription.mockReset();
});

describe("setOrganizationPlan (owner decision 2026-10-13: one plan per organization)", () => {
  it("sets the plan on the organization and every environment still in use", async () => {
    await expect(setOrganizationPlan("admin-1", ORG, "max")).resolves.toEqual({ changed: 2 });
    expect(changePlan.mock.calls.map((c) => c[1])).toEqual([ORG, "env-dev"]);
  });

  it("is refused on an environment", async () => {
    parentOf = ORG;
    await expect(setOrganizationPlan("admin-1", ORG, "max")).rejects.toMatchObject({ status: 400 });
    expect(changePlan).not.toHaveBeenCalled();
  });

  it("reports an environment billed through a payment provider instead of overwriting it", async () => {
    changePlan.mockImplementation(async (_a: string, id: string) => {
      if (id === "env-dev") throw new ApiError(409, "BILLED_BY_PROVIDER", "billed");
      return {};
    });
    await expect(setOrganizationPlan("admin-1", ORG, "pro")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("1 of 2") });
  });
});

describe("inheritOrganizationPlan", () => {
  it("gives a new environment its organization's plan, and leaves one that has a plan", async () => {
    getSubscription.mockImplementation(async (id: string) => (id === ORG ? { plan: "max" } : null));
    await expect(inheritOrganizationPlan("admin-1", ORG, "env-new")).resolves.toBe("max");
    expect(createSubscription).toHaveBeenCalledWith("admin-1", "env-new", "max");
    createSubscription.mockClear();
    getSubscription.mockImplementation(async (id: string) => (id === ORG ? { plan: "max" } : { plan: "pro" }));
    await expect(inheritOrganizationPlan("admin-1", ORG, "env-old")).resolves.toBe("pro");
    expect(createSubscription).not.toHaveBeenCalled();
  });
});
