// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mockGetAgentContract = vi.fn();
const mockGetEffectiveAccess = vi.fn();
const mockGetEffectiveAccessAsOf = vi.fn();
const mockGetDid = vi.fn();

vi.mock("@/modules/agent-identity/service", () => ({
  getAgentContract: (...args: unknown[]) => mockGetAgentContract(...args),
}));
vi.mock("@/modules/access-governance/service", () => ({
  getEffectiveAccess: (...args: unknown[]) => mockGetEffectiveAccess(...args),
  getEffectiveAccessAsOf: (...args: unknown[]) => mockGetEffectiveAccessAsOf(...args),
}));
vi.mock("./did", () => ({
  getDid: (...args: unknown[]) => mockGetDid(...args),
}));

import { compareShouldCanDid } from "./compare";

describe("compareShouldCanDid — RUNTIME-P0-02.2, the central acceptance scenario", () => {
  it("reproduces the PRD's exact FinanceBot/CustomerDB scenario", async () => {
    mockGetAgentContract.mockResolvedValue({
      approvedApplications: ["SAP", "Snowflake"],
      approvedData: ["financial reporting"],
    });
    mockGetEffectiveAccess.mockResolvedValue([
      { id: "grant-1", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" },
      { id: "grant-2", application: "Snowflake", entitlementName: "Financial_Reporting_READ", dataClassification: "financial" },
      { id: "grant-3", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
    ]);
    mockGetDid.mockResolvedValue({
      agentId: "financebot",
      windowStart: "2026-06-14T00:00:00Z",
      windowEnd: "2026-09-14T00:00:00Z",
      tuples: [
        {
          application: "Snowflake",
          resource: "CustomerDB",
          action: "read",
          dataClassification: "PII",
          firstSeenAt: "2026-09-12T10:31:00Z",
          lastSeenAt: "2026-09-12T10:31:00Z",
          eventCount: 1,
          sampleEventId: "event-1",
        },
      ],
    });

    const result = await compareShouldCanDid("tenant-a", "financebot");

    const excessive = result.outcomes.filter((o) => o.type === "excessive_access");
    expect(excessive).toHaveLength(1);
    expect(excessive[0].evidence).toMatchObject({ grantId: "grant-3" });

    const behavioral = result.outcomes.filter((o) => o.type === "behavioral_violation");
    expect(behavioral).toHaveLength(1);
    expect(behavioral[0].evidence).toMatchObject({ eventId: "event-1" });

    // SAP and the approved Snowflake entitlement are both covered and
    // exercised... except CAN vs DID: SAP/Financial_Reporting_READ were
    // never observed in DID, so unused_capability fires for those two.
    const unused = result.outcomes.filter((o) => o.type === "unused_capability");
    expect(unused.map((o) => o.evidence.grantId).sort()).toEqual(["grant-1", "grant-2"]);

    // No insufficient_access: both approved applications have covering grants.
    expect(result.outcomes.some((o) => o.type === "insufficient_access")).toBe(false);
    // No unexpected_capability: the CustomerDB event is backed by grant-3.
    expect(result.outcomes.some((o) => o.type === "unexpected_capability")).toBe(false);
    // Not healthy, since real divergence exists.
    expect(result.outcomes.some((o) => o.type === "healthy")).toBe(false);
  });

  it("reports healthy when SHOULD, CAN and DID fully align", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "Financial reporting automation",
      approvedApplications: ["Snowflake"],
      approvedData: ["financial reporting"],
    });
    mockGetEffectiveAccess.mockResolvedValue([
      { id: "grant-1", application: "Snowflake", entitlementName: "Financial_Reporting_READ", dataClassification: "financial" },
    ]);
    mockGetDid.mockResolvedValue({
      agentId: "agent-2",
      windowStart: "x",
      windowEnd: "y",
      tuples: [
        {
          application: "Snowflake",
          resource: "FinancialReports",
          action: "read",
          dataClassification: "financial",
          firstSeenAt: "t",
          lastSeenAt: "t",
          eventCount: 1,
          sampleEventId: "event-2",
        },
      ],
    });

    const result = await compareShouldCanDid("tenant-a", "agent-2");
    expect(result.outcomes).toEqual([{ type: "healthy", evidence: {} }]);
  });

  it("is reproducible: calling twice with the same stored data yields identical outcomes", async () => {
    mockGetAgentContract.mockResolvedValue({ approvedApplications: ["SAP"], approvedData: ["financial reporting"] });
    mockGetEffectiveAccess.mockResolvedValue([{ id: "g1", application: "SAP", dataClassification: "financial" }]);
    mockGetDid.mockResolvedValue({ agentId: "a", windowStart: "x", windowEnd: "y", tuples: [] });

    const first = await compareShouldCanDid("tenant-a", "agent-3");
    const second = await compareShouldCanDid("tenant-a", "agent-3");
    expect(first.outcomes).toEqual(second.outcomes);
    expect(first.should).toEqual(second.should);
    expect(first.can).toEqual(second.can);
    expect(first.did).toEqual(second.did);
  });

  it("RUNTIME-P0-12: flags shouldUnknown when the contract has no purpose set, and never reports healthy in that state", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
    });
    mockGetEffectiveAccess.mockResolvedValue([
      { id: "g1", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" },
    ]);
    mockGetDid.mockResolvedValue({ agentId: "agent-4", windowStart: "x", windowEnd: "y", tuples: [] });

    const result = await compareShouldCanDid("tenant-a", "agent-4");
    expect(result.shouldUnknown).toBe(true);
    expect(result.outcomes.some((o) => o.type === "healthy")).toBe(false);
  });

  it("RUNTIME-P0-12: shouldUnknown is false and healthy is reachable when the contract has a real purpose", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "Financial reporting automation",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
    });
    mockGetEffectiveAccess.mockResolvedValue([
      { id: "g1", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" },
    ]);
    mockGetDid.mockResolvedValue({
      agentId: "agent-5",
      windowStart: "x",
      windowEnd: "y",
      tuples: [
        {
          application: "SAP",
          resource: "GL",
          action: "read",
          dataClassification: "financial",
          firstSeenAt: "t",
          lastSeenAt: "t",
          eventCount: 1,
          sampleEventId: "event-5",
        },
      ],
    });

    const result = await compareShouldCanDid("tenant-a", "agent-5");
    expect(result.shouldUnknown).toBe(false);
    expect(result.outcomes).toEqual([{ type: "healthy", evidence: {} }]);
  });

  it("RUNTIME-P0-14: a DID tuple with no resolvable application is reported as unscored_unknown, never as a violation", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "Financial reporting automation",
      approvedApplications: [],
      approvedData: [],
    });
    mockGetEffectiveAccess.mockResolvedValue([]);
    mockGetDid.mockResolvedValue({
      agentId: "agent-6",
      windowStart: "x",
      windowEnd: "y",
      tuples: [
        {
          application: null,
          resource: null,
          action: "read",
          dataClassification: null,
          firstSeenAt: "t",
          lastSeenAt: "t",
          eventCount: 1,
          sampleEventId: "event-6",
        },
      ],
    });

    const result = await compareShouldCanDid("tenant-a", "agent-6");
    expect(result.outcomes).toEqual([
      { type: "unscored_unknown", evidence: { eventId: "event-6", resource: null, dataClassification: null, reason: "unresolved_application" } },
    ]);
    expect(result.outcomes.some((o) => o.type === "behavioral_violation")).toBe(false);
    expect(result.outcomes.some((o) => o.type === "unexpected_capability")).toBe(false);
  });

  it("RUNTIME-P0-13: omitting asOf uses current effective access, never the point-in-time variant", async () => {
    mockGetAgentContract.mockResolvedValue({ purpose: "x", approvedApplications: [], approvedData: [] });
    mockGetEffectiveAccess.mockResolvedValue([]);
    mockGetDid.mockResolvedValue({ agentId: "agent-7", windowStart: "x", windowEnd: "y", tuples: [] });

    await compareShouldCanDid("tenant-a", "agent-7");

    expect(mockGetEffectiveAccess).toHaveBeenCalledWith("tenant-a", "agent-7");
    expect(mockGetEffectiveAccessAsOf).not.toHaveBeenCalled();
  });

  it("RUNTIME-P0-13: passing asOf resolves CAN as of that timestamp — an entitlement already revoked today still produces the historical excessive_access finding", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "Financial reporting automation",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
    });
    // The grant that was in force AT THE EVENT TIME (90 days ago) — Snowflake
    // CustomerDB was still active then, even though it has since been revoked
    // and getEffectiveAccess() (current state) would no longer return it.
    mockGetEffectiveAccessAsOf.mockResolvedValue([
      { id: "grant-historical", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
    ]);
    mockGetDid.mockResolvedValue({ agentId: "agent-8", windowStart: "x", windowEnd: "y", tuples: [] });

    const asOf = "2026-06-14T00:00:00Z";
    const result = await compareShouldCanDid("tenant-a", "agent-8", asOf);

    expect(mockGetEffectiveAccessAsOf).toHaveBeenCalledWith("tenant-a", "agent-8", asOf);
    expect(mockGetEffectiveAccess).not.toHaveBeenCalled();
    expect(result.outcomes).toContainEqual({
      type: "excessive_access",
      evidence: { grantId: "grant-historical", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
    });
  });
});
