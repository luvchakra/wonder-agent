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
};

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

export type PolicyException = {
  id: string;
  policyId: string;
  agentId: string | null;
  reason: string;
  approvedBy: string;
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
};
