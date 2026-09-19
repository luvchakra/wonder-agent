// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mockListAgents = vi.fn();
const mockListOwnersForTenant = vi.fn();
const mockListIdentitiesForTenant = vi.fn();
vi.mock("@/modules/agent-identity/service", () => ({
  listAgents: (...a: unknown[]) => mockListAgents(...a),
  listOwnersForTenant: (...a: unknown[]) => mockListOwnersForTenant(...a),
  listIdentitiesForTenant: (...a: unknown[]) => mockListIdentitiesForTenant(...a),
}));

const mockListApplications = vi.fn();
const mockListPolicies = vi.fn();
const mockListEntitlementsForTenant = vi.fn();
vi.mock("@/modules/access-governance/service", () => ({
  listApplications: (...a: unknown[]) => mockListApplications(...a),
  listPolicies: (...a: unknown[]) => mockListPolicies(...a),
  listEntitlementsForTenant: (...a: unknown[]) => mockListEntitlementsForTenant(...a),
}));

const mockGetFindings = vi.fn();
vi.mock("@/modules/risk/service", () => ({
  getFindings: (...a: unknown[]) => mockGetFindings(...a),
}));

const mockListCampaigns = vi.fn();
vi.mock("@/modules/certification-compliance/service", () => ({
  listCampaigns: (...a: unknown[]) => mockListCampaigns(...a),
}));

const mockListIntegrations = vi.fn();
vi.mock("@/modules/integrations/service", () => ({
  listIntegrations: (...a: unknown[]) => mockListIntegrations(...a),
}));

import { search, maskRiskField } from "./search";

describe("maskRiskField — OPERATIONS-P0-03.2", () => {
  it("masks the field entirely when the caller lacks risk.read, regardless of the raw value", () => {
    expect(maskRiskField("critical", false)).toEqual({ riskSeverity: null, riskMasked: true });
    expect(maskRiskField(null, false)).toEqual({ riskSeverity: null, riskMasked: true });
  });

  it("passes the real value through, unmasked, when the caller has risk.read", () => {
    expect(maskRiskField("high", true)).toEqual({ riskSeverity: "high", riskMasked: false });
  });

  it("distinguishes 'visible but no finding' from 'masked' — both are riskSeverity: null but riskMasked differs", () => {
    const visibleNoFinding = maskRiskField(null, true);
    const maskedFromCaller = maskRiskField(null, false);
    expect(visibleNoFinding.riskSeverity).toBeNull();
    expect(visibleNoFinding.riskMasked).toBe(false);
    expect(maskedFromCaller.riskSeverity).toBeNull();
    expect(maskedFromCaller.riskMasked).toBe(true);
  });
});

/**
 * OPERATIONS-P0-03.1 — added 2026-09-19 alongside the three previously-
 * missing object types (identity, owner, entitlement). All nine named
 * object types are now covered by at least one test, most importantly the
 * permission-gating behavior the story's own acceptance note calls out
 * explicitly ("a result type the caller cannot see never enters the
 * returned array at all").
 */
