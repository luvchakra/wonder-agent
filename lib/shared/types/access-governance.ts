/**
 * Shared contracts owned by the Access Agent (docs/plan/04-ACCESS-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining access/policy shapes,
 * and must read effective access / evaluate policy only through
 * modules/access-governance/service.ts — never by querying
 * access_grants/policies/etc. directly.
 */

// ACCESS-P0-06 — Action Governance's 4-state model (governance requirements
// reconciliation, 2026-09-15), enforced against Identity's IDENTITY-P0-07
// contract fields. Deterministic classification, never an LLM decision
// (non-negotiable #9).
export type ActionGovernanceState = "allowed" | "allowed_with_approval" | "restricted" | "prohibited";

export type ActionGovernanceResult = {
  action: string;
  state: ActionGovernanceState;
};

export type Application = {
  id: string;
  tenantId: string;
  name: string;
  category: string | null;
  sourceIntegrationId: string | null;
  /** ACCESS-P0-02.2 — an external-facing application (email/messaging/public API/etc.), the data source for Risk's "External communication capability" factor. */
  isExternal: boolean;
  createdAt: string;
};

export type AccountStatus = "active" | "disabled";

export type Account = {
  id: string;
  tenantId: string;
  agentId: string;
  applicationId: string;
  externalAccountRef: string;
  status: AccountStatus;
  createdAt: string;
};

export type PrivilegeLevel = "standard" | "elevated" | "admin";

export type Entitlement = {
  id: string;
  tenantId: string;
  applicationId: string;
  name: string;
  dataClassification: string | null;
  privilegeLevel: PrivilegeLevel;
  createdAt: string;
  /** ACCESS-P0-13: the data source this entitlement grants access to, if known. */
  dataSourceId?: string | null;
};

/**
 * ACCESS-P0-13 (master P0-11) — where data lives: a database, warehouse,
 * bucket, file share, SaaS object or API, optionally inside an
 * application, with a classification. Entitlements point at the data
 * source they open, so effective access (CAN) carries it.
 */
export type DataSourceKind = "database" | "warehouse" | "object_store" | "file_share" | "saas" | "api" | "other";
export const DATA_SOURCE_KINDS: DataSourceKind[] = ["database", "warehouse", "object_store", "file_share", "saas", "api", "other"];

export type DataSource = {
  id: string;
  tenantId: string;
  applicationId: string | null;
  applicationName: string | null;
  name: string;
  kind: DataSourceKind;
  classification: string | null;
  owner: string | null;
  description: string | null;
  externalRef: string | null;
  status: "active" | "retired";
  createdAt: string;
  updatedAt: string;
};

/** A data source with what reaches it: linked entitlements and the agents that currently hold one (CAN). */
export type DataSourceWithReach = DataSource & {
  entitlementCount: number;
  agentIds: string[];
};

export type GrantType =
  | "direct"
  | "inherited"
  | "group"
  | "role"
  | "delegated"
  | "token_scope"
  | "oauth_scope"
  | "api_scope"
  | "mcp_tool_permission"
  | "service_account_relationship";

export type AccessGrant = {
  id: string;
  tenantId: string;
  accountId: string;
  entitlementId: string;
  grantType: GrantType;
  sourceIntegrationId: string | null;
  grantedAt: string;
  revokedAt: string | null;
  // Denormalized for convenience (populated by getEffectiveAccess/explainAccessPath
  // — never persisted columns, just joined at read time):
  application?: string;
  applicationId?: string;
  entitlementName?: string;
  dataClassification?: string | null;
  privilegeLevel?: PrivilegeLevel;
  /** ACCESS-P0-13: the data source the entitlement opens, when linked. */
  dataSource?: { id: string; name: string; classification: string | null } | null;
};

export type AccessPathStep = {
  step: "agent_identity" | "account" | "access_grant" | "entitlement";
  ref: string;
  [key: string]: unknown;
};

export type AccessPath = {
  agentId: string;
  resource: string;
  path: AccessPathStep[];
};

export type AccessRequestStatus = "pending" | "approved" | "rejected" | "fulfilled";

/** COMPLIANCE-P0-01.3 — 'grant' is a request for new access; 'modify' is a reviewer-initiated request to change an entitlement already covered by an existing access_grant. */
export type AccessRequestType = "grant" | "modify";

