import { describe, expect, it } from "vitest";
import { actingFor, isActive, validateDelegation } from "./delegationRules";
import { actionableStep, type ActionableStep } from "./approvalRules";

const ME = "11111111-1111-1111-1111-111111111111";
const ALEX = "22222222-2222-2222-2222-222222222222";
const SAM = "33333333-3333-3333-3333-333333333333";
const now = new Date("2026-10-14T10:00:00Z");

describe("approver delegation (ACCESS-P0-23)", () => {
  it("delegates the caller's own approvals from now until a date", () => {
    expect(validateDelegation({ delegateUserId: ALEX, endsAt: "2026-10-20T00:00:00Z", reason: " Leave " }, { userId: ME, canManageAccess: false }, now)).toEqual({
      delegator_user_id: ME,
      delegate_user_id: ALEX,
      scope: "approvals",
      starts_at: now.toISOString(),
      ends_at: "2026-10-20T00:00:00.000Z",
      reason: "Leave",
    });
  });

  it("refuses delegating to oneself, without an end, too long, or someone else's without being an access manager", () => {
    const me = { userId: ME, canManageAccess: false };
    expect(validateDelegation({ delegateUserId: ME, endsAt: "2026-10-20" }, me, now)).toMatchObject({ error: expect.stringContaining("someone other") });
    expect(validateDelegation({ delegateUserId: ALEX }, me, now)).toMatchObject({ error: expect.stringContaining("endsAt") });
    expect(validateDelegation({ delegateUserId: ALEX, endsAt: "2026-10-13" }, me, now)).toMatchObject({ error: expect.stringContaining("future") });
    expect(validateDelegation({ delegateUserId: ALEX, endsAt: "2027-06-01" }, me, now)).toMatchObject({ error: expect.stringContaining("180 days") });
    expect(validateDelegation({ delegatorUserId: SAM, delegateUserId: ALEX, endsAt: "2026-10-20" }, me, now)).toMatchObject({ status: 403 });
    expect(validateDelegation({ delegatorUserId: SAM, delegateUserId: ALEX, endsAt: "2026-10-20" }, { userId: ME, canManageAccess: true }, now)).toMatchObject({ delegator_user_id: SAM });
  });

  it("is in force between its dates unless ended", () => {
    const d = { startsAt: "2026-10-13T00:00:00Z", endsAt: "2026-10-15T00:00:00Z", revokedAt: null as string | null };
    expect(isActive(d, now)).toBe(true);
    expect(isActive({ ...d, revokedAt: "2026-10-14T09:00:00Z" }, now)).toBe(false);
    expect(isActive({ ...d, startsAt: "2026-10-14T11:00:00Z" }, now)).toBe(false);
    expect(isActive({ ...d, endsAt: "2026-10-14T10:00:00Z" }, now)).toBe(false);
    expect(
      actingFor(
        [
          { delegatorUserId: SAM, delegateUserId: ME, ...d },
          { delegatorUserId: ALEX, delegateUserId: SAM, ...d },
        ],
        ME,
        now,
      ),
    ).toEqual([SAM]);
  });

  it("lets a delegate decide a step naming the person they stand in for, after their own", () => {
    const steps: ActionableStep[] = [
      { id: "s-sam", stage: 1, status: "pending", approverKind: "manager", approverUserId: SAM },
      { id: "s-am", stage: 1, status: "pending", approverKind: "access_managers", approverUserId: null },
    ];
    expect(actionableStep(steps, 1, { userId: ME, canApproveAsAccessManager: false })).toBeNull();
    expect(actionableStep(steps, 1, { userId: ME, canApproveAsAccessManager: false, actingFor: [SAM] })?.id).toBe("s-sam");
    expect(actionableStep(steps, 1, { userId: ME, canApproveAsAccessManager: true, actingFor: [] })?.id).toBe("s-am");
    expect(actionableStep([{ ...steps[0], approverUserId: ME }, steps[0]], 1, { userId: ME, canApproveAsAccessManager: false, actingFor: [SAM] })?.approverUserId).toBe(ME);
  });

  it("part 2: a request delegation has its own scope, and approvals are not requests", () => {
    const v = validateDelegation({ delegateUserId: ALEX, scope: "requests", endsAt: "2026-10-20T00:00:00Z" }, { userId: ME, canManageAccess: false }, now);
    expect(v).toMatchObject({ scope: "requests", delegator_user_id: ME });
    expect(validateDelegation({ delegateUserId: ALEX, scope: "admin", endsAt: "2026-10-20T00:00:00Z" }, { userId: ME, canManageAccess: false }, now)).toEqual({ error: "scope: approvals, requests or administration" });
    // Part 3: administration only from someone who manages roles.
    expect(validateDelegation({ delegateUserId: ALEX, scope: "administration", endsAt: "2026-10-20T00:00:00Z" }, { userId: ME, canManageAccess: true }, now)).toMatchObject({ status: 403 });
    expect(validateDelegation({ delegateUserId: ALEX, scope: "administration", endsAt: "2026-10-20T00:00:00Z" }, { userId: ME, canManageAccess: false, canManageRoles: true }, now)).toMatchObject({ scope: "administration" });
    const d = { startsAt: "2026-10-14T09:00:00Z", endsAt: "2026-10-15T00:00:00Z", revokedAt: null };
    const list = [{ delegatorUserId: SAM, delegateUserId: ME, scope: "requests" as const, ...d }];
    expect(actingFor(list, ME, now, "requests")).toEqual([SAM]);
    expect(actingFor(list, ME, now)).toEqual([]);
  });
});
