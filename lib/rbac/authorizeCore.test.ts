import { describe, expect, it } from "vitest";
import { authorize, describeScope, permissionMatches, scopeCovers, tenantWidePermissions, type AuthorizationPolicy, type Grant } from "./authorizeCore";

const now = new Date("2026-09-26T12:00:00Z");

function grant(over: Partial<Grant> = {}): Grant {
  return {
    roleId: "r1",
    role: "AGENT_ADMIN",
    roleDisplayName: "Agent Administrator",
    source: "DIRECT",
    via: null,
    permissions: ["agent.read", "agent.update"],
    scopeType: "tenant",
    scopeValues: [],
    startsAt: null,
    expiresAt: null,
    requiresMfa: false,
    ...over,
  };
}

function policy(over: Partial<AuthorizationPolicy> = {}): AuthorizationPolicy {
  return { id: "p1", name: "Production kill switch", effect: "DENY", permissions: ["runtime.emergency"], scopeType: "tenant", scopeValues: [], exemptRoleIds: [], ...over };
}

const prodAgent = { type: "agent" as const, id: "a-prod", environment: "production", applicationIds: ["app-sap"] };
const devAgent = { type: "agent" as const, id: "a-dev", environment: "development", applicationIds: ["app-snow"] };

describe("authorize — grants", () => {
  it("allows a tenant-wide grant with the permission, with its reasons", () => {
    const r = authorize([grant()], [], { permission: "agent.update", now, aal: "aal1" });
    expect(r.decision).toBe("ALLOW");
    expect(r.reasons).toEqual(["PERMISSION_MATCH", "SCOPE_MATCH"]);
    expect(r.matched[0]).toMatchObject({ role: "AGENT_ADMIN", source: "DIRECT", scope: "Entire organization" });
  });

  it("denies a permission nobody granted", () => {
    const r = authorize([grant()], [], { permission: "agent.delete", now, aal: "aal1" });
    expect(r).toMatchObject({ decision: "DENY", reasons: ["PERMISSION_MISSING"], matched: [] });
  });

  it("a scoped grant applies only to resources inside its scope, never without a resource", () => {
    const g = grant({ scopeType: "environment", scopeValues: ["production"] });
    expect(authorize([g], [], { permission: "agent.update", resource: prodAgent, now, aal: null }).decision).toBe("ALLOW");
    const dev = authorize([g], [], { permission: "agent.update", resource: devAgent, now, aal: null });
    expect(dev).toMatchObject({ decision: "DENY", reasons: ["OUT_OF_SCOPE"] });
    expect(authorize([g], [], { permission: "agent.update", now, aal: null }).reasons).toEqual(["OUT_OF_SCOPE"]);
  });

  it("application and agent scopes match the resource", () => {
    const byApp = grant({ scopeType: "application", scopeValues: ["app-sap"] });
    expect(authorize([byApp], [], { permission: "agent.update", resource: prodAgent, now, aal: null }).decision).toBe("ALLOW");
    expect(authorize([byApp], [], { permission: "agent.update", resource: devAgent, now, aal: null }).decision).toBe("DENY");
    expect(authorize([byApp], [], { permission: "agent.update", resource: { type: "application", id: "app-sap" }, now, aal: null }).decision).toBe("ALLOW");
    const byAgent = grant({ scopeType: "agent", scopeValues: ["a-dev"] });
    expect(authorize([byAgent], [], { permission: "agent.update", resource: devAgent, now, aal: null }).decision).toBe("ALLOW");
    expect(authorize([byAgent], [], { permission: "agent.update", resource: prodAgent, now, aal: null }).decision).toBe("DENY");
  });

  it("a grant counts only between its start and expiry", () => {
    const future = grant({ startsAt: "2026-10-01T00:00:00Z" });
    const past = grant({ expiresAt: "2026-09-26T12:00:00Z" });
    expect(authorize([future], [], { permission: "agent.read", now, aal: null }).reasons).toEqual(["GRANT_NOT_STARTED"]);
    expect(authorize([past], [], { permission: "agent.read", now, aal: null }).reasons).toEqual(["GRANT_EXPIRED"]);
    expect(authorize([grant({ startsAt: "2026-09-01T00:00:00Z", expiresAt: "2026-12-31T00:00:00Z" })], [], { permission: "agent.read", now, aal: null }).decision).toBe("ALLOW");
  });

  it("an MFA condition needs an aal2 session", () => {
    const g = grant({ requiresMfa: true });
    expect(authorize([g], [], { permission: "agent.update", now, aal: "aal1" }).reasons).toEqual(["MFA_REQUIRED"]);
    expect(authorize([g], [], { permission: "agent.update", now, aal: null }).decision).toBe("DENY");
    expect(authorize([g], [], { permission: "agent.update", now, aal: "aal2" }).reasons).toContain("MFA_SATISFIED");
  });

  it("any one applicable grant is enough, and group grants say which group", () => {
    const scoped = grant({ scopeType: "agent", scopeValues: ["a-dev"] });
    const viaGroup = grant({ source: "GROUP", via: "Platform team", role: "AUDITOR", roleDisplayName: "Auditor", permissions: ["agent.read"] });
    const r = authorize([scoped, viaGroup], [], { permission: "agent.read", now, aal: null });
    expect(r.decision).toBe("ALLOW");
    expect(r.matched).toEqual([{ role: "AUDITOR", roleDisplayName: "Auditor", source: "GROUP", via: "Platform team", scope: "Entire organization" }]);
    expect(r.notApplied).toEqual([expect.objectContaining({ role: "AGENT_ADMIN", reason: "OUT_OF_SCOPE" })]);
  });
});

