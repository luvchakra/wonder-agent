// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Filter = [string, ...unknown[]];
let policies: Array<Record<string, unknown>> = [];
let priorAudit: { action: string; tenant_id: string } | null = null;
const auditQueries: Filter[][] = [];

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({
    from: (table: string) => {
      const filters: Filter[] = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (...a: unknown[]) => (filters.push(["eq", ...a]), chain),
        in: (...a: unknown[]) => (filters.push(["in", ...a]), chain),
        or: (...a: unknown[]) => (filters.push(["or", ...a]), chain),
        limit: () => chain,
        returns: async () => ({ data: policies, error: null }),
        maybeSingle: async () => {
          if (table === "audit_logs") auditQueries.push(filters);
          return { data: priorAudit, error: null };
        },
      };
      return chain;
    },
  }),
}));
const audits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: async (e: Record<string, unknown>) => void audits.push(e) }));

import { checkSoD, enforceSoD } from "./sod";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const sodPolicy = (action: "alert" | "block") => ({
  id: "p1",
  tenant_id: T,
  action,
  policy_rules: [{ rule_type: "rbac", condition: { conflictingActions: ["access.request_submitted", "access.request_approved"] } }],
});

beforeEach(() => {
  policies = [];
  priorAudit = null;
  auditQueries.length = 0;
  audits.length = 0;
});

describe("checkSoD (ACCESS-P0-14, codebase-map D5)", () => {
  it("finds the conflict when the agent is the audit row's object or in its metadata", async () => {
    policies = [sodPolicy("block")];
    priorAudit = { action: "access.request_submitted", tenant_id: T };
    expect(await checkSoD(T, U, "access.request_approved", A)).toEqual({ conflict: true, policyId: "p1", blocking: true, conflictingAction: "access.request_submitted" });
    const q = auditQueries[0];
    expect(q).toContainEqual(["eq", "tenant_id", T]);
    expect(q).toContainEqual(["eq", "actor_id", U]);
    expect(q).toContainEqual(["in", "action", ["access.request_submitted"]]);
    expect(q).toContainEqual(["or", `object_id.eq.${A},metadata->>agentId.eq.${A}`]);
  });

  it("no rule for this action, a non-rbac rule, or another tenant's policy: no conflict and no audit read", async () => {
    policies = [
      { ...sodPolicy("block"), policy_rules: [{ rule_type: "abac", condition: { conflictingActions: ["access.request_submitted", "access.request_approved"] } }] },
      { ...sodPolicy("block"), tenant_id: "other" },
    ];
    priorAudit = { action: "access.request_submitted", tenant_id: T };
    expect(await checkSoD(T, U, "access.request_approved", A)).toEqual({ conflict: false });
    policies = [sodPolicy("block")];
    expect(await checkSoD(T, U, "access.grant_created", A)).toEqual({ conflict: false });
    expect(auditQueries).toEqual([]);
  });

  it("an advisory policy never hides a blocking one that also matches", async () => {
    policies = [{ ...sodPolicy("alert"), id: "flag" }, { ...sodPolicy("block"), id: "block" }];
    priorAudit = { action: "access.request_submitted", tenant_id: T };
    expect(await checkSoD(T, U, "access.request_approved", A)).toMatchObject({ conflict: true, policyId: "block", blocking: true });
    policies = [{ ...sodPolicy("alert"), id: "flag" }];
    expect(await checkSoD(T, U, "access.request_approved", A)).toMatchObject({ conflict: true, policyId: "flag", blocking: false });
  });

  it("never builds a filter from a malformed id", async () => {
    policies = [sodPolicy("block")];
    expect(await checkSoD(T, U, "access.request_approved", "x,tenant_id.eq.other")).toEqual({ conflict: false });
    expect(auditQueries).toEqual([]);
  });
});

describe("enforceSoD", () => {
  it("a blocking policy refuses the action with 409 and audits the refusal", async () => {
    policies = [sodPolicy("block")];
    priorAudit = { action: "access.request_submitted", tenant_id: T };
    await expect(enforceSoD(T, U, "access.request_approved", A)).rejects.toMatchObject({ status: 409, code: "SOD_CONFLICT" });
    expect(audits).toEqual([expect.objectContaining({ action: "access.sod_conflict", outcome: "failure", metadata: expect.objectContaining({ blocking: true, attemptedAction: "access.request_approved" }) })]);
  });

  it("an advisory policy lets it proceed and records the conflict", async () => {
    policies = [sodPolicy("alert")];
    priorAudit = { action: "access.request_submitted", tenant_id: T };
    await expect(enforceSoD(T, U, "access.request_approved", A)).resolves.toMatchObject({ conflict: true, blocking: false });
    expect(audits[0]).toMatchObject({ action: "access.sod_conflict", outcome: "success" });
  });

  it("no conflict: nothing recorded", async () => {
    await expect(enforceSoD(T, U, "access.request_approved", A)).resolves.toEqual({ conflict: false });
    expect(audits).toEqual([]);
  });
});
