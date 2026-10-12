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
  | "lifecycle_violation"
  | "governance_drift"
  // RISK-P0-12: delegation or credential sharing with an ungoverned agent; tools used outside the contract.
  | "suspicious_delegation"
  | "unapproved_tool_use"
  // ACCESS-P0-25: access that appeared on a target after its baseline with no WonderID approval.
  | "rogue_access";

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

export type EvidenceType = "access_grant" | "runtime_event" | "policy_evaluation" | "ownership_fact" | "lifecycle_event" | "governance_baseline" | "agent_relationship";

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
  /** Agent findings only; an access finding about an account is an AccessFinding (ACCESS-P0-25). */
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

/**
 * RISK-P0-11 (master P0-37) — an investigation groups one or more findings
 * under a human reference (INV-2026-001), with status, priority, an
 * assignee and a timeline. It never changes a finding's own state: the
 * findings are remediated and resolved through their own flow, and an
 * investigation can only be marked resolved once none of them is still
 * open.
 */
export type InvestigationStatus = "open" | "in_progress" | "awaiting_remediation" | "resolved" | "closed";
export type InvestigationPriority = "critical" | "high" | "medium" | "low";
export type InvestigationEventType = "created" | "status_changed" | "priority_changed" | "assigned" | "finding_added" | "finding_removed" | "note";

export type Investigation = {
  id: string;
  tenantId: string;
  reference: string;
  title: string;
  summary: string | null;
  status: InvestigationStatus;
  priority: InvestigationPriority;
  assigneeId: string | null;
  createdBy: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type InvestigationSummary = Investigation & {
  findingCount: number;
  openFindingCount: number;
  worstSeverity: RiskSeverity | null;
};

export type InvestigationEvent = {
  id: string;
  eventType: InvestigationEventType;
  actorId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type InvestigationDetail = Investigation & {
  findings: RiskFinding[];
  events: InvestigationEvent[];
};

/**
 * ACCESS-P0-25: a finding about access on an application account, which may
 * belong to a person, an external person, a service account or an agent.
 * Stored with the agent findings (risk_findings, category rogue_access) but
 * read through its own contract, so agent views keep their agent.
 */
export type AccessFinding = {
  id: string;
  /** The ticket people quote (RA-000001), per organization; it resolves with the finding (0131). */
  ticketNumber: string | null;
  category: "rogue_access";
  severity: RiskSeverity;
  status: FindingStatus;
  title: string;
  explanation: string;
  recommendation: string;
  accountId: string;
  entitlementId: string | null;
  accessGrantId: string | null;
  applicationId: string | null;
  identityId: string | null;
  agentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  /** RISK-P0-13: the removal request raised for it, and that request's status. */
  remediationRequestId: string | null;
  remediationRequestStatus: string | null;
};

/** What Access reports as rogue now: one entry per account (entitlementId null) or account and entitlement. */
export type RogueAccess = {
  accountId: string;
  entitlementId: string | null;
  accessGrantId: string | null;
  applicationId: string;
  identityId: string | null;
  agentId: string | null;
  /** For the finding's title, e.g. "alice in SAP → Finance". */
  label: string;
  firstSeenAt: string;
  baselineAt: string;
};
