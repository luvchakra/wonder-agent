/**
 * Shared contracts owned by the Compliance Agent
 * (docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md). Other modules import these
 * instead of redefining certification/control shapes, and must read/write
 * compliance data only through modules/certification-compliance/service.ts
 * — never by querying certification_campaigns/control_mappings/etc. directly.
 */

export type CampaignScopeType = "agent" | "application" | "entitlement" | "privileged_access" | "high_risk_agent";
export type CampaignCadence = "one_time" | "periodic" | "event_driven";
export type CampaignStatus = "draft" | "active" | "completed" | "cancelled";

export type CertificationCampaign = {
  id: string;
  tenantId: string;
  name: string;
  scopeType: CampaignScopeType;
  scope: Record<string, unknown>;
  cadence: CampaignCadence;
  status: CampaignStatus;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
};

export type UsageAtReview = "used" | "never" | "unknown";
export type Recommendation = "keep" | "review" | "remove";
export type ItemStatus = "pending" | "decided";

/**
 * COMPLIANCE-P0-03 — a point-in-time snapshot of everything a reviewer saw:
 * agent contract version, the specific access grant, the policy version(s)
 * it was evaluated against, and risk/usage at that moment. Captured once at
 * item population time (`CertificationItem.snapshot`) and again, freshly,
 * at decision time (`CertificationDecision.snapshot`) — the two can differ
 * if the agent's contract or policies changed in between.
 */
export type CertificationSnapshot = {
  capturedAt: string;
  agentContractId: string | null;
  agentContractVersion: number | null;
  accessGrant: {
    id: string;
    application?: string;
    entitlementName?: string;
    dataClassification?: string | null;
  } | null;
  policyEvaluations: { policyId: string; policyVersion: number; result: string }[];
  riskAtReview: string | null;
  usageAtReview: UsageAtReview | null;
};

export type CertificationItem = {
  id: string;
  tenantId: string;
  campaignId: string;
  agentId: string;
  accessGrantId: string | null;
  reviewerId: string;
  riskAtReview: string | null;
  usageAtReview: UsageAtReview | null;
  recommendation: Recommendation | null;
  status: ItemStatus;
  dueDate: string | null;
  createdAt: string;
  /** COMPLIANCE-P0-03. Null only for items created before this story shipped. */
  snapshot: CertificationSnapshot | null;
  /** COMPLIANCE-P0-05. Set once an overdue item has been escalated. */
  escalatedAt: string | null;
  escalatedTo: string | null;
};

/** COMPLIANCE-P0-05 — a campaign's review-progress and overdue/escalation counts. */
export type CampaignMetrics = {
  totalItems: number;
  pendingItems: number;
  decidedItems: number;
  overdueItems: number;
  escalatedItems: number;
};

export type DecisionType = "approve" | "revoke" | "modify" | "delegate" | "request_information";

export type CertificationDecision = {
  id: string;
  itemId: string;
  decision: DecisionType;
  justification: string;
  decidedBy: string;
  decidedAt: string;
  remediationId: string | null;
  /** COMPLIANCE-P0-03 — a fresh snapshot captured at the moment of this decision. */
  snapshot: CertificationSnapshot | null;
};

export type ControlFramework = {
  id: string;
  displayName: string;
};

export type Control = {
  id: string;
  frameworkId: string;
  controlRef: string;
  requirement: string;
};

export type ControlStatus = "compliant" | "partial" | "non_compliant" | "not_applicable" | "no_evidence";

export type ControlMapping = {
  id: string;
  tenantId: string;
  controlId: string;
  policyId: string | null;
  status: ControlStatus;
  ownerId: string | null;
  createdAt: string;
};

export type ControlEvidenceType = "certification_decision" | "policy_evaluation" | "audit_log" | "manual_attestation";

export type ControlEvidence = {
  id: string;
  controlMappingId: string;
  evidenceType: ControlEvidenceType;
  referenceId: string | null;
  summary: string;
  createdAt: string;
};

/** The certification detail panel's full data contract (COMPLIANCE-P0-01.4). */
export type CertificationItemDetail = CertificationItem & {
  decisions: CertificationDecision[];
};

/**
 * COMPLIANCE-P0-07 — Governance Posture: a composite, explainable status
 * distinct from Risk Agent's risk score (never conflated with it — risk
 * measures threat/impact of observed behavior, posture measures whether
 * the agent's *governance scaffolding itself* — identity, ownership,
 * contract, access, certification, oversight — is intact). Computed
 * on-demand from other modules' published read contracts; never stored,
 * never duplicating another module's table.
 */
export type GovernancePostureStatus = "GOVERNED" | "PARTIALLY_GOVERNED" | "NON_COMPLIANT" | "EXCEPTION_APPROVED" | "SUSPENDED";

export type GovernanceDimension =
  | "identity"
  | "ownership"
  | "purpose"
  | "access"
  | "action_authority"
  | "certification"
  | "runtime_monitoring"
  | "human_oversight"
  | "policy_compliance"
  | "lifecycle"
  | "compliance_controls"
  | "evidence_completeness";

export type GovernanceDimensionResult = {
  dimension: GovernanceDimension;
  status: "governed" | "gap" | "not_applicable";
  reason: string;
};

export type GovernancePosture = {
  agentId: string;
  tenantId: string;
  status: GovernancePostureStatus;
  computedAt: string;
  dimensions: GovernanceDimensionResult[];
  /** Active governance exceptions covering this agent — populated only when status is EXCEPTION_APPROVED. */
  coveringExceptionIds: string[];
};

/**
 * COMPLIANCE-P0-08 — Governance Attestation (broad). Promoted to P0 per the
 * user's 2026-09-15 decision; distinct from and broader than Identity's own
 * narrower `IDENTITY-P1-02` self-attestation concept (which stays P1,
 * unchanged). Fields per the governance requirements doc's P0-13: agent,
 * policy/requirements, checklist, approver, approval timestamp, validity,
 * decision, comments, evidence references.
 */
export type AttestationChecklistItem = { item: string; checked: boolean };
export type AttestationEvidenceReference = { type: string; referenceId: string | null; summary: string };
export type AttestationDecision = "attested" | "rejected" | "needs_more_info";

export type GovernanceAttestation = {
  id: string;
  tenantId: string;
  agentId: string;
  policyRequirement: string;
  checklist: AttestationChecklistItem[];
  approverId: string;
  decision: AttestationDecision;
  comments: string | null;
  evidenceReferences: AttestationEvidenceReference[];
  validFrom: string;
  validUntil: string | null;
  decidedAt: string;
  createdAt: string;
};

/**
 * COMPLIANCE-P0-06 — the assembled evidence bundle for a completed campaign.
 * `contentHash` is a SHA-256 over the canonical JSON of everything else in
 * this object (campaign/items/decisions), so any post-export tampering with
 * a saved copy is detectable by recomputing the hash.
 */
export type EvidenceExportPackage = {
  campaign: CertificationCampaign;
  items: (CertificationItem & { decisions: CertificationDecision[] })[];
  exportedAt: string;
  exportedBy: string;
  contentHash: string;
};
