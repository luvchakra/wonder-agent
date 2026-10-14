import { describe, expect, it } from "vitest";
import { allowedTransitions, detectLifecycleEvents, endDatePassed, opensAccessRemoval, opensBirthright, statusForState, tasksForEvent, whyCannotDisableAll } from "./humanLifecycle";

describe("human lifecycle transitions", () => {
  it("allows the governed path and rehire, never skipping to terminated from active", () => {
    expect(allowedTransitions("PRE_JOIN")).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(allowedTransitions("ACTIVE")).toEqual(["LEAVE_PENDING", "DISABLED"]);
    expect(allowedTransitions("ACTIVE")).not.toContain("TERMINATED");
    expect(allowedTransitions("TERMINATED")).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(allowedTransitions(null)).toEqual([]);
  });

  it("maps states to statuses, keeping the current one while notice is served", () => {
    expect(statusForState("PRE_JOIN", "active")).toBe("pending");
    expect(statusForState("LEAVE_PENDING", "active")).toBe("active");
    expect(statusForState("LEAVE_PENDING", "inactive")).toBe("inactive");
    expect(statusForState("TERMINATED", "active")).toBe("terminated");
  });
});

describe("detectLifecycleEvents", () => {
  const person = (over: Record<string, unknown> = {}) => ({ lifecycleState: "ACTIVE" as const, department: "Finance", title: "Analyst", managerIdentityId: "m1", employmentType: "contractor", ...over });

  it("a new person is a joiner, and a start date arriving is the join", () => {
    expect(detectLifecycleEvents(null, person({ lifecycleState: "PRE_JOIN" }))).toEqual([{ eventType: "joiner", changedFields: [], fromState: null, toState: "PRE_JOIN" }]);
    expect(detectLifecycleEvents(person({ lifecycleState: "PRE_JOIN" }), person())[0]).toMatchObject({ eventType: "joiner", fromState: "PRE_JOIN", toState: "ACTIVE" });
  });

  it("a department or title change is a mover; a manager-only change is its own event", () => {
    expect(detectLifecycleEvents(person(), person({ department: "Sales", title: "Rep" }))).toEqual([
      { eventType: "mover", changedFields: ["department", "title"], fromState: "ACTIVE", toState: "ACTIVE" },
    ]);
    expect(detectLifecycleEvents(person(), person({ managerIdentityId: "m2" }))[0]).toMatchObject({ eventType: "manager_change" });
    // A first manager is an assignment, not a change.
    expect(detectLifecycleEvents(person({ managerIdentityId: null }), person({ managerIdentityId: "m2" }))).toEqual([]);
    expect(detectLifecycleEvents(person(), person())).toEqual([]);
  });

  it("a contractor becoming an employee is a conversion", () => {
    expect(detectLifecycleEvents(person(), person({ employmentType: "employee" }))).toEqual([
      { eventType: "conversion", changedFields: ["employmentType"], fromState: "ACTIVE", toState: "ACTIVE" },
    ]);
  });

  it("leaving, returning and cancelling a departure are told apart", () => {
    expect(detectLifecycleEvents(person(), person({ lifecycleState: "LEAVE_PENDING" }))[0]).toMatchObject({ eventType: "leaver" });
    expect(detectLifecycleEvents(person(), person({ lifecycleState: "TERMINATED" }))[0]).toMatchObject({ eventType: "leaver" });
    expect(detectLifecycleEvents(person({ lifecycleState: "TERMINATED" }), person())[0]).toMatchObject({ eventType: "rehire" });
    expect(detectLifecycleEvents(person({ lifecycleState: "LEAVE_PENDING" }), person())[0]).toMatchObject({ eventType: "leaver_cancelled" });
    expect(detectLifecycleEvents(person({ lifecycleState: "DISABLED" }), person({ lifecycleState: "TERMINATED" }))[0]).toMatchObject({ eventType: "terminated" });
  });

  it("someone who has gone does not move", () => {
    expect(detectLifecycleEvents(person({ lifecycleState: "DISABLED" }), person({ lifecycleState: "DISABLED", department: "Sales" }))).toEqual([]);
  });
});

describe("tasksForEvent", () => {
  it("opens governed work, and sign-in only for people who can sign in", () => {
    expect(tasksForEvent("joiner", { hasSignIn: false })).toEqual(["request_baseline_access"]);
    expect(tasksForEvent("mover", { hasSignIn: true })).toEqual(["review_access"]);
    expect(tasksForEvent("leaver", { hasSignIn: true })).toEqual(["transfer_ownership", "revoke_access", "disable_sign_in"]);
    expect(tasksForEvent("leaver", { hasSignIn: false })).toEqual(["transfer_ownership", "revoke_access"]);
    expect(tasksForEvent("manager_change", { hasSignIn: true })).toEqual([]);
  });
});

