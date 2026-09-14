import "server-only";

import { getAgentContract } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ContractComparisonClassification, ContractComparisonRow } from "@/lib/shared/types/access-governance";
import { getEffectiveAccess, explainAccessPath } from "./grants";

/**
 * Case-insensitive substring match between a contract's free-text
 * `approvedData`/`prohibitedData` vocabulary and an entitlement's short
 * `data_classification` code (e.g. "financial reporting data" vs
 * "financial") — same documented heuristic class as Runtime Agent's own
 * `classificationsCompatible()` (modules/runtime-assurance/compare.ts), but
 * implemented independently here since that function is module-internal,
 * not published via modules/runtime-assurance/service.ts (CLAUDE.md
 * non-negotiable #6: never import another module's unpublished internals).
 * A real ambiguity worth flagging, not silently resolved as "obviously
 * correct" — see the Access Agent audit log.
 */
export function classificationsOverlap(vocabularyTerm: string, classificationCode: string): boolean {
  const a = vocabularyTerm.trim().toLowerCase();
  const b = classificationCode.trim().toLowerCase();
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

type ContractShape = {
  approvedApplications: string[];
  approvedData: string[];
  prohibitedData: string[];
};

/**
 * Pure classification of one effective-access grant against a contract's
 * approved-applications/approved-data/prohibited-data vocabulary. Extracted
 * from compareAccessToContract() so the actual decision logic is
 * unit-testable without a database — see comparison.test.ts, which
 * reproduces the exact FinanceBot fixture scenario CLAUDE.md §11's central
 * acceptance test describes.
 */
export function classifyAccessGrant(
  contract: ContractShape,
  grant: { application?: string | null; dataClassification?: string | null },
): ContractComparisonClassification {
  if (!grant.application) return "unknown";

  const approvedAppsLower = new Set(contract.approvedApplications.map((a) => a.toLowerCase()));
  const isApprovedApp = approvedAppsLower.has(grant.application.toLowerCase());

  // Approval is data-classification-scoped, not merely application-scoped
  // — this is exactly the distinction CLAUDE.md §11's central acceptance
  // scenario turns on ("SHOULD = financial data only, CAN = financial data
  // + CustomerDB" — both live in the *same* approved application,
  // Snowflake, so an application-only check would wrongly call
  // CustomerDB_READ "approved"). An entitlement's data classification is
  // "in scope" only if the contract names no approvedData at all (no
  // data-level restriction declared) or if it overlaps at least one
  // approvedData term.
  const dataInScope =
    contract.approvedData.length === 0 ||
    !grant.dataClassification ||
    contract.approvedData.some((d) => classificationsOverlap(d, grant.dataClassification!));
  const dataProhibited =
    !!grant.dataClassification && contract.prohibitedData.some((p) => classificationsOverlap(p, grant.dataClassification!));

  if (!isApprovedApp || dataProhibited || !dataInScope) return "excessive";
  return "approved";
}

/**
 * ACCESS-P0-04 — SHOULD (Identity's Agent Contract) vs CAN (this module's
 * own effective access) comparison, also covering ACCESS-P0-10 (Access
 * Change Traceability: every row carries its source, entitlement, path and
 * an "as of" timestamp). Distinct from evaluatePolicies() (which evaluates
 * policy *rules*, not a raw SHOULD-vs-CAN diff) and distinct from Runtime
 * Agent's compareShouldCanDid() (which adds observed runtime behavior/DID
 * into a three-way comparison — this function never touches runtime data).
 * Access Agent only computes and evidences this diff — it never writes a
 * risk_findings row itself (CLAUDE.md §2 module boundaries); Risk Agent
 * consumes this function's output the same way it already consumes
 * evaluatePolicies().
 */
export async function compareAccessToContract(
  tenantId: string,
  agentId: string,
): Promise<ContractComparisonRow[]> {
  const contract = await getAgentContract(agentId);
  if (!contract) throw new ApiError(404, "NO_ACTIVE_CONTRACT", "Agent has no active contract to compare against");

  const effectiveAccess = await getEffectiveAccess(tenantId, agentId);

  const rows: ContractComparisonRow[] = [];
  const seenApprovedApps = new Set<string>();

  for (const grant of effectiveAccess) {
    const application = grant.application ?? null;
    const classification = classifyAccessGrant(contract, grant);
    if (classification === "approved" && application) seenApprovedApps.add(application.toLowerCase());

    const path = application
      ? await explainAccessPath(tenantId, agentId, application).catch(() => null)
      : null;

    rows.push({
      classification,
      application,
      entitlement: grant.entitlementName ?? null,
      dataClassification: grant.dataClassification ?? null,
      sourceIntegrationId: grant.sourceIntegrationId,
      lastSyncedAt: grant.grantedAt,
      path: path?.path ?? null,
      agentContractId: contract.id,
    });
  }

  // "missing" — approved applications the contract names but effective
  // access has zero grants on at all.
  for (const approvedApp of contract.approvedApplications) {
    if (!seenApprovedApps.has(approvedApp.toLowerCase())) {
      rows.push({
        classification: "missing",
        application: approvedApp,
        entitlement: null,
        dataClassification: null,
        sourceIntegrationId: null,
        lastSyncedAt: null,
        path: null,
        agentContractId: contract.id,
      });
    }
  }

  return rows;
}
