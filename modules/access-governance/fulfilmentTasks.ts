import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { getTenantConfig } from "@/lib/config/tenantConfig";
import { ApiError } from "@/lib/shared/types/foundation";
import { notify } from "@/modules/operations/service";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { canAct, isOverdue, taskDueAt, needsReminder, needsUnconfirmedRemovalReminder, UNCONFIRMED_REMOVAL_DAYS, type FulfilmentTaskAction, type FulfilmentTaskKind, type FulfilmentTaskStatus } from "./fulfilmentTaskRules";
import { accountToCreateFirst, planConnectorFulfilment, runConnectorFulfilment } from "./connectorFulfilment";
import { runAfterResponse } from "@/lib/shared/afterResponse";

/**
 * ACCESS-P0-29 — fulfilment tasks. Each pending grant (ACCESS-P0-28) is
 * work for a person until provisioning exists (F3): a task assigned to the
 * application's technical owner (else its business owner), due after the
 * organization's SLA. It is claimed, completed with a note (the grant
 * becomes "fulfilled, not yet verified"), or failed with a reason; it is
 * closed as verified when reconciliation finds the grant at the source,
 * and cancelled when the grant is withdrawn. Overdue tasks remind their
 * owner once a day.
 *
 * Writes use the service role (members have no write policy, 0122); every
 * statement is filtered on `tenantId`, and a task is read inside that
 * tenant before it is changed (§14). Lists are read as the member, under
 * RLS.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE: FulfilmentTaskStatus[] = ["open", "claimed", "failed", "completed"];

export type FulfilmentTask = {
  id: string;
  kind: FulfilmentTaskKind;
  status: FulfilmentTaskStatus;
  overdue: boolean;
  dueAt: string;
  /** The grant to add (kind grant) or remove (kind remove); null for an account task. */
  accessGrantId: string | null;
  accountId: string | null;
  requestId: string | null;
  applicationId: string;
  applicationName: string | null;
  entitlementName: string | null;
  accountName: string | null;
  assigneeIdentityId: string | null;
  assigneeName: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  note: string | null;
  failureReason: string | null;
  /** INTEGRATION-P0-13: the connector's attempt at this task, if it made one. */
  connectorStatus: "running" | "succeeded" | "failed" | null;
  connectorError: string | null;
  createdAt: string;
};

