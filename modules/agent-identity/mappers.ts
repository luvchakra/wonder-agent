import "server-only";

import type {
  Agent,
  AgentContract,
  AgentIdentityLink,
  AgentLifecycleEvent,
  AgentOwner,
  AgentRelationship,
} from "@/lib/shared/types/agent-identity";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toAgent(row: any): Agent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentName: row.agent_name,
    displayName: row.display_name,
    description: row.description,
    purpose: row.purpose,
    agentType: row.agent_type,
    agentFramework: row.agent_framework,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    modelVersion: row.model_version,
    runtime: row.runtime,
    environment: row.environment,
    criticality: row.criticality,
    dataClassification: row.data_classification,
    status: row.status,
    lifecycleState: row.lifecycle_state,
    sourceSystem: row.source_system,
    sourceObjectId: row.source_object_id,
    enterpriseIdentityId: row.enterprise_identity_id,
    serviceAccountId: row.service_account_id,
    riskScore: row.risk_score,
    postureScore: row.posture_score,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    lastSeenAt: row.last_seen_at,
    nextReviewAt: row.next_review_at,
    retirementDate: row.retirement_date,
  };
}

export function toAgentContract(row: any): AgentContract {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    purpose: row.purpose,
    ownerSummary: row.owner_summary,
    approvedApplications: row.approved_applications ?? [],
    approvedData: row.approved_data ?? [],
    prohibitedData: row.prohibited_data ?? [],
    approvedActions: row.approved_actions ?? [],
    prohibitedActions: row.prohibited_actions ?? [],
    certificationFrequency: row.certification_frequency,
    maximumRisk: row.maximum_risk,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
  };
}

export function toAgentOwner(row: any): AgentOwner {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    ownerType: row.owner_type,
    userId: row.user_id,
    assignedAt: row.assigned_at,
    removedAt: row.removed_at,
  };
}

export function toAgentLifecycleEvent(row: any): AgentLifecycleEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    fromState: row.from_state,
    toState: row.to_state,
    reason: row.reason,
    actorId: row.actor_id,
    actorType: row.actor_type,
    createdAt: row.created_at,
  };
}

export function toAgentIdentityLink(row: any): AgentIdentityLink {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    identityType: row.identity_type,
    externalReference: row.external_reference,
    sourceSystem: row.source_system,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function toAgentRelationship(row: any): AgentRelationship {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    relatedAgentId: row.related_agent_id,
    relationshipType: row.relationship_type,
    createdAt: row.created_at,
  };
}
