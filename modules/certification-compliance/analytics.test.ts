import { describe, expect, it } from "vitest";
import type { CampaignMetrics, CertificationCampaign } from "@/lib/shared/types/compliance";
import { campaignCalendar, summarizeCampaigns } from "./analytics";

const campaign = (id: string, over: Partial<CertificationCampaign> = {}): CertificationCampaign => ({
  id,
  tenantId: "t",
  name: `Campaign ${id}`,
  scopeType: "identity_access",
  scope: {},
  cadence: "one_time",
  status: "active",
  dueDate: null,
  createdBy: "u",
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});
const metrics = (total: number, decided: number, overdue = 0): CampaignMetrics => ({ totalItems: total, pendingItems: total - decided, decidedItems: decided, overdueItems: overdue, escalatedItems: 0 });

describe("COMPLIANCE-P0-10: campaign analytics", () => {
  it("adds up items, completion, revoke rate and the weighted time to decide", () => {
    const campaigns = [campaign("a"), campaign("b", { scopeType: "role_assignments", status: "completed" })];
    const counts = new Map([
      ["a", metrics(10, 4, 2)],
      ["b", metrics(6, 6)],
    ]);
    const a = summarizeCampaigns(campaigns, counts, [
      { campaignId: "a", decision: "approve", decisions: 3, avgHours: 10 },
      { campaignId: "a", decision: "revoke", decisions: 1, avgHours: 30 },
      { campaignId: "b", decision: "approve", decisions: 6, avgHours: 5 },
      { campaignId: "gone", decision: "revoke", decisions: 99, avgHours: 1 },
    ]);
    expect(a).toMatchObject({ campaigns: 2, active: 1, items: 16, decided: 10, pending: 6, overdue: 2, completion: 62.5, revokeRate: 10, avgHoursToDecide: 9 });
    expect(a.outcomes).toEqual([
      { decision: "approve", label: "Certified", count: 9 },
      { decision: "revoke", label: "Revoked", count: 1 },
    ]);
    expect(a.byScope).toEqual([
      { scopeType: "identity_access", campaigns: 1, items: 10, decided: 4, revoked: 1, overdue: 2 },
      { scopeType: "role_assignments", campaigns: 1, items: 6, decided: 6, revoked: 0, overdue: 0 },
    ]);
  });

  it("shows nothing it cannot compute", () => {
    const a = summarizeCampaigns([campaign("a")], new Map(), []);
    expect(a).toMatchObject({ items: 0, completion: null, revokeRate: null, avgHoursToDecide: null, outcomes: [] });
  });
});

describe("COMPLIANCE-P0-10: campaign calendar", () => {
  const now = new Date("2026-10-17T10:00:00Z");

  it("puts open campaigns under the month they are due, past due first; closed ones are left out", () => {
    const { months, undated } = campaignCalendar(
      [
        campaign("nov", { dueDate: "2026-11-30" }),
        campaign("late", { dueDate: "2026-10-01" }),
        campaign("oct2", { dueDate: "2026-10-20" }),
        campaign("oct1", { dueDate: "2026-10-18" }),
        campaign("none"),
        campaign("done", { dueDate: "2026-10-19", status: "completed" }),
      ],
      now,
    );
    expect(months.map((m) => [m.label, m.campaigns.map((c) => c.id)])).toEqual([
      ["Past due", ["late"]],
      ["October 2026", ["oct1", "oct2"]],
      ["November 2026", ["nov"]],
    ]);
    expect(undated).toBe(1);
  });
});
