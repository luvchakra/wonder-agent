// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DUPLICATE_MATCH_THRESHOLD, computeDuplicateScore } from "./duplicates";

const existing = {
  agentName: "FinanceBot",
  sourceSystem: "saviynt",
  sourceObjectId: "svc-acct-123",
};

describe("computeDuplicateScore — IDENTITY-P0-04", () => {
  it("scores a full source_system+source_object_id match as decisive", () => {
    const result = computeDuplicateScore(existing, {
      agentName: "Finance Bot (renamed)",
      sourceSystem: "saviynt",
      sourceObjectId: "svc-acct-123",
    });
    expect(result.score).toBe(1);
    expect(result.matchedKeys).toEqual(["source_system", "source_object_id"]);
  });

  it("scores a case-insensitive name-only match above the threshold but below 1", () => {
    const result = computeDuplicateScore(existing, {
      agentName: "  financebot  ",
      sourceSystem: "manual",
      sourceObjectId: undefined,
    });
    expect(result.score).toBe(0.6);
    expect(result.score).toBeGreaterThanOrEqual(DUPLICATE_MATCH_THRESHOLD);
    expect(result.matchedKeys).toEqual(["agent_name"]);
  });

  it("scores zero when neither name nor source identity match", () => {
    const result = computeDuplicateScore(existing, {
      agentName: "UnrelatedBot",
      sourceSystem: "manual",
      sourceObjectId: undefined,
    });
    expect(result.score).toBe(0);
    expect(result.matchedKeys).toEqual([]);
  });

  it("does not treat two agents with different source_object_id under the same source_system as a decisive match", () => {
    const result = computeDuplicateScore(existing, {
      agentName: "UnrelatedBot",
      sourceSystem: "saviynt",
      sourceObjectId: "svc-acct-999",
    });
    expect(result.score).toBe(0);
  });

  it("does not treat a missing source_object_id on either side as a match", () => {
    const result = computeDuplicateScore(
      { agentName: "X", sourceSystem: "saviynt", sourceObjectId: null },
      { agentName: "Y", sourceSystem: "saviynt", sourceObjectId: undefined },
    );
    expect(result.score).toBe(0);
  });
});
