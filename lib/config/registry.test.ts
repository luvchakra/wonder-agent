import { describe, expect, it } from "vitest";
import { CONFIG_SETTINGS, DEFAULT_CONFIG, GLOBAL_IDLE_MINUTES, GLOBAL_SESSION_HOURS, MFA_ENABLE_NEEDS_AAL2, acceptHosts, acceptValue, canViewConfig, formatConfigValue, planConfigChange, resolveConfig, settingFor } from "./registry";
import { ABSOLUTE_SESSION_MAX_MS, IDLE_TIMEOUT_MS } from "@/lib/tenant/sessionSecurity";

const ADMIN = ["tenant.settings", "tenant.security.manage"];

describe("the settings", () => {
  it("default to the behaviour WonderID had before they existed", () => {
    expect(DEFAULT_CONFIG).toEqual({
      "session.idleMinutes": 30,
      "session.maxHours": 12,
      "users.invitationExpiryDays": 30,
      "access.dormantDays": 90,
      "access.fulfilmentSlaDays": 3,
      "access.expiryReminderDays": 7,
      "agents.duplicateMatchPercent": 60,
      "runtime.unregisteredWindowDays": 90,
      "runtime.alertThrottleMinutes": 15,
      "risk.keyRotationDays": 90,
      "risk.maxActiveKeysPerAgent": 3,
      "certification.highRiskScore": 50,
      "sod.conflictWindowDays": 30,
      "integration.massMissingPercent": 20,
      "integration.maxWritesPerHour": 100,
      "integration.allowedHosts": [],
      "security.mfaRequired": 0,
    });
  });

  it("can only tighten the global session limits proxy.ts enforces", () => {
    expect(GLOBAL_IDLE_MINUTES * 60_000).toBe(IDLE_TIMEOUT_MS);
    expect(GLOBAL_SESSION_HOURS * 3_600_000).toBe(ABSOLUTE_SESSION_MAX_MS);
    const idle = settingFor("session.idleMinutes")!;
    const hours = settingFor("session.maxHours")!;
    expect(idle.type === "int" && idle.max).toBe(GLOBAL_IDLE_MINUTES);
    expect(hours.type === "int" && hours.max).toBe(GLOBAL_SESSION_HOURS);
    expect(idle.permission).toEqual(["tenant.security.manage"]);
  });

  it("each have a section, a one-line help, a default within their bounds, and unique keys", () => {
    expect(new Set(CONFIG_SETTINGS.map((s) => s.key)).size).toBe(CONFIG_SETTINGS.length);
    for (const s of CONFIG_SETTINGS) {
      expect(acceptValue(s, s.default), s.key).toEqual(s.default);
      expect(s.help.length, s.key).toBeLessThan(140);
    }
  });
});

describe("acceptValue", () => {
  const idle = settingFor("session.idleMinutes")!;
  const dormant = settingFor("access.dormantDays")!;
  it("takes whole numbers within bounds, from numbers or form text", () => {
    expect(acceptValue(idle, 15)).toBe(15);
    expect(acceptValue(idle, " 5 ")).toBe(5);
  });
  it("refuses fractions, text, out-of-range values and choices off the list", () => {
    for (const bad of [4, 31, 7.5, "abc", "", null, undefined, "1e1"]) expect(acceptValue(idle, bad), String(bad)).toBeNull();
    expect(acceptValue(dormant, 45)).toBeNull();
    expect(acceptValue(dormant, "180")).toBe(180);
  });
});

describe("resolveConfig", () => {
  it("keeps valid stored values and puts the default back for anything missing, unknown or invalid", () => {
    expect(resolveConfig({ "session.idleMinutes": 10, "access.dormantDays": 45, "risk.maxActiveKeysPerAgent": "x", junk: 1 })).toEqual({
      ...DEFAULT_CONFIG,
      "session.idleMinutes": 10,
    });
    for (const nothing of [null, undefined, "x", [], 3]) expect(resolveConfig(nothing)).toEqual(DEFAULT_CONFIG);
  });
});

describe("planConfigChange", () => {
  it("lists what changed, from and to, and leaves the rest", () => {
    const plan = planConfigChange(DEFAULT_CONFIG, { "access.dormantDays": "30", "risk.keyRotationDays": "90" }, ADMIN);
    expect(plan).toEqual({ ok: true, next: { ...DEFAULT_CONFIG, "access.dormantDays": 30 }, changes: [{ key: "access.dormantDays", from: 90, to: 30 }] });
  });

  it("refuses a session change without the security permission, but lets the same member save other settings", () => {
    const refused = planConfigChange(DEFAULT_CONFIG, { "session.idleMinutes": "10" }, ["tenant.settings"]);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.errors["session.idleMinutes"]).toMatch(/can't change/);
    // An unchanged session value submitted alongside is not a change, so it needs no permission.
    expect(planConfigChange(DEFAULT_CONFIG, { "session.idleMinutes": "30", "access.dormantDays": "60" }, ["tenant.settings"]).ok).toBe(true);
  });

  it("refuses everything when any value is invalid or unknown (never part-applied)", () => {
    const plan = planConfigChange(DEFAULT_CONFIG, { "access.dormantDays": "30", "session.maxHours": "24", "made.up": 1 }, ADMIN);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && Object.keys(plan.errors).sort()).toEqual(["made.up", "session.maxHours"]);
  });
});

