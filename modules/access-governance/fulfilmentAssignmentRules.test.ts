import { describe, expect, it } from "vitest";
import { canReassign, isAssignee, resolveAssignee, validateReassignment, workload } from "./fulfilmentAssignmentRules";
import { canAct } from "./fulfilmentTaskRules";

const G = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const owners = { technicalOwnerIdentityId: "tech", businessOwnerIdentityId: "biz" };

describe("fulfilment task assignment (ACCESS-P0-42)", () => {
  it("routes by entitlement type, then the application, then its owners", () => {
    const rows = [
      { entitlementType: null, identityId: null, groupId: "g-app" },
      { entitlementType: "License", identityId: "p-lic", groupId: null },
    ];
    expect(resolveAssignee(rows, "license", owners)).toEqual({ identityId: "p-lic", groupId: null, source: "entitlement_type" });
    expect(resolveAssignee(rows, "role", owners)).toEqual({ identityId: null, groupId: "g-app", source: "application" });
    expect(resolveAssignee(rows, null, owners)).toMatchObject({ groupId: "g-app", source: "application" });
    // With no row, today's route: technical owner, then business owner, then nobody (the access managers).
    expect(resolveAssignee([], "role", owners)).toEqual({ identityId: "tech", groupId: null, source: "technical_owner" });
    expect(resolveAssignee([], null, { technicalOwnerIdentityId: null, businessOwnerIdentityId: "biz" })).toMatchObject({ identityId: "biz", source: "business_owner" });
    expect(resolveAssignee([], null, { technicalOwnerIdentityId: null, businessOwnerIdentityId: null })).toEqual({ identityId: null, groupId: null, source: "none" });
  });

  it("a group's task belongs to each member, who may claim and complete it", () => {
    const task = { status: "open" as const, assigneeIdentityId: null, assigneeGroupId: "g1", claimedBy: null };
    const member = { userId: "u1", identityId: "i1", groupIds: ["g1"], canApprove: false };
    const outsider = { userId: "u2", identityId: "i2", groupIds: ["g2"], canApprove: false };
    expect(isAssignee(task, member)).toBe(true);
    expect(canAct(task, member, "claim")).toEqual({ ok: true, to: "claimed" });
    expect(canAct(task, outsider, "claim")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // Claimed by one member, another member cannot finish it.
    expect(canAct({ ...task, status: "claimed", claimedBy: "u3" }, member, "complete")).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("the assignee, the claimer or an access manager may hand a task on, while it is still to do", () => {
    const task = { status: "claimed" as const, assigneeIdentityId: "i1", assigneeGroupId: null, claimedBy: "u9" };
    expect(canReassign(task, { userId: "u1", identityId: "i1", groupIds: [], canApprove: false })).toEqual({ ok: true });
    expect(canReassign(task, { userId: "u9", identityId: "i9", groupIds: [], canApprove: false })).toEqual({ ok: true });
    expect(canReassign(task, { userId: "u5", identityId: "i5", groupIds: [], canApprove: true })).toEqual({ ok: true });
    expect(canReassign(task, { userId: "u5", identityId: "i5", groupIds: [], canApprove: false })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(canReassign({ ...task, status: "completed" }, { userId: "u1", identityId: "i1", groupIds: [], canApprove: true })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("a reassignment names one person or one group, and why", () => {
    expect(validateReassignment({ groupId: G, reason: " Holiday cover " })).toEqual({ identityId: null, groupId: G, reason: "Holiday cover" });
    expect(validateReassignment({ identityId: P, reason: "x" })).toMatchObject({ identityId: P });
    expect(validateReassignment({ identityId: P, groupId: G, reason: "x" })).toMatchObject({ error: expect.stringContaining("one person or one group") });
    expect(validateReassignment({ reason: "x" })).toMatchObject({ error: expect.any(String) });
    expect(validateReassignment({ identityId: P })).toMatchObject({ error: expect.stringContaining("reason") });
    expect(validateReassignment({ identityId: "me", reason: "x" })).toMatchObject({ error: expect.stringContaining("identityId") });
  });

  it("counts each assignee's tasks still to do, overdue first", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const past = "2026-10-10T00:00:00Z";
    const future = "2026-10-20T00:00:00Z";
    const w = workload(
      [
        { status: "open", dueAt: future, assigneeIdentityId: "i1", assigneeGroupId: null },
        { status: "claimed", dueAt: future, assigneeIdentityId: "i1", assigneeGroupId: null },
        { status: "open", dueAt: past, assigneeIdentityId: null, assigneeGroupId: "g1" },
        { status: "completed", dueAt: past, assigneeIdentityId: "i1", assigneeGroupId: null },
        { status: "failed", dueAt: future, assigneeIdentityId: null, assigneeGroupId: null },
      ],
      now,
    );
    expect(w).toEqual([
      { key: "group:g1", identityId: null, groupId: "g1", open: 1, claimed: 0, failed: 0, overdue: 1 },
      { key: "identity:i1", identityId: "i1", groupId: null, open: 1, claimed: 1, failed: 0, overdue: 0 },
      { key: "none", identityId: null, groupId: null, open: 0, claimed: 0, failed: 1, overdue: 0 },
    ]);
  });
});
