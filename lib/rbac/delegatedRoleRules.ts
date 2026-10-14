/**
 * ACCESS-P0-23 part 3 — administration delegation, pure (#9). While a member
 * is away, their directly assigned roles are given to a delegate as
 * time-bound copies, through Foundation's ordinary role assignments; the
 * authorization engine then treats them like any other assignment.
 *
 * Never copied:
 * - the Tenant Administrator role (it is always permanent, migration 0100);
 * - a role the delegate already holds (their own assignment is not touched);
 * - a role the delegator holds only by delegation (no re-delegation);
 * - an inactive role, or an assignment that has ended.
 * A copy keeps the original's scope and MFA condition and lasts no longer
 * than either the delegation or the original assignment.
 */

export const TENANT_ADMIN_ROLE = "TENANT_SUPER_ADMIN";

export type HeldRole = {
  roleId: string;
  roleName: string;
  roleActive: boolean;
  scopeType: string;
  scopeValues: string[];
  startsAt: string | null;
  expiresAt: string | null;
  requiresMfa: boolean;
  delegationId: string | null;
};

export type DelegatedCopy = { roleId: string; roleName: string; scopeType: string; scopeValues: string[]; startsAt: string; expiresAt: string; requiresMfa: boolean };
export type SkippedRole = { roleName: string; reason: "tenant_administrator" | "already_held" | "delegated" | "inactive" | "ended" };

export function planDelegatedRoles(
  delegatorRoles: HeldRole[],
  delegateRoleIds: string[],
  window: { startsAt: string; endsAt: string },
): { copies: DelegatedCopy[]; skipped: SkippedRole[] } {
  const copies: DelegatedCopy[] = [];
  const skipped: SkippedRole[] = [];
  const held = new Set(delegateRoleIds);
  for (const r of delegatorRoles) {
    if (r.roleName === TENANT_ADMIN_ROLE) skipped.push({ roleName: r.roleName, reason: "tenant_administrator" });
    else if (r.delegationId) skipped.push({ roleName: r.roleName, reason: "delegated" });
    else if (!r.roleActive) skipped.push({ roleName: r.roleName, reason: "inactive" });
    else if (held.has(r.roleId)) skipped.push({ roleName: r.roleName, reason: "already_held" });
    else {
      const startsAt = r.startsAt && r.startsAt > window.startsAt ? r.startsAt : window.startsAt;
      const expiresAt = r.expiresAt && r.expiresAt < window.endsAt ? r.expiresAt : window.endsAt;
      if (Date.parse(expiresAt) <= Date.parse(startsAt)) skipped.push({ roleName: r.roleName, reason: "ended" });
      else copies.push({ roleId: r.roleId, roleName: r.roleName, scopeType: r.scopeType, scopeValues: r.scopeValues, startsAt, expiresAt, requiresMfa: r.requiresMfa });
    }
  }
  return { copies, skipped };
}