function toTask(r: Row, now = new Date()): FulfilmentTask {
  const grant = ((r.grant as Row | null) ?? (r.removal as Row | null)) ?? null;
  const account = ((grant?.accounts as Row | null) ?? (r.account as Row | null)) ?? null;
  const app = (r.applications as Row | null) ?? null;
  const assignee = (r.assignee as Row | null) ?? null;
  const status = r.status as FulfilmentTaskStatus;
  return {
    id: r.id as string,
    kind: ((r.kind as FulfilmentTaskKind | undefined) ?? "grant") as FulfilmentTaskKind,
    status,
    overdue: isOverdue({ status, dueAt: r.due_at as string }, now),
    dueAt: r.due_at as string,
    accessGrantId: ((r.access_grant_id as string | null) ?? (r.removal_grant_id as string | null)) ?? null,
    accountId: (r.account_id as string | null) ?? null,
    requestId: (r.request_id as string | null) ?? null,
    applicationId: r.application_id as string,
    applicationName: ((app?.display_name as string | null) ?? (app?.name as string | null)) ?? null,
    entitlementName: (((grant?.entitlements as Row | null)?.name as string | undefined) ?? null) as string | null,
    accountName: ((account?.account_name as string | null) ?? (account?.external_account_ref as string | null)) ?? null,
    assigneeIdentityId: (r.assignee_identity_id as string | null) ?? null,
    assigneeName: (assignee?.display_name as string | null) ?? null,
    claimedBy: (r.claimed_by as string | null) ?? null,
    claimedAt: (r.claimed_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    failureReason: (r.failure_reason as string | null) ?? null,
    connectorStatus: (r.connector_status as FulfilmentTask["connectorStatus"]) ?? null,
    connectorError: (r.connector_error as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

const GRANT_FIELDS = "entitlements(name), accounts(account_name, external_account_ref)";
const SELECT =
  "id, tenant_id, kind, status, due_at, access_grant_id, removal_grant_id, account_id, request_id, application_id, assignee_identity_id, claimed_by, claimed_at, completed_at, note, failure_reason, connector_status, connector_error, created_at, " +
  `applications(name, display_name), grant:access_grants!access_fulfilment_tasks_grant_fkey(${GRANT_FIELDS}), removal:access_grants!access_fulfilment_tasks_removal_grant_fkey(${GRANT_FIELDS}), ` +
  "account:accounts!access_fulfilment_tasks_account_fkey(account_name, external_account_ref), assignee:identities!access_fulfilment_tasks_assignee_fkey(display_name)";

const KIND_TITLE: Record<FulfilmentTaskKind, string> = {
  grant: "Access to fulfil",
  remove: "Access to remove",
  create_account: "Account to create",
  disable_account: "Account to disable",
};

/**
 * Opens the task for an approved line: a pending grant (kind grant), a
 * grant to remove, or an account to create or disable. Never throws: a
 * failure is audited and the line stays pending.
 */
export async function openFulfilmentTask(
  tenantId: string,
  line: { kind?: FulfilmentTaskKind; grantId?: string | null; accountId?: string | null; requestId: string | null; applicationId: string },
): Promise<void> {
  const kind = line.kind ?? "grant";
  try {
    const admin = supabaseServiceRole();
    const [{ data: app, error }, config] = await Promise.all([
      admin.from("applications").select("tenant_id, name, display_name, technical_owner_identity_id, business_owner_identity_id").eq("tenant_id", tenantId).eq("id", line.applicationId).maybeSingle(),
      getTenantConfig(tenantId),
    ]);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (!app || app.tenant_id !== tenantId) return;
    const assignee = ((app.technical_owner_identity_id as string | null) ?? (app.business_owner_identity_id as string | null)) ?? null;
    const { data, error: insertError } = await admin
      .from("access_fulfilment_tasks")
      .insert({
        tenant_id: tenantId,
        kind,
        access_grant_id: kind === "grant" ? line.grantId : null,
        removal_grant_id: kind === "remove" ? line.grantId : null,
        account_id: kind === "create_account" || kind === "disable_account" ? line.accountId : null,
        request_id: line.requestId,
        application_id: line.applicationId,
        assignee_identity_id: assignee,
        due_at: taskDueAt(kind, new Date(), config["access.fulfilmentSlaDays"]),
      })
      .select("id")
      .single();
    if (insertError?.code === "23505") return; // a live task for the same grant or account is open already
    if (insertError || !data) throw new ApiError(500, "CREATE_FAILED", insertError?.message ?? "Could not open the task");
    await writeAudit({ tenantId, actorType: "system", action: "access.fulfilment_task_opened", objectType: "access_fulfilment_task", objectId: data.id as string, outcome: "success", metadata: { kind, grantId: line.grantId ?? null, accountId: line.accountId ?? null, requestId: line.requestId, assigneeIdentityId: assignee } });
    // INTEGRATION-P0-13: a connector with writes turned on makes the change; its owner hears only if it cannot.
    const plan = await planConnectorFulfilment(tenantId, data.id as string).catch(() => null);
    if (plan) {
      runAfterResponse(() => runConnectorFulfilment(tenantId, plan));
      return;
    }
    // Access for an account still to be created: the connector creates it first, and adds the access once it is read back.
    const createFirst = kind === "grant" ? await accountToCreateFirst(tenantId, data.id as string).catch(() => null) : null;
    if (createFirst) {
      await openFulfilmentTask(tenantId, { kind: "create_account", accountId: createFirst, requestId: line.requestId, applicationId: line.applicationId });
      return;
    }
    const userId = assignee ? await userOf(tenantId, assignee) : null;
    const appName = ((app.display_name as string | null) ?? (app.name as string)) as string;
    // No owner who signs in: the tenant's access managers see it in the list (a broadcast would reach everyone).
    if (userId) await notify({ tenantId, userId, type: "fulfilment_task", title: `${KIND_TITLE[kind]} in ${appName}`, body: "An approved request waits for the change on the target. Open Fulfilment Tasks.", referenceType: "access_fulfilment_task", referenceId: data.id as string });
  } catch (err) {
    await writeAudit({ tenantId, actorType: "system", action: "access.fulfilment_task_opened", objectType: line.grantId ? "access_grant" : "account", objectId: (line.grantId ?? line.accountId)!, outcome: "failure", metadata: { kind, error: err instanceof ApiError ? err.code : "UNEXPECTED" } });
  }
}

async function userOf(tenantId: string, identityId: string): Promise<string | null> {
  const { data } = await supabaseServiceRole().from("identities").select("tenant_id, user_id").eq("tenant_id", tenantId).eq("id", identityId).maybeSingle();
  return data && data.tenant_id === tenantId ? ((data.user_id as string | null) ?? null) : null;
}

/**
 * The organization's tasks, read as the member: the ones still to do (overdue first), or all.
 * EXPERIENCE-P0-29: `forPerson` narrows to the ones waiting for that person: assigned to them,
 * claimed by them, or (for someone who can approve access) with no owner.
 */
export async function listFulfilmentTasks(
  tenantId: string,
  filter: { view?: "todo" | "all"; requestId?: string; forPerson?: { userId: string; identityId: string | null; canApprove: boolean } } = {},
): Promise<FulfilmentTask[]> {
  const supabase = await supabaseServer();
  let q = supabase.from("access_fulfilment_tasks").select(SELECT).eq("tenant_id", tenantId);
  if (filter.requestId) q = q.eq("request_id", filter.requestId);
  if (filter.forPerson) {
    const p = filter.forPerson;
    const mine = [
      UUID_RE.test(p.userId) ? `claimed_by.eq.${p.userId}` : null,
      p.identityId && UUID_RE.test(p.identityId) ? `assignee_identity_id.eq.${p.identityId}` : null,
      p.canApprove ? "assignee_identity_id.is.null" : null,
    ].filter(Boolean);
    if (!mine.length) return [];
    q = q.or(mine.join(","));
  }
  if ((filter.view ?? "todo") === "todo" && !filter.requestId) q = q.in("status", ["open", "claimed", "failed"]);
  const { data, error } = await q.order("due_at", { ascending: true }).limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const now = new Date();
  return ((data ?? []) as unknown as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => toTask(r, now));
}

/** Claim, complete (with an optional note) or fail (with a reason). Audited; completing marks the grant fulfilled, not yet verified. */
export async function actOnFulfilmentTask(
  tenantId: string,
  actor: { userId: string; canApprove: boolean },
  taskId: string,
  action: unknown,
  note?: unknown,
): Promise<FulfilmentTask> {
  if (!UUID_RE.test(taskId)) throw new ApiError(404, "NOT_FOUND", "No such task");
  if (action !== "claim" && action !== "complete" && action !== "fail" && action !== "retry_connector") throw new ApiError(400, "VALIDATION_FAILED", "action: claim, complete, fail or retry_connector");
  const text = typeof note === "string" && note.trim() ? note.trim().slice(0, 2000) : null;
  if (action === "fail" && !text) throw new ApiError(400, "VALIDATION_FAILED", "note: say what failed");
  const admin = supabaseServiceRole();
  const { data: task, error } = await admin
    .from("access_fulfilment_tasks")
    .select("id, tenant_id, kind, status, assignee_identity_id, claimed_by, access_grant_id, removal_grant_id, connector_status")
    .eq("tenant_id", tenantId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!task || task.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such task");
  // INTEGRATION-P0-13: never two hands on the target at once.
  if (task.connector_status === "running") throw new ApiError(409, "CONNECTOR_RUNNING", "The connector is making this change now; wait for its result");
  // The task's owner is an identity; the actor is the member signed in, matched to their identity in this organization.
  const identity = await getIdentityForUser(tenantId, actor.userId);
  const decision = canAct(
    { status: task.status as FulfilmentTaskStatus, assigneeIdentityId: (task.assignee_identity_id as string | null) ?? null, claimedBy: (task.claimed_by as string | null) ?? null },
    { ...actor, identityId: identity?.id ?? null },
    action === "retry_connector" ? "claim" : (action as FulfilmentTaskAction),
  );
  if (!decision.ok) throw new ApiError(decision.code === "FORBIDDEN" ? 403 : 409, decision.code, decision.message);

  // INTEGRATION-P0-13: whoever may work on the task may ask the connector to try again.
  if (action === "retry_connector") {
    if (task.connector_status !== "failed" || task.status !== "open") throw new ApiError(409, "INVALID_TRANSITION", "Only an open task the connector failed can be tried again");
    const plan = await planConnectorFulfilment(tenantId, taskId);
    if (!plan) throw new ApiError(409, "CONNECTOR_UNAVAILABLE", "No connector can make this change now (writes are off, or the system does not support it)");
    const result = await runConnectorFulfilment(tenantId, plan, actor.userId);
    if (result === "busy") throw new ApiError(409, "CONFLICT", "The task changed meanwhile; reload");
    const [fresh] = await listTaskById(tenantId, taskId);
    return fresh;
  }

  const now = new Date().toISOString();
  const set: Row =
    action === "claim"
      ? { status: "claimed", claimed_by: actor.userId, claimed_at: now, failure_reason: null }
      : action === "complete"
        ? { status: "completed", completed_by: actor.userId, completed_at: now, note: text }
        : { status: "failed", failure_reason: text };
  const { data: updated, error: updateError } = await admin
    .from("access_fulfilment_tasks")
    .update({ ...set, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", taskId)
    .eq("status", task.status as string)
    .select("id")
    .maybeSingle();
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  if (!updated) throw new ApiError(409, "CONFLICT", "The task changed meanwhile; reload");
  // Done on the target: a grant waits for verification; a removal waits for the source to drop it. Account tasks wait for the account itself.
  if (action === "complete" && task.kind === "grant") {
    const { error: grantError } = await admin
      .from("access_grants")
      .update({ fulfilment_status: "fulfilled_unverified", updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", task.access_grant_id as string)
      .eq("fulfilment_status", "pending_fulfilment");
    if (grantError) throw new ApiError(500, "UPDATE_FAILED", grantError.message);
  }
  if (action === "complete" && task.kind === "remove") {
    const { error: grantError } = await admin
      .from("access_grants")
      .update({ removal_status: "removed_unverified", updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", task.removal_grant_id as string)
      .eq("removal_status", "pending_removal");
    if (grantError) throw new ApiError(500, "UPDATE_FAILED", grantError.message);
  }
  await writeAudit({ tenantId, actorId: actor.userId, actorType: "user", action: `access.fulfilment_task_${action === "claim" ? "claimed" : action === "complete" ? "completed" : "failed"}`, objectType: "access_fulfilment_task", objectId: taskId, outcome: "success", metadata: { kind: task.kind, from: task.status, grantId: task.access_grant_id ?? task.removal_grant_id ?? null, note: text } });
  const [fresh] = await listTaskById(tenantId, taskId);
  return fresh;
}

async function listTaskById(tenantId: string, taskId: string): Promise<FulfilmentTask[]> {
  const { data, error } = await supabaseServiceRole().from("access_fulfilment_tasks").select(SELECT).eq("tenant_id", tenantId).eq("id", taskId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as unknown as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => toTask(r));
}

/**
 * Closes the tasks of these grants: `verified` when reconciliation found
 * the access, `cancelled` when the grant was withdrawn, `completed` when
 * the request or item was marked fulfilled (the grant is not yet verified).
 */
export async function closeTasksForGrants(tenantId: string, grantIds: string[], status: "verified" | "cancelled" | "completed", kind: "grant" | "remove" = "grant"): Promise<number> {
  if (!grantIds.length) return 0;
  const column = kind === "remove" ? "removal_grant_id" : "access_grant_id";
  const now = new Date().toISOString();
  const from: FulfilmentTaskStatus[] = status === "completed" ? ["open", "claimed", "failed"] : LIVE;
  let closed = 0;
  for (let i = 0; i < grantIds.length; i += 200) {
    const { data, error } = await supabaseServiceRole()
      .from("access_fulfilment_tasks")
      .update(status === "completed" ? { status, completed_at: now, updated_at: now } : { status, closed_at: now, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("kind", kind)
      .in(column, grantIds.slice(i, i + 200))
      .in("status", from)
      .select("id");
    if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
    closed += (data ?? []).length;
  }
  return closed;
}

/** The daily sweep: each overdue task reminds its owner, at most once a day. */
export async function remindOverdueFulfilmentTasks(tenantId: string | null, now = new Date()): Promise<{ reminded: number }> {
  let q = supabaseServiceRole()
    .from("access_fulfilment_tasks")
    .select("id, tenant_id, status, due_at, reminded_at, assignee_identity_id, applications(name, display_name)")
    .in("status", ["open", "claimed", "failed"])
    .lt("due_at", now.toISOString())
    .order("due_at")
    .limit(500);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  let reminded = 0;
  for (const t of (data ?? []) as unknown as Row[]) {
    const tenant = t.tenant_id as string;
    if (tenantId && tenant !== tenantId) continue;
    if (!needsReminder({ status: t.status as FulfilmentTaskStatus, dueAt: t.due_at as string, remindedAt: (t.reminded_at as string | null) ?? null }, now)) continue;
    const userId = t.assignee_identity_id ? await userOf(tenant, t.assignee_identity_id as string) : null;
    if (!userId) continue;
    const app = (t.applications as Row | null) ?? null;
    await notify({ tenantId: tenant, userId, type: "fulfilment_task", title: `Overdue: access to fulfil in ${(app?.display_name as string | null) ?? (app?.name as string | null) ?? "an application"}`, body: "This approved access is past its fulfilment time. Open Fulfilment Tasks.", referenceType: "access_fulfilment_task", referenceId: t.id as string });
    await supabaseServiceRole().from("access_fulfilment_tasks").update({ reminded_at: now.toISOString() }).eq("tenant_id", tenant).eq("id", t.id as string);
    reminded++;
  }

  // WID-C02: a removal marked done that no read of the system has confirmed: the access may still be there.
  let unconfirmed = supabaseServiceRole()
    .from("access_fulfilment_tasks")
    .select("id, tenant_id, kind, status, completed_at, reminded_at, assignee_identity_id, applications(name, display_name)")
    .eq("kind", "remove")
    .eq("status", "completed")
    .lt("completed_at", new Date(now.getTime() - UNCONFIRMED_REMOVAL_DAYS * 86_400_000).toISOString())
    .order("completed_at")
    .limit(500);
  if (tenantId) unconfirmed = unconfirmed.eq("tenant_id", tenantId);
  const { data: waiting, error: waitingError } = await unconfirmed;
  if (waitingError) throw new ApiError(500, "QUERY_FAILED", waitingError.message);
  for (const t of (waiting ?? []) as unknown as Row[]) {
    const tenant = t.tenant_id as string;
    if (tenantId && tenant !== tenantId) continue;
    const task = { kind: t.kind as string, status: t.status as FulfilmentTaskStatus, completedAt: (t.completed_at as string | null) ?? null, remindedAt: (t.reminded_at as string | null) ?? null };
    if (!needsUnconfirmedRemovalReminder(task, now)) continue;
    const userId = t.assignee_identity_id ? await userOf(tenant, t.assignee_identity_id as string) : null;
    if (!userId) continue;
    const app = (t.applications as Row | null) ?? null;
    await notify({
      tenantId: tenant,
      userId,
      type: "fulfilment_task",
      title: `Removal not confirmed in ${(app?.display_name as string | null) ?? (app?.name as string | null) ?? "an application"}`,
      body: `This access was marked removed ${UNCONFIRMED_REMOVAL_DAYS}+ days ago, but the system still has not confirmed it. Check that it is really gone.`,
      referenceType: "access_fulfilment_task",
      referenceId: t.id as string,
    });
    await supabaseServiceRole().from("access_fulfilment_tasks").update({ reminded_at: now.toISOString() }).eq("tenant_id", tenant).eq("id", t.id as string);
    reminded++;
  }
  return { reminded };
}

/** ACCESS-P0-30: closes an account's live tasks of one kind (created or disabled at the source, or moved off a placeholder). */
export async function closeTasksForAccounts(tenantId: string, accountIds: string[], kind: "create_account" | "disable_account", status: "verified" | "cancelled"): Promise<number> {
  if (!accountIds.length) return 0;
  const now = new Date().toISOString();
  const { data, error } = await supabaseServiceRole()
    .from("access_fulfilment_tasks")
    .update({ status, closed_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .in("account_id", accountIds)
    .in("status", LIVE)
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  return (data ?? []).length;
}

/** "Mark fulfilled" on a request: every live task of it is done (what it asked for still waits for the source). */
export async function completeTasksForRequest(tenantId: string, requestId: string): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServiceRole()
    .from("access_fulfilment_tasks")
    .update({ status: "completed", completed_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("request_id", requestId)
    .in("status", ["open", "claimed", "failed"])
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  return (data ?? []).length;
}