export type AccessRequest = {
  id: string;
  tenantId: string;
  agentId: string;
  requestedBy: string;
  applicationId: string;
  entitlementId: string | null;
  requestType: AccessRequestType;
  justification: string;
  status: AccessRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type PolicyCategory = "identity" | "access" | "runtime" | "agent" | "lifecycle";
export type PolicySeverity = "low" | "medium" | "high" | "critical";
export type PolicyAction = "flag" | "restrict" | "block";
export type PolicyStatus = "draft" | "active" | "disabled";

export type Policy = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  policyCategory: PolicyCategory;
  scope: Record<string, unknown>;
  severity: PolicySeverity;
  action: PolicyAction;
  exceptionProcess: string | null;
  ownerId: string | null;
  effectiveDate: string;
  expiryDate: string | null;
  status: PolicyStatus;
  /** ACCESS-P0-05 — incremented on every updatePolicy() call. */
  version: number;
  /** ACCESS-P0-05, used since ACCESS-P0-12: runtime policies are evaluated
   * highest priority first, and among equally severe outcomes the higher
   * priority decides. */
  priority: number;
};

/** ACCESS-P0-05 — append-only snapshot of a policy's prior state. */
export type PolicyVersionRecord = {
  id: string;
  policyId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changedAt: string;
};

export type UpdatePolicyInput = Partial<{
  name: string;
  description: string | null;
  scope: Record<string, unknown>;
  severity: PolicySeverity;
  action: PolicyAction;
  exceptionProcess: string | null;
  ownerId: string | null;
  expiryDate: string | null;
  status: PolicyStatus;
  priority: number;
}>;

export type PolicyRuleType = "rbac" | "abac" | "resource" | "time";

/**
 * A structured condition tree: a leaf compares one field to a value; `all`/
 * `any` combine sub-conditions. This is the ENTIRE evaluation vocabulary —
 * deliberately not Turing-complete, per non-negotiable #9 (no LLM, and no
 * scripting engine either, in this deterministic path).
 */
