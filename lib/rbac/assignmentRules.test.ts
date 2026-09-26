import { describe, expect, it } from "vitest";
import { isTenantWide, validateTerms } from "./assignmentRules";

const now = new Date("2026-09-26T12:00:00Z");
const APP = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("validateTerms", () => {
  it("defaults to an organization-wide, permanent, unconditional assignment", () => {
    const r = validateTerms({}, "AUDITOR", now);
    expect(r).toEqual({ ok: true, terms: { scopeType: "tenant", scopeValues: [], startsAt: null, expiresAt: null, requiresMfa: false } });
    expect(r.ok && isTenantWide(r.terms)).toBe(true);
  });

  it("accepts scopes with their values, dedupes them and checks their shape", () => {
    expect(validateTerms({ scopeType: "environment", scopeValues: ["production", "production"] }, "AGENT_ADMIN", now)).toMatchObject({ ok: true, terms: { scopeValues: ["production"] } });
    expect(validateTerms({ scopeType: "application", scopeValues: APP }, "AGENT_ADMIN", now)).toMatchObject({ ok: true, terms: { scopeType: "application", scopeValues: [APP] } });
    expect(validateTerms({ scopeType: "environment", scopeValues: ["prod"] }, "X", now)).toMatchObject({ ok: false, errors: { scopeValues: "Unknown environment." } });
    expect(validateTerms({ scopeType: "agent", scopeValues: ["not-an-id"] }, "X", now)).toMatchObject({ ok: false, errors: { scopeValues: "Unknown application or agent." } });
    expect(validateTerms({ scopeType: "agent", scopeValues: [] }, "X", now)).toMatchObject({ ok: false, errors: { scopeValues: "Choose at least one agent." } });
    expect(validateTerms({ scopeType: "tenant", scopeValues: [APP] }, "X", now).ok).toBe(false);
    expect(validateTerms({ scopeType: "planet" }, "X", now)).toMatchObject({ ok: false, errors: { scopeType: expect.any(String) } });
  });

  it("checks the validity window", () => {
    expect(validateTerms({ expiresAt: "2026-09-01" }, "X", now)).toMatchObject({ ok: false, errors: { expiresAt: "The expiry must be in the future." } });
    expect(validateTerms({ startsAt: "2026-11-01", expiresAt: "2026-10-01" }, "X", now)).toMatchObject({ ok: false, errors: { expiresAt: "The expiry must be after the start." } });
    expect(validateTerms({ startsAt: "nope" }, "X", now)).toMatchObject({ ok: false, errors: { startsAt: "Not a valid date." } });
    const ok = validateTerms({ startsAt: "2026-10-01", expiresAt: "2026-12-31", requiresMfa: "on" }, "X", now);
    expect(ok).toMatchObject({ ok: true, terms: { startsAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z", requiresMfa: true } });
    expect(ok.ok && isTenantWide(ok.terms)).toBe(false);
  });

  it("keeps the Tenant Administrator role unconditional", () => {
    expect(validateTerms({ expiresAt: "2026-12-31" }, "TENANT_SUPER_ADMIN", now).ok).toBe(false);
    expect(validateTerms({ requiresMfa: true }, "TENANT_SUPER_ADMIN", now).ok).toBe(false);
    expect(validateTerms({ scopeType: "environment", scopeValues: ["production"] }, "TENANT_SUPER_ADMIN", now).ok).toBe(false);
    expect(validateTerms({}, "TENANT_SUPER_ADMIN", now).ok).toBe(true);
  });
});

describe("describeTerms and termsCurrent", () => {
  it("reads naturally", async () => {
    const { describeTerms, termsCurrent } = await import("./assignmentRules");
    expect(describeTerms({ scopeType: "tenant", scopeValues: [], startsAt: null, expiresAt: null, requiresMfa: false })).toBe("Entire organization");
    expect(describeTerms({ scopeType: "environment", scopeValues: ["production"], startsAt: null, expiresAt: "2026-12-31T00:00:00Z", requiresMfa: true })).toBe(
      "Environment: production · until 31 Dec 2026 · MFA",
    );
    expect(describeTerms({ scopeType: "agent", scopeValues: [APP], startsAt: null, expiresAt: null, requiresMfa: false }, () => "FinanceBot")).toBe("Agents: FinanceBot");
    expect(termsCurrent({ startsAt: null, expiresAt: "2026-09-01T00:00:00Z" }, now)).toBe(false);
    expect(termsCurrent({ startsAt: "2026-10-01T00:00:00Z", expiresAt: null }, now)).toBe(false);
    expect(termsCurrent({ startsAt: "2026-09-01T00:00:00Z", expiresAt: null }, now)).toBe(true);
  });
});
