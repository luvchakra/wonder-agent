import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { listPermissionHolders } from "@/lib/rbac/permissionHolders";
import { notify } from "@/modules/operations/service";
import { activeDelegatesOf } from "./delegations";
import { APPROVAL_LINK_TTL_HOURS, approvalLinkPath, approvalLinkState, isLinkToken, type LinkState } from "./approvalLinkRules";

/**
 * ACCESS-P0-38 part 2 — tells each approver when a request's stage waits
 * for them, with a link of their own. Only the token's SHA-256 is stored.
 * Opening the link marks it used; deciding still needs the approver's
 * session and the approval engine's checks (#15, §17.4). System path:
 * service role, filtered by the request's tenant. Never throws: a failed
 * notification never undoes the request.
 */

type Row = Record<string, unknown>;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function baseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return raw && /^https?:\/\//.test(raw) ? raw : "";
}

/** Notifies the approvers of the stage now open; access-manager steps reach every access manager. */
export async function notifyApprovers(tenantId: string, requestId: string, stage: number): Promise<number> {
  try {
    const admin = supabaseServiceRole();
    const [{ data: steps }, { data: req }] = await Promise.all([
      admin
        .from("access_request_approvals")
        .select("tenant_id, approver_kind, approver_user_id, status")
        .eq("tenant_id", tenantId)
        .eq("request_id", requestId)
        .eq("stage", stage)
        .eq("status", "pending"),
      admin
        .from("access_requests")
        .select("tenant_id, requested_by, applications(name, display_name), entitlements(name), subject:identities!access_requests_subject_fkey(display_name, user_id)")
        .eq("tenant_id", tenantId)
        .eq("id", requestId)
        .maybeSingle(),
    ]);
    if (!req || req.tenant_id !== tenantId) return 0;
    const users = new Set<string>();
    const named: string[] = [];
    for (const s of (steps ?? []) as Row[]) {
      if (s.tenant_id !== tenantId) continue;
      if (s.approver_user_id) {
        users.add(s.approver_user_id as string);
        named.push(s.approver_user_id as string);
      } else if (s.approver_kind === "access_managers") for (const u of await listPermissionHolders(tenantId, "access.approve")) users.add(u);
    }
    // ACCESS-P0-23: whoever holds a named approver's approvals by delegation hears too.
    for (const delegates of (await activeDelegatesOf(tenantId, named)).values()) for (const d of delegates) users.add(d);
    // Nobody decides their own request, or one for themselves.
    users.delete(req.requested_by as string);
    const subject = (req.subject as unknown as Row | null) ?? null;
    if (subject?.user_id) users.delete(subject.user_id as string);
    if (!users.size) return 0;
    const app = (req.applications as unknown as Row | null) ?? null;
    const what = `${((app?.display_name ?? app?.name) as string | undefined) ?? "an application"}${(req.entitlements as unknown as Row | null)?.name ? ` · ${(req.entitlements as unknown as Row).name}` : ""}`;
    const expiresAt = new Date(Date.now() + APPROVAL_LINK_TTL_HOURS * 3_600_000).toISOString();
    let sent = 0;
    for (const userId of users) {
      const token = randomBytes(32).toString("base64url");
      const { error } = await admin.from("access_approval_links").insert({ tenant_id: tenantId, request_id: requestId, user_id: userId, token_hash: hash(token), expires_at: expiresAt });
      if (error) continue;
      await notify({
        tenantId,
        userId,
        type: "approval_required",
        title: `Approval needed: ${what}`,
        body: `${(subject?.display_name as string | undefined) ?? "Someone"} needs your decision. Open: ${baseUrl()}${approvalLinkPath(requestId, token)} (single use, valid ${APPROVAL_LINK_TTL_HOURS} hours; you sign in to decide).`,
        referenceType: "access_request",
        referenceId: requestId,
      });
      sent++;
    }
    await writeAudit({
      tenantId,
      actorType: "system",
      action: "access.approvers_notified",
      objectType: "access_request",
      objectId: requestId,
      outcome: "success",
      metadata: { stage, approvers: sent },
    });
    return sent;
  } catch (err) {
    console.error("notifyApprovers failed", { requestId, err: err instanceof Error ? err.message : "unknown" });
    return 0;
  }
}

/**
 * Checks a link opened by the member signed in and, if it is theirs and
 * still good, marks it used. Returns what the page should say; the
 * decision itself is the page's normal, session-checked form.
 */
export async function openApprovalLink(tenantId: string, userId: string, requestId: string, token: unknown, requestStatus: string): Promise<LinkState> {
  if (!isLinkToken(token)) return "unknown";
  const admin = supabaseServiceRole();
  const { data } = await admin.from("access_approval_links").select("id, tenant_id, request_id, user_id, expires_at, used_at").eq("token_hash", hash(token)).maybeSingle();
  const link =
    data && data.tenant_id === tenantId
      ? { userId: data.user_id as string, requestId: data.request_id as string, expiresAt: data.expires_at as string, usedAt: (data.used_at as string | null) ?? null }
      : null;
  const state = approvalLinkState(link, { userId, requestId, requestStatus, now: new Date() });
  if (state === "valid") {
    const { data: used } = await admin
      .from("access_approval_links")
      .update({ used_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", data!.id as string)
      .is("used_at", null)
      .select("id");
    if (!used?.length) return "used";
    await writeAudit({ tenantId, actorId: userId, actorType: "user", action: "access.approval_link_opened", objectType: "access_request", objectId: requestId, outcome: "success", metadata: {} });
  } else if (state !== "unknown") {
    await writeAudit({
      tenantId,
      actorId: userId,
      actorType: "user",
      action: "access.approval_link_refused",
      objectType: "access_request",
      objectId: requestId,
      outcome: "failure",
      metadata: { state },
    });
  }
  return state;
}
