import "server-only";

import type { RiskFactor, RiskSeverity } from "@/lib/shared/types/risk";

/**
 * RISK-P0-02.1. Deterministic weighted severity, per the backlog's factor
 * table. Bands: 0-24 low, 25-49 medium, 50-74 high, 75+ critical.
 *
 * Flagged, not silently assumed (per the backlog's own worked-through
 * caveat): two factors have no real source yet — "external communication
 * capability" (no module models this concept) and "no certification in
 * >90 days" (Compliance Agent, the source of certification decisions,
 * doesn't exist in the run order yet) — both always contribute 0 until
 * those modules exist, exactly as the backlog instructs rather than
 * guessing a value.
 */
export function computeSeverity(factors: RiskFactor[]): { severity: RiskSeverity; riskScore: number; reasons: string[] } {
  const riskScore = factors.reduce((sum, f) => sum + (f.triggered ? f.weight : 0), 0);
  const reasons = factors.filter((f) => f.triggered).map((f) => f.name);

  let severity: RiskSeverity;
  if (riskScore >= 75) severity = "critical";
  else if (riskScore >= 50) severity = "high";
  else if (riskScore >= 25) severity = "medium";
  else severity = "low";

  return { severity, riskScore, reasons };
}

/**
 * RISK-P0-02.1's explicit override: "any sensitive_data_violation finding
 * where the data classification is explicitly prohibited_data on the
 * contract is always at least critical, regardless of computed score" —
 * implemented as an explicit, auditable override rather than tuned
 * weights, per the backlog's own instruction.
 */
export function applyProhibitedDataOverride(
  severity: RiskSeverity,
  reasons: string[],
  isProhibitedDataViolation: boolean,
): { severity: RiskSeverity; reasons: string[] } {
  if (!isProhibitedDataViolation || severity === "critical") {
    return { severity, reasons };
  }
  return {
    severity: "critical",
    reasons: [...reasons, "Prohibited data classification accessed (explicit override)"],
  };
}
