import "server-only";

import type {
  CertificationCampaign,
  CertificationDecision,
  CertificationItem,
  ControlEvidence,
  ControlFramework,
  ControlMapping,
} from "@/lib/shared/types/compliance";
import type { Control } from "@/lib/shared/types/compliance";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toCertificationCampaign(row: any): CertificationCampaign {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    scopeType: row.scope_type,
    scope: row.scope ?? {},
    cadence: row.cadence,
    status: row.status,
    dueDate: row.due_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function toCertificationItem(row: any): CertificationItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    campaignId: row.campaign_id,
    agentId: row.agent_id,
    accessGrantId: row.access_grant_id,
    reviewerId: row.reviewer_id,
    riskAtReview: row.risk_at_review,
    usageAtReview: row.usage_at_review,
    recommendation: row.recommendation,
    status: row.status,
    dueDate: row.due_date,
    createdAt: row.created_at,
  };
}

export function toCertificationDecision(row: any): CertificationDecision {
  return {
    id: row.id,
    itemId: row.item_id,
    decision: row.decision,
    justification: row.justification,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    remediationId: row.remediation_id,
  };
}

export function toControlFramework(row: any): ControlFramework {
  return { id: row.id, displayName: row.display_name };
}

export function toControl(row: any): Control {
  return { id: row.id, frameworkId: row.framework_id, controlRef: row.control_ref, requirement: row.requirement };
}

export function toControlMapping(row: any): ControlMapping {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    controlId: row.control_id,
    policyId: row.policy_id,
    status: row.status,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}

export function toControlEvidence(row: any): ControlEvidence {
  return {
    id: row.id,
    controlMappingId: row.control_mapping_id,
    evidenceType: row.evidence_type,
    referenceId: row.reference_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
}
