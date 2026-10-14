import { describe, expect, it } from "vitest";
import { resolveReviewer, selfCertificationRefused } from "./identityReviewRules";

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
