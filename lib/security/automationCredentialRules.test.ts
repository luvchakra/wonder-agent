import { describe, expect, it } from "vitest";
import {
  addressAllowed,
  firstOverRateLimit,
  refusalAuditDue,
  automationBearer,
  credentialState,
  expiryFrom,
  generateAutomationKey,
  hashAutomationKey,
  isWellFormedAutomationKey,
  overRateLimit,
  parseCidrs,
  roleEscalation,
  trustedClientIp,
  HUMAN_ONLY_PERMISSIONS,
  refusalFor,
} from "./automationCredentialRules";

const now = new Date("2026-10-12T10:00:00Z");
const future = "2026-12-01T00:00:00Z";
const past = "2026-10-01T00:00:00Z";
const ok = { status: "active" as const, expires_at: future, allowed_cidrs: [] as string[], tenant_status: "active" };

describe("automation credential secret", () => {
  it("is well formed, prefixed and hashed", () => {
    const k = generateAutomationKey();
    expect(isWellFormedAutomationKey(k.secret)).toBe(true);
    expect(k.secret.startsWith(k.prefix)).toBe(true);
    expect(k.prefix).toHaveLength(12);
    expect(k.hash).toBe(hashAutomationKey(k.secret));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generateAutomationKey().secret).not.toBe(k.secret);
  });

  it("rejects agent keys and malformed values", () => {
    expect(isWellFormedAutomationKey("wa_ak_" + "a".repeat(43))).toBe(false);
    expect(isWellFormedAutomationKey("wa_ac_short")).toBe(false);
  });

  it("reads only a wa_ac_ bearer", () => {
    expect(automationBearer("Bearer wa_ac_abc")).toBe("wa_ac_abc");
    expect(automationBearer("bearer   wa_ac_abc ")).toBe("wa_ac_abc");
    expect(automationBearer("Bearer wa_ak_abc")).toBeNull();
    expect(automationBearer("Basic wa_ac_abc")).toBeNull();
    expect(automationBearer(null)).toBeNull();
  });
});

describe("expiry", () => {
  it("defaults to 90 days and allows at most a year", () => {
    const d = expiryFrom(undefined, now);
    expect(d.ok && d.expiresAt.getTime() - now.getTime()).toBe(90 * 86_400_000);
    expect(expiryFrom(365, now).ok).toBe(true);
    expect(expiryFrom(366, now).ok).toBe(false);
    expect(expiryFrom(0, now).ok).toBe(false);
    expect(expiryFrom("1.5", now).ok).toBe(false);
  });

  it("shows an active credential past its expiry as expired", () => {
    expect(credentialState({ status: "active", expires_at: past }, now)).toBe("expired");
    expect(credentialState({ status: "pending", expires_at: past }, now)).toBe("pending");
    expect(credentialState({ status: "active", expires_at: future }, now)).toBe("active");
  });
});

