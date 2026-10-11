import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { chooseAccount, placeholderRef } from "./pendingGrantRules";
import { closeTasksForAccounts, closeTasksForGrants, completeTasksForRequest, openFulfilmentTask } from "./fulfilmentTasks";

/**
 * ACCESS-P0-28 — an approved request (or package assignment) becomes a
 * grant in `access_grants` with fulfilment status `pending_fulfilment`:
 * not access yet, so every reader of effective access skips it. "Mark
 * fulfilled" makes it `fulfilled_unverified`; connector reconciliation
 * makes it `verified` when it finds the grant on the target
 * (connectorAccess.ts). When the subject has no account on the
 * application, a placeholder account (status `pending`) holds the grant
 * until account reconciliation brings the real one (accounts.ts).
 *
 * Service role: called from the approval paths after their own permission
 * checks, and from the post-sync pipeline. Every statement is filtered on
 * `tenantId`, and the request or assignment is read inside that tenant
 * first (§14). A failure here never undoes the approval: it is audited,
 * and the request shows that it is not tracked.
 */

type Row = Record<string, unknown>;
type Subject = { identityId: string | null; agentId: string | null };
type Line = { applicationId: string; entitlementId: string | null; requestId: string | null; itemId: string | null };

async function accountFor(tenantId: string, applicationId: string, subject: Subject): Promise<string | null> {
  const admin = supabaseServiceRole();
  let q = admin.from("accounts").select("id, tenant_id, status").eq("tenant_id", tenantId).eq("application_id", applicationId).neq("status", "disabled");
  q = subject.agentId ? q.eq("agent_id", subject.agentId) : q.eq("identity_id", subject.identityId!);
  const { data, error } = await q.limit(10);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const choice = chooseAccount(((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => ({ id: r.id as string, status: r.status as string })));
  if (choice.kind === "ambiguous") return null;
  if (choice.kind === "existing") return choice.accountId;
  const ref = placeholderRef(subject);
  const { data: created, error: createError } = await admin
    .from("accounts")
    .insert({
      tenant_id: tenantId,
      application_id: applicationId,
      identity_id: subject.identityId,
      agent_id: subject.agentId,
      external_account_ref: ref,
      status: "pending",
      source: "request",
      correlation: "correlated",
    })
    .select("id")
    .single();
  if (createError?.code === "23505") {
    const { data: again } = await admin.from("accounts").select("id").eq("tenant_id", tenantId).eq("application_id", applicationId).eq("external_account_ref", ref).maybeSingle();
    return (again?.id as string | undefined) ?? null;
  }
  if (createError || !created) throw new ApiError(500, "CREATE_FAILED", createError?.message ?? "Could not create the pending account");
  return created.id as string;
}

/** Adds the pending grant for one line, or links the live grant that already gives that access. Returns the grant id. */
async function pendGrant(tenantId: string, accountId: string, line: Line & { entitlementId: string }): Promise<{ grantId: string; existing: boolean }> {
  const admin = supabaseServiceRole();
  const { data: live, error } = await admin
    .from("access_grants")
    .select("id, request_id, access_package_assignment_item_id")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId)
    .eq("entitlement_id", line.entitlementId)
    .is("revoked_at", null)
    .limit(1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const current = (live ?? [])[0] as Row | undefined;
  if (current) {
    // The access already exists (or is already pending for another request): nothing to fulfil.
    // It is linked to this request or item when nothing asked for it before, so the request shows it.
    const link = line.itemId ? { access_package_assignment_item_id: line.itemId, request_id: current.request_id ?? line.requestId } : { request_id: line.requestId };
    if (!current.request_id && !current.access_package_assignment_item_id) {
      await admin.from("access_grants").update(link).eq("tenant_id", tenantId).eq("id", current.id as string);
    }
    return { grantId: current.id as string, existing: true };
  }
  const { data, error: insertError } = await admin
    .from("access_grants")
    .insert({
      tenant_id: tenantId,
      account_id: accountId,
      entitlement_id: line.entitlementId,
      grant_type: "direct",
      fulfilment_status: "pending_fulfilment",
      request_id: line.requestId,
      access_package_assignment_item_id: line.itemId,
    })
    .select("id")
    .single();
  if (insertError?.code === "23505") {
    // This request or item was turned into its grant a moment ago.
    let q = admin.from("access_grants").select("id").eq("tenant_id", tenantId);
    q = line.itemId ? q.eq("access_package_assignment_item_id", line.itemId) : q.eq("request_id", line.requestId!).eq("entitlement_id", line.entitlementId);
    const { data: again } = await q.maybeSingle();
    if (again) return { grantId: again.id as string, existing: false };
  }
  if (insertError || !data) throw new ApiError(500, "CREATE_FAILED", insertError?.message ?? "Could not record the pending grant");
  // ACCESS-P0-29: until provisioning exists, a person makes the change: their task opens with the grant.
  await openFulfilmentTask(tenantId, { grantId: data.id as string, requestId: line.requestId, applicationId: line.applicationId });
  return { grantId: data.id as string, existing: false };
}

async function pendLines(tenantId: string, subject: Subject, lines: Line[], audit: { objectType: string; objectId: string }): Promise<void> {
  const results: { applicationId: string; entitlementId: string | null; accountId: string | null; grantId: string | null; existing?: boolean }[] = [];
  for (const line of lines) {
    // A line for an application alone asks for an account: that is ACCESS-P0-30, not tracked here yet.
    if (!line.entitlementId) continue;
    const accountId = await accountFor(tenantId, line.applicationId, subject);
    if (!accountId) {
      results.push({ applicationId: line.applicationId, entitlementId: line.entitlementId, accountId, grantId: null });
      continue;
    }
    const { grantId, existing } = await pendGrant(tenantId, accountId, { ...line, entitlementId: line.entitlementId });
    results.push({ applicationId: line.applicationId, entitlementId: line.entitlementId, accountId, grantId, existing });
  }
  if (!results.length) return;
  const ambiguous = results.filter((r) => r.accountId === null).length;
  await writeAudit({
    tenantId,
    actorType: "system",
    action: "access.grants_pending",
    objectType: audit.objectType,
    objectId: audit.objectId,
    outcome: ambiguous ? "failure" : "success",
    metadata: { lines: results, ...(ambiguous ? { reason: "The subject has several accounts on the application; none was chosen" } : {}) },
  });
}

/** After a request for an application (and optionally an entitlement) is approved. Never throws: a failure is audited. */
export async function pendRequest(tenantId: string, requestId: string): Promise<void> {
  try {
    const { data: req, error } = await supabaseServiceRole()
      .from("access_requests")
      .select("id, tenant_id, status, request_type, application_id, entitlement_id, subject_identity_id, agent_id")
      .eq("tenant_id", tenantId)
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (!req || req.tenant_id !== tenantId || req.status !== "approved" || !req.application_id) return;
    const subject = { identityId: (req.agent_id as string | null) ? null : ((req.subject_identity_id as string | null) ?? null), agentId: (req.agent_id as string | null) ?? null };
    const applicationId = req.application_id as string;
    const entitlementId = (req.entitlement_id as string | null) ?? null;
    // ACCESS-P0-30: besides access, a request may ask for an account, for access to go, or for an account to be disabled.
    if (req.request_type === "grant" && entitlementId) {
      await pendLines(tenantId, subject, [{ applicationId, entitlementId, requestId, itemId: null }], { objectType: "access_request", objectId: requestId });
    } else if (req.request_type === "grant") {
      await pendAccount(tenantId, subject, applicationId, requestId);
    } else if (req.request_type === "remove" && entitlementId) {
      await pendRemoval(tenantId, subject, applicationId, entitlementId, requestId);
    } else if (req.request_type === "disable_account") {
      await pendDisable(tenantId, subject, applicationId, requestId);
    } else if (req.request_type === "extend" && entitlementId) {
      await pendExtension(tenantId, subject, applicationId, entitlementId, requestId);
    }
  } catch (err) {
    await writeAudit({ tenantId, actorType: "system", action: "access.grants_pending", objectType: "access_request", objectId: requestId, outcome: "failure", metadata: { error: err instanceof ApiError ? err.code : "UNEXPECTED" } });
  }
}

/** The subject's real (not placeholder) accounts on the application. */
async function realAccounts(tenantId: string, applicationId: string, subject: Subject): Promise<{ id: string; status: string }[]> {
  let q = supabaseServiceRole().from("accounts").select("id, tenant_id, status").eq("tenant_id", tenantId).eq("application_id", applicationId).neq("status", "pending");
  q = subject.agentId ? q.eq("agent_id", subject.agentId) : q.eq("identity_id", subject.identityId!);
  const { data, error } = await q.limit(10);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => ({ id: r.id as string, status: r.status as string }));
}

