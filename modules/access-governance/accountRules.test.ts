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

describe("IDENTITY-P0-20: non-human accounts and agents' declared identifiers", () => {
  const base = { identifierField: "id", rule, identities, now, existing: [] as ExistingAccount[] };

  it("a service or shared account no person matches is listed for its own identity, with the source's owner", () => {
    const plan = planReconciliation({
      ...base,
      sourceAccounts: [
        { id: "svc-backup", name: "Backup job", accountType: "Service", owner: "ana@example.com" },
        { id: "ops-shared", accountType: "shared" },
        { id: "build-box", normalized: { accountType: "machine" } },
        { id: "nobody", email: "nobody@example.com" },
      ],
    });
    expect(plan.nonHumanAccounts).toEqual([
      { ref: "svc-backup", displayName: "Backup job", identityType: "SERVICE_ACCOUNT", ownerRef: "ana@example.com" },
      { ref: "ops-shared", displayName: "ops-shared", identityType: "SERVICE_ACCOUNT", ownerRef: null },
      { ref: "build-box", displayName: "build-box", identityType: "MACHINE", ownerRef: null },
    ]);
    expect(plan.upserts.map((u) => u.account_type)).toEqual(["service", "shared", "service", "standard"]);
    // An ordinary account nobody matches stays an orphan; nothing is invented for it.
    expect(plan.upserts[3]).toMatchObject({ correlation: "orphan", identity_id: null });
  });

  it("a service-typed account that matches a person stays the person's", () => {
    const plan = planReconciliation({ ...base, sourceAccounts: [{ id: "a1", email: "ana@example.com", accountType: "service" }] });
    expect(plan.nonHumanAccounts).toEqual([]);
    expect(plan.upserts[0]).toMatchObject({ identity_id: "p1", correlation: "correlated" });
  });

  it("an agent's account links to the agent by an identifier the agent declares", () => {
    const agentIdentifiers = new Map([["client-123", "agent-9"], ["spn-777", "agent-8"]]);
    const plan = planReconciliation({
      ...base,
      agentIdentifiers,
      sourceAccounts: [
        { id: "finbot", clientId: "client-123", accountType: "service" },
        { id: "spn-777" },
        { id: "other", clientId: "client-999" },
      ],
    });
    expect(plan.upserts[0]).toMatchObject({ agent_id: "agent-9", identity_id: null, correlation: "correlated" });
    expect(plan.upserts[1]).toMatchObject({ agent_id: "agent-8", correlation: "correlated" });
    expect(plan.upserts[2]).toMatchObject({ agent_id: null, correlation: "orphan" });
    // An agent's account never becomes a separate service-account identity.
    expect(plan.nonHumanAccounts).toEqual([]);
  });
});

describe("WID-H01: an account linked to a person stays with them", () => {
  const base = { identifierField: "id", rule, identities, now };
  it("keeps the link when the email now belongs to someone else, and holds the move for review", () => {
    const plan = planReconciliation({
      ...base,
      existing: [existing({ externalAccountRef: "A1", identityId: "p1", correlation: "correlated" })],
      sourceAccounts: [{ id: "A1", email: "bo@example.com" }],
    });
    expect(plan.upserts[0]).toMatchObject({ identity_id: "p1", correlation: "correlated" });
    expect(plan.counts.relinkHeld).toBe(1);
    expect(plan.relinkHeld).toEqual([{ ref: "A1", keptIdentityId: "p1", matchedIdentityId: "p2", matched: "correlated" }]);
  });
  it("keeps it too when the email now matches nobody or several people", () => {
    const plan = planReconciliation({
      ...base,
      existing: [existing({ externalAccountRef: "A1", identityId: "p1", correlation: "correlated" }), existing({ id: "y", externalAccountRef: "A2", identityId: "p2", correlation: "correlated" })],
      sourceAccounts: [{ id: "A1", email: "gone@example.com" }, { id: "A2", email: "twin@example.com" }],
    });
    expect(plan.upserts.map((u) => u.identity_id)).toEqual(["p1", "p2"]);
    expect(plan.relinkHeld.map((h) => h.matched)).toEqual(["orphan", "ambiguous"]);
  });
  it("still links an account that had no person, and holds nothing when the match is unchanged", () => {
    const plan = planReconciliation({
      ...base,
      existing: [existing({ externalAccountRef: "A1", identityId: null, correlation: "orphan" }), existing({ id: "y", externalAccountRef: "A2", identityId: "p2", correlation: "correlated" })],
      sourceAccounts: [{ id: "A1", email: "ana@example.com" }, { id: "A2", email: "bo@example.com" }],
    });
    expect(plan.upserts.map((u) => u.identity_id)).toEqual(["p1", "p2"]);
    expect(plan.relinkHeld).toEqual([]);
  });
  it("an account unlinked from a person goes back for matching, but never to that person by itself", () => {
    const plan = planReconciliation({
      ...base,
      existing: [
        existing({ externalAccountRef: "A1", identityId: null, correlation: "orphan", unlinkedIdentityId: "p1" }),
        existing({ id: "y", externalAccountRef: "A2", identityId: null, correlation: "orphan", unlinkedIdentityId: "p1" }),
      ],
      sourceAccounts: [{ id: "A1", email: "ana@example.com" }, { id: "A2", email: "bo@example.com" }],
    });
    expect(plan.upserts.map((u) => [u.identity_id, u.correlation])).toEqual([[null, "orphan"], ["p2", "correlated"]]);
  });
  it("a re-match requested by an unlink moves the account without the hold, and is cleared", () => {
    const plan = planReconciliation({
      ...base,
      existing: [existing({ externalAccountRef: "A1", identityId: "p1", correlation: "correlated", rematchRequested: true })],
      sourceAccounts: [{ id: "A1", email: "bo@example.com" }],
    });
    expect(plan.upserts[0]).toMatchObject({ identity_id: "p2", correlation: "correlated", rematch_requested_at: null });
    expect(plan.relinkHeld).toEqual([]);
  });
});
