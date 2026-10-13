import { describe, expect, it } from "vitest";
import { mfaStepUpNeeded } from "./mfaRequired";

describe("FOUNDATION-P0-27: mfaStepUpNeeded", () => {
  it("asks for MFA only where the organization requires it and the session has not used it", () => {
    expect(mfaStepUpNeeded({ mfaRequired: true }, "aal1")).toBe(true);
    expect(mfaStepUpNeeded({ mfaRequired: true }, null)).toBe(true);
    expect(mfaStepUpNeeded({ mfaRequired: true }, undefined)).toBe(true);
    expect(mfaStepUpNeeded({ mfaRequired: true }, "aal2")).toBe(false);
    expect(mfaStepUpNeeded({ mfaRequired: false }, "aal1")).toBe(false);
    expect(mfaStepUpNeeded({}, "aal1")).toBe(false);
  });
  it("never asks an automation member, which cannot do MFA", () => {
    expect(mfaStepUpNeeded({ mfaRequired: true, automation: true }, "aal1")).toBe(false);
  });
});