const lineAudit = (tenantId: string, requestId: string, action: string, ok: boolean, metadata: Record<string, unknown>) =>
  writeAudit({ tenantId, actorType: "system", action, objectType: "access_request", objectId: requestId, outcome: ok ? "success" : "failure", metadata });

/** ACCESS-P0-30: an account requested: when the subject has none, a placeholder holds the request and a task asks for the account. */
async function pendAccount(tenantId: string, subject: Subject, applicationId: string, requestId: string): Promise<void> {
  if ((await realAccounts(tenantId, applicationId, subject)).length) {
    await lineAudit(tenantId, requestId, "access.account_requested", true, { applicationId, outcome: "The subject already has an account" });
    return;
  }
  const accountId = await accountFor(tenantId, applicationId, subject);
  if (!accountId) return;
  await openFulfilmentTask(tenantId, { kind: "create_account", accountId, requestId, applicationId });
  await lineAudit(tenantId, requestId, "access.account_requested", true, { applicationId, accountId });
}

/** ACCESS-P0-30: access to remove: the grant is marked pending removal (it is still access) and a task asks for the change. */
async function pendRemoval(tenantId: string, subject: Subject, applicationId: string, entitlementId: string, requestId: string): Promise<void> {
  const admin = supabaseServiceRole();
  const accounts = await realAccounts(tenantId, applicationId, subject);
  const { data, error } = accounts.length
    ? await admin
        .from("access_grants")
        .update({ removal_status: "pending_removal", removal_request_id: requestId, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .in("account_id", accounts.map((a) => a.id))
        .eq("entitlement_id", entitlementId)
        .is("revoked_at", null)
        .is("removal_status", null)
        .neq("fulfilment_status", "pending_fulfilment")
        .select("id")
    : { data: [], error: null };
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  const grantIds = ((data ?? []) as Row[]).map((r) => r.id as string);
  for (const grantId of grantIds) await openFulfilmentTask(tenantId, { kind: "remove", grantId, requestId, applicationId });
  await lineAudit(tenantId, requestId, "access.removal_pending", grantIds.length > 0, grantIds.length ? { grantIds } : { reason: "The subject holds no such access to remove" });
}

/** ACCESS-P0-30: an account to disable: its one active account gets a task; several, or none, are not guessed. */
async function pendDisable(tenantId: string, subject: Subject, applicationId: string, requestId: string): Promise<void> {
  const active = (await realAccounts(tenantId, applicationId, subject)).filter((a) => a.status === "active");
  if (active.length !== 1) {
    await lineAudit(tenantId, requestId, "access.account_disable_pending", false, { reason: active.length ? "The subject has several active accounts; none was chosen" : "The subject has no active account to disable" });
    return;
  }
  await openFulfilmentTask(tenantId, { kind: "disable_account", accountId: active[0].id, requestId, applicationId });
  await lineAudit(tenantId, requestId, "access.account_disable_pending", true, { accountId: active[0].id });
}

/**
 * ACCESS-P0-32: an approved extension. The access the subject holds through
 * a request now rests on this one (its approval and end date), and removal
 * work its old end date started is called off. Nothing changes on the
 * target, so there is no task.
 */
async function pendExtension(tenantId: string, subject: Subject, applicationId: string, entitlementId: string, requestId: string): Promise<void> {
  const admin = supabaseServiceRole();
  const accounts = await realAccounts(tenantId, applicationId, subject);
  const { data, error } = accounts.length
    ? await admin
        .from("access_grants")
        .select("id, removal_status, removal_request_id")
        .eq("tenant_id", tenantId)
        .in("account_id", accounts.map((a) => a.id))
        .eq("entitlement_id", entitlementId)
        .is("revoked_at", null)
        .is("access_package_assignment_item_id", null)
        .neq("fulfilment_status", "pending_fulfilment")
    : { data: [], error: null };
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  // A removal someone asked for, or one already done on the target, is not undone by an extension.
  const grants = ((data ?? []) as Row[]).filter((g) => g.removal_status === null || (g.removal_status === "pending_removal" && g.removal_request_id === null));
  if (!grants.length) {
    await lineAudit(tenantId, requestId, "access.access_extended", false, { reason: "The subject no longer holds this access to extend" });
    return;
  }
  const ids = grants.map((g) => g.id as string);
  const now = new Date().toISOString();
  const { error: moveError } = await admin.from("access_grants").update({ request_id: requestId, updated_at: now }).eq("tenant_id", tenantId).in("id", ids);
  if (moveError) throw new ApiError(500, "UPDATE_FAILED", moveError.message);
  const reopened = grants.filter((g) => g.removal_status === "pending_removal").map((g) => g.id as string);
  if (reopened.length) {
    const { error: keepError } = await admin
      .from("access_grants")
      .update({ removal_status: null, updated_at: now })
      .eq("tenant_id", tenantId)
      .in("id", reopened)
      .eq("removal_status", "pending_removal")
      .is("removal_request_id", null);
    if (keepError) throw new ApiError(500, "UPDATE_FAILED", keepError.message);
    await closeTasksForGrants(tenantId, reopened, "cancelled", "remove");
  }
  await lineAudit(tenantId, requestId, "access.access_extended", true, { grantIds: ids, removalCancelled: reopened });
}

/**
 * ACCESS-P0-32: access whose approval has ended (a request's end date, an
 * expired or revoked package assignment) becomes removal work: each live
 * grant is marked pending removal (it is still access) and gets one removal
 * task. Conditional on the grant not being marked already, with one live
 * task per grant (0123), so running it again changes nothing. Returns the
 * grants it marked.
 */
export async function queueRemoval(tenantId: string, lines: { grantId: string; applicationId: string }[]): Promise<string[]> {
  if (!lines.length) return [];
  const { data, error } = await supabaseServiceRole()
    .from("access_grants")
    .update({ removal_status: "pending_removal", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .in("id", lines.map((l) => l.grantId))
    .is("revoked_at", null)
    .is("removal_status", null)
    .neq("fulfilment_status", "pending_fulfilment")
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  const marked = new Set(((data ?? []) as Row[]).map((r) => r.id as string));
  for (const line of lines) if (marked.has(line.grantId)) await openFulfilmentTask(tenantId, { kind: "remove", grantId: line.grantId, requestId: null, applicationId: line.applicationId });
  return [...marked];
}

/** ACCESS-P0-32: grants still waiting for fulfilment when their approval ends never existed: withdrawn (revoked), their tasks cancelled. */
export async function withdrawGrants(tenantId: string, grantIds: string[]): Promise<void> {
  if (!grantIds.length) return;
  const now = new Date().toISOString();
  const { data, error } = await supabaseServiceRole()
    .from("access_grants")
    .update({ revoked_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .in("id", grantIds)
    .eq("fulfilment_status", "pending_fulfilment")
    .is("revoked_at", null)
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await closeTasksForGrants(tenantId, ((data ?? []) as Row[]).map((r) => r.id as string), "cancelled");
}

/**
 * "Mark fulfilled" on a request: what it asked for was done on the target,
 * not yet seen there. Its grants become fulfilled, not yet verified; a
 * removal becomes removed, not yet verified; its tasks are done.
 */
export async function markRequestFulfilled(tenantId: string, requestId: string): Promise<void> {
  await markGrantsFulfilled(tenantId, { requestId });
  const { error } = await supabaseServiceRole()
    .from("access_grants")
    .update({ removal_status: "removed_unverified", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("removal_request_id", requestId)
    .eq("removal_status", "pending_removal");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await completeTasksForRequest(tenantId, requestId);
}

/** After a package assignment is created: one pending grant per item. Never throws: a failure is audited. */
export async function pendAssignment(tenantId: string, assignmentId: string): Promise<void> {
  try {
    const admin = supabaseServiceRole();
    const { data: assignment, error } = await admin
      .from("access_package_assignments")
      .select("id, tenant_id, identity_id, request_id, access_package_assignment_items(id, application_id, entitlement_id, status)")
      .eq("tenant_id", tenantId)
      .eq("id", assignmentId)
      .maybeSingle();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    if (!assignment || assignment.tenant_id !== tenantId) return;
    const items = ((assignment.access_package_assignment_items ?? []) as Row[]).filter((i) => i.status === "pending");
    await pendLines(
      tenantId,
      { identityId: assignment.identity_id as string, agentId: null },
      items.map((i) => ({ applicationId: i.application_id as string, entitlementId: (i.entitlement_id as string | null) ?? null, requestId: (assignment.request_id as string | null) ?? null, itemId: i.id as string })),
      { objectType: "access_package_assignment", objectId: assignmentId },
    );
  } catch (err) {
    await writeAudit({ tenantId, actorType: "system", action: "access.grants_pending", objectType: "access_package_assignment", objectId: assignmentId, outcome: "failure", metadata: { error: err instanceof ApiError ? err.code : "UNEXPECTED" } });
  }
}

/** "Mark fulfilled": the request's or item's pending grants become fulfilled, not yet verified. */
export async function markGrantsFulfilled(tenantId: string, by: { requestId: string } | { itemId: string }): Promise<number> {
  let q = supabaseServiceRole()
    .from("access_grants")
    .update({ fulfilment_status: "fulfilled_unverified", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("fulfilment_status", "pending_fulfilment");
  q = "requestId" in by ? q.eq("request_id", by.requestId).is("access_package_assignment_item_id", null) : q.eq("access_package_assignment_item_id", by.itemId);
  const { data, error } = await q.select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  const ids = ((data ?? []) as Row[]).map((r) => r.id as string);
  // Marked fulfilled on the request or item: its tasks are done too (the grant still waits for verification).
  await closeTasksForGrants(tenantId, ids, "completed");
  return ids.length;
}

/** An assignment ended before its items were fulfilled: their pending grants never existed, so they are withdrawn (revoked). */
export async function withdrawPendingGrants(tenantId: string, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  const now = new Date().toISOString();
  const { data, error } = await supabaseServiceRole()
    .from("access_grants")
    .update({ revoked_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("fulfilment_status", "pending_fulfilment")
    .is("revoked_at", null)
    .in("access_package_assignment_item_id", itemIds)
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await closeTasksForGrants(tenantId, ((data ?? []) as Row[]).map((r) => r.id as string), "cancelled");
}

/** The grants a request asked for (its own and its package items'), for the request page. */
export async function grantsForRequest(tenantId: string, requestId: string): Promise<{ id: string; entitlementId: string; accountId: string; fulfilmentStatus: string; verifiedAt: string | null; revokedAt: string | null }[]> {
  const { data, error } = await supabaseServiceRole()
    .from("access_grants")
    .select("id, tenant_id, entitlement_id, account_id, fulfilment_status, verified_at, revoked_at")
    .eq("tenant_id", tenantId)
    .eq("request_id", requestId)
    .limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as Row[])
    .filter((r) => r.tenant_id === tenantId)
    .map((r) => ({
      id: r.id as string,
      entitlementId: r.entitlement_id as string,
      accountId: r.account_id as string,
      fulfilmentStatus: r.fulfilment_status as string,
      verifiedAt: (r.verified_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
    }));
}

/**
 * After account reconciliation: each placeholder account whose subject now
 * has exactly one real account on the application hands its grants to it
 * and is removed. Its grants keep their fulfilment status, so the next
 * access reconciliation can verify them. Several real accounts: the
 * placeholder stays (nothing is guessed, §17.6).
 */
export async function replacePlaceholders(tenantId: string, applicationId: string): Promise<number> {
  const admin = supabaseServiceRole();
  const { data: rows, error } = await admin
    .from("accounts")
    .select("id, tenant_id, identity_id, agent_id, status")
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .limit(5000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const accounts = ((rows ?? []) as Row[]).filter((r) => r.tenant_id === tenantId);
  const placeholders = accounts.filter((a) => a.status === "pending");
  let replaced = 0;
  for (const p of placeholders) {
    const real = accounts.filter(
      (a) => a.status !== "pending" && ((p.agent_id && a.agent_id === p.agent_id) || (!p.agent_id && p.identity_id && a.identity_id === p.identity_id)),
    );
    if (real.length !== 1) continue;
    // ACCESS-P0-30: a task asking for this account now names the real one, and the account exists: verified.
    const { error: taskError } = await admin.from("access_fulfilment_tasks").update({ account_id: real[0].id, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("account_id", p.id as string);
    if (taskError) throw new ApiError(500, "UPDATE_FAILED", taskError.message);
    await closeTasksForAccounts(tenantId, [real[0].id as string], "create_account", "verified");
    const { error: moveError } = await admin.from("access_grants").update({ account_id: real[0].id, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("account_id", p.id as string);
    if (moveError) throw new ApiError(500, "UPDATE_FAILED", moveError.message);
    const { error: deleteError } = await admin.from("accounts").delete().eq("tenant_id", tenantId).eq("id", p.id as string).eq("status", "pending");
    if (deleteError) throw new ApiError(500, "UPDATE_FAILED", deleteError.message);
    replaced++;
    await writeAudit({
      tenantId,
      actorType: "system",
      action: "access.pending_account_replaced",
      objectType: "account",
      objectId: real[0].id as string,
      outcome: "success",
      metadata: { placeholderId: p.id, applicationId },
    });
  }
  return replaced;
}

/**
 * ACCESS-P0-30: after account reconciliation, a disable task whose account
 * the source now shows disabled, or no longer lists, is verified.
 */
export async function verifyDisabledAccounts(tenantId: string, applicationId: string): Promise<number> {
  const admin = supabaseServiceRole();
  const { data: tasks, error } = await admin
    .from("access_fulfilment_tasks")
    .select("account_id")
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .eq("kind", "disable_account")
    .in("status", ["open", "claimed", "failed", "completed"])
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const ids = [...new Set(((tasks ?? []) as Row[]).map((t) => t.account_id as string))];
  if (!ids.length) return 0;
  const { data: accounts, error: accountError } = await admin.from("accounts").select("id, tenant_id, status, missing_from_source_at").eq("tenant_id", tenantId).in("id", ids);
  if (accountError) throw new ApiError(500, "QUERY_FAILED", accountError.message);
  const done = ((accounts ?? []) as Row[]).filter((a) => a.tenant_id === tenantId && (a.status === "disabled" || a.missing_from_source_at)).map((a) => a.id as string);
  return closeTasksForAccounts(tenantId, done, "disable_account", "verified");
}