describe("search — OPERATIONS-P0-03.1/03.2", () => {
  const ALL_PERMISSIONS = ["agent.read", "access.read", "risk.read", "compliance.read", "policy.read", "integration.read"];

  function stubEmpty() {
    mockListAgents.mockResolvedValue([]);
    mockListOwnersForTenant.mockResolvedValue([]);
    mockListIdentitiesForTenant.mockResolvedValue([]);
    mockListApplications.mockResolvedValue([]);
    mockListPolicies.mockResolvedValue([]);
    mockListEntitlementsForTenant.mockResolvedValue([]);
    mockGetFindings.mockResolvedValue([]);
    mockListCampaigns.mockResolvedValue([]);
    mockListIntegrations.mockResolvedValue([]);
  }

  it("returns nothing for an empty/whitespace query without calling any dependency", async () => {
    stubEmpty();
    const results = await search("tenant-a", ALL_PERMISSIONS, "   ");
    expect(results).toEqual([]);
    expect(mockListAgents).not.toHaveBeenCalled();
  });

  it("finds an 'identity' result by its external reference, titled and subtitled from the embedded agent name", async () => {
    stubEmpty();
    mockListIdentitiesForTenant.mockResolvedValue([
      {
        id: "identity-1",
        agentId: "agent-1",
        agentName: "FinanceBot",
        externalReference: "financebot@svc.example.com",
        sourceSystem: "Okta",
        identityType: "service_account",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);

    const results = await search("tenant-a", ["agent.read"], "financebot@svc");
    expect(results).toEqual([
      {
        objectType: "identity",
        id: "identity-1",
        title: "financebot@svc.example.com",
        subtitle: "FinanceBot",
        href: "/agents/agent-1",
        freshness: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("finds an 'owner' result by the owner's display name, and separately by their email", async () => {
    stubEmpty();
    mockListOwnersForTenant.mockResolvedValue([
      {
        id: "owner-1",
        agentId: "agent-1",
        agentName: "FinanceBot",
        ownerType: "business_owner",
        userDisplayName: "Priya Shah",
        userEmail: "priya@example.com",
        assignedAt: "2026-02-01T00:00:00Z",
      },
    ]);

    const byName = await search("tenant-a", ["agent.read"], "priya shah");
    expect(byName).toEqual([
      {
        objectType: "owner",
        id: "owner-1",
        title: "Priya Shah",
        subtitle: "business owner of FinanceBot",
        href: "/agents/agent-1",
        freshness: "2026-02-01T00:00:00Z",
      },
    ]);

    const byEmail = await search("tenant-a", ["agent.read"], "priya@example.com");
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0].id).toBe("owner-1");
  });

  it("falls back to the owner's email as the title when no display name is set", async () => {
    stubEmpty();
    mockListOwnersForTenant.mockResolvedValue([
      {
        id: "owner-2",
        agentId: "agent-1",
        agentName: "FinanceBot",
        ownerType: "technical_owner",
        userDisplayName: null,
        userEmail: "noname@example.com",
        assignedAt: "2026-02-01T00:00:00Z",
      },
    ]);

    const results = await search("tenant-a", ["agent.read"], "noname");
    expect(results[0].title).toBe("noname@example.com");
  });

  it("finds an 'entitlement' result by name, subtitled by its application", async () => {
    stubEmpty();
    mockListEntitlementsForTenant.mockResolvedValue([
      {
        id: "ent-1",
        applicationId: "app-1",
        applicationName: "Snowflake",
        name: "CustomerDB_READ",
        dataClassification: "pii",
        privilegeLevel: "standard",
        createdAt: "2026-03-01T00:00:00Z",
      },
    ]);

    const results = await search("tenant-a", ["access.read"], "customerdb");
    expect(results).toEqual([
      {
        objectType: "entitlement",
        id: "ent-1",
        title: "CustomerDB_READ",
        subtitle: "Snowflake",
        href: "/access",
        freshness: "2026-03-01T00:00:00Z",
      },
    ]);
  });

  it("never returns identity/owner results without agent.read, even though the dependency was called", async () => {
    stubEmpty();
    mockListIdentitiesForTenant.mockResolvedValue([
      { id: "identity-1", agentId: "agent-1", agentName: "FinanceBot", externalReference: "financebot@svc.example.com", sourceSystem: "Okta", createdAt: "t" },
    ]);
    mockListOwnersForTenant.mockResolvedValue([
      { id: "owner-1", agentId: "agent-1", agentName: "FinanceBot", ownerType: "business_owner", userDisplayName: "Priya Shah", userEmail: "priya@example.com", assignedAt: "t" },
    ]);

    const results = await search("tenant-a", ["access.read"], "financebot");
    expect(results.some((r) => r.objectType === "identity" || r.objectType === "owner")).toBe(false);
    expect(mockListIdentitiesForTenant).not.toHaveBeenCalled();
    expect(mockListOwnersForTenant).not.toHaveBeenCalled();
  });

  it("never returns an entitlement result without access.read, even though a matching row exists", async () => {
    stubEmpty();
    mockListEntitlementsForTenant.mockResolvedValue([
      { id: "ent-1", applicationId: "app-1", applicationName: "Snowflake", name: "CustomerDB_READ", dataClassification: "pii", privilegeLevel: "standard", createdAt: "t" },
    ]);

    const results = await search("tenant-a", ["agent.read"], "customerdb");
    expect(results).toEqual([]);
    expect(mockListEntitlementsForTenant).not.toHaveBeenCalled();
  });

  it("covers all nine named search object types across a mixed permission set", async () => {
    stubEmpty();
    mockListAgents.mockResolvedValue([{ id: "a1", agentName: "MatchBot", agentType: "workflow" }]);
    mockListApplications.mockResolvedValue([{ id: "app1", name: "MatchApp", category: "erp", createdAt: "t" }]);
    mockListEntitlementsForTenant.mockResolvedValue([{ id: "e1", applicationId: "app1", applicationName: "MatchApp", name: "Match_READ", createdAt: "t" }]);
    mockGetFindings.mockResolvedValue([{ id: "f1", agentId: "a1", title: "Match finding", category: "excessive_access", severity: "high", createdAt: "t" }]);
    mockListCampaigns.mockResolvedValue([{ id: "c1", name: "Match campaign", status: "active", createdAt: "t" }]);
    mockListPolicies.mockResolvedValue([{ id: "p1", name: "Match policy", policyCategory: "access", effectiveDate: "t" }]);
    mockListIntegrations.mockResolvedValue([{ id: "i1", name: "Match integration", status: "connected", lastSyncAt: "t", createdAt: "t" }]);
    mockListIdentitiesForTenant.mockResolvedValue([{ id: "id1", agentId: "a1", agentName: "MatchBot", externalReference: "match-svc@example.com", sourceSystem: "Okta", createdAt: "t" }]);
    mockListOwnersForTenant.mockResolvedValue([{ id: "o1", agentId: "a1", agentName: "MatchBot", ownerType: "business_owner", userDisplayName: "Match Owner", userEmail: "match@example.com", assignedAt: "t" }]);

    const results = await search("tenant-a", ALL_PERMISSIONS, "match");
    const types = results.map((r) => r.objectType).sort();
    expect(types).toEqual(
      ["agent", "application", "certification_campaign", "entitlement", "finding", "identity", "integration", "owner", "policy"].sort(),
    );
  });
});
