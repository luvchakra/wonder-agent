// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canTransition, formatReference, nextSequence, priorityFromSeverities, transitionBlocker, worstSeverity } from "./investigationRules";

describe("investigation rules (RISK-P0-11)", () => {
  it("allows the working transitions and reopening, and nothing else", () => {
    expect(canTransition("open", "in_progress")).toBe(true);
    expect(canTransition("awaiting_remediation", "resolved")).toBe(true);
    expect(canTransition("resolved", "in_progress")).toBe(true);
    expect(canTransition("closed", "in_progress")).toBe(true);
    expect(canTransition("resolved", "closed")).toBe(false);
    expect(canTransition("awaiting_remediation", "open")).toBe(false);
    expect(canTransition("open", "open")).toBe(false);
  });

  it("refuses to resolve while any finding is still open, and needs a resolution", () => {
    expect(transitionBlocker("in_progress", "resolved", ["resolved", "open"], "fixed")).toMatchObject({ code: "FINDINGS_STILL_OPEN", message: expect.stringMatching(/^1 finding is still open/) });
    expect(transitionBlocker("in_progress", "resolved", ["assigned", "remediation_in_progress"], "fixed")?.code).toBe("FINDINGS_STILL_OPEN");
    // Every non-closed status counts as open, including acknowledged and investigating.
    expect(transitionBlocker("in_progress", "resolved", ["acknowledged"], "fixed")?.code).toBe("FINDINGS_STILL_OPEN");
    expect(transitionBlocker("in_progress", "resolved", ["investigating"], "fixed")?.code).toBe("FINDINGS_STILL_OPEN");
    expect(transitionBlocker("in_progress", "resolved", ["mitigated", "exception"], "Accepted with compensating control")).toBeNull();
    expect(transitionBlocker("in_progress", "resolved", ["resolved", "false_positive"], "  ")?.code).toBe("RESOLUTION_REQUIRED");
    expect(transitionBlocker("in_progress", "resolved", ["resolved", "false_positive"], "Entitlement revoked, re-evaluated clean")).toBeNull();
  });

  it("closing without resolution needs a reason; an invalid move is named", () => {
    expect(transitionBlocker("open", "closed", ["open"], null)?.code).toBe("REASON_REQUIRED");
    expect(transitionBlocker("open", "closed", ["open"], "Duplicate of INV-2026-001")).toBeNull();
    expect(transitionBlocker("resolved", "closed", [], "x")?.code).toBe("INVALID_TRANSITION");
  });

  it("defaults priority to the worst grouped severity", () => {
    expect(priorityFromSeverities(["low", "critical", "medium"])).toBe("critical");
    expect(priorityFromSeverities(["medium", "low"])).toBe("medium");
    expect(priorityFromSeverities(["info"])).toBe("low");
    expect(worstSeverity([])).toBeNull();
  });

  it("allocates INV-<year>-<n> references per year", () => {
    expect(formatReference(2026, 1)).toBe("INV-2026-001");
    expect(formatReference(2026, 1234)).toBe("INV-2026-1234");
    expect(nextSequence(2026, [])).toBe(1);
    expect(nextSequence(2026, ["INV-2026-001", "INV-2026-007", "INV-2025-099"])).toBe(8);
  });
});
