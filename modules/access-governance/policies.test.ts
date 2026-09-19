// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockNotify = vi.fn();
const mockWasRecentlyNotified = vi.fn();
vi.mock("@/modules/operations/service", () => ({
  notify: (event: unknown) => mockNotify(event),
  wasRecentlyNotified: (...a: unknown[]) => mockWasRecentlyNotified(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

let exceptionRows: Record<string, unknown>[] = [];
let tenantRows: { id: string; status: string }[] = [];

function exceptionsTable() {
  return {
    select: () => ({
      eq: (_c1: string, tenantId: string) => ({
        eq: (_c2: string, status: string) => ({
          not: () => ({
            lt: (_c4: string, before: string) => ({
              data: exceptionRows.filter(
                (r) => r.tenant_id === tenantId && r.status === status && r.expires_at !== null && (r.expires_at as string) < before,
              ),
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
}

function tenantsTable() {
  return {
    select: () => ({
      eq: (_c: string, status: string) => ({ data: tenantRows.filter((t) => t.status === status), error: null }),
    }),
  };
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({
    from: (table: string) => (table === "policy_exceptions" ? exceptionsTable() : tenantsTable()),
  }),
}));

import { sendExpiredExceptionReminders, sendExpiredExceptionRemindersForAllTenants } from "./policies";

/**
 * OPERATIONS-P0-02.2's `lifecycle_expiry` trigger (2026-09-19) — see
 * modules/agent-identity/owners.test.ts and lifecycle.test.ts for the
 * matching coverage of the other two previously-unwired trigger types.
 */
describe("sendExpiredExceptionReminders — OPERATIONS-P0-02.2's lifecycle_expiry trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exceptionRows = [
      {
        id: "exc-1",
        tenant_id: "tenant-a",
        policy_id: "policy-1",
        scope_type: "policy",
        scope_id: null,
        agent_id: "agent-1",
        reason: "Temporary elevated access for migration",
        business_justification: null,
        approved_by: "approver-1",
        compensating_control: null,
        residual_risk: null,
        status: "active",
        start_date: "2026-01-01T00:00:00Z",
        expires_at: "2026-01-15T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    mockWasRecentlyNotified.mockResolvedValue(false);
  });

  it("notifies the approver for an expired, still-active exception not recently notified", async () => {
    const count = await sendExpiredExceptionReminders("tenant-a");

    expect(count).toBe(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        userId: "approver-1",
        type: "lifecycle_expiry",
        referenceType: "policy_exception",
        referenceId: "exc-1",
      }),
    );
  });

  it("does not re-notify within the dedup window", async () => {
    mockWasRecentlyNotified.mockResolvedValue(true);

    const count = await sendExpiredExceptionReminders("tenant-a");

    expect(count).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not consider a still-active exception with no expiry date set", async () => {
    exceptionRows = [{ ...exceptionRows[0], expires_at: null }];

    const count = await sendExpiredExceptionReminders("tenant-a");

    expect(count).toBe(0);
  });

  it("does not consider an exception that has already been revoked", async () => {
    exceptionRows = [{ ...exceptionRows[0], status: "revoked" }];

    const count = await sendExpiredExceptionReminders("tenant-a");

    expect(count).toBe(0);
  });

  it("does not consider an exception whose expiry is still in the future", async () => {
    exceptionRows = [{ ...exceptionRows[0], expires_at: "2099-01-01T00:00:00Z" }];

    const count = await sendExpiredExceptionReminders("tenant-a");

    expect(count).toBe(0);
  });
});

describe("sendExpiredExceptionRemindersForAllTenants — the cron entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWasRecentlyNotified.mockResolvedValue(false);
  });

  it("sweeps every active tenant and sums the notified counts", async () => {
    tenantRows = [
      { id: "tenant-a", status: "active" },
      { id: "tenant-b", status: "active" },
    ];
    exceptionRows = [
      { id: "exc-a", tenant_id: "tenant-a", approved_by: "u1", status: "active", expires_at: "2020-01-01T00:00:00Z", created_at: "t", reason: "r" },
      { id: "exc-b", tenant_id: "tenant-b", approved_by: "u2", status: "active", expires_at: "2020-01-01T00:00:00Z", created_at: "t", reason: "r" },
    ];

    const results = await sendExpiredExceptionRemindersForAllTenants();
    expect(results).toEqual([
      { tenantId: "tenant-a", notifiedCount: 1 },
      { tenantId: "tenant-b", notifiedCount: 1 },
    ]);
  });

  it("isolates one tenant's failure — the sweep for other tenants still completes", async () => {
    tenantRows = [
      { id: "tenant-a", status: "active" },
      { id: "tenant-b", status: "active" },
    ];
    exceptionRows = [
      { id: "exc-a", tenant_id: "tenant-a", approved_by: "u1", status: "active", expires_at: "2020-01-01T00:00:00Z", created_at: "t", reason: "r" },
      { id: "exc-b", tenant_id: "tenant-b", approved_by: "u2", status: "active", expires_at: "2020-01-01T00:00:00Z", created_at: "t", reason: "r" },
    ];
    mockWasRecentlyNotified.mockImplementation(async (tenantId: string) => {
      if (tenantId === "tenant-a") throw new Error("boom");
      return false;
    });

    const results = await sendExpiredExceptionRemindersForAllTenants();
    const tenantAResult = results.find((r) => r.tenantId === "tenant-a");
    const tenantBResult = results.find((r) => r.tenantId === "tenant-b");
    expect(tenantAResult?.error).toBeDefined();
    expect(tenantAResult?.notifiedCount).toBe(0);
    expect(tenantBResult).toEqual({ tenantId: "tenant-b", notifiedCount: 1 });
  });

  it("returns an empty sweep when there are no active tenants", async () => {
    tenantRows = [];
    exceptionRows = [];

    const results = await sendExpiredExceptionRemindersForAllTenants();
    expect(results).toEqual([]);
  });
});
