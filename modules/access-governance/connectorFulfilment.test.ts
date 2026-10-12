// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WID-H02 — a connector change that dies or times out partway, against an
 * in-memory stand-in for the service-role client:
 * - a run that never reported back (the process was killed mid-write) goes
 *   back to its owner as unclear, and the system is read again;
 * - an unclear outcome is never sent again: one attempt, then a read;
 * - a change the system did not take is retried with the same task key;
 * - a task already running is never run a second time.
 */
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: "select" } | { kind: "update"; set: Row } = { kind: "select" };
  let single = false;
  const rows = () => (db[table] ??= []);
  const run = () => {
    const matched = rows().filter((r) => filters.every((f) => f(r)));
    if (op.kind === "update") for (const r of matched) Object.assign(r, op.set);
    return matched;
  };
  const b = {
    select: () => b,
    update: (set: Row) => ((op = { kind: "update", set }), b),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
    // Only the `col.is.null,col.eq.value` form the claim uses.
    or: (expr: string) => {
      const alts = expr.split(",").map((part) => {
        const [col, operator, value] = part.split(".");
        return (r: Row) => (operator === "is" ? (r[col] ?? null) === null : r[col] === value);
      });
      filters.push((r) => alts.some((f) => f(r)));
      return b;
    },
    limit: () => b,
    maybeSingle: () => ((single = true), b),
    single: () => ((single = true), b),
    then: (resolve: (v: unknown) => unknown) => {
      const data = run();
      return Promise.resolve(single ? { data: data[0] ?? null, error: null } : { data, error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: query }), supabaseServer: vi.fn() }));
const audits: Row[] = [];
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn(async (e: Row) => void audits.push(e)) }));
vi.mock("@/modules/operations/service", () => ({ notify: vi.fn(async () => undefined) }));
vi.mock("@/lib/shared/afterResponse", () => ({ runAfterResponse: vi.fn() }));
const executeConnectorWrite = vi.fn();
const startVerificationSync = vi.fn(async () => undefined);
vi.mock("@/modules/integrations/service", () => ({
  executeConnectorWrite: (...args: unknown[]) => executeConnectorWrite(...args),
  startVerificationSync: (...args: unknown[]) => startVerificationSync(...(args as [])),
  connectionCanWrite: vi.fn(async () => true),
}));

import { releaseLostConnectorRuns, runConnectorFulfilment } from "./connectorFulfilment";

const T = "t1";
const OTHER = "t2";
const plan = { taskId: "task-1", operation: "disable_account" as const, integrationId: "conn-1", target: { account: "u-1" } };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  audits.length = 0;
  executeConnectorWrite.mockReset();
  startVerificationSync.mockClear();
  db.identities = [];
  db.access_fulfilment_tasks = [
    { id: "task-1", tenant_id: T, kind: "disable_account", status: "open", connector_status: null, connector_attempts: 0, access_grant_id: null, removal_grant_id: null, request_id: null, assignee_identity_id: null },
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a connector run that never reported back (WID-H02)", () => {
  it("goes back to its owner as unclear, and the system is read again before any retry", async () => {
    db.access_fulfilment_tasks = [
      { id: "lost", tenant_id: T, status: "open", connector_status: "running", connector_started_at: minutesAgo(20), connector_integration_id: "conn-1", assignee_identity_id: null },
      { id: "recent", tenant_id: T, status: "open", connector_status: "running", connector_started_at: minutesAgo(5), connector_integration_id: "conn-1", assignee_identity_id: null },
      { id: "elsewhere", tenant_id: OTHER, status: "open", connector_status: "running", connector_started_at: minutesAgo(20), connector_integration_id: "conn-9", assignee_identity_id: null },
    ];
    expect(await releaseLostConnectorRuns(T)).toBe(1);
    const [lost, recent, elsewhere] = db.access_fulfilment_tasks;
    expect(lost).toMatchObject({ connector_status: "failed", connector_error: expect.stringMatching(/did not report back.*reading the system again/) });
    expect(lost.connector_uncertain_at).toEqual(expect.any(String));
    expect(startVerificationSync).toHaveBeenCalledWith(T, "conn-1");
    // Still within its time, and another organization's: untouched.
    expect(recent.connector_status).toBe("running");
    expect(elsewhere.connector_status).toBe("running");
    expect(audits).toEqual([expect.objectContaining({ tenantId: T, action: "access.fulfilment_task_connector_failed", metadata: { error: "LOST_RUN", uncertain: true } })]);
  });
});

describe("a change whose outcome is unclear (WID-H02)", () => {
  it("is sent once, never again, and the system is read", async () => {
    executeConnectorWrite.mockResolvedValue({ id: "w1", status: "failed", error: "The request timed out after 20 s", retryable: false, uncertain: true });
    expect(await runConnectorFulfilment(T, plan)).toBe("failed");
    expect(executeConnectorWrite).toHaveBeenCalledTimes(1);
    const [task] = db.access_fulfilment_tasks;
    expect(task).toMatchObject({ status: "open", connector_status: "failed", connector_attempts: 1, connector_error: expect.stringMatching(/may have made this change/) });
    expect(task.connector_uncertain_at).toEqual(expect.any(String));
    expect(startVerificationSync).toHaveBeenCalledWith(T, "conn-1");
  });

  it("a change the system did not take is retried with the same task key, a new attempt key each time", async () => {
    vi.useFakeTimers();
    executeConnectorWrite
      .mockResolvedValueOnce({ id: "w1", status: "failed", error: "HTTP 429", retryable: true })
      .mockResolvedValueOnce({ id: "w2", status: "succeeded", error: null });
    const done = runConnectorFulfilment(T, plan);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await done).toBe("succeeded");
    const inputs = executeConnectorWrite.mock.calls.map((c) => c[3] as { idempotencyKey: string; taskKey: string });
    expect(inputs.map((i) => i.taskKey)).toEqual(["fulfil:task-1", "fulfil:task-1"]);
    expect(inputs.map((i) => i.idempotencyKey)).toEqual(["fulfil:task-1:1", "fulfil:task-1:2"]);
    expect(db.access_fulfilment_tasks[0]).toMatchObject({ status: "completed", connector_status: "succeeded", connector_uncertain_at: null });
  });

  it("a task the connector is already running is never run again (a restarted process cannot double it)", async () => {
    db.access_fulfilment_tasks[0].connector_status = "running";
    expect(await runConnectorFulfilment(T, plan)).toBe("busy");
    expect(executeConnectorWrite).not.toHaveBeenCalled();
  });

  it("another organization's task is never claimed", async () => {
    expect(await runConnectorFulfilment(OTHER, plan)).toBe("busy");
    expect(executeConnectorWrite).not.toHaveBeenCalled();
  });
});
