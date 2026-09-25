// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
const calls: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];

function query(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  calls.push({ table, filters });
  const rows = () =>
    (tables[table] ?? []).filter((r) => filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : r[c] !== v)));
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), chain),
    neq: (c: string, v: unknown) => (filters.push(["neq", c, v]), chain),
    limit: async () => ({ data: rows(), error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
  };
  return chain;
}
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: query }) }));

import { resolveAgentReference } from "./runtimeProfile";

const A1 = "11111111-1111-4111-8111-111111111111";
const B1 = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  calls.length = 0;
  tables = {
    agents: [
      { id: A1, tenant_id: "t1" },
      { id: B1, tenant_id: "t2" },
    ],
    agent_identities: [
      { id: "i1", agent_id: A1, tenant_id: "t1", external_reference: "svc-finance", status: "active" },
      { id: "i2", agent_id: "a2", tenant_id: "t1", external_reference: "shared-svc", status: "active" },
      { id: "i3", agent_id: "a3", tenant_id: "t1", external_reference: "shared-svc", status: "active" },
      { id: "i4", agent_id: "a4", tenant_id: "t1", external_reference: "old-svc", status: "removed" },
      { id: "i5", agent_id: B1, tenant_id: "t2", external_reference: "tenant-two-svc", status: "active" },
    ],
  };
});

describe("resolveAgentReference (IDENTITY-P0-12, §17.6)", () => {
  it("resolves this tenant's agent id, and never another tenant's", async () => {
    expect(await resolveAgentReference("t1", A1)).toEqual({ kind: "unique", agentId: A1, identityId: null });
    expect(await resolveAgentReference("t1", B1)).toEqual({ kind: "none" });
  });

  it("resolves a linked identity's external reference exactly, with that identity", async () => {
    expect(await resolveAgentReference("t1", " svc-finance ")).toEqual({ kind: "unique", agentId: A1, identityId: "i1" });
    expect(await resolveAgentReference("t1", "svc-fin")).toEqual({ kind: "none" });
    expect(await resolveAgentReference("t1", "tenant-two-svc")).toEqual({ kind: "none" });
  });

  it("a reference linked to two agents is ambiguous; a removed link resolves nothing", async () => {
    expect(await resolveAgentReference("t1", "shared-svc")).toEqual({ kind: "ambiguous", agentIds: ["a2", "a3"] });
    expect(await resolveAgentReference("t1", "old-svc")).toEqual({ kind: "none" });
  });

  it("every query is filtered by the tenant", async () => {
    await resolveAgentReference("t1", "svc-finance");
    await resolveAgentReference("t1", A1);
    expect(calls.every((c) => c.filters.some(([op, col, v]) => op === "eq" && col === "tenant_id" && v === "t1"))).toBe(true);
  });
});
