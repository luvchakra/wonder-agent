import { describe, expect, it } from "vitest";
import { escalationTarget, resolveReviewer, selfCertificationRefused, validateUntil } from "./identityReviewRules";

const people = { subjectUserId: "u-ana", managerUserId: "u-mgr", applicationOwnerUserId: "u-own" };

describe("reviews of people's access (COMPLIANCE-P0-10)", () => {
  it("goes to the manager, the application owner or the named reviewer", () => {
    expect(resolveReviewer("manager", people, "u-named")).toEqual({ reviewerId: "u-mgr", fallback: false });
    expect(resolveReviewer("application_owner", people, "u-named")).toEqual({ reviewerId: "u-own", fallback: false });
    expect(resolveReviewer("named", people, "u-named")).toEqual({ reviewerId: "u-named", fallback: false });
  });

  it("falls back to the named reviewer when nobody fits, or when the choice is the person themself", () => {
    expect(resolveReviewer("manager", { ...people, managerUserId: null }, "u-named")).toEqual({ reviewerId: "u-named", fallback: true });
    expect(resolveReviewer("application_owner", { ...people, applicationOwnerUserId: "u-ana" }, "u-named")).toEqual({ reviewerId: "u-named", fallback: true });
  });

  it("never lets anyone certify their own access, but lets them revoke it", () => {
    expect(selfCertificationRefused("approve", "u-ana", "u-ana")).toBe(true);
    expect(selfCertificationRefused("revoke", "u-ana", "u-ana")).toBe(false);
    expect(selfCertificationRefused("approve", "u-mgr", "u-ana")).toBe(false);
    expect(selfCertificationRefused("approve", "u-mgr", null)).toBe(false);
  });
});

describe("defer, escalate and exception (COMPLIANCE-P0-10 part 2)", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  it("a defer runs to a future date at most 30 days away; an exception at most 90", () => {
    expect(validateUntil("defer", "2026-10-20T00:00:00Z", now)).toEqual({ until: "2026-10-20T00:00:00.000Z" });
    expect(validateUntil("defer", "2026-12-01T00:00:00Z", now)).toHaveProperty("error");
    expect(validateUntil("exception", "2026-12-01T00:00:00Z", now)).toEqual({ until: "2026-12-01T00:00:00.000Z" });
    expect(validateUntil("exception", "2027-02-01T00:00:00Z", now)).toHaveProperty("error");
    expect(validateUntil("exception", "2026-10-13T00:00:00Z", now)).toHaveProperty("error");
    expect(validateUntil("exception", undefined, now)).toHaveProperty("error");
    expect(validateUntil("exception", "not a date", now)).toHaveProperty("error");
    expect(validateUntil("approve", "2026-10-20T00:00:00Z", now)).toEqual({ until: null });
  });
  it("nobody keeps their own access by exception either", () => {
    expect(selfCertificationRefused("exception", "u-ana", "u-ana")).toBe(true);
    expect(selfCertificationRefused("defer", "u-ana", "u-ana")).toBe(false);
  });
  it("escalation goes to whoever launched the campaign, never back to the person escalating", () => {
    expect(escalationTarget("u-lead", "u-rev")).toBe("u-lead");
    expect(escalationTarget("u-lead", "u-lead")).toBeNull();
    expect(escalationTarget(null, "u-rev")).toBeNull();
  });
});
