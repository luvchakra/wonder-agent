/**
 * RISK-P0-13 (core, F3) — pure rules (#9) for remediating a rogue-access
 * finding through a request: what to ask for, and when a finding may ask
 * (again). The service (accessRemediation.ts) loads and writes.
 */
import type { FindingStatus } from "@/lib/shared/types/risk";

export type RemediationPlan =
  | { ok: true; requestType: "remove" | "disable_account"; subjectIdentityId: string; applicationId: string; entitlementId: string | null }
  | { ok: false; code: string; message: string };

/** Statuses a finding can still be remediated from. */
const ACTIONABLE: FindingStatus[] = ["open", "acknowledged", "investigating", "assigned", "remediation_in_progress"];
/** A request that ended without removing anything: the finding may ask again. */
const ENDED_WITHOUT_CHANGE = ["rejected", "cancelled", "expired"];

/**
 * Rogue access to one entitlement is removed; rogue access to the account
 * itself (nothing approved it at all) is disabled. Either way the request
 * names the person or non-human identity the account belongs to, so an
 * account nobody is linked to must be linked first.
 */
export function remediationPlan(
  finding: { category: string; status: FindingStatus; identityId: string | null; applicationId: string | null; entitlementId: string | null },
  currentRequestStatus: string | null,
): RemediationPlan {
  if (finding.category !== "rogue_access") return { ok: false, code: "NOT_ACCESS_FINDING", message: "Only rogue-access findings are removed through a request" };
  if (!ACTIONABLE.includes(finding.status)) return { ok: false, code: "FINDING_CLOSED", message: `A finding that is ${finding.status.replace(/_/g, " ")} needs no removal` };
  if (currentRequestStatus && !ENDED_WITHOUT_CHANGE.includes(currentRequestStatus)) {
    return { ok: false, code: "ALREADY_REQUESTED", message: "A removal was already requested for this finding" };
  }
  if (!finding.applicationId) return { ok: false, code: "NO_APPLICATION", message: "This access is not tied to an application WonderID manages" };
  if (!finding.identityId) return { ok: false, code: "ACCOUNT_UNLINKED", message: "Link the account to its identity first; a removal is requested for someone" };
  return {
    ok: true,
    requestType: finding.entitlementId ? "remove" : "disable_account",
    subjectIdentityId: finding.identityId,
    applicationId: finding.applicationId,
    entitlementId: finding.entitlementId,
  };
}

/** What the finding's remediation shows, from its request's status. */
export function remediationLabel(requestStatus: string | null): string | null {
  if (!requestStatus) return null;
  if (requestStatus === "pending") return "Removal awaiting approval";
  if (requestStatus === "approved") return "Removal approved, being made";
  if (requestStatus === "fulfilled") return "Removal done, awaiting verification";
  if (ENDED_WITHOUT_CHANGE.includes(requestStatus)) return `Removal ${requestStatus}`;
  return null;
}
