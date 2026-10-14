import { describe, expect, it } from "vitest";
import { planDelegatedRoles, type HeldRole } from "./delegatedRoleRules";

const role = (over: Partial<HeldRole>): HeldRole => ({
  roleId: "r-app",
  roleName: "APP_ADMIN",
  roleActive: true,
  scopeType: "tenant",
  scopeValues: [],
  startsAt: null,
  expiresAt: null,
  requiresMfa: false,
  delegationId: null,
  ...over,
});
const window = { startsAt: "2026-10-14T00:00:00.000Z", endsAt: "2026-10-21T00:00:00.000Z" };

describe("administration delegation (ACCESS-P0-23 part 3)", () => {
  it("copies the delegator's direct roles for the delegation's window, keeping scope and MFA", () => {
    const { copies } = planDelegatedRoles([role({ scopeType: "application", scopeValues: ["a1"], requiresMfa: true })], [], window);
    expect(copies).toEqual([{ roleId: "r-app", roleName: "APP_ADMIN", scopeType: "application", scopeValues: ["a1"], startsAt: window.startsAt, expiresAt: window.endsAt, requiresMfa: true }]);
  });

  it("never copies Tenant Administrator, a held role, a delegated one, an inactive one or an ended one", () => {
    const { copies, skipped } = planDelegatedRoles(
      [
        role({ roleId: "r-ta", roleName: "TENANT_SUPER_ADMIN" }),
        role({ roleId: "r-held", roleName: "AUDITOR" }),
        role({ roleId: "r-del", roleName: "IAM_ADMIN", delegationId: "d0" }),
        role({ roleId: "r-off", roleName: "OLD", roleActive: false }),
        role({ roleId: "r-end", roleName: "SHORT", expiresAt: "2026-10-13T00:00:00.000Z" }),
      ],
      ["r-held"],
      window,
    );
    expect(copies).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["tenant_administrator", "already_held", "delegated", "inactive", "ended"]);
  });

  it("lasts no longer than the original assignment", () => {
    const { copies } = planDelegatedRoles([role({ expiresAt: "2026-10-17T00:00:00.000Z" })], [], window);
    expect(copies[0].expiresAt).toBe("2026-10-17T00:00:00.000Z");
  });
});
