import "server-only";

/**
 * The published contract for the Access Agent's module
 * (docs/plan/04-ACCESS-AGENT-BACKLOG.md). Other modules must import from
 * this file only — never query access_grants/policies/etc. directly.
 */

export { createApplication, listApplications, getApplication, createAccount, listAccountsForAgent } from "./applications";
export { createEntitlement, listEntitlementsForApplication } from "./entitlements";
export { getEffectiveAccess, explainAccessPath, createManualAccessGrant, revokeAccessGrant } from "./grants";
export { createAccessRequest, listAccessRequests, decideAccessRequest } from "./requests";
export {
  createPolicy,
  listPolicies,
  getPolicy,
  addPolicyRule,
  listPolicyRules,
  addPolicyException,
  listPolicyExceptions,
  type CreatePolicyInput,
} from "./policies";
export { evaluatePolicies, listPolicyEvaluations } from "./evaluate";
export { checkSoD, type SoDCheckResult } from "./sod";
