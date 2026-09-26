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
  setEntitlementOwner,
  type EntitlementWithContext,
} from "./entitlements";
export { getEffectiveAccess, getEffectiveAccessAsOf, explainAccessPath, createManualAccessGrant, revokeAccessGrant, getAccessGrant } from "./grants";
export { createAccessRequest, listAccessRequests, decideAccessRequest } from "./requests";
export {
  createPolicy,
  publishPolicy,
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
export {
  listApplicationCatalog,
  getCatalogSummary,
  getApplicationDetail,
  registerApplication,
  updateApplication,
  listApplicationsForMatching,
  type ApplicationOrigin,
  type CatalogFilter,
  type CatalogRow,
} from "./catalog";
export {
  getOnboarding,
  startOnboarding,
  configureOnboarding,
  validateOnboarding,
  simulateOnboarding,
  decideOnboarding,
  promoteOnboarding,
  setApplicationLifecycle,
  type ApplicationOnboarding,
} from "./onboarding";
export {
  listAccountInventory,
  getAccountSummary,
  getInventoryAccount,
  linkAccount,
  listReconciliationRuns,
  reconcileApplicationAccounts,
  ACCOUNT_VIEWS,
  RECONCILE_CAP,
  type AccountView,
  type AccountFilter,
  type AccountSummary,
  type InventoryAccount,
  type ReconciliationRun,
} from "./accounts";
export { DORMANT_WINDOWS, DEFAULT_DORMANT_DAYS, parseDormantDays } from "./accountRules";
export {
  listRequestPolicies,
  saveRequestPolicy,
  listRequestCatalog,
  getRequestCatalogItem,
  submitAccessRequest,
  cancelAccessRequest,
  listRequests,
  type CatalogItem,
  type CatalogEntitlement,
  type PolicyRow,
  type RequestRow,
  type RequestInput,
} from "./requestCatalog";
export { RISK_LEVELS, ALLOW_FOR_OTHERS, APPROVAL_ROUTES, APPROVAL_MODES, ON_TIMEOUT, type RequestPolicy, type RiskLevel } from "./requestRules";
export {
  decideApprovalStep,
  sweepApprovalTimeouts,
  repairApprovalChains,
  getRequestWithApprovals,
  listRequestIdsAwaiting,
  type ApprovalStep,
  type ApprovalView,
  type ApproverActor,
} from "./approvals";
export type { ApproverKind, StepStatus } from "./approvalRules";
export {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  addPackageResource,
  removePackageResource,
  requestPackage,
  assignPackageDirect,
  listAssignments,
  getAssignment,
  setAssignmentItemStatus,
  revokeAssignment,
  sweepPackageExpiry,
  listLiveApplications,
  type AccessPackage,
  type PackageDetail,
  type PackageListItem,
  type PackageResource,
  type PackageAssignment,
  type AssignmentItem,
} from "./packages";
export { checkEligibility as checkPackageEligibility, PACKAGE_IDENTITY_TYPES, CERTIFICATION_FREQUENCIES } from "./packageRules";
