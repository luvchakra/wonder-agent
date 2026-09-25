// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockListAgents = vi.fn();
const mockGetAgentContract = vi.fn();
// PLATFORM-P0-12 — feature flags: defaults (every gated capability on,
// gateway observe-only). Flag behaviour itself is tested in
// modules/platform-admin/featureFlags.test.ts and gateway.test.ts.
vi.mock("@/modules/platform-admin/service", () => ({
  requireFeature: async () => undefined,
  getFeatureFlags: async (_t: string, keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, k !== "runtime_enforce"])),
}));

vi.mock("@/modules/agent-identity/service", () => ({
  listAgents: (...a: unknown[]) => mockListAgents(...a),
  getAgentContract: (...a: unknown[]) => mockGetAgentContract(...a),
}));

const mockGetEffectiveAccess = vi.fn();
const mockListPolicyEvaluations = vi.fn();
const mockGetApplication = vi.fn();
const mockGetEntitlement = vi.fn();
vi.mock("@/modules/access-governance/service", () => ({
  getEffectiveAccess: (...a: unknown[]) => mockGetEffectiveAccess(...a),
  listPolicyEvaluations: (...a: unknown[]) => mockListPolicyEvaluations(...a),
  getApplication: (...a: unknown[]) => mockGetApplication(...a),
  getEntitlement: (...a: unknown[]) => mockGetEntitlement(...a),
}));

const mockGetFindings = vi.fn();
vi.mock("@/modules/risk/service", () => ({
  getFindings: (...a: unknown[]) => mockGetFindings(...a),
}));

const mockGetDid = vi.fn();
vi.mock("@/modules/runtime-assurance/service", () => ({
  getDid: (...a: unknown[]) => mockGetDid(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

const insertedItems: Record<string, unknown>[] = [];
const campaignInsert = vi.fn();

function campaignsTable() {
  return {
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          campaignInsert(row);
          return { data: { id: "campaign-1", ...row }, error: null };
        },
      }),
    }),
  };
}

function itemsTable() {
  return {
    insert: (row: Record<string, unknown>) => {
      insertedItems.push(row);
      return Promise.resolve({ error: null });
    },
  };
}

function makeFrom(table: string) {
  if (table === "certification_campaigns") return campaignsTable();
  if (table === "certification_items") return itemsTable();
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
}));

import { launchCampaign } from "./campaigns";
import { ApiError } from "@/lib/shared/types/foundation";

const AGENT_1 = { id: "agent-1", agentName: "MailBot", criticality: "medium", riskScore: 20 };
const AGENT_2 = { id: "agent-2", agentName: "DbBot", criticality: "medium", riskScore: 80 };

const GRANT_SENDGRID = { id: "grant-1", entitlementId: "ent-sendgrid", applicationId: "app-sendgrid", application: "SendGrid", privilegeLevel: "standard" };
const GRANT_DB_ADMIN = { id: "grant-2", entitlementId: "ent-db-admin", applicationId: "app-db", application: "Postgres", privilegeLevel: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  insertedItems.length = 0;
  mockGetAgentContract.mockResolvedValue(null);
  mockListPolicyEvaluations.mockResolvedValue([]);
  mockGetFindings.mockResolvedValue([]);
  mockGetDid.mockResolvedValue({ tuples: [] });
});

describe("launchCampaign — COMPLIANCE-P0-01.2's 4 previously-unimplemented scope types", () => {
  it("'application' scope: requires scope.applicationId and rejects before creating a campaign row", async () => {
    await expect(
      launchCampaign("tenant-a", "actor-1", { name: "Q1", scopeType: "application", scope: {}, cadence: "one_time", reviewerId: "reviewer-1" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(campaignInsert).not.toHaveBeenCalled();
  });

  it("'application' scope: 404s when the application doesn't exist, before creating a campaign row", async () => {
    mockGetApplication.mockResolvedValue(null);
    await expect(
      launchCampaign("tenant-a", "actor-1", { name: "Q1", scopeType: "application", scope: { applicationId: "app-sendgrid" }, cadence: "one_time", reviewerId: "reviewer-1" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(campaignInsert).not.toHaveBeenCalled();
  });

  it("'application' scope: creates items only for grants on the named application, across all agents", async () => {
    mockGetApplication.mockResolvedValue({ id: "app-sendgrid", name: "SendGrid" });
    mockListAgents.mockResolvedValue([AGENT_1, AGENT_2]);
    mockGetEffectiveAccess.mockImplementation(async (_t: string, agentId: string) =>
      agentId === "agent-1" ? [GRANT_SENDGRID, GRANT_DB_ADMIN] : [GRANT_DB_ADMIN],
    );

    await launchCampaign("tenant-a", "actor-1", { name: "Q1", scopeType: "application", scope: { applicationId: "app-sendgrid" }, cadence: "one_time", reviewerId: "reviewer-1" });

    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]).toMatchObject({ agent_id: "agent-1", access_grant_id: "grant-1" });
  });

  it("'entitlement' scope: creates items only for grants of the named entitlement", async () => {
    mockGetEntitlement.mockResolvedValue({ id: "ent-db-admin", applicationId: "app-db" });
    mockListAgents.mockResolvedValue([AGENT_1, AGENT_2]);
    mockGetEffectiveAccess.mockResolvedValue([GRANT_SENDGRID, GRANT_DB_ADMIN]);

    await launchCampaign("tenant-a", "actor-1", { name: "Q1", scopeType: "entitlement", scope: { entitlementId: "ent-db-admin" }, cadence: "one_time", reviewerId: "reviewer-1" });

    expect(insertedItems).toHaveLength(2); // one per agent, both hold GRANT_DB_ADMIN
    expect(insertedItems.every((i) => i.access_grant_id === "grant-2")).toBe(true);
  });

  it("'privileged_access' scope: creates items only for elevated/admin grants, never standard ones", async () => {
    mockListAgents.mockResolvedValue([AGENT_1]);
    mockGetEffectiveAccess.mockResolvedValue([GRANT_SENDGRID, GRANT_DB_ADMIN]);

    await launchCampaign("tenant-a", "actor-1", { name: "Q1", scopeType: "privileged_access", scope: {}, cadence: "one_time", reviewerId: "reviewer-1" });

    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]).toMatchObject({ access_grant_id: "grant-2" });
  });

  it("'high_risk_agent' scope: only includes agents at/above the risk-score threshold (default 50)", async () => {
    mockListAgents.mockResolvedValue([AGENT_1, AGENT_2]); // riskScore 20 and 80
    mockGetEffectiveAccess.mockResolvedValue([GRANT_SENDGRID]);

    await launchCampaign("tenant-a", "actor-1", { name: "Q1", scopeType: "high_risk_agent", scope: {}, cadence: "one_time", reviewerId: "reviewer-1" });

    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]).toMatchObject({ agent_id: "agent-2" });
  });

  it("'high_risk_agent' scope: honors a custom scope.minRiskScore override", async () => {
    mockListAgents.mockResolvedValue([AGENT_1, AGENT_2]);
    mockGetEffectiveAccess.mockResolvedValue([GRANT_SENDGRID]);

    await launchCampaign("tenant-a", "actor-1", { name: "Q1", scopeType: "high_risk_agent", scope: { minRiskScore: 10 }, cadence: "one_time", reviewerId: "reviewer-1" });

    expect(insertedItems).toHaveLength(2); // both agents now qualify
  });
});
