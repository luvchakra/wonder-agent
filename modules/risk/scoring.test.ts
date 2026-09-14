// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyProhibitedDataOverride, computeSeverity, resolveWeight, DEFAULT_SEVERITY_WEIGHTS } from "./scoring";
import type { RiskFactor } from "@/lib/shared/types/risk";

describe("computeSeverity — RISK-P0-02.1 / RISK-P0-02.2's info tier", () => {
  it("bands scores correctly at each boundary, including the info floor", () => {
    const factor = (weight: number, triggered: boolean): RiskFactor => ({ name: "f", weight, triggered });
    expect(computeSeverity([factor(0, true)]).severity).toBe("info");
    expect(computeSeverity([factor(9, true)]).severity).toBe("info");
    expect(computeSeverity([factor(10, true)]).severity).toBe("low");
    expect(computeSeverity([factor(24, true)]).severity).toBe("low");
    expect(computeSeverity([factor(25, true)]).severity).toBe("medium");
    expect(computeSeverity([factor(49, true)]).severity).toBe("medium");
    expect(computeSeverity([factor(50, true)]).severity).toBe("high");
    expect(computeSeverity([factor(74, true)]).severity).toBe("high");
    expect(computeSeverity([factor(75, true)]).severity).toBe("critical");
  });

  it("computes info severity when nothing is triggered", () => {
    expect(computeSeverity([{ name: "f", weight: 20, triggered: false }]).severity).toBe("info");
  });

  it("only sums triggered factors, and lists their names as reasons", () => {
    const factors: RiskFactor[] = [
      { name: "A", weight: 20, triggered: true },
      { name: "B", weight: 30, triggered: false },
      { name: "C", weight: 10, triggered: true },
    ];
    const result = computeSeverity(factors);
    expect(result.riskScore).toBe(30);
    expect(result.reasons).toEqual(["A", "C"]);
  });
});

describe("applyProhibitedDataOverride — the backlog's explicit override", () => {
  it("forces critical when a sensitive_data_violation touches prohibited data, even at a low base score", () => {
    const result = applyProhibitedDataOverride("high", ["Sensitive data involved"], true);
    expect(result.severity).toBe("critical");
    expect(result.reasons).toContain("Prohibited data classification accessed (explicit override)");
  });

  it("does not touch severity when the finding isn't a prohibited-data violation", () => {
    const result = applyProhibitedDataOverride("medium", ["Something"], false);
    expect(result).toEqual({ severity: "medium", reasons: ["Something"] });
  });

  it("is a no-op when already critical", () => {
    const result = applyProhibitedDataOverride("critical", ["X"], true);
    expect(result).toEqual({ severity: "critical", reasons: ["X"] });
  });
});

describe("resolveWeight — RISK-P0-02.2's configurable severity weights", () => {
  it("falls back to the deterministic default when no override exists for the factor", () => {
    const name = "Production environment access";
    expect(resolveWeight(name, {})).toBe(DEFAULT_SEVERITY_WEIGHTS[name]);
  });

  it("prefers a tenant override over the default", () => {
    const name = "Production environment access";
    expect(resolveWeight(name, { [name]: 99 })).toBe(99);
  });

  it("resolves to 0 for an unknown factor with no override", () => {
    expect(resolveWeight("Not a real factor", {})).toBe(0);
  });
});