export type PolicyCondition =
  | { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains"; value: unknown }
  | { all: PolicyCondition[] }
  | { any: PolicyCondition[] };

export type PolicyRule = {
  id: string;
  policyId: string;
  ruleType: PolicyRuleType;
  condition: PolicyCondition;
  createdAt: string;
};

// ACCESS-P0-07 — the canonical governance-exception model, not scoped to
// access policy alone (governance requirements reconciliation, 2026-09-15).
export type PolicyExceptionScopeType =
  | "policy"
  | "attestation"
  | "certification"
  | "control_mapping"
  | "contract_requirement";

export type PolicyExceptionStatus = "active" | "revoked";

export type PolicyException = {
  id: string;
  tenantId: string;
  /** Only set when scopeType === "policy"; null for other scope types. */
  policyId: string | null;
  scopeType: PolicyExceptionScopeType;
  /** The target row's id when scopeType !== "policy" (e.g. an attestation id). */
  scopeId: string | null;
  agentId: string | null;
  reason: string;
  businessJustification: string | null;
  approvedBy: string;
  compensatingControl: string | null;
  residualRisk: "low" | "medium" | "high" | "critical" | null;
  status: PolicyExceptionStatus;
  startDate: string;
  expiresAt: string | null;
  createdAt: string;
};

export type PolicyEvaluationResult = {
  id: string;
  tenantId: string;
  policyId: string;
  agentId: string;
  result: "pass" | "violation" | "exempted";
  evidence: Record<string, unknown>;
  evaluatedAt: string;
  /** ACCESS-P0-05/06 — the policy's version at evaluation time, so a stored
   * evaluation is reproducible against the exact rule set that produced it. */
  policyVersion: number;
};

// ACCESS-P0-03 — Access Graph.
export type AccessGraphNodeType = "agent" | "account" | "entitlement" | "application";

export type AccessGraphNode = {
  id: string;
  type: AccessGraphNodeType;
  label: string;
  data?: Record<string, unknown>;
};

export type AccessGraphEdge = {
  source: string;
  target: string;
  relation: GrantType | "has_account" | "belongs_to";
};

export type AccessGraph = {
  agentId: string;
  nodes: AccessGraphNode[];
  edges: AccessGraphEdge[];
  /** Flat/tabular equivalent for non-graph UI consumers. */
  rows: AccessGrant[];
};

// ACCESS-P0-04 — Contract Comparison (SHOULD vs CAN), also covers
// ACCESS-P0-10 (Access Change Traceability).
export type ContractComparisonClassification = "approved" | "excessive" | "missing" | "unknown";

export type ContractComparisonRow = {
  classification: ContractComparisonClassification;
  application: string | null;
  entitlement: string | null;
  dataClassification: string | null;
  sourceIntegrationId: string | null;
  /** Best-effort "as of" timestamp for this row's underlying grant — the
   * grant's own grantedAt, since no per-grant sync timestamp is tracked
   * yet (see the Access Agent audit log for this documented simplification). */
  lastSyncedAt: string | null;
  path: AccessPathStep[] | null;
  agentContractId: string;
};

// ACCESS-P0-11 — the deterministic runtime decision (master P0-28–P0-32,
// runtime authorization/decision contracts §11–§12). Access Agent owns the
// decision; Runtime Agent's gateway (RUNTIME-P0-15) calls it and records
// the result (user decision, 2026-09-25). Tenant and agent never come from
// this request: the gateway takes them from the verified agent API key.
export type RuntimeDecisionOutcome = "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "ALLOW_WITH_RESTRICTIONS";

export type RuntimeRequest = {
  /** Caller's idempotency id for this request. */
  requestId: string;
  correlationId?: string;
  action: string;
  application?: string;
  resource?: string;
  tool?: string;
  /** RUNTIME-P0-18: the MCP server a tool call goes through, when it does. */
  mcpServer?: string;
  dataClassification?: string;
  /** Optional: which of the agent's linked identities is acting. Must belong to the agent. */
  identityId?: string;
  intent?: { requestPurpose?: string };
  context?: { environment?: string; sessionId?: string; userId?: string; source?: string; timestamp?: string };
};

export type RuntimeDecisionStepName =
  | "tenant"
  | "identity"
  | "lifecycle"
  | "emergency"
  | "approved_access"
  | "effective_access"
  | "context"
  | "risk"
  | "runtime_policy";

export type RuntimeDecisionStep = {
  step: RuntimeDecisionStepName;
  /** PASS: this step raised nothing. SKIPPED: an earlier step made it meaningless. */
  outcome: RuntimeDecisionOutcome | "PASS" | "SKIPPED";
  code: string;
  reason: string;
};

export type RuntimeRestrictions = {
  readOnly?: boolean;
  maxAmount?: number;
  recordScope?: string[];
  fieldScope?: string[];
  expiresAt?: string;
};

export type RuntimeDecision = {
  decision: RuntimeDecisionOutcome;
  /** Machine-readable code of the step that set the decision. */
  code: string;
  reason: string;
  policyId?: string;
  policyVersion?: number;
  restrictions?: RuntimeRestrictions;
  riskScore?: number;
  /** Every step in evaluation order, so each decision is explainable. */
  steps: RuntimeDecisionStep[];
};

/**
 * ACCESS-P0-12 (master P0-23) — what a policy applies to. Stored in
 * `policies.scope.targets`. A policy with no targets applies to every
 * request in its category; a policy with targets applies only when at
 * least one target matches the request (case-insensitive):
 * - TOOL: the requested tool;
 * - MCP_SERVER: the MCP server the request came through;
 * - MCP_TOOL: "<server>:<tool>", both must match;
 * - DATA_SOURCE: a data source by name, matched against the request's
 *   resource or application;
 * - DATA_RESOURCE: the request's resource, with a trailing `*` as prefix
 *   match (e.g. "CustomerDB.*");
 * - ACTION: the requested action.
 */
export type PolicyTargetType = "TOOL" | "MCP_SERVER" | "MCP_TOOL" | "DATA_SOURCE" | "DATA_RESOURCE" | "ACTION";
export const POLICY_TARGET_TYPES: PolicyTargetType[] = ["TOOL", "MCP_SERVER", "MCP_TOOL", "DATA_SOURCE", "DATA_RESOURCE", "ACTION"];
export type PolicyTarget = { type: PolicyTargetType; value: string };
