import { describe, expect, it } from "vitest";
import { allowedTransitions, detectLifecycleEvents, statusForState, tasksForEvent } from "./humanLifecycle";

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
