// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetAgent = vi.fn();
const mockGetAgentContract = vi.fn();
const mockListAgentIdentities = vi.fn();
const mockGetOwnershipIssues = vi.fn();

const mockCompareAccessToContract = vi.fn();
const mockClassifyActionsForAgent = vi.fn();
const mockListPolicyEvaluations = vi.fn();
const mockListGovernanceExceptions = vi.fn();

const mockGetDid = vi.fn();

const mockGetCertificationHistory = vi.fn();
const mockListControlFrameworks = vi.fn();
const mockListControls = vi.fn();
const mockListControlMappings = vi.fn();

vi.mock("@/modules/agent-identity/service", () => ({
  getAgent: (...a: unknown[]) => mockGetAgent(...a),
  getAgentContract: (...a: unknown[]) => mockGetAgentContract(...a),
  listAgentIdentities: (...a: unknown[]) => mockListAgentIdentities(...a),
  getOwnershipIssues: (...a: unknown[]) => mockGetOwnershipIssues(...a),
}));
vi.mock("@/modules/access-governance/service", () => ({
  compareAccessToContract: (...a: unknown[]) => mockCompareAccessToContract(...a),
  classifyActionsForAgent: (...a: unknown[]) => mockClassifyActionsForAgent(...a),
  listPolicyEvaluations: (...a: unknown[]) => mockListPolicyEvaluations(...a),
  listGovernanceExceptions: (...a: unknown[]) => mockListGovernanceExceptions(...a),
}));
vi.mock("@/modules/runtime-assurance/service", () => ({
  getDid: (...a: unknown[]) => mockGetDid(...a),
}));
vi.mock("./decisions", () => ({
  getCertificationHistory: (...a: unknown[]) => mockGetCertificationHistory(...a),
}));
vi.mock("./controls", () => ({
  listControlFrameworks: (...a: unknown[]) => mockListControlFrameworks(...a),
  listControls: (...a: unknown[]) => mockListControls(...a),
  listControlMappings: (...a: unknown[]) => mockListControlMappings(...a),
}));

import { getGovernancePosture } from "./posture";
import type { Agent, AgentContract } from "@/lib/shared/types/agent-identity";

const agent: Agent = {
  id: "agent-1",
  tenantId: "tenant-a",
  agentName: "FinanceBot",
  displayName: null,
  description: null,
  purpose: null,
  agentType: "bot",
  agentFramework: null,
  modelProvider: null,
  modelName: null,
  modelVersion: null,
  runtime: null,
  environment: "production",
  criticality: "high",
  dataClassification: null,
  status: "active",
  lifecycleState: "ACTIVE",
  sourceSystem: null,
  sourceObjectId: null,
  enterpriseIdentityId: null,
  serviceAccountId: null,
  riskScore: null,
  postureScore: null,
  createdAt: "2026-01-01T00:00:00Z",
  activatedAt: null,
  lastSeenAt: null,
  nextReviewAt: null,
  retirementDate: null,
};

const contract: AgentContract = {
  id: "contract-1",
  tenantId: "tenant-a",
  agentId: "agent-1",
  purpose: "Financial reporting",
  ownerSummary: null,
  approvedApplications: ["SAP"],
  approvedData: ["financial reporting"],
  prohibitedData: [],
  approvedActions: ["read"],
  prohibitedActions: [],
  certificationFrequency: "quarterly",
  maximumRisk: "medium",
  status: "active",
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  supersededAt: null,
  autonomyLevel: 1,
  allowedTools: [],
  actionsRequiringApproval: [],
  requiredMonitoring: null,
  requiredComplianceControls: [],
      approvedUsers: [],
      approvedDelegators: [],
      allowedEnvironments: [],
      expiresAt: null,
};

function stubGoverned() {
  mockGetAgent.mockResolvedValue(agent);
  mockGetAgentContract.mockResolvedValue(contract);
  mockListAgentIdentities.mockResolvedValue([{ id: "i1", status: "active", confidence: "confirmed" }]);
  mockGetOwnershipIssues.mockResolvedValue([]);
  mockCompareAccessToContract.mockResolvedValue([{ classification: "approved" }]);
  mockGetDid.mockResolvedValue({ tuples: [] });
  mockClassifyActionsForAgent.mockResolvedValue([]);
  mockListPolicyEvaluations.mockResolvedValue([]);
  mockListControlFrameworks.mockResolvedValue([]);
  mockListControls.mockResolvedValue([]);
  mockListControlMappings.mockResolvedValue([]);
  mockGetCertificationHistory.mockResolvedValue([{ id: "d1", decidedAt: "2026-06-01T00:00:00Z", snapshot: { capturedAt: "x" } }]);
  mockListGovernanceExceptions.mockResolvedValue([]);
}

