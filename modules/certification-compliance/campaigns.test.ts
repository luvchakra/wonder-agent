// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeRecommendation } from "./campaigns";

describe("computeRecommendation — COMPLIANCE-P0-01.2, the PRD's worked table", () => {
  it("reproduces the PRD's exact three rows", () => {
    // FinanceBot / Snowflake READ / High / Used -> Review
    expect(computeRecommendation("high", "used")).toBe("review");
    // FinanceBot / SAP READ / Low / Used -> Keep
    expect(computeRecommendation("low", "used")).toBe("keep");
    // FinanceBot / S3 READ / Medium / Never -> Remove
    expect(computeRecommendation("medium", "never")).toBe("remove");
  });

  it("high/critical risk is always 'review', regardless of usage", () => {
    expect(computeRecommendation("critical", "never")).toBe("review");
    expect(computeRecommendation("high", "unknown")).toBe("review");
  });

  it("never-used at medium+ risk (but below high) is 'remove'", () => {
    expect(computeRecommendation("medium", "never")).toBe("remove");
  });

  it("low risk or used access defaults to 'keep'", () => {
    expect(computeRecommendation("low", "never")).toBe("keep");
    expect(computeRecommendation(null, "never")).toBe("keep");
    expect(computeRecommendation("medium", "used")).toBe("keep");
    expect(computeRecommendation("medium", "unknown")).toBe("keep");
  });
});
