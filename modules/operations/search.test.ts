// @vitest-environment node
import { describe, expect, it } from "vitest";
import { maskRiskField } from "./search";

describe("maskRiskField — OPERATIONS-P0-03.2", () => {
  it("masks the field entirely when the caller lacks risk.read, regardless of the raw value", () => {
    expect(maskRiskField("critical", false)).toEqual({ riskSeverity: null, riskMasked: true });
    expect(maskRiskField(null, false)).toEqual({ riskSeverity: null, riskMasked: true });
  });

  it("passes the real value through, unmasked, when the caller has risk.read", () => {
    expect(maskRiskField("high", true)).toEqual({ riskSeverity: "high", riskMasked: false });
  });

  it("distinguishes 'visible but no finding' from 'masked' — both are riskSeverity: null but riskMasked differs", () => {
    const visibleNoFinding = maskRiskField(null, true);
    const maskedFromCaller = maskRiskField(null, false);
    expect(visibleNoFinding.riskSeverity).toBeNull();
    expect(visibleNoFinding.riskMasked).toBe(false);
    expect(maskedFromCaller.riskSeverity).toBeNull();
    expect(maskedFromCaller.riskMasked).toBe(true);
  });
});
