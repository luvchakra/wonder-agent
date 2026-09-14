/**
 * Shared contracts owned by the Risk Agent (docs/plan/06-RISK-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining finding/risk shapes, and
 * must read/write risk data only through modules/risk/service.ts — never by
 * querying risk_findings/risk_evidence directly.
 */

export type RogueCategory =
  | "excessive_access"
  | "unauthorized_resource"
  | "unauthorized_action"
  | "sensitive_data_violation"
  | "behavioral_deviation"
  | "identity_anomaly"
  | "ownership_violation"
  | "lifecycle_violation";

export type RiskSeverity = "info" | "low" | "medium" | "high" | "critical";

/**
 * RISK-P0-03.4 — `remediation_in_progress` maps onto the requirements
 * package's REMEDIATION_PENDING in meaning; kept unrenamed to avoid an
 * unnecessary breaking change to an already-Done contract.
 */
export type FindingStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "assigned"
  | "remediation_in_progress"
  | "mitigated"
  | "resolved"
  | "false_positive"
  | "exception";

export type EvidenceType = "access_grant" | "runtime_event" | "policy_evaluation" | "ownership_fact" | "lifecycle_event";

export type RiskEvidence = {
  id: string;
  findingId: string;
  evidenceType: EvidenceType;
  referenceId: string;
  summary: string;
  createdAt: string;
};

export type ResolutionType = "verified_fixed" | "accepted_risk" | "false_positive";

export type RiskFinding = {
  id: string;
  tenantId: string;
  agentId: string;
  category: RogueCategory;
  severity: RiskSeverity;
  riskScore: number;
  reasons: string[];
  title: string;
  explanation: string;
  recommendation: string;
  status: FindingStatus;
  assignedTo: string | null;
  resolutionType: ResolutionType | null;
  resolutionReason: string | null;
  policyId: string | null;
  correlationId: string;
  createdAt: string;
  resolvedAt: string | null;
  /** RISK-P0-01.4 — which version of the deterministic rule engine produced this finding. */
  evaluatorVersion: number;
  /** RISK-P0-03.5 — set only when status is false_positive and a re-check expiry was chosen. */
  falsePositiveExpiresAt: string | null;
  evidence?: RiskEvidence[];
};

/** One factor contributing to a finding's severity/risk score (RISK-P0-02.1). */
export type RiskFactor = {
  name: string;
  weight: number;
  triggered: boolean;
};

export type FindingFilter = {
  agentId?: string;
  status?: FindingStatus;
  category?: RogueCategory;
  severity?: RiskSeverity;
};
