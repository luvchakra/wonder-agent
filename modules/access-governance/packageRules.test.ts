// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assignmentExpiry, assignmentStatus, birthrightApplies, birthrightNeedsReapproval, birthrightTransition, checkEligibility, contentsDigest, itemOnEnd, packageRisk, validatePackageInput } from "./packageRules";

describe("checkEligibility", () => {
  const pkg = { eligibleIdentityTypes: ["HUMAN"], eligibleDepartments: ["Finance"] };
  it("admits an active person of the right department (exact name)", () => {
    expect(checkEligibility(pkg, { identityType: "HUMAN", department: " Finance ", status: "active" })).toEqual({ eligible: true, reasons: [] });
    expect(checkEligibility(pkg, { identityType: "HUMAN", department: "finance", status: "active" }).eligible).toBe(false);
  });
  it("gives every reason it does not", () => {
    const r = checkEligibility(pkg, { identityType: "AI_AGENT", department: null, status: "inactive" });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toHaveLength(3);
    expect(r.reasons.join(" ")).toMatch(/not active.*people.*Finance/);
  });
  it("any department when none is listed; AI agents when listed", () => {
    expect(checkEligibility({ eligibleIdentityTypes: ["AI_AGENT"], eligibleDepartments: [] }, { identityType: "AI_AGENT", department: null, status: "active" }).eligible).toBe(true);
  });
});

describe("packageRisk and assignment state", () => {
  it("is the worst included risk", () => {
    expect(packageRisk([])).toBe("low");
    expect(packageRisk(["low", "high", "medium"])).toBe("high");
  });
  it("shows a failure, is active only when all is fulfilled, keeps an end state", () => {
    expect(assignmentStatus("provisioning", ["fulfilled", "failed"])).toBe("partially_failed");
    expect(assignmentStatus("provisioning", ["fulfilled", "pending"])).toBe("provisioning");
    expect(assignmentStatus("provisioning", ["fulfilled", "fulfilled"])).toBe("active");
    expect(assignmentStatus("partially_failed", ["fulfilled", "fulfilled"])).toBe("active");
    expect(assignmentStatus("expired", ["fulfilled"])).toBe("expired");
  });
  it("turns fulfilled access into revocation work when an assignment ends", () => {
    expect(itemOnEnd("fulfilled")).toBe("revoke_pending");
    expect(itemOnEnd("pending")).toBe("revoked");
    expect(itemOnEnd("failed")).toBe("revoked");
  });
});

describe("assignmentExpiry", () => {
  const now = new Date("2026-09-26T00:00:00Z");
  it("uses the requested days, else the package default, else never; never past the maximum", () => {
    expect(assignmentExpiry(now, 10, { defaultDurationDays: 30, maxDurationDays: 90 })).toEqual({ days: 10, expiresAt: "2026-10-06T00:00:00.000Z" });
    expect(assignmentExpiry(now, null, { defaultDurationDays: 30, maxDurationDays: 90 }).days).toBe(30);
    expect(assignmentExpiry(now, null, { defaultDurationDays: null, maxDurationDays: null })).toEqual({ days: null, expiresAt: null });
    expect(() => assignmentExpiry(now, 120, { defaultDurationDays: 30, maxDurationDays: 90 })).toThrow(/At most 90 days/);
  });
});

describe("validatePackageInput", () => {
  it("maps fields and refuses bad ones", () => {
    expect(validatePackageInput({ name: " Finance Analyst ", eligibleIdentityTypes: ["HUMAN", "HUMAN"], eligibleDepartments: "Finance, ,Accounting", approval: "owner_approval" }, false)).toEqual({
      name: "Finance Analyst",
      eligible_identity_types: ["HUMAN"],
      eligible_departments: ["Finance", "Accounting"],
      approval: "owner_approval",
    });
    expect(() => validatePackageInput({ name: "" }, false)).toThrow(/name/);
    expect(() => validatePackageInput({ name: "x", eligibleIdentityTypes: [] }, false)).toThrow(/eligibleIdentityTypes/);
    expect(() => validatePackageInput({ name: "x", eligibleIdentityTypes: ["ROBOT"] }, false)).toThrow(/eligibleIdentityTypes/);
    expect(() => validatePackageInput({ approvalTimeoutDays: 0 }, true)).toThrow(/approvalTimeoutDays/);
    expect(() => validatePackageInput({ maxDurationDays: 10, defaultDurationDays: 20 }, true)).toThrow(/defaultDurationDays/);
  });
});

describe("contentsDigest", () => {
  it("ignores order and changes with contents or privilege", () => {
    const a = { applicationId: "a", entitlementId: "e1", privilegeLevel: "standard" };
    const b = { applicationId: "b", entitlementId: null, privilegeLevel: null };
    expect(contentsDigest([a, b])).toBe(contentsDigest([b, a]));
    expect(contentsDigest([a])).not.toBe(contentsDigest([a, b]));
    expect(contentsDigest([a])).not.toBe(contentsDigest([{ ...a, privilegeLevel: "admin" }]));
  });
});

describe("birthright (owner decision, 13 October 2026)", () => {
  it("takes two administrators: one asks, someone else approves", () => {
    expect(birthrightTransition({ status: "off", requestedBy: null }, "request", "u1")).toEqual({ ok: true, next: "pending" });
    expect(birthrightTransition({ status: "pending", requestedBy: "u1" }, "approve", "u1")).toMatchObject({ ok: false, code: "FOUR_EYES" });
    expect(birthrightTransition({ status: "pending", requestedBy: "u1" }, "approve", "u2")).toEqual({ ok: true, next: "on" });
  });
  it("refuses steps out of order, and one person may turn it off", () => {
    expect(birthrightTransition({ status: "off", requestedBy: null }, "approve", "u2")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(birthrightTransition({ status: "on", requestedBy: "u1" }, "request", "u2")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(birthrightTransition({ status: "pending", requestedBy: "u1" }, "request", "u2")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(birthrightTransition({ status: "on", requestedBy: "u1" }, "off", "u1")).toEqual({ ok: true, next: "off" });
    expect(birthrightTransition({ status: "off", requestedBy: null }, "off", "u1")).toMatchObject({ ok: false });
  });
  it("needs approval again when what it includes or who is eligible changes, only while on", () => {
    expect(birthrightNeedsReapproval("on", { resources: true })).toBe(true);
    expect(birthrightNeedsReapproval("on", { fields: ["eligible_departments"] })).toBe(true);
    expect(birthrightNeedsReapproval("on", { fields: ["eligible_identity_types"] })).toBe(true);
    expect(birthrightNeedsReapproval("on", { fields: ["description", "name"] })).toBe(false);
    expect(birthrightNeedsReapproval("pending", { resources: true })).toBe(false);
    expect(birthrightNeedsReapproval("off", { fields: ["eligible_departments"] })).toBe(false);
  });
  it("goes only to eligible, active people, from an active package that is on", () => {
    const pkg = { eligibleIdentityTypes: ["HUMAN"], eligibleDepartments: ["Finance"], status: "active", birthrightStatus: "on" as const };
    const ana = { identityType: "HUMAN", department: "Finance", status: "active" };
    expect(birthrightApplies(pkg, ana)).toBe(true);
    expect(birthrightApplies(pkg, { ...ana, department: "Sales" })).toBe(false);
    expect(birthrightApplies(pkg, { ...ana, status: "inactive" })).toBe(false);
    expect(birthrightApplies({ ...pkg, birthrightStatus: "pending" }, ana)).toBe(false);
    expect(birthrightApplies({ ...pkg, status: "retired" }, ana)).toBe(false);
  });
});
