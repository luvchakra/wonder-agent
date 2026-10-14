import { describe, expect, it } from "vitest";
import { decisionRefusal, diffFields, fourEyesRequired, isStale } from "./governanceChangeRules";

describe("approved governance changes (ACCESS-P0-35)", () => {
  it("needs a second person only with two or more Tenant Administrators", () => {
    expect(fourEyesRequired(1)).toBe(false);
    expect(fourEyesRequired(2)).toBe(true);
    expect(fourEyesRequired(5)).toBe(true);
  });

  it("lists only what the proposal changes", () => {
    expect(diffFields({ auto_approve: true, max_duration_days: 30, name: "P" }, { auto_approve: false, max_duration_days: 30, name: "P" })).toEqual([{ field: "auto_approve", before: true, after: false }]);
    expect(diffFields(null, { name: "New" })).toEqual([{ field: "name", before: null, after: "New" }]);
    expect(diffFields({ x: null }, { x: undefined })).toEqual([]);
  });

  it("refuses the proposer, a decided change and an unknown decision", () => {
    const change = { status: "pending", requestedBy: "u1" };
    expect(decisionRefusal(change, "u1", "approved")?.code).toBe("SELF_APPROVAL");
    expect(decisionRefusal({ ...change, status: "approved" }, "u2", "approved")?.code).toBe("INVALID_TRANSITION");
    expect(decisionRefusal(change, "u2", "maybe")?.code).toBe("VALIDATION_FAILED");
    expect(decisionRefusal(change, "u2", "rejected")).toBeNull();
  });

  it("is stale once the object moved on", () => {
    expect(isStale(3, 3)).toBe(false);
    expect(isStale(3, 4)).toBe(true);
    expect(isStale(null, null)).toBe(false);
    expect(isStale(null, 1)).toBe(true);
  });
});
