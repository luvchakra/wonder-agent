/**
 * Shared contracts owned by the Access Agent (docs/plan/04-ACCESS-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining access/policy shapes,
 * and must read effective access / evaluate policy only through
 * modules/access-governance/service.ts — never by querying
 * access_grants/policies/etc. directly.
 */

export type Application = {
  id: string;
  tenantId: string;
  name: string;
  category: string | null;
  sourceIntegrationId: string | null;
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
  entitlementName?: string;
  dataClassification?: string | null;
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

export type AccessRequest = {
  id: string;
  tenantId: string;
  agentId: string;
  requestedBy: string;
  applicationId: string;
  entitlementId: string | null;
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
  /** ACCESS-P0-05 — higher priority policies take precedence in a future
   * conflict-resolution story; P0 only stores and surfaces the value. */
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
