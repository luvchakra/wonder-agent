import { describe, expect, it } from "vitest";
import { answerRefusal, askRefusal } from "./consultationRules";

describe("consultation (COMPLIANCE-P0-14 part 3)", () => {
  const ask = { reviewerId: "u-rev", actorId: "u-rev", itemStatus: "pending", askedOf: "u-ana", question: "Do you still need this?" };
  it("the reviewer asks a member about a pending item", () => {
    expect(askRefusal(ask)).toBeNull();
    expect(askRefusal({ ...ask, actorId: "u-other" })).toMatchObject({ status: 403 });
    expect(askRefusal({ ...ask, itemStatus: "decided" })).toMatchObject({ status: 409 });
    expect(askRefusal({ ...ask, askedOf: null })).toMatchObject({ status: 404 });
    expect(askRefusal({ ...ask, askedOf: "u-rev" })).toMatchObject({ code: "SELF" });
    expect(askRefusal({ ...ask, question: "?" })).toMatchObject({ status: 400 });
  });
  it("only the person asked answers, once", () => {
    const a = { askedOf: "u-ana", actorId: "u-ana", answeredAt: null, answer: "Yes, for the audit" };
    expect(answerRefusal(a)).toBeNull();
    expect(answerRefusal({ ...a, actorId: "u-rev" })).toMatchObject({ status: 404 });
    expect(answerRefusal({ ...a, answeredAt: "2026-10-14T00:00:00Z" })).toMatchObject({ status: 409 });
    expect(answerRefusal({ ...a, answer: "  " })).toMatchObject({ status: 400 });
  });
});
