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
