import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * RISK-P0-13 — Access's published contract for approving access afterwards:
 * access that already exists on an application (found by reconciliation
 * with no approval behind it) is approved as it stands. It is recorded the
 * way every approval is, as an access request, so the ledger's evidence
 * rules need nothing new: an approved or fulfilled grant request for the
 * same subject, application and entitlement makes the access VALID with
 * source WONDERID_REQUEST on the next refresh (ledgerRules.ts).
 *
 * The request is written as already fulfilled, because the access exists:
 * nothing is provisioned, no approval chain runs (the person approving is
 * the decision, checked by the caller: risk.manage, never the account's
 * owner). An end date makes it time-bound: the daily expiry sweep removes
 * the access then (ACCESS-P0-32). The grant points at the request, so the
 * finding's resolution and the ledger name it as evidence.
 *
 * Service role (requests have no client write path for decided rows); every
 * statement is filtered on `tenantId` (§14); audited.
 */
export type ApprovedAfterwardsInput = {
  subjectIdentityId: string;
  applicationId: string;
  entitlementId: string | null;
  accessGrantId: string | null;
  justification: string;
  expiresAt: string | null;
};

export async function recordApprovedAfterwards(tenantId: string, actorId: string, input: ApprovedAfterwardsInput, now = new Date()): Promise<{ requestId: string }> {
  const admin = supabaseServiceRole();
  const decidedAt = now.toISOString();
  const { data: request, error } = await admin
    .from("access_requests")
    .insert({
      tenant_id: tenantId,
      request_type: "grant",
      status: "fulfilled",
      subject_identity_id: input.subjectIdentityId,
      application_id: input.applicationId,
      entitlement_id: input.entitlementId,
      justification: input.justification,
      requested_by: actorId,
      created_by: actorId,
      decided_by: actorId,
      decided_at: decidedAt,
      requested_expiry: input.expiresAt,
      policy_result: { approvedAfterwards: true },
    })
    .select("id")
    .single();
  if (error || !request) throw new ApiError(500, "CREATE_FAILED", "The approval could not be recorded");
  const requestId = request.id as string;

  if (input.accessGrantId) {
    const { error: grantError } = await admin
      .from("access_grants")
      .update({ request_id: requestId })
      .eq("tenant_id", tenantId)
      .eq("id", input.accessGrantId);
    if (grantError) throw new ApiError(500, "UPDATE_FAILED", "The approval was recorded but could not be attached to the access");
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.request_approved_afterwards",
    objectType: "access_request",
    objectId: requestId,
    outcome: "success",
    metadata: { subjectIdentityId: input.subjectIdentityId, applicationId: input.applicationId, entitlementId: input.entitlementId, accessGrantId: input.accessGrantId, expiresAt: input.expiresAt },
  });
  return { requestId };
}
