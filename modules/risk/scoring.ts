import "server-only";

import type { RiskFactor, RiskSeverity } from "@/lib/shared/types/risk";

/**
 * RISK-P0-02.2 — the deterministic default weight for each named factor,
 * centralized here (previously inlined as literals in rules.ts) so
 * `getSeverityWeights()` (modules/risk/config.ts) has one canonical
 * fallback to merge tenant overrides (risk_severity_weights) against.
 * Changing a value here changes the product-wide default for every tenant
 * with no override row — a tenant-specific override always takes
 * precedence, and a change to either is always an audited, admin-only
 * action (never silently tunable, never delegated to an LLM per
 * non-negotiable #9).
 */
export const DEFAULT_SEVERITY_WEIGHTS: Record<string, number> = {
  "Production environment access": 20,
  "Sensitive data (PII/financial/confidential) involved": 25,
  "External communication capability": 15,
  "Certification overdue": 15,
  "Active policy violation": 15,
  "Runtime/behavioral anomaly present": 10,
  "Business criticality high/critical": 10,
  "Missing or invalid ownership": 10,
};

/** Tenant override takes precedence; otherwise the deterministic default. */
export function resolveWeight(factorName: string, overrides: Record<string, number>): number {
  return overrides[factorName] ?? DEFAULT_SEVERITY_WEIGHTS[factorName] ?? 0;
}

/**
 * RISK-P0-02.1 (RISK-P0-02.2 extends the band table with an `info` tier).
 * Deterministic weighted severity, per the backlog's factor table. Bands:
 * 0-9 info, 10-24 low, 25-49 medium, 50-74 high, 75+ critical. `info` is
 * for sub-threshold observations that shouldn't read as `low` risk — a
 * distinct signal from "nothing detected" (no finding at all) and from a
 * genuine `low` finding.
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
  else if (riskScore >= 10) severity = "low";
  else severity = "info";

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
