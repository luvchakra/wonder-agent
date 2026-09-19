// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetAgent = vi.fn();
const mockGetAgentContract = vi.fn();
const mockGetOwnershipIssues = vi.fn();
const mockListAgentIdentities = vi.fn();
const mockListLifecycleEvents = vi.fn();
const mockTransitionAgentLifecycle = vi.fn();
const mockUpdateAgentRiskScore = vi.fn();
const mockListPolicyEvaluations = vi.fn();
const mockListApplications = vi.fn();
const mockGetEffectiveAccess = vi.fn();
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
  updateAgentRiskScore: (...a: unknown[]) => mockUpdateAgentRiskScore(...a),
}));
vi.mock("@/modules/access-governance/service", () => ({
  listPolicyEvaluations: (...a: unknown[]) => mockListPolicyEvaluations(...a),
  listApplications: (...a: unknown[]) => mockListApplications(...a),
  getEffectiveAccess: (...a: unknown[]) => mockGetEffectiveAccess(...a),
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
import { SHOULD_CAN_DID_CORPUS } from "@/tests/runtime/should-can-did-corpus";

describe("evaluateAgentRisk — the central FinanceBot/CustomerDB acceptance scenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateFinding.mockImplementation(async (_tenantId, agentId, category, fields) => ({
      finding: { id: `finding-${category}`, tenantId: "tenant-a", agentId, category, ...fields, status: "open" },
      created: true,
    }));
    mockListApplications.mockResolvedValue([]);
    mockGetEffectiveAccess.mockResolvedValue([]);
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

    // RISK-P0-02.1 — the deterministic agent-level score is persisted onto
    // agents.risk_score via Identity's published sink, once per evaluation
    // (not once per finding).
    expect(mockUpdateAgentRiskScore).toHaveBeenCalledTimes(1);
    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "financebot", 80);

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

    // Even with zero triggered categories, the agent's computed score
    // (0 here — staging, low criticality, no policy violation, no anomaly)
    // is still persisted, not left as "unknown".
    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a2", 0);
  });

  it("ACCESS-P0-02.2: triggers 'External communication capability' when CAN touches an application marked is_external", async () => {
    mockGetAgent.mockResolvedValue({ id: "a3", agentName: "MailBot", environment: "staging", criticality: "low", lifecycleState: "ACTIVE" });
    mockGetAgentContract.mockResolvedValue({ approvedApplications: ["SendGrid"], approvedData: [], prohibitedData: [], approvedActions: [], prohibitedActions: [] });
    mockCompareShouldCanDid.mockResolvedValue({
      can: [{ application: "SendGrid", entitlementName: "SEND_EMAIL", dataClassification: null, grantId: "grant-1" }],
      outcomes: [],
    });
    mockGetDid.mockResolvedValue({ tuples: [] });
    mockListRuntimeEvents.mockResolvedValue({ events: [] });
    mockGetOwnershipIssues.mockResolvedValue([]);
    mockListAgentIdentities.mockResolvedValue([]);
    mockListLifecycleEvents.mockResolvedValue([]);
    mockListPolicyEvaluations.mockResolvedValue([]);
    mockListApplications.mockResolvedValue([{ id: "app-1", name: "SendGrid", isExternal: true }, { id: "app-2", name: "Internal DB", isExternal: false }]);

    await evaluateAgentRisk("tenant-a", "a3");

    // No triggers fire (SendGrid is approved, no violation/anomaly), but the
    // factor itself must have contributed to the persisted score — confirms
    // it's real, not the old hard-coded `false`.
    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a3", 15);
  });

  it("ACCESS-P0-02.2: does not trigger when CAN only touches non-external applications", async () => {
    mockGetAgent.mockResolvedValue({ id: "a4", agentName: "DbBot", environment: "staging", criticality: "low", lifecycleState: "ACTIVE" });
    mockGetAgentContract.mockResolvedValue({ approvedApplications: ["Internal DB"], approvedData: [], prohibitedData: [], approvedActions: [], prohibitedActions: [] });
    mockCompareShouldCanDid.mockResolvedValue({
      can: [{ application: "Internal DB", entitlementName: "READ", dataClassification: null, grantId: "grant-1" }],
      outcomes: [],
    });
    mockGetDid.mockResolvedValue({ tuples: [] });
    mockListRuntimeEvents.mockResolvedValue({ events: [] });
    mockGetOwnershipIssues.mockResolvedValue([]);
    mockListAgentIdentities.mockResolvedValue([]);
    mockListLifecycleEvents.mockResolvedValue([]);
    mockListPolicyEvaluations.mockResolvedValue([]);
    mockListApplications.mockResolvedValue([{ id: "app-2", name: "Internal DB", isExternal: false }]);

    await evaluateAgentRisk("tenant-a", "a4");

    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a4", 0);
  });
});

