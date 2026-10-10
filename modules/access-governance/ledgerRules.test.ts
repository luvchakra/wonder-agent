import { describe, expect, it } from "vitest";
import { ledgerEntry, ledgerEvents, type LedgerEvidence, type LedgerRelationship } from "./ledgerRules";

const NOW = new Date("2026-10-10T12:00:00Z");
const APP = "app-1";
const OTHER_APP = "app-2";
const ENT = "ent-1";
const PERSON = "identity-ada";

const rel = (over: Partial<LedgerRelationship> = {}): LedgerRelationship => ({
  accountId: "acc-1",
  entitlementId: ENT,
  applicationId: APP,
  identityId: PERSON,
  agentId: null,
  accessGrantId: "grant-1",
  sourceIntegrationId: "int-csv",
  reconciled: false,
  firstSeenAt: "2026-10-01T00:00:00Z",
  revokedAt: null,
  lastSeenAt: "2026-10-09T00:00:00Z",
  lastUsedAt: null,
  missingFromSourceAt: null,
  ...over,
});

const none = (): LedgerEvidence => ({ requests: [], packages: [], adminGrants: new Map() });

const request = (over: Partial<LedgerEvidence["requests"][number]> = {}): LedgerEvidence["requests"][number] => ({
  id: "req-1",
  subjectIdentityId: PERSON,
  agentId: null,
  applicationId: APP,
  entitlementId: ENT,
  decidedBy: "user-approver",
  decidedAt: "2026-09-01T00:00:00Z",
  justification: "Quarter-end reporting",
  requestedExpiry: null,
  ...over,
});

const pkg = (over: Partial<LedgerEvidence["packages"][number]> = {}): LedgerEvidence["packages"][number] => ({
  assignmentId: "asg-1",
  identityId: PERSON,
  applicationId: APP,
  entitlementId: ENT,
  assignmentStatus: "active",
  requestId: null,
  assignedBy: "user-admin",
  startsAt: "2026-08-01T00:00:00Z",
  expiresAt: null,
  justification: null,
  ...over,
});

