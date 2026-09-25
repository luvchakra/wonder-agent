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
  | "data_owner"
  | "escalation_owner"
  // IDENTITY-P0-13: acts for another owner until the delegation expires.
  | "delegated_owner";

export type AgentOwner = {
  id: string;
  tenantId: string;
  agentId: string;
  ownerType: AgentOwnerType;
  userId: string;
  assignedAt: string;
  removedAt: string | null;
  /** IDENTITY-P0-13: set for a delegated owner. */
  delegatedBy?: string | null;
  delegationExpiresAt?: string | null;
  /** IDENTITY-P0-13: the last ownership review that confirmed this owner. */
  lastReviewedAt?: string | null;
  lastReviewedBy?: string | null;
};

export type OwnershipIssue =
  | { type: "missing_owner"; ownerType: "business_owner" | "technical_owner" }
  | { type: "inactive_owner"; ownerType: AgentOwnerType; userId: string }
  | { type: "ownership_conflict"; userId: string; ownerTypes: AgentOwnerType[] }
  | { type: "missing_recommended_owner"; ownerType: "iam_owner" | "application_owner" }
  // IDENTITY-P0-13: a delegated owner whose delegation has expired still holds the row.
  | { type: "delegation_expired"; userId: string; expiredAt: string };

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

/**
 * Human Oversight / Autonomy Model (governance requirements reconciliation,
 * 2026-09-15). 0=human performs action, 1=agent recommends, 2=agent acts
 * with human approval, 3=agent acts autonomously within defined limits,
 * 4=high autonomy with continuous controls.
 */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

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
  // IDENTITY-P0-07 — autonomy/oversight fields.
  autonomyLevel: AutonomyLevel;
  allowedTools: string[];
  actionsRequiringApproval: string[];
  requiredMonitoring: string | null;
  requiredComplianceControls: string[];
  // IDENTITY-P0-13 — who may use or delegate to the agent, where it may
  // run, and until when this contract is valid. Empty means not restricted.
  approvedUsers: string[];
  approvedDelegators: string[];
  allowedEnvironments: AgentEnvironment[];
  expiresAt: string | null;
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
// "ignored"/"linked" statuses were added for the Agent Discovery extension —
// see DiscoveryDecisionType below; this remains one table/type, not a
// parallel discovery-decision model.
export type DuplicateCandidateStatus = "pending" | "merged" | "confirmed_distinct" | "ignored" | "linked";
export type DuplicateCandidateDecisionType = "duplicate_review" | "ignored" | "linked";

export type DuplicateCandidate = {
  id: string;
  tenantId: string;
  matchedAgentId: string | null;
  candidateData: Record<string, unknown>;
  matchScore: number;
  matchedKeys: string[];
  status: DuplicateCandidateStatus;
  decisionType: DuplicateCandidateDecisionType;
  sourceSystem: string | null;
  sourceObjectId: string | null;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type CreateAgentResult =
  | { kind: "created"; agent: Agent }
  | { kind: "duplicate_candidate"; candidate: DuplicateCandidate };

// IDENTITY-P0-05 — Discovery Reconciliation & Orphaned Identity Detection.
/** "shadow_ai" (IDENTITY-P0-12): runtime activity from an agent nobody registered. */
export type DiscoveryCategory = "new" | "likely_duplicate" | "orphaned_identity" | "shadow_ai";

/**
 * Fully Functional Agent Discovery (2026-09-15 extension of IDENTITY-P0-05).
 * Deterministic (non-negotiable #9 — never LLM-decided) AI-agent detection
 * classification. Every entry that isn't NON_AGENT is evidence-backed via
 * `DetectionSignal[]` on `DiscoveryInboxEntry.signals`.
 */
export type DetectionClassification =
  | "CONFIRMED_AGENT"
  | "PROBABLE_AGENT"
  | "POSSIBLE_AGENT"
  | "NON_AGENT"
  | "UNKNOWN";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type EvidenceStrength = "strong" | "medium" | "weak";

export type DetectionSignal = {
  signal: string;
  source: string;
  observedValue: string;
  strength: EvidenceStrength;
  scoreContribution: number;
};

/**
 * Best-effort, honestly-scoped change signal: full field-level
 * UPDATED/OWNER_CHANGED/IDENTITY_CHANGED detection would require persisting
 * a prior snapshot per source object, which neither Identity nor Integration
 * currently stores (see the Identity Agent audit log's 2026-09-15 entry for
 * why that isn't added here). "STALE" is genuinely derivable today, from
 * Integration's own `integration_sync_jobs` history: the object wasn't
 * returned by the most recent completed sync of its source.
 */
export type DiscoveryChangeType = "NEW" | "STALE";

export type DiscoveryCandidateStatus = "open" | "ignored" | "linked";
export type DiscoveryDecisionType = "ignored" | "linked";

export type DiscoveryInboxEntry = {
  externalId: string;
  integrationId: string;
  integrationName: string;
  sourceSystem: string;
  displayName: string;
  identityType: AgentIdentityType;
  owner: string | null;
  application: string | null;
  category: DiscoveryCategory;
  /** Present only when category is "likely_duplicate". */
  likelyDuplicateOfAgentId?: string;
  duplicateMatchScore?: number;
  duplicateMatchedKeys?: string[];
  classification: DetectionClassification;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  signals: DetectionSignal[];
  changeType: DiscoveryChangeType;
  candidateStatus: DiscoveryCandidateStatus;
  /** Set when candidateStatus is "linked" — the agent this was correlated to. */
  linkedAgentId?: string;
  lastSeenAt: string;
  raw: Record<string, unknown>;
};

/**
 * IDENTITY-P0-11 (master P0-08) — one row of the non-human identity (NHI)
 * inventory. An NHI is a service account, workload, OAuth client, API key
 * or MCP server identity — never assumed to be an AI agent. `agent` is set
 * only when the identity is linked to a registered agent; an unlinked
 * identity carries the deterministic detection classification from
 * discovery instead, which says how likely it is to be an agent.
 */
export type NhiStatus = "linked" | "unlinked" | "ignored" | "orphaned";

export type NhiInventoryEntry = {
  /** `${sourceSystem}::${externalReference}` — unique per tenant. */
  key: string;
  externalReference: string;
  displayName: string;
  identityType: AgentIdentityType;
  sourceSystem: string;
  sourceName: string;
  status: NhiStatus;
  agent: { id: string; name: string; lifecycleState: string } | null;
  classification: DetectionClassification | null;
  confidenceLevel: ConfidenceLevel | null;
  owner: string | null;
  lastSeenAt: string;
  /** Where to review it: the agent, or the discovery candidate. */
  href: string;
};