describe("opensAccessRemoval (WID-C02)", () => {
  it("opens removals when a person stops working, not while serving notice", () => {
    expect(opensAccessRemoval({ fromState: "ACTIVE", toState: "DISABLED" })).toBe(true);
    expect(opensAccessRemoval({ fromState: "LEAVE_PENDING", toState: "DISABLED" })).toBe(true);
    expect(opensAccessRemoval({ fromState: "ACTIVE", toState: "TERMINATED" })).toBe(true);
    expect(opensAccessRemoval({ fromState: "PRE_JOIN", toState: "ARCHIVED" })).toBe(true);
    expect(opensAccessRemoval({ fromState: "ACTIVE", toState: "LEAVE_PENDING" })).toBe(false);
  });
  it("does not open them again on later steps, or for someone returning", () => {
    expect(opensAccessRemoval({ fromState: "DISABLED", toState: "TERMINATED" })).toBe(false);
    expect(opensAccessRemoval({ fromState: "TERMINATED", toState: "ARCHIVED" })).toBe(false);
    expect(opensAccessRemoval({ fromState: "DISABLED", toState: "ACTIVE" })).toBe(false);
  });
});

describe("opensBirthright (owner decision, 13 October 2026)", () => {
  it("assigns birthright to an active joiner, rehire or mover only", () => {
    expect(opensBirthright({ eventType: "joiner", toState: "ACTIVE" })).toBe(true);
    expect(opensBirthright({ eventType: "rehire", toState: "ACTIVE" })).toBe(true);
    expect(opensBirthright({ eventType: "mover", toState: "ACTIVE" })).toBe(true);
    // Before the start date: it comes with the joiner event when they become active.
    expect(opensBirthright({ eventType: "joiner", toState: "PRE_JOIN" })).toBe(false);
    expect(opensBirthright({ eventType: "mover", toState: "LEAVE_PENDING" })).toBe(false);
    expect(opensBirthright({ eventType: "leaver", toState: "LEAVE_PENDING" })).toBe(false);
  });
});

describe("IDENTITY-P0-18 (finish): expiry and the manager's disable", () => {
  it("an end date has passed only after the day itself, and only for working people", () => {
    expect(endDatePassed({ lifecycleState: "ACTIVE", endDate: "2026-10-13" }, "2026-10-14")).toBe(true);
    expect(endDatePassed({ lifecycleState: "ACTIVE", endDate: "2026-10-14" }, "2026-10-14")).toBe(false);
    expect(endDatePassed({ lifecycleState: "ACTIVE", endDate: null }, "2026-10-14")).toBe(false);
    expect(endDatePassed({ lifecycleState: "LEAVE_PENDING", endDate: "2026-01-01" }, "2026-10-14")).toBe(false);
    expect(endDatePassed({ lifecycleState: "PRE_JOIN", endDate: "2026-01-01" }, "2026-10-14")).toBe(false);
  });

  it("their manager or an identity administrator may disable all access; nobody may disable their own", () => {
    const subject = { id: "p1", identityType: "HUMAN", lifecycleState: "ACTIVE" as const, managerIdentityId: "m1" };
    expect(whyCannotDisableAll({ actorIdentityId: "m1", canManageIdentities: false, subject })).toBeNull();
    expect(whyCannotDisableAll({ actorIdentityId: "a1", canManageIdentities: true, subject })).toBeNull();
    expect(whyCannotDisableAll({ actorIdentityId: "x9", canManageIdentities: false, subject })?.status).toBe(403);
    expect(whyCannotDisableAll({ actorIdentityId: null, canManageIdentities: false, subject })?.status).toBe(403);
    expect(whyCannotDisableAll({ actorIdentityId: "p1", canManageIdentities: true, subject })?.status).toBe(403);
    expect(whyCannotDisableAll({ actorIdentityId: "m1", canManageIdentities: false, subject: { ...subject, lifecycleState: "DISABLED" } })?.status).toBe(409);
    expect(whyCannotDisableAll({ actorIdentityId: "m1", canManageIdentities: false, subject: { ...subject, lifecycleState: "LEAVE_PENDING" } })).toBeNull();
    expect(whyCannotDisableAll({ actorIdentityId: "a1", canManageIdentities: true, subject: { ...subject, identityType: "SERVICE_ACCOUNT" } })?.status).toBe(400);
  });
});