describe("ledgerEntry", () => {
  it("imported access without a WonderID approval is UNPROVEN from IMPORT, never ROGUE", () => {
    const e = ledgerEntry(rel(), none(), NOW);
    expect(e).toMatchObject({ source: "IMPORT", status: "UNPROVEN", approvedBy: null, evidence: { kind: "none", id: null } });
  });

  it("access with no source and no evidence is UNKNOWN and UNPROVEN", () => {
    const e = ledgerEntry(rel({ sourceIntegrationId: null }), none(), NOW);
    expect(e).toMatchObject({ source: "UNKNOWN", status: "UNPROVEN" });
  });

  it("a reconciled account without evidence is IMPORT", () => {
    expect(ledgerEntry(rel({ entitlementId: null, accessGrantId: null, sourceIntegrationId: null, reconciled: true }), none(), NOW).source).toBe("IMPORT");
  });

  it("an approved request for the same person and entitlement makes it VALID, with its lineage", () => {
    const e = ledgerEntry(rel(), { ...none(), requests: [request()] }, NOW);
    expect(e).toMatchObject({
      source: "WONDERID_REQUEST",
      status: "VALID",
      requestId: "req-1",
      approvedBy: "user-approver",
      approvedAt: "2026-09-01T00:00:00Z",
      businessJustification: "Quarter-end reporting",
      evidence: { kind: "request", id: "req-1" },
    });
  });

  it("a request for someone else, another entitlement or another application is not evidence", () => {
    const ev = { ...none(), requests: [request({ subjectIdentityId: "identity-bob" }), request({ id: "r2", entitlementId: "ent-2" }), request({ id: "r3", applicationId: OTHER_APP })] };
    expect(ledgerEntry(rel(), ev, NOW).status).toBe("UNPROVEN");
  });

  it("a request for an entitlement also explains the account it needs", () => {
    const e = ledgerEntry(rel({ entitlementId: null, accessGrantId: null }), { ...none(), requests: [request()] }, NOW);
    expect(e).toMatchObject({ source: "WONDERID_REQUEST", status: "VALID" });
  });

  it("a request whose expiry passed is EXPIRED", () => {
    const e = ledgerEntry(rel(), { ...none(), requests: [request({ requestedExpiry: "2026-10-01T00:00:00Z" })] }, NOW);
    expect(e).toMatchObject({ source: "WONDERID_REQUEST", status: "EXPIRED", expiryAt: "2026-10-01T00:00:00Z" });
  });

  it("an agent's request matches the agent's account", () => {
    const e = ledgerEntry(rel({ identityId: "identity-bot", agentId: "agent-1" }), { ...none(), requests: [request({ subjectIdentityId: null, agentId: "agent-1" })] }, NOW);
    expect(e.status).toBe("VALID");
  });

  it("an access package explains the access; its revocation or expiry shows", () => {
    expect(ledgerEntry(rel(), { ...none(), packages: [pkg()] }, NOW)).toMatchObject({ source: "WONDERID_ACCESS_PACKAGE", status: "VALID", accessPackageAssignmentId: "asg-1" });
    expect(ledgerEntry(rel(), { ...none(), packages: [pkg({ assignmentStatus: "revoked" })] }, NOW).status).toBe("REVOKED");
    expect(ledgerEntry(rel(), { ...none(), packages: [pkg({ assignmentStatus: "expired" })] }, NOW).status).toBe("EXPIRED");
    expect(ledgerEntry(rel(), { ...none(), packages: [pkg({ expiresAt: "2026-10-09T00:00:00Z" })] }, NOW).status).toBe("EXPIRED");
  });

  it("an application-wide package item covers an entitlement-free account only", () => {
    const appWide = pkg({ entitlementId: null });
    expect(ledgerEntry(rel({ entitlementId: null, accessGrantId: null }), { ...none(), packages: [appWide] }, NOW).status).toBe("VALID");
    expect(ledgerEntry(rel(), { ...none(), packages: [appWide] }, NOW).status).toBe("UNPROVEN");
  });

  it("current evidence wins over ended evidence", () => {
    const ev = { ...none(), requests: [request({ requestedExpiry: "2026-10-01T00:00:00Z" })], packages: [pkg()] };
    expect(ledgerEntry(rel(), ev, NOW)).toMatchObject({ source: "WONDERID_ACCESS_PACKAGE", status: "VALID" });
  });

  it("an administrator's grant is evidence for access WonderID granted, not for access a connection reported", () => {
    const adminGrants = new Map([["grant-1", { grantId: "grant-1", actorId: "user-admin", at: "2026-09-05T00:00:00Z" }]]);
    expect(ledgerEntry(rel({ sourceIntegrationId: null }), { ...none(), adminGrants }, NOW)).toMatchObject({ source: "ADMIN_ASSIGNMENT", status: "VALID", approvedBy: "user-admin" });
    expect(ledgerEntry(rel(), { ...none(), adminGrants }, NOW)).toMatchObject({ source: "IMPORT", status: "UNPROVEN" });
  });

  it("revoked access is REVOKED whatever approved it, and keeps its provenance", () => {
    const e = ledgerEntry(rel({ revokedAt: "2026-10-05T00:00:00Z" }), { ...none(), requests: [request()] }, NOW);
    expect(e).toMatchObject({ source: "WONDERID_REQUEST", status: "REVOKED", requestId: "req-1" });
  });

  it("an orphan account (no identity) is never matched to a person's evidence", () => {
    expect(ledgerEntry(rel({ identityId: null }), { ...none(), requests: [request()], packages: [pkg()] }, NOW).status).toBe("UNPROVEN");
  });

  it("carries the source's verification and use dates", () => {
    const e = ledgerEntry(rel({ lastUsedAt: "2026-10-08T00:00:00Z", missingFromSourceAt: "2026-10-09T00:00:00Z" }), none(), NOW);
    expect(e).toMatchObject({ lastVerifiedAt: "2026-10-09T00:00:00Z", lastUsedAt: "2026-10-08T00:00:00Z", missingFromSourceAt: "2026-10-09T00:00:00Z" });
  });
});

describe("ledgerEvents", () => {
  const after = (over: Partial<ReturnType<typeof ledgerEntry>> = {}) => ({ ...ledgerEntry(rel(), none(), NOW), ...over });

  it("records a new relationship once", () => {
    expect(ledgerEvents(null, after())).toEqual([{ eventType: "recorded", fromStatus: null, fromSource: null }]);
  });

  it("appends a change of status or source", () => {
    expect(ledgerEvents({ status: "UNPROVEN", source: "IMPORT", missingFromSourceAt: null }, after({ status: "VALID", source: "WONDERID_REQUEST" }))).toEqual([
      { eventType: "changed", fromStatus: "UNPROVEN", fromSource: "IMPORT" },
    ]);
  });

  it("records the access going missing from its source, and coming back", () => {
    const before = { status: "UNPROVEN" as const, source: "IMPORT" as const, missingFromSourceAt: null };
    expect(ledgerEvents(before, after({ missingFromSourceAt: "2026-10-09T00:00:00Z" })).map((e) => e.eventType)).toEqual(["missing_from_source"]);
    expect(ledgerEvents({ ...before, missingFromSourceAt: "2026-10-09T00:00:00Z" }, after()).map((e) => e.eventType)).toEqual(["seen_again"]);
  });

  it("adds nothing when only dates moved", () => {
    expect(ledgerEvents({ status: "UNPROVEN", source: "IMPORT", missingFromSourceAt: null }, after({ lastUsedAt: "2026-10-10T00:00:00Z" }))).toEqual([]);
  });
});
