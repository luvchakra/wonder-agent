// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let current: Record<string, unknown> | null = null;
const updates: Record<string, unknown>[] = [];
const from = () => {
  let isUpdate = false;
  const b = {
    select: () => b,
    insert: (row: Record<string, unknown>) => ((current = { id: "s1", status: "active", started_at: "2026-10-13", ...row }), b),
    update: (row: Record<string, unknown>) => ((isUpdate = true), updates.push(row), (current = { ...current, ...row }), b),
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: async () => ({ data: current, error: null }),
    single: async () => ({ data: isUpdate || current ? current : null, error: null }),
  };
  return b;
};
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from }) }));
const audits: Record<string, unknown>[] = [];
vi.mock("./auditLog", () => ({ writePlatformAudit: vi.fn(async (e: Record<string, unknown>) => void audits.push(e)) }));

import { changePlan } from "./subscriptions";

beforeEach(() => {
  current = null;
  updates.length = 0;
  audits.length = 0;
});

describe("changePlan (owner request 2026-10-13)", () => {
  it("changes a hand-assigned plan with the new plan's limits, audited from and to", async () => {
    current = { id: "s1", tenant_id: "t1", plan: "free", provider: "manual", status: "active", started_at: "2026-10-01" };
    const sub = await changePlan("admin-1", "t1", "pro");
    expect(sub.plan).toBe("pro");
    expect(updates[0]).toMatchObject({ plan: "pro", max_users: 25, audit_retention_days: 365 });
    expect(audits).toEqual([expect.objectContaining({ action: "platform.subscription_plan_changed", oldValue: { plan: "free" }, newValue: { plan: "pro" }, result: "success" })]);
  });

  it("refuses a plan billed through a payment provider (a second administrator approves those in Billing)", async () => {
    current = { id: "s1", tenant_id: "t1", plan: "pro", provider: "stripe", status: "active", started_at: "2026-10-01" };
    await expect(changePlan("admin-1", "t1", "enterprise")).rejects.toMatchObject({ status: 409, code: "BILLED_BY_PROVIDER" });
    expect(updates).toHaveLength(0);
  });

  it("assigns one when there is none, and refuses an unknown plan", async () => {
    await expect(changePlan("admin-1", "t1", "max")).resolves.toMatchObject({ plan: "max" });
    await expect(changePlan("admin-1", "t1", "gold" as never)).rejects.toMatchObject({ status: 400 });
  });
});
