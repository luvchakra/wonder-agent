// @vitest-environment node
import { describe, expect, it } from "vitest";
import { actionFingerprint, actionableStep, chainOutcome, planApprovalChain, timeoutAction, type ChainInput } from "./approvalRules";

const person = (id: string, userId: string | null = `u-${id}`, active = true) => ({ identityId: id, userId, active });
const input = (over: Partial<ChainInput> = {}): ChainInput => ({
  route: "manager_and_owner",
  mode: "sequential",
  risk: "low",
  manager: person("mgr"),
  entitlementOwner: null,
  applicationOwner: person("owner"),
  requesterUserId: "u-req",
  subjectUserId: "u-req",
  ...over,
});

describe("planApprovalChain", () => {
  it("runs manager then owner in order, or both at once", () => {
    expect(planApprovalChain(input()).map((s) => [s.stage, s.approverKind, s.approverUserId])).toEqual([
      [1, "manager", "u-mgr"],
      [2, "application_owner", "u-owner"],
    ]);
    expect(planApprovalChain(input({ mode: "parallel" })).map((s) => s.stage)).toEqual([1, 1]);
  });

  it("prefers the entitlement owner to the application owner", () => {
    const steps = planApprovalChain(input({ route: "owner_approval", entitlementOwner: person("ent") }));
    expect(steps).toEqual([{ stage: 1, approverKind: "entitlement_owner", approverIdentityId: "ent", approverUserId: "u-ent", reason: null }]);
  });

  it("routes to access managers, with the reason, when nobody suitable is recorded", () => {
    const [none] = planApprovalChain(input({ route: "manager_approval", manager: null }));
    expect(none).toMatchObject({ approverKind: "access_managers", approverUserId: null });
    expect(none.reason).toMatch(/No manager is recorded/);
    expect(planApprovalChain(input({ route: "manager_approval", manager: person("m", null) }))[0].reason).toMatch(/cannot sign in/);
    expect(planApprovalChain(input({ route: "manager_approval", manager: person("m", "u-m", false) }))[0].reason).toMatch(/not active/);
  });

  it("never names the requester or the subject as approver", () => {
    const byManager = planApprovalChain(input({ route: "manager_approval", requesterUserId: "u-mgr", subjectUserId: "u-report" }));
    expect(byManager[0]).toMatchObject({ approverKind: "access_managers" });
    expect(byManager[0].reason).toMatch(/made this request/);
    const ownerIsSubject = planApprovalChain(input({ route: "owner_approval", subjectUserId: "u-owner", requesterUserId: "u-mgr" }));
    expect(ownerIsSubject[0].reason).toMatch(/who the access is for/);
  });

  it("adds an access-manager review for critical risk, and asks each approver once", () => {
    expect(planApprovalChain(input({ risk: "critical" })).map((s) => [s.stage, s.approverKind])).toEqual([
      [1, "manager"],
      [2, "application_owner"],
      [3, "access_managers"],
    ]);
    // Manager and owner both fall back to access managers: one step, not three.
    const collapsed = planApprovalChain(input({ risk: "critical", manager: null, applicationOwner: null }));
    expect(collapsed.map((s) => [s.stage, s.approverKind])).toEqual([[1, "access_managers"]]);
    // The same person as manager and owner approves once.
    const same = planApprovalChain(input({ applicationOwner: person("mgr") }));
    expect(same).toHaveLength(1);
  });
});

describe("actionFingerprint", () => {
  const base = { tenantId: "t", requestId: "r", subjectIdentityId: "s", applicationId: "a", entitlementId: "e", privilegeLevel: "standard", durationDays: 30, requestType: "grant", policyId: "p" };
  it("is stable, and changes with the resource, privilege, duration or policy", () => {
    const f = actionFingerprint(base);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(actionFingerprint({ ...base })).toBe(f);
    for (const change of [{ entitlementId: "e2" }, { privilegeLevel: "admin" }, { durationDays: 90 }, { policyId: "p2" }, { tenantId: "t2" }, { requestType: "modify" }]) {
      expect(actionFingerprint({ ...base, ...change })).not.toBe(f);
    }
  });
});

describe("chainOutcome", () => {
  it("is open at the lowest undecided stage, rejected on any rejection, approved when all are done", () => {
    expect(chainOutcome([{ id: "1", stage: 1, status: "approved" }, { id: "2", stage: 2, status: "pending" }])).toEqual({ state: "open", stage: 2 });
    expect(chainOutcome([{ id: "1", stage: 1, status: "approved" }, { id: "2", stage: 1, status: "rejected" }])).toEqual({ state: "rejected" });
    expect(chainOutcome([{ id: "1", stage: 1, status: "approved" }, { id: "2", stage: 2, status: "skipped" }])).toEqual({ state: "approved" });
    expect(chainOutcome([{ id: "1", stage: 1, status: "expired" }])).toEqual({ state: "expired" });
    // Invalidated steps do not count.
    expect(chainOutcome([{ id: "1", stage: 1, status: "invalidated" }, { id: "2", stage: 1, status: "pending" }])).toEqual({ state: "open", stage: 1 });
  });
});

describe("actionableStep", () => {
  const steps = [
    { id: "m", stage: 1, status: "pending" as const, approverKind: "manager" as const, approverUserId: "u-mgr" },
    { id: "am", stage: 1, status: "pending" as const, approverKind: "access_managers" as const, approverUserId: null },
    { id: "o", stage: 2, status: "waiting" as const, approverKind: "application_owner" as const, approverUserId: "u-owner" },
  ];
  it("gives a named approver their step, an access manager the open one, and nobody a later stage", () => {
    expect(actionableStep(steps, 1, { userId: "u-mgr", canApproveAsAccessManager: false })?.id).toBe("m");
    expect(actionableStep(steps, 1, { userId: "u-x", canApproveAsAccessManager: true })?.id).toBe("am");
    expect(actionableStep(steps, 1, { userId: "u-x", canApproveAsAccessManager: false })).toBeNull();
    expect(actionableStep(steps, 1, { userId: "u-owner", canApproveAsAccessManager: false })).toBeNull();
  });
});

describe("timeoutAction", () => {
  it("escalates a named step once, then expires", () => {
    expect(timeoutAction({ approverKind: "manager", escalatedAt: null }, "escalate")).toBe("escalate");
    expect(timeoutAction({ approverKind: "access_managers", escalatedAt: "2026-09-26T00:00:00Z" }, "escalate")).toBe("expire");
    expect(timeoutAction({ approverKind: "access_managers", escalatedAt: null }, "escalate")).toBe("expire");
    expect(timeoutAction({ approverKind: "manager", escalatedAt: null }, "expire")).toBe("expire");
  });
});
