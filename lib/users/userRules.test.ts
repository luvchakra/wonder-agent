// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkRoleGrant, checkStatusChange, classifyMemberRow, databaseRefusal, effectivePermissions, invitationEscalation, invitationExpired, invitePermission, roleLabel, validateInvite, type MembershipStatus } from "./userRules";

const ROLES = ["TENANT_SUPER_ADMIN", "READ_ONLY", "AUDITOR"];

describe("checkStatusChange", () => {
  it("allows the lifecycle's transitions, with a reason where one is required", () => {
    expect(checkStatusChange("suspend", "active", "a", "b", "left laptop unlocked")).toBeNull();
    expect(checkStatusChange("reactivate", "suspended", "a", "b", null)).toBeNull();
    expect(checkStatusChange("deactivate", "suspended", "a", "b", "left the company")).toBeNull();
    expect(checkStatusChange("remove", "deactivated", "a", "b", "offboarded")).toBeNull();
  });
  it("refuses changing your own membership, whatever the action", () => {
    for (const action of ["suspend", "reactivate", "deactivate", "remove"] as const) {
      expect(checkStatusChange(action, "active", "a", "a", "x")?.code).toBe("SELF_STATUS_CHANGE");
    }
  });
  it("refuses transitions the lifecycle doesn't have", () => {
    expect(checkStatusChange("reactivate", "active", "a", "b", null)?.code).toBe("INVALID_TRANSITION");
    expect(checkStatusChange("suspend", "deactivated", "a", "b", "x")?.code).toBe("INVALID_TRANSITION");
    expect(checkStatusChange("remove", "removed", "a", "b", "x")?.code).toBe("INVALID_TRANSITION");
  });
  it("requires a reason for suspension, deactivation and removal", () => {
    expect(checkStatusChange("suspend", "active", "a", "b", null)?.code).toBe("REASON_REQUIRED");
    expect(checkStatusChange("deactivate", "active", "a", "b", null)?.code).toBe("REASON_REQUIRED");
    expect(checkStatusChange("remove", "active", "a", "b", null)?.code).toBe("REASON_REQUIRED");
  });
});

describe("checkRoleGrant", () => {
  it("refuses self-escalation only", () => {
    expect(checkRoleGrant("a", "a")?.code).toBe("SELF_ESCALATION");
    expect(checkRoleGrant("a", "b")).toBeNull();
  });
});

describe("validateInvite", () => {
  const base = {
    email: " Anita.Desai@Acme.com ",
    displayName: "  Anita   Desai ",
    accountType: "internal",
    authMethod: "tenant_default",
    method: "invite",
    roles: ["READ_ONLY", "READ_ONLY"],
  };
  it("normalizes a valid invitation", () => {
    const r = validateInvite(base, ROLES);
    expect(r.ok && r.value).toEqual({
      email: "anita.desai@acme.com",
      displayName: "Anita Desai",
      jobTitle: null,
      department: null,
      accountType: "internal",
      authMethod: "tenant_default",
      method: "invite",
      roles: ["READ_ONLY"],
    });
  });
  it("names every problem", () => {
    const r = validateInvite({ email: "nope", displayName: " ", accountType: "service", authMethod: "magic", method: "force", roles: ["GOD_MODE"] }, ROLES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["accountType", "authMethod", "displayName", "email", "method", "roles"]);
  });
  it("never accepts a service account as a member", () => {
    expect(validateInvite({ ...base, accountType: "service" }, ROLES).ok).toBe(false);
  });
});

describe("effectivePermissions", () => {
  it("lists each permission once with every role that grants it", () => {
    expect(
      effectivePermissions([
        { role: "READ_ONLY", permission: "agent.read" },
        { role: "AUDITOR", permission: "agent.read" },
        { role: "AUDITOR", permission: "audit.read" },
      ]),
    ).toEqual([
      { permission: "agent.read", roles: ["AUDITOR", "READ_ONLY"] },
      { permission: "audit.read", roles: ["AUDITOR"] },
    ]);
  });
});

