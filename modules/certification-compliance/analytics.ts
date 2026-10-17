import type { CampaignMetrics, CertificationCampaign } from "@/lib/shared/types/compliance";

/**
 * COMPLIANCE-P0-10 (remainder) — the campaign calendar and analytics. Pure:
 * the counts come from the database (migrations 0154 and 0199); this only
 * groups and divides them. Nothing here is estimated: a rate with nothing to
 * divide by is null, shown as "—".
 */

export type DecisionCount = { campaignId: string; decision: string; decisions: number; avgHours: number | null };

export type CampaignAnalytics = {
  campaigns: number;
  active: number;
  items: number;
  decided: number;
  pending: number;
  overdue: number;
  /** Decided as a share of all items, 0–100, or null with no items. */
  completion: number | null;
  /** Revoked as a share of decided items, 0–100, or null with none decided. */
  revokeRate: number | null;
  /** Average hours from an item opening to its decision, or null. */
  avgHoursToDecide: number | null;
  /** Final outcomes, in a fixed order. */
  outcomes: { decision: string; label: string; count: number }[];
  /** Per scope type, most items first. */
  byScope: { scopeType: string; campaigns: number; items: number; decided: number; revoked: number; overdue: number }[];
};

export const OUTCOME_LABEL: Record<string, string> = {
  approve: "Certified",
  revoke: "Revoked",
  exception: "Exception",
  defer: "Deferred",
  escalate: "Escalated",
  modify: "Modified",
  delegate: "Delegated",
  request_information: "More information asked",
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function summarizeCampaigns(campaigns: CertificationCampaign[], counts: Map<string, CampaignMetrics>, decisions: DecisionCount[]): CampaignAnalytics {
  const known = new Set(campaigns.map((c) => c.id));
  const rows = decisions.filter((d) => known.has(d.campaignId));
  let items = 0;
  let decided = 0;
  let pending = 0;
  let overdue = 0;
  for (const c of campaigns) {
    const m = counts.get(c.id);
    items += m?.totalItems ?? 0;
    decided += m?.decidedItems ?? 0;
    pending += m?.pendingItems ?? 0;
    overdue += m?.overdueItems ?? 0;
  }
  const byDecision = new Map<string, number>();
  let hoursWeighted = 0;
  let hoursCount = 0;
  for (const d of rows) {
    byDecision.set(d.decision, (byDecision.get(d.decision) ?? 0) + d.decisions);
    if (d.avgHours !== null) {
      hoursWeighted += d.avgHours * d.decisions;
      hoursCount += d.decisions;
    }
  }
  const revoked = byDecision.get("revoke") ?? 0;
  const decidedByOutcome = [...byDecision.values()].reduce((a, b) => a + b, 0);

  const scopes = new Map<string, CampaignAnalytics["byScope"][number]>();
  const scopeOf = new Map(campaigns.map((c) => [c.id, c.scopeType as string]));
  for (const c of campaigns) {
    const s = scopes.get(c.scopeType) ?? { scopeType: c.scopeType, campaigns: 0, items: 0, decided: 0, revoked: 0, overdue: 0 };
    const m = counts.get(c.id);
    s.campaigns += 1;
    s.items += m?.totalItems ?? 0;
    s.decided += m?.decidedItems ?? 0;
    s.overdue += m?.overdueItems ?? 0;
    scopes.set(c.scopeType, s);
  }
  for (const d of rows) if (d.decision === "revoke") scopes.get(scopeOf.get(d.campaignId)!)!.revoked += d.decisions;

  return {
    campaigns: campaigns.length,
    active: campaigns.filter((c) => c.status === "active").length,
    items,
    decided,
    pending,
    overdue,
    completion: pct(decided, items),
    revokeRate: pct(revoked, decidedByOutcome),
    avgHoursToDecide: hoursCount ? Math.round((hoursWeighted / hoursCount) * 10) / 10 : null,
    outcomes: Object.keys(OUTCOME_LABEL)
      .filter((k) => byDecision.has(k))
      .map((k) => ({ decision: k, label: OUTCOME_LABEL[k], count: byDecision.get(k)! })),
    byScope: [...scopes.values()].sort((a, b) => b.items - a.items || a.scopeType.localeCompare(b.scopeType)),
  };
}

export type CalendarMonth = { key: string; label: string; campaigns: CertificationCampaign[] };

/**
 * Open campaigns by the month they are due: past due first, then each
 * month in order. Campaigns with no due date are counted, not placed.
 */
export function campaignCalendar(campaigns: CertificationCampaign[], now = new Date()): { months: CalendarMonth[]; undated: number } {
  const open = campaigns.filter((c) => c.status === "active" || c.status === "draft");
  const today = now.toISOString().slice(0, 10);
  const months = new Map<string, CalendarMonth>();
  let undated = 0;
  for (const c of open) {
    if (!c.dueDate) {
      undated += 1;
      continue;
    }
    const due = c.dueDate.slice(0, 10);
    const key = due < today ? "past" : due.slice(0, 7);
    const label =
      key === "past" ? "Past due" : new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const m = months.get(key) ?? { key, label, campaigns: [] };
    m.campaigns.push(c);
    months.set(key, m);
  }
  for (const m of months.values()) m.campaigns.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.name.localeCompare(b.name));
  const ordered = [...months.values()].sort((a, b) => (a.key === "past" ? -1 : b.key === "past" ? 1 : a.key.localeCompare(b.key)));
  return { months: ordered, undated };
}
