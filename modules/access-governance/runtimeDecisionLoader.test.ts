// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failTable: string | null = null;
const filtersSeen: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  filtersSeen.push({ table, filters });
  // Dotted filters ("accounts.agent_id") address an embedded relation, as in PostgREST.
  const get = (r: Row, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Row | undefined)?.[k], r);
  const rows = () =>
    (tables[table] ?? []).filter((r) =>
      filters.every(([c, v]) => {
        const actual = get(r, c);
        return Array.isArray(v) ? v.includes(actual) : v === null ? actual == null : actual === v;
      }),
    );
  const result = () => (failTable === table ? { data: null, error: { message: `${table} unavailable` } } : { data: rows(), error: null });
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
    in: (c: string, v: unknown[]) => (filters.push([c, v]), chain),
    is: (c: string, v: unknown) => (filters.push([c, v]), chain),
    returns: () => chain,
    then: (resolve: (v: unknown) => void) => resolve(result()),
  };
  return chain;
}

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: query }) }));

const profile = vi.fn();
vi.mock("@/modules/agent-identity/service", () => ({ getAgentRuntimeProfile: (...a: unknown[]) => profile(...a) }));

import { evaluateRuntimeRequest } from "./runtimeDecisionLoader";

const principal = { tenantId: "tenant-a", agentId: "agent-a" };
const contract = {
  approvedApplications: ["Snowflake"],
  approvedData: [],
  prohibitedData: [],
  approvedActions: ["READ"],
  prohibitedActions: [],
  actionsRequiringApproval: [],
  allowedTools: [],
  autonomyLevel: 3,
  maximumRisk: "high",
};

beforeEach(() => {
  failTable = null;
  filtersSeen.length = 0;
  profile.mockReset();
  profile.mockResolvedValue({
    agent: { id: "agent-a", lifecycleState: "ACTIVE", environment: "production", criticality: "medium", riskScore: 10 },
    contract,
    identityIds: ["ident-a"],
  });
  tables = {
    accounts: [
      { id: "acc-a", tenant_id: "tenant-a", agent_id: "agent-a" },
      { id: "acc-b", tenant_id: "tenant-b", agent_id: "agent-a" },
    ],
    access_grants: [
      { tenant_id: "tenant-a", accounts: { agent_id: "agent-a", tenant_id: "tenant-a" }, revoked_at: null, entitlements: { applications: { name: "Snowflake" } } },
      // Same agent id, another tenant: must never count.
      { tenant_id: "tenant-b", accounts: { agent_id: "agent-a", tenant_id: "tenant-b" }, revoked_at: null, entitlements: { applications: { name: "SAP" } } },
      // Revoked: must never count.
      { tenant_id: "tenant-a", accounts: { agent_id: "agent-a", tenant_id: "tenant-a" }, revoked_at: "2026-09-01T00:00:00Z", entitlements: { applications: { name: "Workday" } } },
    ],
    policies: [],
    policy_rules: [],
  };
});

describe("evaluateRuntimeRequest", () => {
  it("allows an approved request the agent can reach, and reads only the key's tenant", async () => {
    const d = await evaluateRuntimeRequest(principal, { requestId: "r1", action: "READ", application: "Snowflake" }, { tenantActive: true });
    expect(d.decision).toBe("ALLOW");
    expect(profile).toHaveBeenCalledWith("tenant-a", "agent-a");
    for (const table of ["access_grants", "policies"]) {
      const f = filtersSeen.find((x) => x.table === table)!;
      expect(f.filters, table).toContainEqual(["tenant_id", "tenant-a"]);
    }
  });

  it("does not count another tenant's or a revoked grant as effective access", async () => {
    const revoked = await evaluateRuntimeRequest(principal, { requestId: "r2b", action: "READ", application: "Workday" }, { tenantActive: true });
    expect(revoked.steps.find((s) => s.step === "effective_access")?.code).toBe("NO_EFFECTIVE_ACCESS");
    const d = await evaluateRuntimeRequest(principal, { requestId: "r2", action: "READ", application: "SAP" }, { tenantActive: true });
    expect(d.decision).toBe("DENY");
    // SAP isn't in this agent's approved applications either; both steps must refuse it.
    expect(d.steps.find((s) => s.step === "effective_access")?.code).toBe("NO_EFFECTIVE_ACCESS");
  });

  it("rejects an identity that is not the agent's own", async () => {
    const d = await evaluateRuntimeRequest(principal, { requestId: "r3", action: "READ", identityId: "ident-other" }, { tenantActive: true });
    expect(d.code).toBe("UNKNOWN_IDENTITY");
  });

  it("denies an agent unknown in the key's tenant", async () => {
    profile.mockResolvedValue(null);
    expect((await evaluateRuntimeRequest(principal, { requestId: "r4", action: "READ" }, { tenantActive: true })).code).toBe("UNKNOWN_AGENT");
  });

  it("fails closed when a fact cannot be loaded", async () => {
    failTable = "policies";
    const d = await evaluateRuntimeRequest(principal, { requestId: "r5", action: "READ", application: "Snowflake" }, { tenantActive: true });
    expect(d.decision).toBe("DENY");
    expect(d.code).toBe("EVALUATION_FAILED");

    failTable = null;
    profile.mockRejectedValue(new Error("identity store down"));
    expect((await evaluateRuntimeRequest(principal, { requestId: "r6", action: "READ" }, { tenantActive: true })).code).toBe("EVALUATION_FAILED");
  });

  it("applies an active runtime policy loaded for the tenant", async () => {
    tables.policies = [
      {
        id: "p1",
        tenant_id: "tenant-a",
        name: "No Snowflake",
        action: "block",
        version: 2,
        policy_category: "runtime",
        status: "active",
        policy_rules: [{ id: "r1", condition: { field: "request.application", op: "eq", value: "snowflake" } }],
      },
    ];
    const d = await evaluateRuntimeRequest(principal, { requestId: "r7", action: "READ", application: "Snowflake" }, { tenantActive: true });
    expect(d.decision).toBe("DENY");
    expect(d.policyId).toBe("p1");
    expect(d.policyVersion).toBe(2);
  });
});
