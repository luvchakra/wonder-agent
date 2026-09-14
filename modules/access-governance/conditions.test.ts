// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluateCondition } from "./conditions";
import type { PolicyCondition } from "@/lib/shared/types/access-governance";

describe("evaluateCondition — ACCESS-P0-02.2 deterministic rule interpreter", () => {
  it("evaluates each comparison operator", () => {
    expect(evaluateCondition({ field: "x", op: "eq", value: 1 }, { x: 1 })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "eq", value: 1 }, { x: 2 })).toBe(false);
    expect(evaluateCondition({ field: "x", op: "ne", value: 1 }, { x: 2 })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "gt", value: 5 }, { x: 6 })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "gte", value: 5 }, { x: 5 })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "lt", value: 5 }, { x: 4 })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "lte", value: 5 }, { x: 5 })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "in", value: ["a", "b"] }, { x: "a" })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "in", value: ["a", "b"] }, { x: "c" })).toBe(false);
    expect(evaluateCondition({ field: "x", op: "contains", value: "a" }, { x: ["a", "b"] })).toBe(true);
  });

  it("returns undefined (not false) for a field that isn't known yet", () => {
    expect(evaluateCondition({ field: "agent.external_communication", op: "eq", value: true }, {})).toBeUndefined();
  });

  it("'all' is false if any sub-condition is false, even if another is unknown", () => {
    const condition: PolicyCondition = {
      all: [
        { field: "known", op: "eq", value: true },
        { field: "unknown", op: "eq", value: true },
      ],
    };
    expect(evaluateCondition(condition, { known: false })).toBe(false);
  });

  it("'all' is undefined (not true) when every known sub-condition passes but one is unknown", () => {
    const condition: PolicyCondition = {
      all: [
        { field: "known", op: "eq", value: true },
        { field: "unknown", op: "eq", value: true },
      ],
    };
    expect(evaluateCondition(condition, { known: true })).toBeUndefined();
  });

  it("'any' is true if one sub-condition is true, regardless of unknowns", () => {
    const condition: PolicyCondition = {
      any: [
        { field: "a", op: "eq", value: true },
        { field: "unknown", op: "eq", value: true },
      ],
    };
    expect(evaluateCondition(condition, { a: true })).toBe(true);
  });

  it("'any' is false only when every sub-condition is known false", () => {
    const condition: PolicyCondition = {
      any: [
        { field: "a", op: "eq", value: true },
        { field: "b", op: "eq", value: true },
      ],
    };
    expect(evaluateCondition(condition, { a: false, b: false })).toBe(false);
  });

  it("worked example — ABAC: PII + external_communication (PRD section 19)", () => {
    const condition: PolicyCondition = {
      all: [
        { field: "agent.data_classification", op: "eq", value: "PII" },
        { field: "agent.external_communication", op: "eq", value: true },
      ],
    };
    // Both known and true -> violation.
    expect(
      evaluateCondition(condition, { "agent.data_classification": "PII", "agent.external_communication": true }),
    ).toBe(true);
    // data_classification known and doesn't match -> not a violation, definitively.
    expect(
      evaluateCondition(condition, { "agent.data_classification": "financial", "agent.external_communication": true }),
    ).toBe(false);
  });

  it("worked example — resource-based: AI agents may not access PayrollDB (PRD section 19)", () => {
    const condition: PolicyCondition = {
      all: [
        { field: "access.entitlement.application", op: "eq", value: "PayrollDB" },
        { field: "access.granted", op: "eq", value: true },
      ],
    };
    expect(
      evaluateCondition(condition, { "access.entitlement.application": "PayrollDB", "access.granted": true }),
    ).toBe(true);
    expect(
      evaluateCondition(condition, { "access.entitlement.application": "Snowflake", "access.granted": true }),
    ).toBe(false);
  });
});
