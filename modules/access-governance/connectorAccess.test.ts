// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A tiny in-memory stand-in for the service-role client: enough of the query builder for connectorAccess.ts. */
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let seq = 0;

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: "select" } | { kind: "insert"; rows: Row[] } | { kind: "update"; set: Row } = { kind: "select" };
  let range: [number, number] | null = null;
  let single = false;
  const rows = () => (db[table] ??= []);
  const run = () => {
    if (op.kind === "insert") {
      const inserted = op.rows.map((r) => ({ id: `${table}-${++seq}`, ...r }));
      rows().push(...inserted);
      return inserted;
    }
    const matched = rows().filter((r) => filters.every((f) => f(r)));
    if (op.kind === "update") {
      for (const r of matched) Object.assign(r, op.set);
      return matched;
    }
    return range ? matched.slice(range[0], range[1] + 1) : matched;
  };
  const b = {
    select: () => b,
    insert: (r: Row | Row[]) => ((op = { kind: "insert", rows: Array.isArray(r) ? r : [r] }), b),
    update: (set: Row) => ((op = { kind: "update", set }), b),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
    order: () => b,
    limit: () => b,
    range: (from: number, to: number) => ((range = [from, to]), b),
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
const ledger = vi.fn(async () => ({ recorded: 0, changed: 0 }));
vi.mock("./ledger", () => ({ refreshAccessLedger: () => ledger() }));
const staged: Record<string, { externalId: string; raw: Row; normalized: Row }[]> = {};
vi.mock("@/modules/integrations/service", () => ({
  getNormalizedObjectsAsSystem: vi.fn(async (_t: string, _i: string, kind: string) => staged[kind] ?? []),
}));

import { reconcileApplicationAccess, reconcileApplicationAccessAsSystem } from "./connectorAccess";

const T = "t1";
const APP = "11111111-1111-4111-8111-111111111111";
const INT = "c1";

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  audits.length = 0;
  ledger.mockClear();
  db.applications = [{ id: APP, tenant_id: T, name: "LDAP" }];
  db.application_onboardings = [{ tenant_id: T, application_id: APP, promoted_config: { integrationId: INT, accountIdentifierField: "username", entitlementSource: "connector" } }];
  db.accounts = [
    { id: "acct-alice", tenant_id: T, application_id: APP, external_account_ref: "alice", account_name: "alice" },
    { id: "acct-bob", tenant_id: T, application_id: APP, external_account_ref: "bob", account_name: "bob" },
  ];
  db.entitlements = [];
  db.access_grants = [];
  staged.account = [
    { externalId: "uid=alice", raw: { username: "alice" }, normalized: {} },
    { externalId: "uid=bob", raw: { username: "bob" }, normalized: {} },
  ];
  staged.entitlement = [
    { externalId: "cn=finance", raw: {}, normalized: { name: "Finance" } },
    { externalId: "cn=hr", raw: {}, normalized: { name: "HR" } },
  ];
  staged.access_grant = [
    { externalId: "g1", raw: {}, normalized: { accountExternalId: "uid=alice", entitlementExternalId: "cn=finance" } },
    { externalId: "g2", raw: {}, normalized: { accountExternalId: "uid=bob", entitlementExternalId: "cn=hr" } },
  ];
});

