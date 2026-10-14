import { describe, expect, it } from "vitest";
import { entitlementRequestRules, typeName, validateEntitlementType } from "./entitlementTypeRules";

describe("validateEntitlementType (ACCESS-P0-33)", () => {
  it("needs a name to create; takes only what is given to change", () => {
    expect(validateEntitlementType({}, true)).toEqual({ error: "name: a type name of at most 100 characters" });
    expect(validateEntitlementType({ name: " Group ", requestMode: "multiple", certifiable: false, defaultDurationDays: 30, maxDurationDays: "90" }, true)).toEqual({
      name: "Group",
      request_mode: "multiple",
      certifiable: false,
      default_duration_days: 30,
      max_duration_days: 90,
    });
    expect(validateEntitlementType({ maxDurationDays: "" }, false)).toEqual({ max_duration_days: null });
  });

  it("refuses bad values, and a default above the maximum, including against what is stored", () => {
    expect(validateEntitlementType({ requestMode: "any" }, false)).toMatchObject({ error: expect.stringMatching(/^requestMode/) });
    expect(validateEntitlementType({ certifiable: "yes" }, false)).toMatchObject({ error: expect.stringMatching(/^certifiable/) });
    expect(validateEntitlementType({ defaultDurationDays: 0 }, false)).toMatchObject({ error: expect.stringMatching(/^defaultDurationDays/) });
    expect(validateEntitlementType({ maxDurationDays: 1.5 }, false)).toMatchObject({ error: expect.stringMatching(/^maxDurationDays/) });
    expect(validateEntitlementType({ defaultDurationDays: 60, maxDurationDays: 30 }, false)).toEqual({ error: "defaultDurationDays: at most the maximum" });
    expect(validateEntitlementType({ defaultDurationDays: 60 }, false, { default_duration_days: null, max_duration_days: 30 })).toEqual({ error: "defaultDurationDays: at most the maximum" });
    expect(validateEntitlementType({ requestPolicyId: "x" }, false)).toMatchObject({ error: expect.stringMatching(/^requestPolicyId/) });
  });

  it("reads a connector's type word", () => {
    expect(typeName(" role ")).toBe("role");
    expect(typeName("")).toBeNull();
    expect(typeName(null)).toBeNull();
    expect(typeName("x".repeat(150))).toHaveLength(100);
  });
});

describe("entitlementRequestRules (ACCESS-P0-33)", () => {
  const type = (over: Partial<NonNullable<Parameters<typeof entitlementRequestRules>[1]>> = {}) => ({ requestMode: "single" as const, defaultDurationDays: null, maxDurationDays: null, ...over });

  it("refuses what is not requestable, by the entitlement or its type", () => {
    expect(entitlementRequestRules({ requestable: false }, null, null)).toMatchObject({ ok: false, status: 403, code: "NOT_REQUESTABLE" });
    expect(entitlementRequestRules({ requestable: true }, type({ requestMode: "not_requestable" }), null)).toMatchObject({ ok: false, code: "NOT_REQUESTABLE" });
    expect(entitlementRequestRules({ requestable: true }, null, 10)).toEqual({ ok: true, durationDays: 10 });
  });

  it("applies the type's default, and caps at its maximum", () => {
    expect(entitlementRequestRules({ requestable: true }, type({ defaultDurationDays: 30 }), null)).toEqual({ ok: true, durationDays: 30 });
    expect(entitlementRequestRules({ requestable: true }, type({ maxDurationDays: 90 }), null)).toEqual({ ok: true, durationDays: 90 });
    expect(entitlementRequestRules({ requestable: true }, type({ maxDurationDays: 90 }), 60)).toEqual({ ok: true, durationDays: 60 });
    expect(entitlementRequestRules({ requestable: true }, type({ maxDurationDays: 90 }), 120)).toMatchObject({ ok: false, status: 400, code: "DURATION_TOO_LONG" });
  });
});
