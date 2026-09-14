// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mockGetAgentContract = vi.fn();
const mockGetEffectiveAccess = vi.fn();
const mockGetDid = vi.fn();

vi.mock("@/modules/agent-identity/service", () => ({
  getAgentContract: (...args: unknown[]) => mockGetAgentContract(...args),
}));
vi.mock("@/modules/access-governance/service", () => ({
  getEffectiveAccess: (...args: unknown[]) => mockGetEffectiveAccess(...args),
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
});
