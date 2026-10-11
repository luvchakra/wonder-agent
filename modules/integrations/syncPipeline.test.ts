// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStep } from "./pipelineRules";

const saves: { tenant: unknown; id: unknown; payload: Record<string, unknown> }[] = [];
let sourceOutcome: { status: string; error: string | null } = { status: "succeeded", error: null };
let accountsThrow = false;
const accountCalls: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const b = {
          eq: (c: string, v: unknown) => {
            filters[c] = v;
            if (c === "id") saves.push({ tenant: filters.tenant_id, id: v, payload: structuredClone(payload) });
            return b;
          },
        };
        return b;
      },
    }),
  }),
}));
vi.mock("./identitySources", () => ({
  listSourcesReadingConnection: vi.fn(async () => [{ id: "s1", name: "Workday" }]),
  runSourceAfterSync: vi.fn(async () => ({
    runId: "r1",
    status: sourceOutcome.status,
    counts: { seen: 5, invalid: 0, created: 2, updated: 3, unchanged: 0, pending: 0, leavers: 0, errors: 0 },
    guardTripped: false,
    error: sourceOutcome.error,
  })),
}));
vi.mock("@/modules/access-governance/service", () => ({
  listApplicationsReconciledFrom: vi.fn(async () => [{ id: "a1", name: "SAP" }]),
  reconcileApplicationAccountsAsSystem: vi.fn(async (_t: string, appId: string) => {
    accountCalls.push(appId);
    if (accountsThrow) throw new Error("connector unreachable");
    return { id: "ar1", status: "succeeded", sourceAccounts: 4, created: 1, updated: 3, correlated: 4, orphan: 0, ambiguous: 0, missingIdentifier: 0, notInSource: 0, error: null };
  }),
}));

import { planAfterSync, runPipeline } from "./syncPipeline";

const plan = (): PipelineStep[] => [
  { kind: "identities", targetId: "s1", name: "Workday", status: "pending" },
  { kind: "accounts", targetId: "a1", name: "SAP", status: "pending" },
];

beforeEach(() => {
  saves.length = 0;
  accountCalls.length = 0;
  sourceOutcome = { status: "succeeded", error: null };
  accountsThrow = false;
});

describe("runPipeline", () => {
  it("runs identities then accounts, saving each step as it starts and ends, scoped to the job's tenant", async () => {
    const result = await runPipeline("t1", "j1", "c1", plan(), "succeeded");
    expect(result.status).toBe("succeeded");
    expect(result.steps.map((s) => s.status)).toEqual(["succeeded", "succeeded"]);
    expect(result.steps[0]).toMatchObject({ runId: "r1", counts: { created: 2, updated: 3 } });
    expect(result.steps[1]).toMatchObject({ runId: "ar1", counts: { created: 1, updated: 3 } });
    // running(step 1), running(step 2), final
    expect(saves.map((s) => s.payload.pipeline_status)).toEqual(["running", "running", "succeeded"]);
    expect(saves.every((s) => s.tenant === "t1" && s.id === "j1")).toBe(true);
  });

  it("a failed identity step skips the account step and the chain is failed", async () => {
    sourceOutcome = { status: "failed", error: "reading source links: timeout" };
    const result = await runPipeline("t1", "j1", "c1", plan(), "succeeded");
    expect(result.status).toBe("failed");
    expect(result.steps[0]).toMatchObject({ status: "failed", reason: "reading source links: timeout" });
    expect(result.steps[1]).toMatchObject({ status: "skipped", reason: "Workday failed" });
    expect(accountCalls).toEqual([]);
    expect(saves.at(-1)?.payload.pipeline_status).toBe("failed");
  });

  it("an account step that throws is recorded as failed, never succeeded", async () => {
    accountsThrow = true;
    const result = await runPipeline("t1", "j1", "c1", plan(), "succeeded");
    expect(result.steps[1]).toMatchObject({ status: "failed", reason: "connector unreachable" });
    expect(result.status).toBe("failed");
  });

  it("a partial identity run makes the chain partial", async () => {
    sourceOutcome = { status: "partial", error: null };
    expect((await runPipeline("t1", "j1", "c1", plan(), "succeeded")).status).toBe("partial");
  });
});

describe("planAfterSync", () => {
  it("plans from the connection's sources and onboarded applications", async () => {
    const steps = await planAfterSync("t1", "c1", { mode: "full", status: "succeeded", kindsRead: ["identity", "account"], kindsFailed: [] });
    expect(steps.map((s) => `${s.kind}:${s.targetId}`)).toEqual(["identities:s1", "accounts:a1"]);
  });

  it("reports a failure to find the steps instead of planning nothing", async () => {
    const { listApplicationsReconciledFrom } = await import("@/modules/access-governance/service");
    vi.mocked(listApplicationsReconciledFrom).mockRejectedValueOnce(new Error("db down"));
    const steps = await planAfterSync("t1", "c1", { mode: "full", status: "succeeded", kindsRead: ["account"], kindsFailed: [] });
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("failed");
  });
});
