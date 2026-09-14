/**
 * Shared contracts owned by the Identity Agent (docs/plan/02-IDENTITY-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining agent identity shapes, and
 * must read agent data only through modules/agent-identity/service.ts — never
 * by querying agents/agent_contracts/etc. directly.
 */

export type AgentLifecycleState =
  | "DISCOVERED"
  | "REGISTERED"
  | "ASSESSED"
  | "APPROVED"
  | "PROVISIONED"
  | "ACTIVE"
  | "CERTIFICATION_DUE"
  | "RESTRICTED"
  | "SUSPENDED"
  | "RETIRED";

export type AgentEnvironment = "production" | "staging" | "development";
export type AgentCriticality = "low" | "medium" | "high" | "critical";

export type Agent = {
  id: string;
  tenantId: string;
  agentName: string;
  displayName: string | null;
  description: string | null;
  purpose: string | null;
  agentType: string;
  agentFramework: string | null;
  modelProvider: string | null;
  modelName: string | null;
  modelVersion: string | null;
  runtime: string | null;
  environment: AgentEnvironment;
  criticality: AgentCriticality;
  dataClassification: string | null;
  status: string;
  lifecycleState: AgentLifecycleState;
  sourceSystem: string | null;
  sourceObjectId: string | null;
  enterpriseIdentityId: string | null;
  serviceAccountId: string | null;
  riskScore: number | null;
  postureScore: number | null;
  createdAt: string;
  activatedAt: string | null;
  lastSeenAt: string | null;
  nextReviewAt: string | null;
  retirementDate: string | null;
};

export type AgentIdentityType =
  | "service_account"
  | "human_delegate"
  | "oauth_client"
  | "workload_identity"
  | "api_key"
  | "mcp_server";

export type AgentIdentityLink = {
  id: string;
  tenantId: string;
  agentId: string;
  identityType: AgentIdentityType;
  externalReference: string;
  sourceSystem: string;
  confidence: "unverified" | "probable" | "confirmed";
  status: "active" | "stale" | "removed";
  createdAt: string;
};

export type AgentOwnerType =
  | "business_owner"
  | "technical_owner"
  | "iam_owner"
  | "application_owner"
  | "data_owner";

export type AgentOwner = {
  id: string;
  tenantId: string;
  agentId: string;
  ownerType: AgentOwnerType;
  userId: string;
  assignedAt: string;
  removedAt: string | null;
};

export type OwnershipIssue =
  | { type: "missing_owner"; ownerType: "business_owner" | "technical_owner" }
  | { type: "inactive_owner"; ownerType: AgentOwnerType; userId: string }
  | { type: "ownership_conflict"; userId: string; ownerTypes: AgentOwnerType[] }
  | { type: "missing_recommended_owner"; ownerType: "iam_owner" | "application_owner" };

export type AgentLifecycleEvent = {
  id: string;
  tenantId: string;
  agentId: string;
  fromState: AgentLifecycleState | null;
  toState: AgentLifecycleState;
  reason: string;
  actorId: string | null;
  actorType: "user" | "system";
  createdAt: string;
};

export type CertificationFrequency = "monthly" | "quarterly" | "semiannual" | "annual";
export type MaximumRisk = "low" | "medium" | "high";

export type AgentContract = {
  id: string;
  tenantId: string;
  agentId: string;
  purpose: string;
  ownerSummary: string | null;
  approvedApplications: string[];
  approvedData: string[];
  prohibitedData: string[];
  approvedActions: string[];
  prohibitedActions: string[];
  certificationFrequency: CertificationFrequency;
  maximumRisk: MaximumRisk;
  status: "draft" | "active" | "superseded";
  version: number;
  createdAt: string;
  supersededAt: string | null;
};

export type AgentRelationshipType =
  | "delegates_to"
  | "depends_on"
  | "shares_credential_with"
  | "orchestrates";

export type AgentRelationship = {
  id: string;
  tenantId: string;
  agentId: string;
  relatedAgentId: string;
  relationshipType: AgentRelationshipType;
  createdAt: string;
};

export type AgentFilter = {
  status?: "discovered_unregistered";
  lifecycleState?: AgentLifecycleState;
};

// IDENTITY-P0-04 — Duplicate Detection & Merge/Review Workflow.
export type DuplicateCandidateStatus = "pending" | "merged" | "confirmed_distinct";

export type DuplicateCandidate = {
  id: string;
  tenantId: string;
  matchedAgentId: string;
  candidateData: Record<string, unknown>;
  matchScore: number;
  matchedKeys: string[];
  status: DuplicateCandidateStatus;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type CreateAgentResult =
  | { kind: "created"; agent: Agent }
  | { kind: "duplicate_candidate"; candidate: DuplicateCandidate };

// IDENTITY-P0-05 — Discovery Reconciliation & Orphaned Identity Detection.
export type DiscoveryCategory = "new" | "likely_duplicate" | "orphaned_identity";

export type DiscoveryInboxEntry = {
  externalId: string;
  integrationId: string;
  sourceSystem: string;
  displayName: string;
  category: DiscoveryCategory;
  /** Present only when category is "likely_duplicate". */
  likelyDuplicateOfAgentId?: string;
  raw: Record<string, unknown>;
};
