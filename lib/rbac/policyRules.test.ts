import { describe, expect, it } from "vitest";
import { validatePolicy } from "./policyRules";

const catalog = ["runtime.emergency", "runtime.read", "agent.update", "tenant.security.manage", "tenant.settings.manage"];
const ROLE = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("validatePolicy", () => {
  it("accepts a scoped deny with exempt roles", () => {
    const r = validatePolicy(
      { name: " Production kill switch ", effect: "DENY", permissions: ["runtime.emergency"], scopeType: "environment", scopeValues: ["production"], exemptRoleIds: [ROLE] },
      catalog,
    );
    expect(r).toEqual({
      ok: true,
      value: { name: "Production kill switch", description: null, effect: "DENY", permissions: ["runtime.emergency"], scopeType: "environment", scopeValues: ["production"], exemptRoleIds: [ROLE] },
    });
  });

  it("accepts a prefix that matches real permissions, as a list or text", () => {
    expect(validatePolicy({ name: "Runtime", effect: "REQUIRE_APPROVAL", permissions: "runtime.*" }, catalog)).toMatchObject({ ok: true, value: { permissions: ["runtime.*"] } });
  });

  it("refuses unknown permissions and prefixes", () => {
    expect(validatePolicy({ name: "X policy", effect: "DENY", permissions: ["runtime.explode"] }, catalog)).toMatchObject({ ok: false, errors: { permissions: expect.stringContaining("runtime.explode") } });
    expect(validatePolicy({ name: "X policy", effect: "DENY", permissions: ["billing.*"] }, catalog).ok).toBe(false);
    expect(validatePolicy({ name: "X policy", effect: "DENY", permissions: ["*"] }, catalog).ok).toBe(false);
  });

  it("never covers the permission that manages policies", () => {
    for (const p of ["tenant.security.manage", "tenant.security.*", "tenant.*"]) {
      expect(validatePolicy({ name: "Lockout", effect: "DENY", permissions: [p] }, catalog)).toMatchObject({ ok: false, errors: { permissions: expect.stringContaining("tenant.security.manage") } });
    }
  });

  it("checks name, effect, scope and exempt roles", () => {
    const r = validatePolicy({ name: "x", effect: "ALLOW", permissions: ["agent.update"], scopeType: "agent", scopeValues: [], exemptRoleIds: ["nope"] }, catalog);
    expect(r).toMatchObject({ ok: false, errors: { name: expect.any(String), effect: expect.any(String), scopeValues: "Choose at least one.", exemptRoleIds: "Unknown role." } });
    expect(validatePolicy({ name: "Env", effect: "DENY", permissions: ["agent.update"], scopeType: "environment", scopeValues: ["prod"] }, catalog)).toMatchObject({ ok: false, errors: { scopeValues: "Unknown environment." } });
  });
});