describe("canViewConfig", () => {
  it("opens the page to either permission, and to nobody else", () => {
    expect(canViewConfig(["tenant.settings"])).toBe(true);
    expect(canViewConfig(["tenant.security.manage"])).toBe(true);
    expect(canViewConfig(["access.read", "policy.read"])).toBe(false);
  });
});

describe("the allowed hosts (WID-H05)", () => {
  it("takes host names from text or a list: lower-cased, sorted, once each", () => {
    expect(acceptHosts("API.example.com\n*.corp.example.com, api.example.com.", 50)).toEqual(["*.corp.example.com", "api.example.com"]);
    expect(acceptHosts(["b.example.com", "a.example.com"], 50)).toEqual(["a.example.com", "b.example.com"]);
    expect(acceptHosts("", 50)).toEqual([]);
  });
  it("refuses anything that is not a host name, and too many", () => {
    for (const bad of ["https://api.example.com", "api.example.com:443", "api.example.com/path", "localhost", "*", "*.com", "api.example.com localhost"]) {
      expect(acceptHosts(bad, 50), bad).toBeNull();
    }
    expect(acceptHosts(Array.from({ length: 51 }, (_, i) => `h${i}.example.com`), 50)).toBeNull();
    expect(acceptHosts(42, 50)).toBeNull();
  });
  it("needs the security permission, and records a change readably", () => {
    const plan = planConfigChange(DEFAULT_CONFIG, { "integration.allowedHosts": "api.example.com" }, ["tenant.settings"]);
    expect(plan.ok).toBe(false);
    const ok = planConfigChange(DEFAULT_CONFIG, { "integration.allowedHosts": "api.example.com" }, ADMIN);
    expect(ok).toMatchObject({ ok: true, changes: [{ key: "integration.allowedHosts", from: [], to: ["api.example.com"] }] });
    // Saving the same list again is no change.
    expect(planConfigChange({ ...DEFAULT_CONFIG, "integration.allowedHosts": ["api.example.com"] }, { "integration.allowedHosts": "api.example.com" }, ADMIN)).toMatchObject({ ok: true, changes: [] });
    expect(formatConfigValue([])).toBe("any public host");
    expect(formatConfigValue(["a.example.com", "b.example.com"])).toBe("a.example.com, b.example.com");
  });
});

describe("FOUNDATION-P0-27: requiring MFA", () => {
  const mfa = { "security.mfaRequired": "1" };
  it("is off by default and needs the security permission", () => {
    expect(DEFAULT_CONFIG["security.mfaRequired"]).toBe(0);
    expect(planConfigChange(DEFAULT_CONFIG, mfa, ["tenant.settings"], { aal: "aal2" })).toMatchObject({ ok: false, errors: { "security.mfaRequired": "You can't change this setting." } });
  });
  it("can be turned on only from a session that used MFA, so the administrator can still get in", () => {
    for (const aal of ["aal1", null, undefined] as const) {
      expect(planConfigChange(DEFAULT_CONFIG, mfa, ADMIN, { aal }), String(aal)).toMatchObject({ ok: false, errors: { "security.mfaRequired": MFA_ENABLE_NEEDS_AAL2 } });
    }
    expect(planConfigChange(DEFAULT_CONFIG, mfa, ADMIN)).toMatchObject({ ok: false });
    expect(planConfigChange(DEFAULT_CONFIG, mfa, ADMIN, { aal: "aal2" })).toMatchObject({ ok: true, changes: [{ key: "security.mfaRequired", from: 0, to: 1 }] });
  });
  it("refuses the whole save when it is refused, and allows turning it off from any session", () => {
    const plan = planConfigChange(DEFAULT_CONFIG, { ...mfa, "access.dormantDays": "30" }, ADMIN, { aal: "aal1" });
    expect(plan.ok).toBe(false);
    expect(planConfigChange({ ...DEFAULT_CONFIG, "security.mfaRequired": 1 }, { "security.mfaRequired": "0" }, ADMIN, { aal: "aal1" })).toMatchObject({ ok: true });
  });
  it("accepts only 0 or 1, and anything else stored means not required", () => {
    const s = settingFor("security.mfaRequired")!;
    expect(acceptValue(s, "2")).toBeNull();
    expect(resolveConfig({ "security.mfaRequired": "yes" })["security.mfaRequired"]).toBe(0);
    expect(resolveConfig({ "security.mfaRequired": 1 })["security.mfaRequired"]).toBe(1);
  });
  it("reads as a label in the history", () => {
    expect(formatConfigValue(1, "security.mfaRequired")).toBe("Required");
    expect(formatConfigValue(0, "security.mfaRequired")).toBe("Not required");
    expect(formatConfigValue(30, "access.dormantDays")).toBe("30");
  });
});
