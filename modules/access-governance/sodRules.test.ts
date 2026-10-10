// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: async () => ({}) }));

const { sodRulesFrom, toSoDConflict } = await import("./sodRules");

const T = "aaaaaaaa-0000-0000-0000-000000000001";
const policy = (over: Record<string, unknown>) => ({ id: "p1", tenant_id: T, name: "Requester is not approver", status: "active", action: "block", policy_rules: [], ...over });
const rule = (condition: unknown, rule_type = "rbac") => ({ id: `r-${Math.random()}`, rule_type, condition, created_at: "2026-10-10T09:00:00Z" });

describe("sodRulesFrom", () => {
  it("reads an rbac rule with two or more conflicting actions as an SoD rule, blocking when the policy blocks", () => {
    const [r] = sodRulesFrom(T, [policy({ policy_rules: [rule({ conflictingActions: ["access.requested", "access.approved"] })] }) as never]);
    expect(r).toMatchObject({ policyId: "p1", blocking: true, policyStatus: "active", conflictingActions: ["access.requested", "access.approved"] });
  });

  it("leaves out other rule types, fewer than two actions, non-strings and duplicates", () => {
    const rows = [
      policy({
        policy_rules: [
          rule({ conflictingActions: ["a", "b"] }, "abac"),
          rule({ conflictingActions: ["a"] }),
          rule({ conflictingActions: ["a", "a", 3, null] }),
          rule({ field: "x", op: "eq", value: 1 }),
          rule(null),
        ],
      }),
    ];
    expect(sodRulesFrom(T, rows as never)).toEqual([]);
  });

  it("is advisory unless the policy blocks, and never returns another organization's rule", () => {
    const rows = [
      policy({ id: "p2", action: "flag", policy_rules: [rule({ conflictingActions: ["a", "b"] })] }),
      policy({ id: "p3", tenant_id: "bbbbbbbb-0000-0000-0000-000000000002", policy_rules: [rule({ conflictingActions: ["a", "b"] })] }),
    ];
    const out = sodRulesFrom(T, rows as never);
    expect(out.map((r) => [r.policyId, r.blocking])).toEqual([["p2", false]]);
  });

  it("lists rules of policies in effect first, then drafts, then the rest", () => {
    const rows = [
      policy({ id: "d", name: "B", status: "disabled", policy_rules: [rule({ conflictingActions: ["a", "b"] })] }),
      policy({ id: "r", name: "C", status: "draft", policy_rules: [rule({ conflictingActions: ["a", "b"] })] }),
      policy({ id: "a", name: "A", status: "active", policy_rules: [rule({ conflictingActions: ["a", "b"] })] }),
    ];
    expect(sodRulesFrom(T, rows as never).map((r) => r.policyId)).toEqual(["a", "r", "d"]);
  });
});

describe("toSoDConflict", () => {
  const base = { id: "e1", createdAt: "2026-10-10T10:00:00Z", actorId: "u1", objectId: "ag1", outcome: "success" };
  it("reads what enforceSoD() audited", () => {
    expect(toSoDConflict({ ...base, outcome: "failure", metadata: { agentId: "ag1", attemptedAction: "access.approved", conflictingAction: "access.requested", policyId: "p1", blocking: true } })).toEqual({
      id: "e1",
      at: "2026-10-10T10:00:00Z",
      actorId: "u1",
      agentId: "ag1",
      attemptedAction: "access.approved",
      conflictingAction: "access.requested",
      policyId: "p1",
      blocked: true,
    });
  });

  it("is an advisory conflict when it went ahead, and tolerates missing metadata", () => {
    expect(toSoDConflict({ ...base, metadata: {} })).toMatchObject({ blocked: false, agentId: "ag1", attemptedAction: null, policyId: null });
  });
});