describe("address allowlist", () => {
  it("parses addresses and blocks", () => {
    expect(parseCidrs("203.0.113.0/24, 198.51.100.7 2001:db8::/32")).toEqual({ ok: true, cidrs: ["203.0.113.0/24", "198.51.100.7/32", "2001:db8::/32"] });
    expect(parseCidrs("")).toEqual({ ok: true, cidrs: [] });
    expect(parseCidrs("10.0.0.0/33").ok).toBe(false);
    expect(parseCidrs("example.com").ok).toBe(false);
    expect(parseCidrs("10.0.0.0/8/1").ok).toBe(false);
    expect(parseCidrs(Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`)).ok).toBe(false);
  });

  it("matches IPv4, IPv6 and mapped addresses; empty allows all", () => {
    expect(addressAllowed("1.2.3.4", [])).toBe(true);
    expect(addressAllowed("203.0.113.9", ["203.0.113.0/24"])).toBe(true);
    expect(addressAllowed("::ffff:203.0.113.9", ["203.0.113.0/24"])).toBe(true);
    expect(addressAllowed("203.0.114.9", ["203.0.113.0/24"])).toBe(false);
    expect(addressAllowed("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(addressAllowed(null, ["203.0.113.0/24"])).toBe(false);
    expect(addressAllowed("not-an-ip", ["203.0.113.0/24"])).toBe(false);
  });
});

describe("use decision", () => {
  it("allows an approved, current credential", () => {
    expect(refusalFor(ok, "1.2.3.4", now)).toBeNull();
  });

  it("refuses pending, revoked and expired with 401", () => {
    expect(refusalFor({ ...ok, status: "pending" }, null, now)).toMatchObject({ status: 401, code: "CREDENTIAL_PENDING" });
    expect(refusalFor({ ...ok, status: "revoked" }, null, now)).toMatchObject({ status: 401, code: "CREDENTIAL_REVOKED" });
    expect(refusalFor({ ...ok, expires_at: past }, null, now)).toMatchObject({ status: 401, code: "CREDENTIAL_EXPIRED" });
  });

  it("refuses a suspended organization and a disallowed address", () => {
    expect(refusalFor({ ...ok, tenant_status: "suspended" }, null, now)).toMatchObject({ status: 401 });
    expect(refusalFor({ ...ok, allowed_cidrs: ["10.0.0.0/8"] }, "1.2.3.4", now)).toMatchObject({ status: 403, code: "ADDRESS_NOT_ALLOWED" });
  });

  it("limits calls per minute", () => {
    expect(overRateLimit(120, 120)).toBe(false);
    expect(overRateLimit(121, 120)).toBe(true);
  });
});

describe("role escalation", () => {
  it("refuses permissions the assigner does not hold, and automation.manage always", () => {
    expect(roleEscalation(["integration.read"], ["integration.read", "automation.manage"])).toEqual([]);
    expect(roleEscalation(["integration.read", "users.view"], ["integration.read"])).toEqual(["users.view"]);
    expect(roleEscalation(["automation.manage"], ["automation.manage"])).toEqual(["automation.manage"]);
  });
});

describe("WID-H06 (owner decision 2026-10-12): human-only permissions", () => {
  it("a credential can never be given approval, certification or credential management, even by someone who holds them", () => {
    for (const p of HUMAN_ONLY_PERMISSIONS) expect(roleEscalation([p, "access.read"], [p, "access.read"])).toEqual([p]);
    expect(HUMAN_ONLY_PERMISSIONS).toEqual(expect.arrayContaining(["access.approve", "agent.certify", "automation.manage"]));
  });
});

describe("WID-H08: the caller's address comes only from a trusted header", () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;
  it("never trusts a caller-supplied x-forwarded-for", () => {
    expect(trustedClientIp(headers({ "x-forwarded-for": "10.0.0.5" }), {})).toBeNull();
    expect(trustedClientIp(headers({ "x-forwarded-for": "10.0.0.5", "x-real-ip": "10.0.0.5" }), {})).toBeNull();
  });
  it("on Vercel, reads the headers Vercel sets", () => {
    expect(trustedClientIp(headers({ "x-forwarded-for": "10.0.0.5", "x-vercel-forwarded-for": "203.0.113.7" }), { VERCEL: "1" })).toBe("203.0.113.7");
    expect(trustedClientIp(headers({ "x-real-ip": "203.0.113.8" }), { VERCEL: "1" })).toBe("203.0.113.8");
  });
  it("self-hosted: the configured header, last hop when several", () => {
    expect(trustedClientIp(headers({ "x-forwarded-for": "10.0.0.5, 198.51.100.4" }), { CLIENT_IP_HEADER: "X-Forwarded-For" })).toBe("198.51.100.4");
    expect(trustedClientIp(headers({}), { CLIENT_IP_HEADER: "x-client-ip" })).toBeNull();
  });
  it("an unknown address fails closed for a credential limited to certain addresses", () => {
    expect(addressAllowed(null, ["203.0.113.0/24"])).toBe(false);
    expect(addressAllowed(null, [])).toBe(true);
  });
});

describe("auditing refusals (WID-H06)", () => {
  it("audits the first call over the rate limit in a minute, not the rest", () => {
    expect(firstOverRateLimit(60, 60)).toBe(false);
    expect(firstOverRateLimit(61, 60)).toBe(true);
    expect(firstOverRateLimit(62, 60)).toBe(false);
  });
  it("audits a refusal once per credential and reason a minute, within a bounded memory", () => {
    const seen = new Map<string, number>();
    expect(refusalAuditDue(seen, "c1:CREDENTIAL_REVOKED", 0)).toBe(true);
    expect(refusalAuditDue(seen, "c1:CREDENTIAL_REVOKED", 59_999)).toBe(false);
    expect(refusalAuditDue(seen, "c1:ADDRESS_NOT_ALLOWED", 59_999)).toBe(true);
    expect(refusalAuditDue(seen, "c1:CREDENTIAL_REVOKED", 60_000)).toBe(true);
    const small = new Map<string, number>();
    for (let i = 0; i < 5; i++) refusalAuditDue(small, `k${i}`, 0, 3);
    expect(small.size).toBe(3);
  });
});
