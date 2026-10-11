import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { getTenantConfig } from "@/lib/config/tenantConfig";
import { ApiError } from "@/lib/shared/types/foundation";
import { notify } from "@/modules/operations/service";
import { expiryReminderDue } from "./accessExpiryRules";
import { queueRemoval, withdrawGrants } from "./pendingGrants";

/**
 * ACCESS-P0-32 — time-bound access, swept daily (and by the request views
 * for their own tenant):
 * - before a request's end date, the requester and the person it is for are
 *   reminded once, with the way to extend it (an `extend` request, approved
 *   like any other);
 * - at the end date, what the request granted becomes removal work: one
 *   removal task per grant (queueRemoval), and grants never fulfilled are
 *   withdrawn. The source confirms the removal (connector reconciliation
 *   revokes the grant), and the ledger then shows it as expired.
 *
 * Service role across tenants for the cron job. Every read is filtered on
 * the tenant when one is given, each row's own tenant is checked, and every
 * write is filtered on it (§14).
 */

type Row = Record<string, unknown>;
const OPEN = ["approved", "fulfilled"];
const TIMED = ["grant", "extend"];

/** Requests whose end date has come: their access becomes removal work, once. */
export async function sweepAccessExpiry(tenantId: string | null, now = new Date()): Promise<{ expired: number; removals: number }> {
  const admin = supabaseServiceRole();
  let q = admin
    .from("access_requests")
    .select("id, tenant_id, application_id")
    .in("status", OPEN)
    .in("request_type", TIMED)
    .is("expiry_processed_at", null)
    .lte("requested_expiry", now.toISOString())
    .order("requested_expiry")
    .limit(200);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  let expired = 0;
  let removals = 0;
  for (const req of (data ?? []) as Row[]) {
    const tenant = req.tenant_id as string;
    if (tenantId && tenant !== tenantId) continue;
    const { data: grants, error: grantError } = await admin
      .from("access_grants")
      .select("id, fulfilment_status")
      .eq("tenant_id", tenant)
      .eq("request_id", req.id as string)
      .is("access_package_assignment_item_id", null)
      .is("revoked_at", null);
    if (grantError) throw new ApiError(500, "QUERY_FAILED", grantError.message);
    const rows = (grants ?? []) as Row[];
    const unfulfilled = rows.filter((g) => g.fulfilment_status === "pending_fulfilment").map((g) => g.id as string);
    await withdrawGrants(tenant, unfulfilled);
    const marked = await queueRemoval(
      tenant,
      rows.filter((g) => g.fulfilment_status !== "pending_fulfilment").map((g) => ({ grantId: g.id as string, applicationId: req.application_id as string })),
    );
    // Stamped last, and only once: a run that stopped part way picks the request up again, and queueRemoval does nothing twice.
    const { data: stamped, error: stampError } = await admin
      .from("access_requests")
      .update({ expiry_processed_at: now.toISOString() })
      .eq("tenant_id", tenant)
      .eq("id", req.id as string)
      .is("expiry_processed_at", null)
      .select("id");
    if (stampError) throw new ApiError(500, "UPDATE_FAILED", stampError.message);
    if (!stamped?.length) continue;
    expired += 1;
    removals += marked.length;
    await writeAudit({ tenantId: tenant, actorType: "system", action: "access.access_expired", objectType: "access_request", objectId: req.id as string, outcome: "success", metadata: { removalGrantIds: marked, withdrawnGrantIds: unfulfilled } });
  }
  return { expired, removals };
}

/** Requests ending soon: the requester and the person it is for hear once, with the way to extend. */
export async function remindExpiringAccess(tenantId: string | null, now = new Date()): Promise<{ reminded: number }> {
  const admin = supabaseServiceRole();
  // The longest reminder window the setting allows; each tenant's own is applied below.
  const horizon = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  let q = admin
    .from("access_requests")
    .select("id, tenant_id, requested_by, subject_identity_id, requested_expiry, expiry_reminded_at, applications(name, display_name), entitlements(name)")
    .in("status", OPEN)
    .in("request_type", TIMED)
    .is("expiry_reminded_at", null)
    .is("expiry_processed_at", null)
    .gt("requested_expiry", now.toISOString())
    .lte("requested_expiry", horizon)
    .order("requested_expiry")
    .limit(500);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const days = new Map<string, number>();
  let reminded = 0;
  for (const req of (data ?? []) as unknown as Row[]) {
    const tenant = req.tenant_id as string;
    if (tenantId && tenant !== tenantId) continue;
    if (!days.has(tenant)) days.set(tenant, (await getTenantConfig(tenant))["access.expiryReminderDays"]);
    if (!expiryReminderDue(req.requested_expiry as string, null, days.get(tenant)!, now)) continue;
    // Only access that is held: one never fulfilled has nothing to extend.
    const { count, error: heldError } = await admin
      .from("access_grants")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant)
      .eq("request_id", req.id as string)
      .is("revoked_at", null)
      .neq("fulfilment_status", "pending_fulfilment");
    if (heldError) throw new ApiError(500, "QUERY_FAILED", heldError.message);
    if (!count) continue;
    // Claimed before sending, so two runs never both remind.
    const { data: claimed, error: claimError } = await admin
      .from("access_requests")
      .update({ expiry_reminded_at: now.toISOString() })
      .eq("tenant_id", tenant)
      .eq("id", req.id as string)
      .is("expiry_reminded_at", null)
      .select("id");
    if (claimError) throw new ApiError(500, "UPDATE_FAILED", claimError.message);
    if (!claimed?.length) continue;
    const { data: subject } = req.subject_identity_id
      ? await admin.from("identities").select("tenant_id, user_id").eq("tenant_id", tenant).eq("id", req.subject_identity_id as string).maybeSingle()
      : { data: null };
    const recipients = [...new Set([req.requested_by as string | null, subject?.tenant_id === tenant ? ((subject.user_id as string | null) ?? null) : null].filter((u): u is string => Boolean(u)))];
    const app = (req.applications as Row | null) ?? null;
    const what = `${(req.entitlements as Row | null)?.name ?? "Access"} in ${(app?.display_name as string | null) ?? (app?.name as string | null) ?? "an application"}`;
    const ends = new Date(req.requested_expiry as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    for (const userId of recipients) {
      await notify({ tenantId: tenant, userId, type: "access_expiring", title: `${what} ends on ${ends}`, body: "To keep it, ask to extend it from the request. Otherwise it is removed when it ends.", referenceType: "access_request", referenceId: req.id as string });
    }
    await writeAudit({ tenantId: tenant, actorType: "system", action: "access.expiry_reminded", objectType: "access_request", objectId: req.id as string, outcome: "success", metadata: { recipients: recipients.length, expiresAt: req.requested_expiry } });
    reminded += 1;
  }
  return { reminded };
}
