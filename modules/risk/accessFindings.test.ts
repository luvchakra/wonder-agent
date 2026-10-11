// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RogueAccess } from "@/lib/shared/types/risk";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let seq = 0;
let conflictOnInsert = false;

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: "select" } | { kind: "insert"; row: Row } | { kind: "update"; set: Row } = { kind: "select" };
  let single = false;
  const rows = () => (db[table] ??= []);
  const run = (): { data: unknown; error: { code: string; message: string } | null } => {
    if (op.kind === "insert") {
      if (conflictOnInsert && table === "risk_findings") return { data: null, error: { code: "23505", message: "duplicate" } };
      const row = { id: `${table}-${++seq}`, status: "open", ...op.row };
      rows().push(row);
      return { data: single ? row : [row], error: null };
    }
    const matched = rows().filter((r) => filters.every((f) => f(r)));
    if (op.kind === "update") for (const r of matched) Object.assign(r, op.set);
    return { data: single ? (matched[0] ?? null) : matched, error: null };
  };
  const b = {
    select: () => b,
    insert: (row: Row) => ((op = { kind: "insert", row }), b),
    update: (set: Row) => ((op = { kind: "update", set }), b),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    order: () => b,
    limit: () => b,
    range: () => b,
    single: () => ((single = true), b),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
  };
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: query }) }));
const audits: Row[] = [];
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn(async (e: Row) => void audits.push(e)) }));

import { listAccessFindings, syncRogueAccessFindings } from "./accessFindings";

const T = "t1";
const rogue = (over: Partial<RogueAccess> = {}): RogueAccess => ({
  accountId: "acct-1",
  entitlementId: "ent-1",
  accessGrantId: "grant-1",
  applicationId: "app-1",
  identityId: "person-1",
  agentId: null,
  label: "alice in SAP → Finance",
  firstSeenAt: "2026-10-08T00:00:00Z",
  baselineAt: "2026-10-05T00:00:00Z",
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  audits.length = 0;
  conflictOnInsert = false;
});

describe("syncRogueAccessFindings", () => {
  it("opens one high finding per rogue grant, with the grant as evidence, for a person's account", async () => {
    const out = await syncRogueAccessFindings(T, [rogue()]);
    expect(out).toEqual({ created: 1, resolved: 0, failed: 0 });
    expect(db.risk_findings[0]).toMatchObject({
      tenant_id: T,
      category: "rogue_access",
      severity: "high",
      agent_id: null,
      identity_id: "person-1",
      account_id: "acct-1",
      subject_key: "acct-1|ent-1",
      title: "Rogue access: alice in SAP → Finance",
    });
    expect(db.risk_evidence[0]).toMatchObject({ evidence_type: "access_grant", reference_id: "grant-1" });
    expect(audits[0]).toMatchObject({ action: "risk.access_findings_synced", actorType: "system", tenantId: T });
  });

  it("is idempotent: the same rogue set again opens nothing new", async () => {
    await syncRogueAccessFindings(T, [rogue()]);
    const again = await syncRogueAccessFindings(T, [rogue()]);
    expect(again).toEqual({ created: 0, resolved: 0, failed: 0 });
    expect(db.risk_findings).toHaveLength(1);
  });

  it("resolves the finding once the access is no longer rogue (approved, removed or revoked)", async () => {
    await syncRogueAccessFindings(T, [rogue(), rogue({ entitlementId: "ent-2", accessGrantId: "grant-2" })]);
    const out = await syncRogueAccessFindings(T, [rogue({ entitlementId: "ent-2", accessGrantId: "grant-2" })]);
    expect(out).toEqual({ created: 0, resolved: 1, failed: 0 });
    expect(db.risk_findings.find((f) => f.subject_key === "acct-1|ent-1")).toMatchObject({ status: "resolved", resolution_type: "verified_fixed" });
    expect(db.risk_findings.find((f) => f.subject_key === "acct-1|ent-2")?.status).toBe("open");
  });

  it("an account-level rogue (no entitlement) has its own key and no grant evidence", async () => {
    await syncRogueAccessFindings(T, [rogue({ entitlementId: null, accessGrantId: null, label: "bob in SAP" })]);
    expect(db.risk_findings[0].subject_key).toBe("acct-1|");
    expect(db.risk_evidence ?? []).toHaveLength(0);
  });

  it("a finding another refresh opened first (unique conflict) is not a failure", async () => {
    conflictOnInsert = true;
    expect(await syncRogueAccessFindings(T, [rogue()])).toEqual({ created: 0, resolved: 0, failed: 0 });
  });

  it("never touches another organization's findings", async () => {
    db.risk_findings = [{ id: "other", tenant_id: "t2", category: "rogue_access", status: "open", subject_key: "acct-9|" }];
    await syncRogueAccessFindings(T, []);
    expect(db.risk_findings[0].status).toBe("open");
    expect(await listAccessFindings(T)).toEqual([]);
  });
});
