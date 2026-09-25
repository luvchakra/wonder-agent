// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockListContractVersions = vi.fn();
const mockListOwners = vi.fn();
const mockGetEffectiveAccessAsOf = vi.fn();
const mockGetEffectiveAccess = vi.fn();

vi.mock("@/modules/agent-identity/service", () => ({
  listContractVersions: (...a: unknown[]) => mockListContractVersions(...a),
  listOwners: (...a: unknown[]) => mockListOwners(...a),
}));
vi.mock("@/modules/access-governance/service", () => ({
  getEffectiveAccessAsOf: (...a: unknown[]) => mockGetEffectiveAccessAsOf(...a),
  getEffectiveAccess: (...a: unknown[]) => mockGetEffectiveAccess(...a),
}));

import { detectGovernanceDrift } from "./governanceDrift";
import type { Agent, AgentContract } from "@/lib/shared/types/agent-identity";

const agent = { id: "agent-1", agentName: "FinanceBot" } as Agent;

const baseContract: AgentContract = {
  id: "contract-2",
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
  version: 2,
  createdAt: "2026-06-01T00:00:00Z",
  supersededAt: null,
  autonomyLevel: 1,
  allowedTools: ["query_customer"],
  actionsRequiringApproval: [],
  requiredMonitoring: null,
  requiredComplianceControls: [],
      approvedUsers: [],
      approvedDelegators: [],
      allowedEnvironments: [],
      expiresAt: null,
};

const referenceContract: AgentContract = { ...baseContract, id: "contract-1", version: 1, createdAt: "2026-01-01T00:00:00Z" };

const approvalEvent = { id: "ev-1", tenantId: "tenant-a", agentId: "agent-1", fromState: "ASSESSED" as const, toState: "APPROVED" as const, reason: "ok", actorId: "u1", actorType: "user" as const, createdAt: "2026-01-15T00:00:00Z" };

describe("detectGovernanceDrift — RISK-P0-04", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOwners.mockResolvedValue([]);
    mockGetEffectiveAccessAsOf.mockResolvedValue([]);
    mockGetEffectiveAccess.mockResolvedValue([]);
  });

  it("returns null when the agent was never approved (no baseline to diff against)", async () => {
    const result = await detectGovernanceDrift("tenant-a", agent, baseContract, [], []);
    expect(result).toBeNull();
    expect(mockListContractVersions).not.toHaveBeenCalled();
  });

  it("returns null when nothing changed since approval", async () => {
    mockListContractVersions.mockResolvedValue([referenceContract]);
    const result = await detectGovernanceDrift("tenant-a", agent, referenceContract, [], [approvalEvent]);
    expect(result).toBeNull();
  });

  it("detects a purpose change since approval", async () => {
    mockListContractVersions.mockResolvedValue([referenceContract, baseContract]);
    const changed = { ...baseContract, purpose: "Financial reporting and payroll" };
    const result = await detectGovernanceDrift("tenant-a", agent, changed, [], [approvalEvent]);
    expect(result).not.toBeNull();
    expect(result!.category).toBe("governance_drift");
    expect(result!.explanation).toContain("purpose changed");
    expect(result!.evidence).toContainEqual(expect.objectContaining({ evidenceType: "governance_baseline" }));
  });

  it("detects autonomy level increases but not decreases", async () => {
    mockListContractVersions.mockResolvedValue([referenceContract]);
    const increased = { ...baseContract, autonomyLevel: 3 as const };
    const result = await detectGovernanceDrift("tenant-a", agent, increased, [], [approvalEvent]);
    expect(result!.explanation).toContain("autonomy level increased (1 -> 3)");

    const decreased = { ...baseContract, autonomyLevel: 0 as const };
    const resultDecreased = await detectGovernanceDrift("tenant-a", agent, decreased, [], [approvalEvent]);
    expect(resultDecreased).toBeNull();
  });

  it("detects a new owner assigned after approval, ignores owners assigned before", async () => {
    mockListContractVersions.mockResolvedValue([referenceContract]);
    mockListOwners.mockResolvedValue([
      { id: "o1", tenantId: "tenant-a", agentId: "agent-1", ownerType: "business_owner", userId: "u1", assignedAt: "2026-01-01T00:00:00Z", removedAt: null },
      { id: "o2", tenantId: "tenant-a", agentId: "agent-1", ownerType: "technical_owner", userId: "u2", assignedAt: "2026-07-01T00:00:00Z", removedAt: null },
    ]);
    const result = await detectGovernanceDrift("tenant-a", agent, referenceContract, [], [approvalEvent]);
    expect(result!.explanation).toContain("owner(s) added: technical_owner");
    expect(result!.explanation).not.toContain("business_owner");
  });

  it("detects access expanded since approval via the point-in-time contract", async () => {
    mockListContractVersions.mockResolvedValue([referenceContract]);
    mockGetEffectiveAccessAsOf.mockResolvedValue([{ id: "grant-1", application: "SAP", entitlementName: "SAP_READ", dataClassification: null }]);
    mockGetEffectiveAccess.mockResolvedValue([
      { id: "grant-1", application: "SAP", entitlementName: "SAP_READ", dataClassification: null },
      { id: "grant-2", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
    ]);
    const result = await detectGovernanceDrift("tenant-a", agent, referenceContract, [], [approvalEvent]);
    expect(result!.explanation).toContain("access expanded: 1 new grant(s)");
    expect(mockGetEffectiveAccessAsOf).toHaveBeenCalledWith("tenant-a", "agent-1", approvalEvent.createdAt);
  });

  it("uses the contract version active as of the approval time as the reference, not the oldest version", async () => {
    const midVersion = { ...referenceContract, id: "contract-mid", version: 1, createdAt: "2026-01-10T00:00:00Z", purpose: "Financial reporting" };
    const tooOld = { ...referenceContract, id: "contract-old", version: 0, createdAt: "2025-01-01T00:00:00Z", purpose: "Something else entirely" };
    mockListContractVersions.mockResolvedValue([tooOld, midVersion]);
    // baseContract.purpose === midVersion.purpose, so no drift should be reported
    // if tooOld were (wrongly) picked as the reference, a spurious purpose-change would fire.
    const result = await detectGovernanceDrift("tenant-a", agent, baseContract, [], [approvalEvent]);
    expect(result).toBeNull();
  });
});
