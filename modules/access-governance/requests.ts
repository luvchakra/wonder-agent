import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import type { AccessRequest, AccessRequestStatus, AccessRequestType } from "@/lib/shared/types/access-governance";
import { toAccessRequest } from "./mappers";

/**
 * ACCESS-P0-01.3. `access_requests` grants a client-facing INSERT, but its
 * WITH CHECK (migration 0028) pins every new row to status='pending' with
 * no decision fields — runs as the calling user via supabaseServer().
 */
export async function createAccessRequest(
  tenantId: string,
  requestedBy: string,
  agentId: string,
  applicationId: string,
  entitlementId: string | undefined,
  justification: string,
  requestType: AccessRequestType = "grant",
): Promise<AccessRequest> {
  if (!justification.trim()) throw new ApiError(400, "INVALID_INPUT", "justification is required");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_requests")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      requested_by: requestedBy,
      application_id: applicationId,
      entitlement_id: entitlementId ?? null,
      request_type: requestType,
      justification,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create access request");

  await writeAudit({
    tenantId,
    actorId: requestedBy,
    actorType: "user",
    action: requestType === "modify" ? "access.modify_request_submitted" : "access.request_submitted",
    objectType: "access_request",
    objectId: data.id,
    outcome: "success",
    metadata: { agentId, applicationId, entitlementId, requestType },
  });

  return toAccessRequest(data);
}

export async function listAccessRequests(tenantId: string, agentId?: string): Promise<AccessRequest[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("access_requests").select().eq("tenant_id", tenantId);
  if (agentId) query = query.eq("agent_id", agentId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAccessRequest);
}

const ALLOWED_DECISIONS: Record<AccessRequestStatus, AccessRequestStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["fulfilled"],
  rejected: [],
  fulfilled: [],
};

/**
 * ACCESS-P0-01.3 (higher bar on decision integrity): only the trusted
 * decision path may transition a request out of 'pending' — no client
 * write policy exists for updates at all, so this uses the service-role
 * client and re-verifies tenant ownership itself. Fulfillment does NOT
 * automatically create an access_grants row: per non-negotiable #7/#15,
 * the customer's existing IAM remains the system of record — the admin
 * makes the change there, and the resulting grant shows up via the next
 * Integration sync (or a separate manual createManualAccessGrant call).
 */
export async function decideAccessRequest(
  tenantId: string,
  actorId: string,
  requestId: string,
  decision: AccessRequestStatus,
): Promise<AccessRequest> {
  const supabase = supabaseServiceRole();

  const { data: existing, error: fetchError } = await supabase
    .from("access_requests")
    .select()
    .eq("id", requestId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (fetchError) throw new ApiError(500, "QUERY_FAILED", fetchError.message);
  if (!existing) throw new ApiError(404, "REQUEST_NOT_FOUND");

  const allowed = ALLOWED_DECISIONS[existing.status as AccessRequestStatus] ?? [];
  if (!allowed.includes(decision)) {
    throw new ApiError(409, "INVALID_TRANSITION", `Cannot move from ${existing.status} to ${decision}`);
  }

  const { data, error } = await supabase
    .from("access_requests")
    .update({ status: decision, decided_by: actorId, decided_at: new Date().toISOString() })
    .eq("id", requestId)
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update request");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: `access.request_${decision}`,
    objectType: "access_request",
    objectId: requestId,
    outcome: "success",
    metadata: { previousStatus: existing.status },
  });

  return toAccessRequest(data);
}