describe("authorize — explicit policies", () => {
  const responder = grant({ role: "RUNTIME_SECURITY_ADMIN", roleDisplayName: "Runtime Security Administrator", permissions: ["runtime.emergency", "runtime.read"] });

  it("an explicit deny wins over any allow", () => {
    const r = authorize([responder], [policy()], { permission: "runtime.emergency", now, aal: "aal2" });
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toContain("POLICY_DENY");
    expect(r.policies).toEqual([{ id: "p1", name: "Production kill switch", effect: "DENY", exempt: false }]);
  });

  it("wildcards match by prefix", () => {
    expect(permissionMatches("runtime.*", "runtime.emergency")).toBe(true);
    expect(permissionMatches("runtime.*", "runtimex.read")).toBe(false);
    expect(permissionMatches("*", "agent.read")).toBe(true);
    expect(authorize([responder], [policy({ permissions: ["runtime.*"] })], { permission: "runtime.read", now, aal: null }).decision).toBe("DENY");
  });

  it("a scoped policy applies only inside its scope", () => {
    const prodOnly = policy({ scopeType: "environment", scopeValues: ["production"] });
    expect(authorize([responder], [prodOnly], { permission: "runtime.emergency", resource: prodAgent, now, aal: null }).decision).toBe("DENY");
    expect(authorize([responder], [prodOnly], { permission: "runtime.emergency", resource: devAgent, now, aal: null }).decision).toBe("ALLOW");
    expect(authorize([responder], [prodOnly], { permission: "runtime.emergency", now, aal: null }).decision).toBe("ALLOW");
  });

  it("an exempt role is the break-glass exception", () => {
    const breakGlass = grant({ roleId: "bg", role: "BREAK_GLASS", roleDisplayName: "Break glass", permissions: ["runtime.emergency"] });
    const p = policy({ exemptRoleIds: ["bg"] });
    expect(authorize([responder], [p], { permission: "runtime.emergency", now, aal: null }).decision).toBe("DENY");
    const r = authorize([responder, breakGlass], [p], { permission: "runtime.emergency", now, aal: null });
    expect(r.decision).toBe("ALLOW");
    expect(r.reasons).toContain("POLICY_EXEMPT");
  });

  it("require-approval holds the action unless something denies it", () => {
    const approval = policy({ id: "p2", name: "Four eyes", effect: "REQUIRE_APPROVAL" });
    expect(authorize([responder], [approval], { permission: "runtime.emergency", now, aal: null })).toMatchObject({ decision: "REQUIRE_APPROVAL", reasons: expect.arrayContaining(["POLICY_REQUIRES_APPROVAL"]) });
    expect(authorize([responder], [approval, policy()], { permission: "runtime.emergency", now, aal: null }).decision).toBe("DENY");
  });

  it("a policy never grants: without a grant it is still a plain denial", () => {
    expect(authorize([], [policy({ exemptRoleIds: ["x"] })], { permission: "runtime.emergency", now, aal: null })).toMatchObject({ decision: "DENY", reasons: ["PERMISSION_MISSING"], policies: [] });
  });
});

describe("tenantWidePermissions and helpers", () => {
  it("lists what may be used without naming a resource", () => {
    const grants = [
      grant({ permissions: ["agent.read"] }),
      grant({ roleId: "r2", permissions: ["agent.update"], scopeType: "environment", scopeValues: ["production"] }),
      grant({ roleId: "r3", permissions: ["agent.delete"], expiresAt: "2026-01-01T00:00:00Z" }),
      grant({ roleId: "r4", permissions: ["runtime.emergency", "runtime.read"] }),
    ];
    expect(tenantWidePermissions(grants, [policy()], now, "aal1")).toEqual(["agent.read", "runtime.read"]);
  });

  it("describes scopes and matches them", () => {
    expect(describeScope("tenant", [])).toBe("Entire organization");
    expect(describeScope("environment", ["production"])).toBe("Environment: production");
    expect(scopeCovers("tenant", [], null)).toBe(true);
    expect(scopeCovers("environment", ["production"], { type: "agent", id: "x" })).toBe(false);
  });
});