describe("reconcileApplicationAccess", () => {
  it("a preview changes nothing and reports what an apply would do", async () => {
    const run = await reconcileApplicationAccess(T, "u1", APP, { dryRun: true });
    expect(run.counts).toMatchObject({ entitlements: { added: 2 }, grants: { added: 2 } });
    expect(db.entitlements).toHaveLength(0);
    expect(db.access_grants).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("an apply of that preview writes exactly it, with the connector as source, audits and refreshes the ledger", async () => {
    const preview = await reconcileApplicationAccess(T, "u1", APP, { dryRun: true });
    const run = await reconcileApplicationAccess(T, "u1", APP, { dryRun: false, previewRunId: preview.id });
    expect(run.counts).toEqual(preview.counts);
    expect(db.entitlements.map((e) => [e.name, e.external_ref, e.source_integration_id, e.tenant_id])).toEqual([
      ["Finance", "cn=finance", INT, T],
      ["HR", "cn=hr", INT, T],
    ]);
    const finance = db.entitlements.find((e) => e.external_ref === "cn=finance")!.id;
    expect(db.access_grants.find((g) => g.account_id === "acct-alice")).toMatchObject({ entitlement_id: finance, source_integration_id: INT, tenant_id: T, grant_type: "direct" });
    expect(audits[0]).toMatchObject({ action: "access.reconciled", actorId: "u1", actorType: "user", outcome: "success" });
    expect(ledger).toHaveBeenCalledTimes(1);
  });

  it("refuses an apply when the source changed since the preview, writing nothing", async () => {
    const preview = await reconcileApplicationAccess(T, "u1", APP, { dryRun: true });
    staged.entitlement.push({ externalId: "cn=ops", raw: {}, normalized: { name: "Ops" } });
    await expect(reconcileApplicationAccess(T, "u1", APP, { dryRun: false, previewRunId: preview.id })).rejects.toMatchObject({ status: 409, code: "PLAN_CHANGED" });
    expect(db.entitlements).toHaveLength(0);
  });

  it("re-running with no source change changes nothing", async () => {
    await reconcileApplicationAccessAsSystem(T, APP, { mode: "full", syncJobId: "j1" });
    const snapshot = JSON.stringify([db.entitlements, db.access_grants]);
    const again = await reconcileApplicationAccessAsSystem(T, APP, { mode: "full", syncJobId: "j2" });
    expect(again.counts).toMatchObject({ entitlements: { added: 0, changed: 0, removed: 0 }, grants: { added: 0, removed: 0, restored: 0, unchanged: 2 } });
    expect(JSON.stringify([db.entitlements, db.access_grants])).toBe(snapshot);
  });

  it("a grant gone from the source is marked, never deleted or revoked, and coming back restores it", async () => {
    await reconcileApplicationAccessAsSystem(T, APP, { mode: "full", syncJobId: "j1" });
    staged.access_grant = staged.access_grant.filter((g) => g.externalId !== "g2");
    const gone = await reconcileApplicationAccessAsSystem(T, APP, { mode: "full", syncJobId: "j2" });
    expect(gone.counts).toMatchObject({ grants: { removed: 1 } });
    const bob = db.access_grants.find((g) => g.account_id === "acct-bob")!;
    expect(bob.missing_from_source_at).toEqual(expect.any(String));
    expect(bob.revoked_at ?? null).toBeNull();
    expect(db.access_grants).toHaveLength(2);

    staged.access_grant.push({ externalId: "g2", raw: {}, normalized: { accountExternalId: "uid=bob", entitlementExternalId: "cn=hr" } });
    const back = await reconcileApplicationAccessAsSystem(T, APP, { mode: "full", syncJobId: "j3" });
    expect(back.counts).toMatchObject({ grants: { restored: 1, added: 0 } });
    expect(bob.missing_from_source_at).toBeNull();
    expect(ledger).toHaveBeenCalledTimes(3);
  });

  it("the system path audits as the system", async () => {
    await reconcileApplicationAccessAsSystem(T, APP, { mode: "full", syncJobId: "j1" });
    expect(audits[0]).toMatchObject({ actorId: null, actorType: "system", correlationId: "j1" });
  });

  it("refuses an application whose entitlements do not come from the connector", async () => {
    db.application_onboardings[0].promoted_config = { integrationId: INT, accountIdentifierField: "username", entitlementSource: "manual" };
    await expect(reconcileApplicationAccess(T, "u1", APP, { dryRun: true })).rejects.toMatchObject({ code: "NOT_CONNECTOR_ENTITLEMENTS" });
  });

  it("never reads another organization's application", async () => {
    db.applications[0].tenant_id = "t2";
    await expect(reconcileApplicationAccess(T, "u1", APP, { dryRun: true })).rejects.toMatchObject({ status: 404 });
  });
});
