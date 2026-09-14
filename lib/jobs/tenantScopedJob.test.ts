// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));

import { computeIdempotencyKey, runTenantScopedJob } from "./tenantScopedJob";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";

const ctx: TenantContext = {
  userId: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "acme",
  roles: ["IAM_ADMIN"],
  permissions: ["integration.execute"],
};

describe("runTenantScopedJob — FOUNDATION-P0-08", () => {
  it("rejects a context with no resolved tenant", async () => {
    const noTenantCtx: TenantContext = { ...ctx, tenantId: null };
    await expect(
      runTenantScopedJob(noTenantCtx, "integration.execute", "key-1", async () => "ok"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a context missing the required permission", async () => {
    await expect(
      runTenantScopedJob(ctx, "policy.delete", "key-1", async () => "ok"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a call with no idempotency key", async () => {
    await expect(
      runTenantScopedJob(ctx, "integration.execute", "", async () => "ok"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("passes a frozen job context carrying the verified tenant/actor/key to the job body", async () => {
    const result = await runTenantScopedJob(ctx, "integration.execute", "key-1", async (job) => {
      expect(job.tenantId).toBe("tenant-1");
      expect(job.actorId).toBe("user-1");
      expect(job.idempotencyKey).toBe("key-1");
      expect(Object.isFrozen(job)).toBe(true);
      return "done";
    });
    expect(result).toBe("done");
  });

  it("writes a job.failed audit event and rethrows when the job body throws", async () => {
    await expect(
      runTenantScopedJob(ctx, "integration.execute", "key-1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job.failed", tenantId: "tenant-1", outcome: "failure" }),
    );
  });
});

describe("computeIdempotencyKey", () => {
  it("is deterministic for the same inputs", () => {
    expect(computeIdempotencyKey(["a", 1, null])).toBe(computeIdempotencyKey(["a", 1, null]));
  });

  it("differs for different inputs", () => {
    expect(computeIdempotencyKey(["a"])).not.toBe(computeIdempotencyKey(["b"]));
  });
});
