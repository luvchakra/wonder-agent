import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { pendRequest } from "./pendingGrants";
import { toAccessRequest } from "./mappers";
import type { AccessRequest } from "@/lib/shared/types/access-governance";

/**
 * COMPLIANCE-P0-10 — Access's published contract for reviews of people's
 * access: the live grants a campaign covers, and the removal a reviewer's
 * revoke decision opens. Service-role reads and writes, every statement
 * filtered on the tenant the caller resolved (§14).
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewableGrant = {
  grantId: string;
  accountId: string;
  accountRef: string;
  identityId: string;
  applicationId: string;
  applicationName: string;
  applicationOwnerIdentityId: string | null;
  entitlementId: string;
  entitlementName: string;
  privilegeLevel: string;
};

/**
 * Access people hold (accounts linked to an identity, not an agent): not
 * revoked, not pending or merely marked done, still reported by the source.
 */
export async function listIdentityGrantsForReview(tenantId: string, filter: { applicationId?: string | null; privilegedOnly?: boolean } = {}): Promise<ReviewableGrant[]> {
  const admin = supabaseServiceRole();
  const out: ReviewableGrant[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from("access_grants")
      .select(
        "id, tenant_id, account_id, entitlement_id, accounts!inner(id, tenant_id, identity_id, agent_id, application_id, external_account_ref, status), entitlements!inner(id, name, privilege_level, application_id, applications!inner(id, name, display_name, business_owner_identity_id))",
      )
      .eq("tenant_id", tenantId)
      .is("revoked_at", null)
      .is("missing_from_source_at", null)
      .in("fulfilment_status", ["none", "verified"])
      .not("accounts.identity_id", "is", null)
      .is("accounts.agent_id", null)
      .neq("accounts.status", "pending");
    if (filter.applicationId) q = q.eq("entitlements.application_id", filter.applicationId);
    if (filter.privilegedOnly) q = q.in("entitlements.privilege_level", ["elevated", "admin"]);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    for (const r of (data ?? []) as Row[]) {
      const account = r.accounts as unknown as Row;
      const ent = r.entitlements as unknown as Row;
      const app = ent.applications as unknown as Row;
      if (r.tenant_id !== tenantId || account.tenant_id !== tenantId) continue;
      out.push({
        grantId: r.id as string,
        accountId: account.id as string,
        accountRef: account.external_account_ref as string,
        identityId: account.identity_id as string,
        applicationId: app.id as string,
        applicationName: ((app.display_name as string | null) || (app.name as string)) ?? "",
        applicationOwnerIdentityId: (app.business_owner_identity_id as string | null) ?? null,
        entitlementId: ent.id as string,
        entitlementName: ent.name as string,
        privilegeLevel: ent.privilege_level as string,
      });
    }
    if ((data ?? []).length < 1000 || out.length >= 20_000) break;
  }
  return out;
}

/**
 * A reviewer's revoke decision on a person's access: the decision is the
 * human approval (#15), so the removal request is approved as it is opened
 * and then followed like any other (a fulfilment task or the connection,
 * verified at the source). An open removal for the same access is reused.
 */
export async function requestCertifiedRemoval(tenantId: string, actorId: string, input: { grantId: string; certificationItemId: string; justification: string }): Promise<AccessRequest> {
  if (!UUID_RE.test(input.grantId)) throw new ApiError(404, "NOT_FOUND", "No such access");
  const admin = supabaseServiceRole();
  const { data: grant, error } = await admin
    .from("access_grants")
    .select("id, tenant_id, revoked_at, entitlement_id, accounts!inner(tenant_id, identity_id, agent_id, application_id)")
    .eq("tenant_id", tenantId)
    .eq("id", input.grantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const account = grant?.accounts as unknown as Row | undefined;
  if (!grant || grant.tenant_id !== tenantId || !account || account.tenant_id !== tenantId || !account.identity_id) throw new ApiError(404, "NOT_FOUND", "No such access");
  if (grant.revoked_at) throw new ApiError(409, "ALREADY_REMOVED", "This access was already removed");

  const subjectIdentityId = account.identity_id as string;
  const applicationId = account.application_id as string;
  const entitlementId = grant.entitlement_id as string;
  const { data: open } = await admin
    .from("access_requests")
    .select()
    .eq("tenant_id", tenantId)
    .eq("subject_identity_id", subjectIdentityId)
    .eq("application_id", applicationId)
    .eq("entitlement_id", entitlementId)
    .eq("request_type", "remove")
    .in("status", ["pending", "approved"])
    .limit(1)
    .maybeSingle();
  if (open) return toAccessRequest(open);

  const reviewer = await getIdentityForUser(tenantId, actorId);
  const now = new Date().toISOString();
  const { data, error: insertError } = await admin
    .from("access_requests")
    .insert({
      tenant_id: tenantId,
      subject_identity_id: subjectIdentityId,
      requester_identity_id: reviewer?.id ?? null,
      requested_by: actorId,
      application_id: applicationId,
      entitlement_id: entitlementId,
      request_type: "remove",
      justification: input.justification.trim().slice(0, 2000) || "Revoked in an access review",
      status: "approved",
      decided_by: actorId,
      decided_at: now,
      risk_level: "low",
      policy_result: { checks: [{ check: "certification", result: `revoked in access review item ${input.certificationItemId}` }] },
    })
    .select()
    .single();
  if (insertError || !data) throw new ApiError(insertError?.code === "23505" ? 409 : 500, insertError?.code === "23505" ? "ANOTHER_REQUEST_WAITING" : "CREATE_FAILED", insertError?.message ?? "Could not open the removal");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.certified_removal_requested",
    objectType: "access_request",
    objectId: data.id as string,
    outcome: "success",
    metadata: { subjectIdentityId, applicationId, entitlementId, grantId: input.grantId, certificationItemId: input.certificationItemId },
  });
  // Opens the removal task (or sends it through the connection) like any approved removal.
  await pendRequest(tenantId, data.id as string);
  return toAccessRequest(data);
}
