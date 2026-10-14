import { describe, expect, it } from "vitest";
import { modelAfterLines, summarizeBasket, validateBasket, type HeldAccess } from "./requestBasketRules";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const APP = "33333333-3333-3333-3333-333333333333";
const E1 = "44444444-4444-4444-4444-444444444444";
const E2 = "55555555-5555-5555-5555-555555555555";

describe("request baskets (ACCESS-P0-38)", () => {
  it("takes many people and lines, dropping repeats", () => {
    const v = validateBasket({
      subjectIdentityIds: [A, B, A],
      lines: [
        { applicationId: APP, entitlementId: E1, durationDays: "30" },
        { applicationId: APP, entitlementId: E1 },
        { applicationId: APP, entitlementId: E2, requestType: "remove" },
        { applicationId: APP, requestType: "disable_account" },
      ],
      justification: "  New team  ",
    });
    expect(v).toEqual({
      subjects: [A, B],
      lines: [
        { applicationId: APP, entitlementId: E1, requestType: "grant", durationDays: 30 },
        { applicationId: APP, entitlementId: E2, requestType: "remove", durationDays: null },
        { applicationId: APP, entitlementId: null, requestType: "disable_account", durationDays: null },
      ],
      justification: "New team",
    });
  });

  it("refuses a malformed basket, and one too large", () => {
    expect(validateBasket({ subjectIdentityIds: [], lines: [{ applicationId: APP }] })).toMatchObject({ error: expect.stringContaining("subjectIdentityIds") });
    expect(validateBasket({ subjectIdentityIds: ["me"], lines: [{ applicationId: APP }] })).toMatchObject({ error: expect.stringContaining("identity ids") });
    expect(validateBasket({ subjectIdentityIds: [A], lines: [] })).toMatchObject({ error: expect.stringContaining("lines") });
    expect(validateBasket({ subjectIdentityIds: [A], lines: [{ applicationId: APP, requestType: "extend" }] })).toMatchObject({ error: expect.stringContaining("requestType") });
    expect(validateBasket({ subjectIdentityIds: [A], lines: [{ applicationId: APP, durationDays: 0 }] })).toMatchObject({ error: expect.stringContaining("durationDays") });
    const many = Array.from({ length: 21 }, (_, i) => ({ applicationId: APP, entitlementId: `44444444-4444-4444-4444-${String(i).padStart(12, "0")}` }));
    expect(validateBasket({ subjectIdentityIds: [A], lines: many })).toMatchObject({ error: expect.stringContaining("at most 20") });
    const people = Array.from({ length: 11 }, (_, i) => `11111111-1111-1111-1111-${String(i).padStart(12, "0")}`);
    expect(validateBasket({ subjectIdentityIds: people, lines: many.slice(0, 19) })).toMatchObject({ error: expect.stringContaining("200 requests") });
  });

  it("models after someone: their requestable access, minus what the person has or asked for", () => {
    const held = (id: string, name: string, over: Partial<HeldAccess> = {}): HeldAccess => ({
      entitlementId: id,
      entitlementName: name,
      applicationId: APP,
      applicationName: "Ledger",
      requestable: true,
      applicationActive: true,
      ...over,
    });
    const r = modelAfterLines(
      [held("e1", "Reader"), held("e2", "Writer"), held("e3", "Admin", { requestable: false }), held("e4", "Old", { applicationActive: false }), held("e5", "Exporter"), held("e1", "Reader")],
      new Set(["e2"]),
      new Set(["e5"]),
    );
    expect(r.lines.map((l) => l.entitlementId)).toEqual(["e1"]);
    expect(r.skipped.map((s) => [s.entitlementId, s.reason])).toEqual([
      ["e3", "not requestable"],
      ["e5", "already asked for"],
      ["e4", "the application is not live"],
      ["e2", "already has it"],
    ]);
  });

  it("summarizes what happened to each request", () => {
    expect(
      summarizeBasket([
        { subjectIdentityId: A, line: 0, ok: true, requestId: "r1" },
        { subjectIdentityId: A, line: 1, ok: true, requestId: "r2", duplicate: true },
        { subjectIdentityId: B, line: 0, ok: false, code: "NOT_REQUESTABLE" },
        { subjectIdentityId: B, line: 1, ok: false, code: "NOT_REQUESTABLE" },
      ]),
    ).toEqual({ created: 1, existing: 1, refused: 2, byCode: { NOT_REQUESTABLE: 2 } });
  });
});
