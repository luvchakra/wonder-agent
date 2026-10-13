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
    lte: (c: string, v: string) => (filters.push((r) => typeof r[c] === "string" && (r[c] as string) <= v), b),
    not: (c: string, _op: "is", v: null) => (filters.push((r) => (r[c] ?? null) !== v), b),
    maybeSingle: () => ((single = true), b),
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
let deciderIdentity: string | null = "reviewer-1";
vi.mock("@/modules/agent-identity/service", () => ({ getIdentityForUser: vi.fn(async () => (deciderIdentity ? { id: deciderIdentity } : null)) }));

import { decideRogueFinding, listAccessFindings, syncRogueAccessFindings } from "./accessFindings";

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
  deciderIdentity = "reviewer-1";
});

describe("syncRogueAccessFindings", () => {
  it("opens one finding per rogue grant, with the grant as evidence, for a person's account (plain rogue access is medium)", async () => {
    db.identities = [{ id: "person-1", tenant_id: T, identity_type: "HUMAN", status: "active" }];
    const out = await syncRogueAccessFindings(T, [rogue()]);
    expect(out).toEqual({ created: 1, resolved: 0, failed: 0 });
    expect(db.risk_findings[0]).toMatchObject({
      tenant_id: T,
      category: "rogue_access",
      severity: "medium",
      risk_score: 50,
      agent_id: null,
      identity_id: "person-1",
      account_id: "acct-1",
      subject_key: "acct-1|ent-1",
      title: "Rogue access: alice in SAP → Finance",
    });
    expect(db.risk_evidence[0]).toMatchObject({ evidence_type: "access_grant", reference_id: "grant-1" });
    expect(audits[0]).toMatchObject({ action: "risk.access_findings_synced", actorType: "system", tenantId: T });
  });

  it("RISK-P0-13: severity comes from the facts (admin entitlement held by a leaver is critical), never from another tenant's rows", async () => {
    db.entitlements = [
      { id: "ent-1", tenant_id: T, privilege_level: "admin", data_classification: null },
      { id: "ent-1", tenant_id: "other", privilege_level: "standard", data_classification: null },
    ];
    db.identities = [{ id: "person-1", tenant_id: T, identity_type: "HUMAN", status: "terminated" }];
    await syncRogueAccessFindings(T, [rogue()]);
    expect(db.risk_findings[0]).toMatchObject({ severity: "critical", risk_score: 100 });
    expect(db.risk_findings[0].reasons).toEqual(expect.arrayContaining(["Administrative privilege", "Held by an identity that is terminated"]));
  });

  it("RISK-P0-13: an open finding is re-scored when its facts change, and the change is audited", async () => {
    db.identities = [{ id: "person-1", tenant_id: T, identity_type: "HUMAN", status: "active" }];
    await syncRogueAccessFindings(T, [rogue()]);
    expect(db.risk_findings[0].severity).toBe("medium");
    db.identities[0].status = "terminated";
    audits.length = 0;
    const out = await syncRogueAccessFindings(T, [rogue()]);
    expect(out).toEqual({ created: 0, resolved: 0, failed: 0 });
    expect(db.risk_findings[0]).toMatchObject({ severity: "high", risk_score: 75 });
    expect(audits[0]).toMatchObject({ action: "risk.access_findings_synced", metadata: expect.objectContaining({ rescored: [db.risk_findings[0].id] }) });
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

describe("rogue-access decisions (WID-H04)", () => {
  const FID = "11111111-1111-4111-8111-111111111111";
  const now = new Date("2026-10-12T10:00:00Z");
  const seed = (over: Row = {}) => {
    db.risk_findings = [{ id: FID, tenant_id: T, category: "rogue_access", status: "open", identity_id: "person-1", account_id: "acct-1", subject_key: "acct-1|ent-1", access_grant_id: "grant-1", ...over }];
  };

  it("an exception records who, why and until when, and is audited", async () => {
    seed();
    const f = await decideRogueFinding(T, "user-9", FID, { outcome: "exception", reason: "Month-end close", until: "2026-11-01" }, now);
    expect(f.status).toBe("exception");
    expect(db.risk_findings[0]).toMatchObject({ status: "exception", exception_until: "2026-11-01T23:59:59.000Z", decided_by: "user-9", decision_reason: "Month-end close" });
    expect(audits.at(-1)).toMatchObject({ action: "risk.access_finding_decided", metadata: { outcome: "exception" } });
    // WID-H07: the reason is on the finding; the audit event hands it over as typed text (fingerprinted by writeAudit), never as metadata.
    expect(audits.at(-1)).toMatchObject({ typedText: { reason: "Month-end close" } });
    expect(JSON.stringify((audits.at(-1) as Row).metadata)).not.toContain("Month-end");
  });

  it("the account's owner cannot decide, and another organization's finding is not found", async () => {
    seed();
    deciderIdentity = "person-1";
    await expect(decideRogueFinding(T, "user-1", FID, { outcome: "false_positive", reason: "mine" }, now)).rejects.toMatchObject({ code: "SELF_DECISION" });
    deciderIdentity = "reviewer-1";
    await expect(decideRogueFinding("t2", "user-9", FID, { outcome: "false_positive", reason: "x" }, now)).rejects.toMatchObject({ code: "FINDING_NOT_FOUND" });
    expect(db.risk_findings[0].status).toBe("open");
  });

  it("a false positive is not flagged again for the same grant; a new grant on the same access is", async () => {
    seed();
    await decideRogueFinding(T, "user-9", FID, { outcome: "false_positive", reason: "Granted by payroll" }, now);
    expect(await syncRogueAccessFindings(T, [rogue()])).toMatchObject({ created: 0 });
    expect(await syncRogueAccessFindings(T, [rogue({ accessGrantId: "grant-2" })])).toMatchObject({ created: 1 });
  });

  it("an ended exception reopens on the next sync, and is not duplicated while it lasts", async () => {
    seed({ status: "exception", exception_until: "2026-10-01T00:00:00Z" });
    await syncRogueAccessFindings(T, [rogue()]);
    expect(db.risk_findings.filter((f) => f.category === "rogue_access")).toHaveLength(1);
    expect(db.risk_findings[0]).toMatchObject({ status: "open", exception_until: null });
    expect(audits.some((a) => a.action === "risk.access_finding_exception_ended")).toBe(true);
  });
});