describe("helpers", () => {
  it("maps methods to permissions, database guards to answers, and role keys to names", () => {
    expect(invitePermission("invite")).toBe("users.invite");
    expect(invitePermission("add")).toBe("users.create");
    expect(databaseRefusal({ message: "LAST_TENANT_ADMIN: this would leave…" })?.status).toBe(409);
    expect(databaseRefusal({ message: 'new row violates check constraint "user_roles_no_self_grant"' })?.code).toBe("SELF_ESCALATION");
    expect(databaseRefusal({ message: "something else" })).toBeNull();
    expect(roleLabel("TENANT_SUPER_ADMIN")).toBe("Tenant Administrator");
    expect(roleLabel("IAM_ADMIN")).toBe("Identity Administrator");
    expect(roleLabel("CERTIFICATION_MANAGER")).toBe("Certification Manager");
  });
});

describe("bulk invitation (FOUNDATION-P0-32)", () => {
  const NOW = new Date("2026-10-11T12:00:00Z");
  const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
  it("an invitation expires after the organization's limit, never without a date", () => {
    expect(invitationExpired(ago(29), 30, NOW)).toBe(false);
    expect(invitationExpired(ago(31), 30, NOW)).toBe(true);
    expect(invitationExpired(null, 30, NOW)).toBe(false);
  });
  it("a role may carry only permissions the inviter holds", () => {
    expect(invitationEscalation(["users.view", "users.invite"], ["users.view", "users.invite", "x"])).toEqual([]);
    expect(invitationEscalation(["users.view", "tenant.security.manage", "tenant.security.manage"], ["users.view"])).toEqual(["tenant.security.manage"]);
  });
  const ctx = {
    assignableRoles: ["READ_ONLY", "TENANT_SUPER_ADMIN"],
    memberStatus: new Map<string, MembershipStatus>([
      ["ana@example.test", "active"],
      ["bo@example.test", "invited"],
      ["cy@example.test", "removed"],
    ]),
    actorEmail: "me@example.test",
    canAssignRoles: true,
    escalation: (roles: string[]) => (roles.includes("TENANT_SUPER_ADMIN") ? ["tenant.security.manage"] : []),
  };
  it("classifies each row: new, already a member, or invalid with the reason", () => {
    expect(classifyMemberRow({ email: "New@Example.test", displayName: "New Person" }, ctx)).toMatchObject({ decision: "new", invite: { email: "New@Example.test", method: "invite", accountType: "internal" } });
    expect(classifyMemberRow({ email: "ana@example.test", displayName: "Ana" }, ctx)).toMatchObject({ decision: "unchanged" });
    expect(classifyMemberRow({ email: "bo@example.test", displayName: "Bo" }, ctx).note).toMatch(/invited/);
    // Removed people can be invited again.
    expect(classifyMemberRow({ email: "cy@example.test", displayName: "Cy" }, ctx).decision).toBe("new");
    expect(classifyMemberRow({ email: "me@example.test", displayName: "Me" }, ctx).decision).toBe("unchanged");
    expect(classifyMemberRow({ email: "not-an-email", displayName: "X" }, ctx)).toMatchObject({ decision: "invalid" });
    expect(classifyMemberRow({ email: "nameless@example.test" }, ctx)).toMatchObject({ decision: "invalid" });
    expect(classifyMemberRow({ email: "r@example.test", displayName: "R", roles: ["NO_SUCH_ROLE"] }, ctx).note).toMatch(/Unknown role/);
  });
  it("roles: only with role management, and never beyond the inviter's own permissions", () => {
    expect(classifyMemberRow({ email: "r@example.test", displayName: "R", roles: ["READ_ONLY"] }, ctx).decision).toBe("new");
    expect(classifyMemberRow({ email: "r@example.test", displayName: "R", roles: ["READ_ONLY"] }, { ...ctx, canAssignRoles: false }).note).toMatch(/role management/);
    expect(classifyMemberRow({ email: "r@example.test", displayName: "R", roles: ["TENANT_SUPER_ADMIN"] }, ctx).note).toMatch(/Not held: tenant.security.manage/);
  });
});
