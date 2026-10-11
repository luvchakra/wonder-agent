// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** One recorded query: the operation, its payload and every filter. */
type Query = { op: "select" | "update"; payload?: Record<string, unknown>; count?: boolean; filters: Array<[string, string, unknown]> };

const queries: Query[] = [];
const rpcs: Record<string, unknown>[] = [];
const audits: Record<string, unknown>[] = [];
let job: Record<string, unknown> | null;
let newerRuns: number;
let claimWins: boolean;

const HELD_SUMMARY = {
  account: { status: "marked", marked: 1, candidates: 1, presentBefore: 9 },
  identity: { status: "held", candidates: 15, presentBefore: 25, thresholdPercent: 20 },
};

function result(q: Query): { data: unknown; error: null; count?: number } {
  if (q.op === "select" && q.count) return { data: null, error: null, count: newerRuns };
  if (q.op === "select") return { data: job, error: null };
  if (q.payload && "missing_status" in q.payload) {
    if (!claimWins) return { data: [], error: null };
    job = { ...job, ...q.payload };
    return { data: [{ id: "j1" }], error: null };
  }
  return { data: { ...job, ...q.payload, id: "j1", tenant_id: "t1", integration_id: "c1", created_at: "2026-10-11T00:00:00Z", errors: [] }, error: null };
}

function builder(q: Query) {
  const b = {
    eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), b),
    gt: (c: string, v: unknown) => (q.filters.push(["gt", c, v]), b),
    select: () => b,
    maybeSingle: async () => result(q),
    single: async () => result(q),
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(result(q)).then(resolve),
  };
  queries.push(q);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: vi.fn(),
  supabaseServiceRole: () => ({
    from: () => ({
      select: (_cols: string, opts?: { count?: string }) => builder({ op: "select", count: Boolean(opts?.count), filters: [] }),
      update: (payload: Record<string, unknown>) => builder({ op: "update", payload, filters: [] }),
    }),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      rpcs.push(args);
      return { data: [{ candidates: 15, present_before: 25, marked: 15, held: false }], error: null };
    },
  }),
}));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn(async (e: Record<string, unknown>) => void audits.push(e)) }));
vi.mock("@/modules/operations/service", () => ({ notify: vi.fn() }));
vi.mock("@/lib/config/tenantConfig", () => ({ getTenantConfig: vi.fn() }));
vi.mock("./registry", () => ({ createConnector: vi.fn() }));
vi.mock("./credentials", () => ({ getDecryptedCredential: vi.fn() }));
vi.mock("./gateway/gateway", () => ({ openGateway: vi.fn() }));

import { resolveHeldMissing } from "./syncJobs";

beforeEach(() => {
  queries.length = 0;
  rpcs.length = 0;
  audits.length = 0;
  job = { id: "j1", tenant_id: "t1", integration_id: "c1", started_at: "2026-10-11T01:00:00Z", missing_status: "held", missing_summary: HELD_SUMMARY, correlation_id: "corr" };
  newerRuns = 0;
  claimWins = true;
});

const updates = () => queries.filter((q) => q.op === "update");

describe("resolveHeldMissing", () => {
  it("scopes the job read to the caller's tenant and connection", async () => {
    await resolveHeldMissing("t1", "u1", "c1", "j1", "discard");
    expect(queries[0].filters).toEqual(expect.arrayContaining([["eq", "tenant_id", "t1"], ["eq", "integration_id", "c1"], ["eq", "id", "j1"]]));
  });

  it("refuses a run that is not held, changing nothing", async () => {
    job = { ...job, missing_status: "applied" };
    await expect(resolveHeldMissing("t1", "u1", "c1", "j1", "approve")).rejects.toMatchObject({ status: 409, code: "NOT_HELD" });
    expect(updates()).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("refuses an unknown job", async () => {
    job = null;
    await expect(resolveHeldMissing("t1", "u1", "c1", "j1", "discard")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to approve once a newer run has started", async () => {
    newerRuns = 1;
    await expect(resolveHeldMissing("t1", "u1", "c1", "j1", "approve")).rejects.toMatchObject({ status: 409, code: "SUPERSEDED" });
    expect(updates()).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("approves: claims the decision, then marks only the held kinds without the guard, and audits", async () => {
    const result = await resolveHeldMissing("t1", "u1", "c1", "j1", "approve");
    const [claim, save] = updates();
    expect(claim.payload).toMatchObject({ missing_status: "approved", missing_resolved_by: "u1" });
    expect(claim.filters).toEqual(expect.arrayContaining([["eq", "missing_status", "held"], ["eq", "tenant_id", "t1"]]));
    expect(rpcs).toEqual([{ p_tenant: "t1", p_job: "j1", p_kind: "identity", p_threshold_percent: null, p_min_population: 20 }]);
    expect(save.payload?.missing_summary).toEqual({
      account: HELD_SUMMARY.account,
      identity: { status: "approved", marked: 15, candidates: 15, presentBefore: 25 },
    });
    expect(audits[0]).toMatchObject({ action: "integration.sync_missing_approved", actorId: "u1", outcome: "success", tenantId: "t1" });
    expect(result.missingStatus).toBe("approved");
  });

  it("discards: marks nothing and records the discarded kinds", async () => {
    await resolveHeldMissing("t1", "u1", "c1", "j1", "discard");
    expect(rpcs).toHaveLength(0);
    expect(updates()[1].payload?.missing_summary).toMatchObject({ identity: { status: "discarded", candidates: 15, presentBefore: 25 } });
    expect(audits[0]).toMatchObject({ action: "integration.sync_missing_discarded" });
  });

  it("a decision someone else already claimed applies nothing", async () => {
    claimWins = false;
    await expect(resolveHeldMissing("t1", "u1", "c1", "j1", "approve")).rejects.toMatchObject({ code: "NOT_HELD" });
    expect(rpcs).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});
