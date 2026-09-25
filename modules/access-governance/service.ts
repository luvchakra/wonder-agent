import "server-only";

/**
 * The published contract for the Access Agent's module
 * (docs/plan/04-ACCESS-AGENT-BACKLOG.md). Other modules must import from
 * this file only — never query access_grants/policies/etc. directly.
 */

export { createApplication, listApplications, getApplication, createAccount, listAccountsForAgent } from "./applications";
export { createDataSource, updateDataSource, linkEntitlementToDataSource, listDataSources, validateDataSourceInput, type DataSourceInput } from "./dataSources";
export {
  createEntitlement,
  listEntitlementsForApplication,
  listEntitlementsForTenant,
  getEntitlement,
  type EntitlementWithContext,
} from "./entitlements";
export { getEffectiveAccess, getEffectiveAccessAsOf, explainAccessPath, createManualAccessGrant, revokeAccessGrant, getAccessGrant } from "./grants";
export { createAccessRequest, listAccessRequests, decideAccessRequest } from "./requests";
export {
  createPolicy,
  listPolicies,
  getPolicy,
  updatePolicy,
  listPolicyVersions,
  addPolicyRule,
  listPolicyRules,
  addPolicyException,
  listPolicyExceptions,
  createGovernanceException,
  listGovernanceExceptions,
  revokeException,
  sendExpiredExceptionReminders,
  sendExpiredExceptionRemindersForAllTenants,
  type ExceptionExpiryReminderResult,
  type CreatePolicyInput,
  type GovernanceExceptionInput,
} from "./policies";
export { evaluatePolicies, listPolicyEvaluations, hasOpenPolicyViolation } from "./evaluate";
export { checkSoD, enforceSoD, type SoDCheckResult } from "./sod";
export { getAccessGraph } from "./graph";
export { compareAccessToContract } from "./comparison";
export { classifyAction, classifyActionsForAgent } from "./actionGovernance";
// ACCESS-P0-11 — the deterministic runtime decision, for the Runtime Gateway.
export { decideRuntimeRequest, isMutatingAction, filterToolsForAgent, type ToolVisibility } from "./runtimeDecision";
export { evaluateRuntimeRequest, evaluateToolVisibility, type RuntimePrincipal, type RuntimeEmergencyState } from "./runtimeDecisionLoader";
