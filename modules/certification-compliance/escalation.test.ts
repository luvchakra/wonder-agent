// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

const notify = vi.fn();
vi.mock("@/modules/operations/service", () => ({ notify: (...a: unknown[]) => notify(...a) }));

const listOwners = vi.fn();
vi.mock("@/modules/agent-identity/service", () => ({ listOwners: (...a: unknown[]) => listOwners(...a) }));

let overdueRows: Record<string, unknown>[] = [];
let failNextSelect = false;
const updateFn = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));

function itemsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          is: () => ({
            lt: () => ({
              returns: async () => {
                if (failNextSelect) {
                  failNextSelect = false;
                  return { data: null, error: { message: "boom" } };
                }
                return { data: overdueRows, error: null };
              },
            }),
          }),
        }),
      }),
    }),
    update: updateFn,
  };
}

let tenantRows: Record<string, unknown>[] = [];
function tenantsTable() {
  return { select: () => ({ eq: async () => ({ data: tenantRows, error: null }) }) };
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({
    from: (t: string) => {
      if (t === "certification_items") return itemsTable();
      if (t === "tenants") return tenantsTable();
      throw new Error(`unexpected table ${t}`);
    },
  }),
}));

import { escalateOverdueItems, escalateOverdueItemsForAllTenants } from "./escalation";

beforeEach(() => {
  vi.clearAllMocks();
  overdueRows = [];
  tenantRows = [];
  listOwners.mockResolvedValue([]);
});

describe("escalateOverdueItems — OPERATIONS-P0-02.2 wiring", () => {
  it("notifies the escalated-to user for every escalated item", async () => {
    overdueRows = [
      {
        id: "item-1",
        tenant_id: "tenant-a",
        campaign_id: "campaign-1",
        agent_id: "agent-1",
        reviewer_id: "reviewer-1",
        due_date: "2026-01-01T00:00:00Z",
        status: "pending",
        certification_campaigns: { created_by: "campaign-owner" },
      },
    ];
    listOwners.mockResolvedValue([{ id: "o1", ownerType: "business_owner", userId: "biz-owner-1" }]);

    const count = await escalateOverdueItems("tenant-a", "actor-1");

    expect(count).toBe(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", userId: "biz-owner-1", type: "certification_overdue", referenceType: "certification_item", referenceId: "item-1" }),
    );
  });

  it("falls back to the campaign creator when the agent has no business owner", async () => {
    overdueRows = [
      {
        id: "item-1",
        tenant_id: "tenant-a",
        campaign_id: "campaign-1",
        agent_id: "agent-1",
        reviewer_id: "reviewer-1",
        due_date: "2026-01-01T00:00:00Z",
        status: "pending",
        certification_campaigns: { created_by: "campaign-owner" },
      },
    ];
    listOwners.mockResolvedValue([]);

    await escalateOverdueItems("tenant-a", "actor-1");

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "campaign-owner" }));
  });

  it("notifies nothing when there are no overdue items", async () => {
    overdueRows = [];
    const count = await escalateOverdueItems("tenant-a", "actor-1");
    expect(count).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("escalateOverdueItemsForAllTenants — COMPLIANCE-P0-05's cron scheduler entry point", () => {
  it("sweeps every active tenant and sums the escalated counts", async () => {
    tenantRows = [{ id: "tenant-a" }, { id: "tenant-b" }];
    overdueRows = [
      {
        id: "item-1",
        tenant_id: "tenant-a",
        campaign_id: "campaign-1",
        agent_id: "agent-1",
        reviewer_id: "reviewer-1",
        due_date: "2026-01-01T00:00:00Z",
        status: "pending",
        certification_campaigns: { created_by: "campaign-owner" },
      },
    ];

    const results = await escalateOverdueItemsForAllTenants();

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.escalatedCount === 1 && !r.error)).toBe(true);
  });

  it("isolates one tenant's failure — other tenants still get swept and it's reported, not thrown", async () => {
    tenantRows = [{ id: "tenant-a" }, { id: "tenant-b" }];
    overdueRows = [];
    failNextSelect = true; // fails only the first (tenant-a's) certification_items query

    const [first, second] = await escalateOverdueItemsForAllTenants();

    expect(first).toMatchObject({ tenantId: "tenant-a", escalatedCount: 0 });
    expect(first.error).toBeTruthy();
    expect(second).toEqual({ tenantId: "tenant-b", escalatedCount: 0 });
  });

  it("returns an empty sweep when there are no active tenants", async () => {
    tenantRows = [];
    const results = await escalateOverdueItemsForAllTenants();
    expect(results).toEqual([]);
  });
});