describe("evaluateAgentRisk — QA-P0-08, the shared runtime event corpus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateFinding.mockImplementation(async (_tenantId, agentId, category, fields) => ({
      finding: { id: `finding-${category}`, tenantId: "tenant-a", agentId, category, ...fields, status: "open" },
      created: true,
    }));
    mockListApplications.mockResolvedValue([]);
    mockGetEffectiveAccess.mockResolvedValue([]);
    mockGetOwnershipIssues.mockResolvedValue([]);
    mockListAgentIdentities.mockResolvedValue([]);
    mockListLifecycleEvents.mockResolvedValue([]);
    mockListPolicyEvaluations.mockResolvedValue([]);
    mockListRuntimeEvents.mockResolvedValue({ events: [] });
    mockTransitionAgentLifecycle.mockResolvedValue({});
  });

  // Expected trigger categories per corpus case — derived independently
  // from rules.ts's own logic (not copied from compare.ts's outcome
  // types): excessive_access/behavioral_violation come straight off
  // comparison.outcomes, but unauthorized_resource and
  // sensitive_data_violation are each rules.ts's OWN check, computed
  // directly from did.tuples/comparison.can rather than reusing
  // compare.ts's unexpected_capability/behavioral_violation outcomes —
  // see the corpus module's per-case doc comments for the full trace.
  const EXPECTED_CATEGORIES: Record<string, string[]> = {
    allowed: [],
    // unused_capability is a real comparison outcome, but no rule in this
    // file reads it — a documented, current gap (see the corpus case),
    // not a bug in this test.
    can_only_unused: [],
    // behavioral_deviation is suppressed here because unauthorized_resource
    // already captures the same Workday divergence (rules.ts's own
    // de-duplication — see "alreadyCapturedApps").
    did_only_unexpected: ["excessive_access", "unauthorized_resource"],
    unauthorized_resource: ["unauthorized_resource"],
    sensitive_data: ["excessive_access", "sensitive_data_violation", "behavioral_deviation"],
    unmappable: [],
  };

  it.each(SHOULD_CAN_DID_CORPUS)("$category ($id): triggers exactly the expected finding categories", async (c) => {
    mockGetAgent.mockResolvedValue({
      id: c.id,
      agentName: `Agent-${c.id}`,
      environment: "production",
      criticality: "low",
      lifecycleState: "ACTIVE",
    });
    mockGetAgentContract.mockResolvedValue(c.contract);
    mockCompareShouldCanDid.mockResolvedValue({
      can: c.effectiveAccess.map((g) => ({
        application: g.application,
        dataClassification: g.dataClassification,
        entitlementName: g.entitlementName,
        grantId: g.id,
      })),
      outcomes: c.expectedOutcomes,
    });
    mockGetDid.mockResolvedValue({ tuples: c.didTuples });

    const results = await evaluateAgentRisk("tenant-a", c.id);
    const categories = results.map((r: { category: string }) => r.category).sort();
    expect(categories).toEqual([...EXPECTED_CATEGORIES[c.category]].sort());
  });
});

describe("evaluateAgentRisk — RISK-P1-05, additional deterministic risk factors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateFinding.mockImplementation(async (_tenantId, agentId, category, fields) => ({
      finding: { id: `finding-${category}`, tenantId: "tenant-a", agentId, category, ...fields, status: "open" },
      created: true,
    }));
    mockListApplications.mockResolvedValue([]);
    mockGetAgent.mockResolvedValue({ id: "a5", agentName: "PrivBot", environment: "staging", criticality: "low", lifecycleState: "ACTIVE" });
    mockGetAgentContract.mockResolvedValue({ approvedApplications: [], approvedData: [], prohibitedData: [], approvedActions: [], prohibitedActions: [] });
    // No trigger from compareShouldCanDid/DID/policy/ownership — isolates
    // the new "Privilege level" factor's own contribution to the score.
    mockCompareShouldCanDid.mockResolvedValue({ can: [], outcomes: [] });
    mockGetDid.mockResolvedValue({ tuples: [] });
    mockListRuntimeEvents.mockResolvedValue({ events: [] });
    mockGetOwnershipIssues.mockResolvedValue([]);
    mockListAgentIdentities.mockResolvedValue([]);
    mockListLifecycleEvents.mockResolvedValue([]);
    mockListPolicyEvaluations.mockResolvedValue([]);
  });

  it("triggers 'Privilege level' when effective access includes an admin-privilege entitlement", async () => {
    mockGetEffectiveAccess.mockResolvedValue([{ id: "grant-1", application: "SAP", privilegeLevel: "admin" }]);

    await evaluateAgentRisk("tenant-a", "a5");

    expect(mockGetEffectiveAccess).toHaveBeenCalledWith("tenant-a", "a5");
    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a5", 15);
  });

  it("triggers 'Privilege level' for an elevated-privilege entitlement too, not just admin", async () => {
    mockGetEffectiveAccess.mockResolvedValue([{ id: "grant-1", application: "SAP", privilegeLevel: "elevated" }]);

    await evaluateAgentRisk("tenant-a", "a5");

    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a5", 15);
  });

  it("does not trigger 'Privilege level' when every entitlement is standard", async () => {
    mockGetEffectiveAccess.mockResolvedValue([{ id: "grant-1", application: "SAP", privilegeLevel: "standard" }]);

    await evaluateAgentRisk("tenant-a", "a5");

    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a5", 0);
  });

  it("does not trigger 'Privilege level' with no effective access at all", async () => {
    mockGetEffectiveAccess.mockResolvedValue([]);

    await evaluateAgentRisk("tenant-a", "a5");

    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a5", 0);
  });

  it("the other three RISK-P1-05 factors never trigger yet — no published data source (documented, not a silent gap)", async () => {
    // An admin-privilege grant alone should contribute exactly 15
    // (its own weight) and nothing more — if "Destructive capability
    // present" (20), "Credential status unhealthy" (15), or "Position on
    // a high-value attack path" (15) ever silently started triggering,
    // this score would jump well past 15 and this test would catch it.
    mockGetEffectiveAccess.mockResolvedValue([{ id: "grant-1", application: "SAP", privilegeLevel: "admin" }]);

    await evaluateAgentRisk("tenant-a", "a5");

    expect(mockUpdateAgentRiskScore).toHaveBeenCalledWith("tenant-a", "a5", 15);
  });
});
