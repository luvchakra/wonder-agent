import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ApiError, TenantContext } from "@/lib/shared/types/foundation";

const getTenantContextMock = vi.fn<() => Promise<TenantContext>>();

vi.mock("@/lib/tenant/getTenantContext", () => ({
  getTenantContext: () => getTenantContextMock(),
}));

const { requirePermission, requireAnyPermission } = await import("./requirePermission");

describe("requirePermission", () => {
  beforeEach(() => {
    getTenantContextMock.mockReset();
  });

  it("throws 401 NO_TENANT when the user has no active tenant", async () => {
    getTenantContextMock.mockResolvedValue({
      userId: "u1",
      tenantId: null,
      tenantSlug: null,
      roles: [],
      permissions: [],
    });

    await expect(requirePermission("agent.read")).rejects.toMatchObject({
      status: 401,
      code: "NO_TENANT",
    } satisfies Partial<InstanceType<typeof ApiError>>);
  });

  it("throws 403 FORBIDDEN when the tenant context lacks the permission", async () => {
    getTenantContextMock.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      tenantSlug: "acme",
      roles: ["READ_ONLY"],
      permissions: ["agent.read"],
    });

    await expect(requirePermission("agent.create")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    } satisfies Partial<InstanceType<typeof ApiError>>);
  });

  it("resolves with the tenant context when the permission is present", async () => {
    const ctx: TenantContext = {
      userId: "u1",
      tenantId: "t1",
      tenantSlug: "acme",
      roles: ["IAM_ADMIN"],
      permissions: ["agent.read", "agent.create"],
    };
    getTenantContextMock.mockResolvedValue(ctx);

    await expect(requirePermission("agent.create")).resolves.toEqual(ctx);
  });
});

describe("requireAnyPermission", () => {
  const ctx = (permissions: string[], tenantId: string | null = "t1"): TenantContext => ({
    userId: "u1",
    tenantId,
    tenantSlug: tenantId ? "acme" : null,
    roles: [],
    permissions,
  });

  beforeEach(() => {
    getTenantContextMock.mockReset();
  });

  it("passes when the user holds any one of the permissions", async () => {
    getTenantContextMock.mockResolvedValue(ctx(["runtime.emergency"]));
    await expect(requireAnyPermission(["agent.update", "runtime.emergency"])).resolves.toMatchObject({ tenantId: "t1" });
  });

  it("throws 403 when the user holds none of them", async () => {
    getTenantContextMock.mockResolvedValue(ctx(["agent.read"]));
    await expect(requireAnyPermission(["agent.update", "runtime.emergency"])).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("throws 401 without a tenant, whatever the permissions", async () => {
    getTenantContextMock.mockResolvedValue(ctx(["agent.update"], null));
    await expect(requireAnyPermission(["agent.update"])).rejects.toMatchObject({ status: 401, code: "NO_TENANT" });
  });
});