describe("getGovernancePosture — COMPLIANCE-P0-07", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubGoverned();
  });

  it("throws when the agent doesn't exist", async () => {
    mockGetAgent.mockResolvedValue(null);
    await expect(getGovernancePosture("tenant-a", "agent-1")).rejects.toMatchObject({ status: 404 });
  });

  it("returns GOVERNED when every dimension is governed", async () => {
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.status).toBe("GOVERNED");
    expect(posture.dimensions.every((d) => d.status !== "gap")).toBe(true);
    expect(posture.coveringExceptionIds).toEqual([]);
  });

  it("returns SUSPENDED when the agent's lifecycle state is SUSPENDED, overriding other dimensions", async () => {
    mockGetAgent.mockResolvedValue({ ...agent, lifecycleState: "SUSPENDED" });
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.status).toBe("SUSPENDED");
  });

  it("returns NON_COMPLIANT when a core dimension (ownership) has a gap", async () => {
    mockGetOwnershipIssues.mockResolvedValue([{ type: "missing_owner", ownerType: "business_owner" }]);
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.status).toBe("NON_COMPLIANT");
    expect(posture.dimensions.find((d) => d.dimension === "ownership")?.status).toBe("gap");
  });

  it("returns PARTIALLY_GOVERNED when only a non-core dimension (access) has a gap", async () => {
    mockCompareAccessToContract.mockResolvedValue([{ classification: "excessive", application: "Snowflake", entitlement: "CustomerDB_READ" }]);
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.status).toBe("PARTIALLY_GOVERNED");
    expect(posture.dimensions.find((d) => d.dimension === "access")?.status).toBe("gap");
  });

  it("returns EXCEPTION_APPROVED when a gap exists but an active governance exception covers the agent", async () => {
    mockCompareAccessToContract.mockResolvedValue([{ classification: "excessive", application: "Snowflake", entitlement: "CustomerDB_READ" }]);
    mockListGovernanceExceptions.mockResolvedValue([{ id: "exc-1", status: "active" }]);
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.status).toBe("EXCEPTION_APPROVED");
    expect(posture.coveringExceptionIds).toEqual(["exc-1"]);
  });

  it("flags action_authority as a gap when an observed runtime action is prohibited", async () => {
    mockGetDid.mockResolvedValue({ tuples: [{ action: "delete", eventCount: 3 }] });
    mockClassifyActionsForAgent.mockResolvedValue([{ action: "delete", state: "prohibited" }]);
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.dimensions.find((d) => d.dimension === "action_authority")?.status).toBe("gap");
  });

  it("flags human_oversight as a gap for high autonomy with no actions requiring approval", async () => {
    mockGetAgentContract.mockResolvedValue({ ...contract, autonomyLevel: 3, actionsRequiringApproval: [] });
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.dimensions.find((d) => d.dimension === "human_oversight")?.status).toBe("gap");
  });

  it("marks contract-dependent dimensions not_applicable when the agent has no active contract", async () => {
    mockGetAgentContract.mockResolvedValue(null);
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    for (const dim of ["access", "action_authority", "runtime_monitoring", "human_oversight", "policy_compliance", "compliance_controls"]) {
      expect(posture.dimensions.find((d) => d.dimension === dim)?.status).toBe("not_applicable");
    }
    expect(posture.dimensions.find((d) => d.dimension === "purpose")?.status).toBe("gap");
  });

  it("flags compliance_controls as a gap when a required control has no compliant mapping", async () => {
    mockGetAgentContract.mockResolvedValue({ ...contract, requiredComplianceControls: ["A.9.2.3"] });
    mockListControlFrameworks.mockResolvedValue([{ id: "iso27001", displayName: "ISO 27001" }]);
    mockListControls.mockResolvedValue([{ id: "control-1", frameworkId: "iso27001", controlRef: "A.9.2.3", requirement: "..." }]);
    mockListControlMappings.mockResolvedValue([{ id: "map-1", controlId: "control-1", status: "no_evidence" }]);
    const posture = await getGovernancePosture("tenant-a", "agent-1");
    expect(posture.dimensions.find((d) => d.dimension === "compliance_controls")?.status).toBe("gap");
  });
});
