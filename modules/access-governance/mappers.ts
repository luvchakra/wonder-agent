import "server-only";

import type {
  AccessGrant,
  AccessRequest,
  Account,
  Application,
  Entitlement,
  Policy,
  PolicyEvaluationResult,
  PolicyException,
  PolicyRule,
  PolicyVersionRecord,
} from "@/lib/shared/types/access-governance";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toApplication(row: any): Application {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    category: row.category,
    sourceIntegrationId: row.source_integration_id,
    isExternal: row.is_external,
    createdAt: row.created_at,
  };
}

export function toAccount(row: any): Account {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    applicationId: row.application_id,
    externalAccountRef: row.external_account_ref,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function toEntitlement(row: any): Entitlement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    applicationId: row.application_id,
    name: row.name,
    dataClassification: row.data_classification,
    privilegeLevel: row.privilege_level,
    createdAt: row.created_at,
  };
}

export function toAccessGrant(row: any): AccessGrant {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    entitlementId: row.entitlement_id,
    grantType: row.grant_type,
    sourceIntegrationId: row.source_integration_id,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

export function toAccessRequest(row: any): AccessRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    requestedBy: row.requested_by,
    applicationId: row.application_id,
    entitlementId: row.entitlement_id,
    requestType: row.request_type,
    justification: row.justification,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export function toPolicy(row: any): Policy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    policyCategory: row.policy_category,
    scope: row.scope ?? {},
    severity: row.severity,
    action: row.action,
    exceptionProcess: row.exception_process,
    ownerId: row.owner_id,
    effectiveDate: row.effective_date,
    expiryDate: row.expiry_date,
    status: row.status,
    version: row.version ?? 1,
    priority: row.priority ?? 0,
  };
}

export function toPolicyVersionRecord(row: any): PolicyVersionRecord {
  return {
    id: row.id,
    policyId: row.policy_id,
    version: row.version,
    snapshot: row.snapshot ?? {},
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  };
}

export function toPolicyRule(row: any): PolicyRule {
  return {
    id: row.id,
    policyId: row.policy_id,
    ruleType: row.rule_type,
    condition: row.condition,
    createdAt: row.created_at,
  };
}

export function toPolicyException(row: any): PolicyException {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    policyId: row.policy_id,
    scopeType: row.scope_type ?? "policy",
    scopeId: row.scope_id ?? null,
    agentId: row.agent_id,
    reason: row.reason,
    businessJustification: row.business_justification ?? null,
    approvedBy: row.approved_by,
    compensatingControl: row.compensating_control ?? null,
    residualRisk: row.residual_risk ?? null,
    status: row.status ?? "active",
    startDate: row.start_date ?? row.created_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function toPolicyEvaluationResult(row: any): PolicyEvaluationResult {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    policyId: row.policy_id,
    agentId: row.agent_id,
    result: row.result,
    evidence: row.evidence ?? {},
    evaluatedAt: row.evaluated_at,
    policyVersion: row.policy_version ?? 1,
  };
}
