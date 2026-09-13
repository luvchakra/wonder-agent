import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ApiError, TenantContext } from "@/lib/shared/types/foundation";

const getTenantContextMock = vi.fn<() => Promise<TenantContext>>();

vi.mock("@/lib/tenant/getTenantContext", () => ({
  getTenantContext: () => getTenantContextMock(),
}));

const { requirePermission } = await import("./requirePermission");

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
