// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetAgent = vi.fn();
const mockGetAgentContract = vi.fn();
const mockGetOwnershipIssues = vi.fn();
const mockListAgentIdentities = vi.fn();
const mockListLifecycleEvents = vi.fn();
const mockTransitionAgentLifecycle = vi.fn();
const mockListPolicyEvaluations = vi.fn();
const mockCompareShouldCanDid = vi.fn();
const mockGetDid = vi.fn();
const mockListRuntimeEvents = vi.fn();
const mockCreateOrUpdateFinding = vi.fn();

vi.mock("@/modules/agent-identity/service", () => ({
  getAgent: (...a: unknown[]) => mockGetAgent(...a),
  getAgentContract: (...a: unknown[]) => mockGetAgentContract(...a),
  getOwnershipIssues: (...a: unknown[]) => mockGetOwnershipIssues(...a),
  listAgentIdentities: (...a: unknown[]) => mockListAgentIdentities(...a),
  listLifecycleEvents: (...a: unknown[]) => mockListLifecycleEvents(...a),
  transitionAgentLifecycle: (...a: unknown[]) => mockTransitionAgentLifecycle(...a),
}));
vi.mock("@/modules/access-governance/service", () => ({
  listPolicyEvaluations: (...a: unknown[]) => mockListPolicyEvaluations(...a),
}));
vi.mock("@/modules/runtime-assurance/service", () => ({
  compareShouldCanDid: (...a: unknown[]) => mockCompareShouldCanDid(...a),
  getDid: (...a: unknown[]) => mockGetDid(...a),
  listRuntimeEvents: (...a: unknown[]) => mockListRuntimeEvents(...a),
}));
vi.mock("./findings", () => ({
  createOrUpdateFinding: (...a: unknown[]) => mockCreateOrUpdateFinding(...a),
}));
vi.mock("./config", () => ({
  getSeverityWeights: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));

import { evaluateAgentRisk } from "./rules";

describe("evaluateAgentRisk — the central FinanceBot/CustomerDB acceptance scenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateFinding.mockImplementation(async (_tenantId, agentId, category, fields) => ({
      finding: { id: `finding-${category}`, tenantId: "tenant-a", agentId, category, ...fields, status: "open" },
      created: true,
    }));
  });

  it("generates a CRITICAL sensitive_data_violation finding, excessive_access, and behavioral_deviation with evidence, and auto-restricts the agent", async () => {
    mockGetAgent.mockResolvedValue({
      id: "financebot",
      agentName: "FinanceBot",
      environment: "production",
      criticality: "high",
      lifecycleState: "ACTIVE",
    });
    mockGetAgentContract.mockResolvedValue({
      approvedApplications: ["SAP", "Snowflake"],
      approvedData: ["financial reporting"],
      prohibitedData: ["PII"],
      approvedActions: ["read", "report"],
      prohibitedActions: [],
    });
    mockCompareShouldCanDid.mockResolvedValue({
      can: [
        { application: "Snowflake", entitlementName: "Financial_Reporting_READ", dataClassification: "financial", grantId: "grant-1" },
        { application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii", grantId: "grant-2" },
      ],
      outcomes: [
        { type: "excessive_access", evidence: { grantId: "grant-2", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" } },
        { type: "behavioral_violation", evidence: { eventId: "event-1", application: "Snowflake", resource: "CustomerDB", dataClassification: "PII" } },
      ],
    });
    mockGetDid.mockResolvedValue({
      tuples: [
        {
          application: "Snowflake",
          resource: "CustomerDB",
          action: "read",
          dataClassification: "PII",
          firstSeenAt: "t",
          lastSeenAt: "2026-09-12T10:31:00Z",
          eventCount: 1,
          sampleEventId: "event-1",
        },
      ],
    });
    mockListRuntimeEvents.mockResolvedValue({ events: [] });
    mockGetOwnershipIssues.mockResolvedValue([]);
    mockListAgentIdentities.mockResolvedValue([]);
    mockListLifecycleEvents.mockResolvedValue([]);
    mockListPolicyEvaluations.mockResolvedValue([{ result: "violation" }]);
    mockTransitionAgentLifecycle.mockResolvedValue({});

    const results = await evaluateAgentRisk("tenant-a", "financebot");

    const categories = results.map((r: { category: string }) => r.category);
    // Snowflake IS approved, so unauthorized_resource does not fire; the
    // divergence is captured as excessive_access (CAN) + sensitive_data_violation
    // (prohibited PII) + behavioral_deviation (SHOULD != DID, not already
    // captured as unauthorized_resource since Snowflake is approved).
    expect(categories).toEqual(expect.arrayContaining(["excessive_access", "sensitive_data_violation", "behavioral_deviation"]));

    const sensitiveCall = mockCreateOrUpdateFinding.mock.calls.find((c) => c[2] === "sensitive_data_violation");
    expect(sensitiveCall).toBeDefined();
    expect(sensitiveCall![3].severity).toBe("critical");
    expect(sensitiveCall![4].length).toBeGreaterThan(0);

    // Production (20) + sensitive data (25) + policy violation (15) +
    // runtime/behavioral anomaly (10) + criticality high (10) = 80 ->
    // already "critical" at the base band for every finding from this
    // evaluation pass (the prohibited-data override on the
    // sensitive_data_violation finding above is then a no-op, which is
    // correct — it's still exercised and asserted for its own sake).
    const excessiveCall = mockCreateOrUpdateFinding.mock.calls.find((c) => c[2] === "excessive_access");
    expect(excessiveCall![3].severity).toBe("critical");
    expect(excessiveCall![3].riskScore).toBe(80);

    // A CRITICAL finding on an ACTIVE agent triggers auto-restriction.
    expect(mockTransitionAgentLifecycle).toHaveBeenCalledWith(
      "tenant-a",
      "financebot",
      "RESTRICTED",
      expect.any(String),
      expect.objectContaining({ actorType: "system" }),
    );
  });

  it("does not restrict the agent when no finding reaches critical", async () => {
    mockGetAgent.mockResolvedValue({ id: "a2", agentName: "OtherBot", environment: "staging", criticality: "low", lifecycleState: "ACTIVE" });
    mockGetAgentContract.mockResolvedValue({ approvedApplications: ["SAP"], approvedData: [], prohibitedData: [], approvedActions: [], prohibitedActions: [] });
    mockCompareShouldCanDid.mockResolvedValue({ can: [], outcomes: [] });
    mockGetDid.mockResolvedValue({ tuples: [] });
    mockListRuntimeEvents.mockResolvedValue({ events: [] });
    mockGetOwnershipIssues.mockResolvedValue([]);
    mockListAgentIdentities.mockResolvedValue([]);
    mockListLifecycleEvents.mockResolvedValue([]);
    mockListPolicyEvaluations.mockResolvedValue([]);

    const results = await evaluateAgentRisk("tenant-a", "a2");
    expect(results).toEqual([]);
    expect(mockTransitionAgentLifecycle).not.toHaveBeenCalled();
  });
});
