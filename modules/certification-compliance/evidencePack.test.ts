// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetAgent = vi.fn();
const mockGetAgentContract = vi.fn();
const mockListOwners = vi.fn();
const mockListAgentIdentities = vi.fn();
const mockListLifecycleEvents = vi.fn();

const mockGetEffectiveAccess = vi.fn();
const mockListPolicyEvaluations = vi.fn();
const mockListGovernanceExceptions = vi.fn();
const mockListAccessRequests = vi.fn();

const mockCompareShouldCanDid = vi.fn();
const mockGetFindings = vi.fn();
const mockListAuditLogs = vi.fn();

const mockGetCertificationHistory = vi.fn();
const mockListAttestationsForAgent = vi.fn();
const mockListControlFrameworks = vi.fn();
const mockListControls = vi.fn();
const mockListControlMappings = vi.fn();
const mockGetGovernancePosture = vi.fn();

vi.mock("@/modules/agent-identity/service", () => ({
  getAgent: (...a: unknown[]) => mockGetAgent(...a),
  getAgentContract: (...a: unknown[]) => mockGetAgentContract(...a),
  listOwners: (...a: unknown[]) => mockListOwners(...a),
  listAgentIdentities: (...a: unknown[]) => mockListAgentIdentities(...a),
  listLifecycleEvents: (...a: unknown[]) => mockListLifecycleEvents(...a),
}));
vi.mock("@/modules/access-governance/service", () => ({
  getEffectiveAccess: (...a: unknown[]) => mockGetEffectiveAccess(...a),
  listPolicyEvaluations: (...a: unknown[]) => mockListPolicyEvaluations(...a),
  listGovernanceExceptions: (...a: unknown[]) => mockListGovernanceExceptions(...a),
  listAccessRequests: (...a: unknown[]) => mockListAccessRequests(...a),
}));
vi.mock("@/modules/runtime-assurance/service", () => ({
  compareShouldCanDid: (...a: unknown[]) => mockCompareShouldCanDid(...a),
}));
vi.mock("@/modules/risk/service", () => ({
  getFindings: (...a: unknown[]) => mockGetFindings(...a),
}));
vi.mock("@/modules/operations/service", () => ({
  listAuditLogs: (...a: unknown[]) => mockListAuditLogs(...a),
}));
vi.mock("./decisions", () => ({
  getCertificationHistory: (...a: unknown[]) => mockGetCertificationHistory(...a),
}));
vi.mock("./attestations", () => ({
  listAttestationsForAgent: (...a: unknown[]) => mockListAttestationsForAgent(...a),
}));
vi.mock("./controls", () => ({
  listControlFrameworks: (...a: unknown[]) => mockListControlFrameworks(...a),
  listControls: (...a: unknown[]) => mockListControls(...a),
  listControlMappings: (...a: unknown[]) => mockListControlMappings(...a),
}));
vi.mock("./posture", () => ({
  getGovernancePosture: (...a: unknown[]) => mockGetGovernancePosture(...a),
}));

import { assembleGovernanceEvidencePack } from "./evidencePack";
import { ApiError } from "@/lib/shared/types/foundation";

const agent = { id: "agent-1", tenantId: "tenant-a", agentName: "FinanceBot" };
const contract = { id: "contract-1", requiredComplianceControls: [] as string[] };

function stubDefaults() {
  mockGetAgent.mockResolvedValue(agent);
  mockGetAgentContract.mockResolvedValue(contract);
  mockListOwners.mockResolvedValue([]);
  mockListAgentIdentities.mockResolvedValue([]);
  mockListLifecycleEvents.mockResolvedValue([]);
  mockGetEffectiveAccess.mockResolvedValue([]);
  mockListPolicyEvaluations.mockResolvedValue([]);
  mockListGovernanceExceptions.mockResolvedValue([]);
  mockListAccessRequests.mockResolvedValue([]);
  mockCompareShouldCanDid.mockResolvedValue({ agentId: "agent-1", should: [], can: [], did: [], outcomes: [], evaluatedAt: "x" });
  mockGetFindings.mockResolvedValue([]);
  mockListAuditLogs.mockResolvedValue({ entries: [], nextCursor: null });
  mockGetCertificationHistory.mockResolvedValue([]);
  mockListAttestationsForAgent.mockResolvedValue([]);
  mockListControlFrameworks.mockResolvedValue([]);
  mockListControls.mockResolvedValue([]);
  mockListControlMappings.mockResolvedValue([]);
  mockGetGovernancePosture.mockResolvedValue({ agentId: "agent-1", tenantId: "tenant-a", status: "GOVERNED", computedAt: "x", dimensions: [], coveringExceptionIds: [] });
}

describe("assembleGovernanceEvidencePack — COMPLIANCE-P0-09", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDefaults();
  });

  it("throws when the agent doesn't exist", async () => {
    mockGetAgent.mockResolvedValue(null);
    await expect(assembleGovernanceEvidencePack("tenant-a", "agent-1")).rejects.toBeInstanceOf(ApiError);
  });

  it("assembles every section from the mocked dependencies", async () => {
    const pack = await assembleGovernanceEvidencePack("tenant-a", "agent-1");
    expect(pack.agentId).toBe("agent-1");
    expect(pack.tenantId).toBe("tenant-a");
    expect(pack.identity.agent).toEqual(agent);
    expect(pack.identity.contract).toEqual(contract);
    expect(pack.controlMappings).toEqual([]);
    expect(pack.posture.status).toBe("GOVERNED");
    expect(pack.generatedAt).toBeTruthy();
  });

  it("filters audit events down to those whose objectId is the agent itself", async () => {
    mockListAuditLogs.mockResolvedValue({
      entries: [
        { id: "e1", objectType: "agent", objectId: "agent-1", tenantId: "tenant-a", actorId: "u1", actorType: "user", action: "identity.agent_registered", outcome: "success", metadata: {}, correlationId: "c1", createdAt: "t1" },
        { id: "e2", objectType: "agent", objectId: "agent-2", tenantId: "tenant-a", actorId: "u1", actorType: "user", action: "identity.agent_registered", outcome: "success", metadata: {}, correlationId: "c2", createdAt: "t2" },
      ],
      nextCursor: null,
    });
    const pack = await assembleGovernanceEvidencePack("tenant-a", "agent-1");
    expect(pack.auditEvents).toHaveLength(1);
    expect(pack.auditEvents[0].id).toBe("e1");
  });

  it("resolves control mappings only for controls the contract requires, matched by controlRef", async () => {
    mockGetAgentContract.mockResolvedValue({ ...contract, requiredComplianceControls: ["A.9.2.3"] });
    mockListControlFrameworks.mockResolvedValue([{ id: "iso27001", displayName: "ISO 27001" }]);
    mockListControls.mockResolvedValue([
      { id: "control-1", frameworkId: "iso27001", controlRef: "A.9.2.3", requirement: "..." },
      { id: "control-2", frameworkId: "iso27001", controlRef: "A.9.2.5", requirement: "..." },
    ]);
    mockListControlMappings.mockResolvedValue([
      { id: "map-1", controlId: "control-1", status: "compliant" },
      { id: "map-2", controlId: "control-2", status: "no_evidence" },
    ]);
    const pack = await assembleGovernanceEvidencePack("tenant-a", "agent-1");
    expect(pack.controlMappings).toEqual([{ id: "map-1", controlId: "control-1", status: "compliant" }]);
  });
});
