import { describe, expect, it } from "vitest";
import { dormantCutoff, isDormant, parseDormantDays, planReconciliation, type ExistingAccount } from "./accountRules";

const now = new Date("2026-09-26T12:00:00Z");
const identities = [
  { id: "p1", email: "ana@example.com", username: "ana", displayName: "Ana" },
  { id: "p2", email: "bo@example.com", username: "bo", displayName: "Bo" },
  { id: "p3", email: "twin@example.com", username: "t1", displayName: "Twin" },
  { id: "p4", email: "TWIN@example.com", username: "t2", displayName: "Twin 2" },
];
const rule = { accountField: "email", identityField: "email" as const };
const existing = (over: Partial<ExistingAccount>): ExistingAccount => ({
  id: "x",
  externalAccountRef: "r",
  agentId: null,
  identityId: null,
  correlation: "orphan",
  accountType: "standard",
  status: "active",
  source: "reconciliation",
  lastUsedAt: null,
  ...over,
});

describe("dormant accounts", () => {
  it("uses a known window or the 90-day default", () => {
    expect(parseDormantDays("30")).toBe(30);
    expect(parseDormantDays("45")).toBe(90);
    expect(parseDormantDays(undefined)).toBe(90);
  });
  it("counts an unused account as dormant only once it is older than the window", () => {
    expect(isDormant({ lastUsedAt: null, createdAt: "2026-09-20T00:00:00Z" }, now, 30)).toBe(false);
    expect(isDormant({ lastUsedAt: null, createdAt: "2026-01-01T00:00:00Z" }, now, 30)).toBe(true);
    expect(isDormant({ lastUsedAt: "2026-09-01T00:00:00Z", createdAt: "2025-01-01T00:00:00Z" }, now, 30)).toBe(false);
    expect(isDormant({ lastUsedAt: "2026-06-01T00:00:00Z", createdAt: "2025-01-01T00:00:00Z" }, now, 90)).toBe(true);
    expect(dormantCutoff(now, 30)).toBe("2026-08-27T12:00:00.000Z");
  });
});

describe("planReconciliation", () => {
  it("correlates, flags orphans and ambiguity, and skips accounts without the identifier", () => {
    const plan = planReconciliation({
      identifierField: "id",
      rule,
      identities,
      existing: [],
      now,
      sourceAccounts: [
        { id: "A1", email: "ANA@example.com", lastLogin: "2026-09-01T00:00:00Z" },
        { id: "A2", email: "nobody@example.com" },
        { id: "A3", email: "twin@example.com" },
        { email: "bo@example.com" },
        { id: "A1", email: "ana@example.com" },
      ],
    });
    expect(plan.counts).toMatchObject({ sourceAccounts: 5, created: 3, updated: 0, correlated: 1, orphan: 1, ambiguous: 1, missingIdentifier: 1 });
    expect(plan.upserts.map((u) => [u.external_account_ref, u.correlation, u.identity_id])).toEqual([
      ["A1", "correlated", "p1"],
      ["A2", "orphan", null],
      ["A3", "ambiguous", null],
    ]);
    expect(plan.upserts[0]).toMatchObject({ last_used_at: "2026-09-01T00:00:00.000Z", source: "reconciliation", last_seen_at: now.toISOString() });
  });

  it("keeps a manual link and an agent's ownership, and never moves last use backwards", () => {
    const plan = planReconciliation({
      identifierField: "id",
      rule,
      identities,
      now,
      existing: [
        existing({ externalAccountRef: "M1", identityId: "p2", correlation: "manual", source: "manual", lastUsedAt: "2026-09-10T00:00:00.000Z" }),
        existing({ externalAccountRef: "AG1", agentId: "agent-1", identityId: "agent-identity", correlation: "correlated", accountType: "service" }),
      ],
      sourceAccounts: [
        { id: "M1", email: "ana@example.com", lastLogin: "2026-08-01T00:00:00Z" },
        { id: "AG1", email: "bo@example.com", privileged: true },
      ],
    });
    expect(plan.counts).toMatchObject({ created: 0, updated: 2, correlated: 2 });
    expect(plan.upserts[0]).toMatchObject({ identity_id: "p2", correlation: "manual", source: "manual", last_used_at: "2026-09-10T00:00:00.000Z" });
    expect(plan.upserts[1]).toMatchObject({ agent_id: "agent-1", identity_id: "agent-identity", account_type: "service" });
  });

  it("re-correlates what it imported, reads disabled and privileged, and counts (never removes) accounts gone from the source", () => {
    const plan = planReconciliation({
      identifierField: "id",
      rule,
      identities,
      now,
      existing: [existing({ externalAccountRef: "O1" }), existing({ id: "gone", externalAccountRef: "GONE" }), existing({ externalAccountRef: "HAND", source: "manual" })],
      sourceAccounts: [{ id: "O1", email: "bo@example.com", status: "Disabled", admin: true }],
    });
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({ identity_id: "p2", correlation: "correlated", status: "disabled", account_type: "privileged" });
    // Only accounts reconciliation created count as missing from the source.
    expect(plan.counts.notInSource).toBe(1);
    expect(plan.missingIds).toEqual(["gone"]);
  });

  it("with no correlation rule every account is an orphan", () => {
    const plan = planReconciliation({ identifierField: "id", rule: null, identities, existing: [], now, sourceAccounts: [{ id: "Z", email: "ana@example.com" }] });
    expect(plan.upserts[0]).toMatchObject({ correlation: "orphan", identity_id: null });
  });
});
