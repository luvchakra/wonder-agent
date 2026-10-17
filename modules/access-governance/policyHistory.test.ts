import { describe, expect, it } from "vitest";
import { describePolicyChange, describeRule, policyHistory } from "./policyHistory";

const sod = { ruleType: "rbac", condition: { conflictingActions: ["approve_payment", "create_vendor"] } };

describe("ACCESS-P0-35: policy history", () => {
  it("names an SoD rule by its conflicting actions", () => {
    expect(describeRule(sod)).toBe("separation of duties: approve_payment vs create_vendor");
    expect(describeRule({ ruleType: "time", condition: {} })).toBe("time rule");
  });

  it("lists changed fields and added or removed rules", () => {
    expect(describePolicyChange({ name: "A", severity: "high", rules: [] }, { name: "A", severity: "critical", rules: [sod] })).toEqual([
      "Severity: high → critical",
      "Rule added: separation of duties: approve_payment vs create_vendor",
    ]);
    expect(describePolicyChange({ rules: [sod] }, { rules: [] })).toEqual(["Rule removed: separation of duties: approve_payment vs create_vendor"]);
  });

  it("claims no rule change for a version saved before rules were kept", () => {
    expect(describePolicyChange({ name: "A" }, { name: "A", rules: [sod] })).toEqual([]);
  });

  it("pairs each saved state with the one after it, newest first", () => {
    const h = policyHistory(
      [
        { version: 1, snapshot: { status: "draft", rules: [] }, changedBy: "u1", changedAt: "2026-10-17T08:00:00Z" },
        { version: 2, snapshot: { status: "active", rules: [] }, changedBy: "u2", changedAt: "2026-10-17T09:00:00Z" },
      ],
      { version: 3, status: "active", rules: [sod] },
    );
    expect(h.map((e) => [e.version, e.changedBy, e.changes])).toEqual([
      [3, "u2", ["Rule added: separation of duties: approve_payment vs create_vendor"]],
      [2, "u1", ["Status: draft → active"]],
    ]);
  });
});
