import { describe, expect, it } from "vitest";
import { rogueSeverity, type RogueFacts } from "./rogueSeverity";

const plain: RogueFacts = { privilegeLevel: "standard", accountType: "standard", dataClassification: null, identityType: "HUMAN", identityStatus: "active", otherRogueOnAccount: 0 };

describe("rogueSeverity", () => {
  it("plain rogue access on an active person's standard account is medium, with the two base reasons", () => {
    expect(rogueSeverity(plain)).toEqual({ severity: "medium", score: 50, reasons: ["Appeared after the application's baseline", "No WonderID approval found"] });
  });

  it("administrative privilege makes it high", () => {
    const r = rogueSeverity({ ...plain, privilegeLevel: "admin" });
    expect(r.severity).toBe("high");
    expect(r.reasons).toContain("Administrative privilege");
  });

  it("a leaver holding admin access is critical", () => {
    const r = rogueSeverity({ ...plain, privilegeLevel: "admin", identityStatus: "terminated" });
    expect(r).toMatchObject({ severity: "critical", score: 100 });
    expect(r.reasons).toContain("Held by an identity that is terminated");
  });

  it("sensitive data, external people and unlinked accounts each count", () => {
    expect(rogueSeverity({ ...plain, dataClassification: " PII " }).reasons).toContain("Reaches PII data");
    expect(rogueSeverity({ ...plain, dataClassification: "public" }).score).toBe(50);
    expect(rogueSeverity({ ...plain, identityType: "EXTERNAL" }).score).toBe(60);
    expect(rogueSeverity({ ...plain, identityType: null, identityStatus: null }).reasons).toContain("The account is linked to no identity");
  });

  it("blast radius counts from two other pieces of rogue access on the account", () => {
    expect(rogueSeverity({ ...plain, otherRogueOnAccount: 1 }).score).toBe(50);
    expect(rogueSeverity({ ...plain, otherRogueOnAccount: 2 }).score).toBe(60);
  });

  it("the score never passes 100", () => {
    const r = rogueSeverity({ privilegeLevel: "admin", accountType: "shared", dataClassification: "restricted", identityType: "EXTERNAL", identityStatus: "disabled", otherRogueOnAccount: 9 });
    expect(r.score).toBe(100);
    expect(r.severity).toBe("critical");
  });
});
