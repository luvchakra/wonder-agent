import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { notify } from "@/modules/operations/service";
import { runAfterResponse } from "@/lib/shared/afterResponse";
import { connectionCanWrite, executeConnectorWrite, startVerificationSync } from "@/modules/integrations/service";
import {
  attemptKey,
  connectorOperation,
  connectorTarget,
  newAccountTarget,
  retryDelayMs,
  runIsLost,
  shouldRetry,
  taskKey,
  uncertainReason,
  MAX_ATTEMPTS_TOTAL,
  type ConnectorOperation,
} from "./connectorFulfilmentRules";
import type { FulfilmentTaskKind } from "./fulfilmentTaskRules";

/**
 * INTEGRATION-P0-13 with ACCESS-P0-29 (decision D3, approved 2026-10-12):
 * a fulfilment task carried out by a connector.
 *
 * approval (the request, already decided by people) → plan (the task's
 * operation and target, through the connection the account came from) →
 * pre-check (writes turned on for that connection, operation supported,
 * connection not disabled) → execute (connectorWrites: one record per
 * attempt, one key per task for the system; retried twice when the system
 * did not take it, or when its outcome is unclear and the change is
 * repeatable, WID-H02) → record
 * (the task completes, not yet verified, as when a person completes it) →
 * verify (a sync reads the system again; reconciliation closes the task
 * only when the change is really there) → audit at each step.
 *
 * A failure leaves the task open for its owner, with the reason, and tells
 * them. When the system may have made a change that is not repeatable, it
 * is not sent again: a verification sync reads the system, reconciliation
 * closes the task if the change is there, and the owner may try again only
 * after that read (connector_uncertain_at, WID-H02). Access for an account that does not exist yet waits for it: the
 * connector creates the account, the next read brings it in and replaces
 * the placeholder, and then the access is added (resumeConnectorGrants).
 *
 * Service role (the task tables have no client write policy, 0122), every
 * statement filtered on `tenantId`, every row checked against it (§14).
 */

type Row = Record<string, unknown>;

export type ConnectorPlan = { taskId: string; operation: ConnectorOperation; integrationId: string; target: Record<string, string> };

/** The plan for a task, or null when no connector can do it (then it stays a person's task). */
export async function planConnectorFulfilment(tenantId: string, taskId: string): Promise<ConnectorPlan | null> {
  const admin = supabaseServiceRole();
  const { data: task, error } = await admin
    .from("access_fulfilment_tasks")
    .select("id, tenant_id, kind, status, access_grant_id, removal_grant_id, account_id, application_id")
    .eq("tenant_id", tenantId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!task || task.tenant_id !== tenantId) return null;
  const operation = connectorOperation(task.kind as FulfilmentTaskKind);
  if (!operation) return null;
  const planned =
    operation === "create_account"
      ? await planNewAccount(tenantId, (task.account_id as string | null) ?? null, task.application_id as string)
      : await planExistingAccount(tenantId, operation, task);
  if (!planned) return null;
  if (!(await connectionCanWrite(tenantId, planned.integrationId, operation))) return null;
  return { taskId, operation, ...planned };
}

/** Disable, add or remove: the account (and entitlement) as imported, through the connection they came from. */
async function planExistingAccount(tenantId: string, operation: Exclude<ConnectorOperation, "create_account">, task: Row) {
  const admin = supabaseServiceRole();
  let accountId = (task.account_id as string | null) ?? null;
  let entitlementId: string | null = null;
  const grantId = operation === "revoke_access" ? (task.removal_grant_id as string | null) : operation === "grant_access" ? (task.access_grant_id as string | null) : null;
  if (operation !== "disable_account") {
    if (!grantId) return null;
    const { data: grant } = await admin.from("access_grants").select("tenant_id, account_id, entitlement_id").eq("tenant_id", tenantId).eq("id", grantId).maybeSingle();
    if (!grant || grant.tenant_id !== tenantId) return null;
    accountId = grant.account_id as string;
    entitlementId = grant.entitlement_id as string;
  }
  if (!accountId) return null;
  const [{ data: account }, { data: entitlement }] = await Promise.all([
    admin.from("accounts").select("tenant_id, external_account_ref, source_integration_id, status").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle(),
    entitlementId
      ? admin.from("entitlements").select("tenant_id, external_ref, source_integration_id").eq("tenant_id", tenantId).eq("id", entitlementId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!account || account.tenant_id !== tenantId) return null;
  if (entitlement && entitlement.tenant_id !== tenantId) return null;
  return connectorTarget(
    operation,
    { externalRef: (account.external_account_ref as string | null) ?? null, integrationId: (account.source_integration_id as string | null) ?? null, pending: account.status === "pending" },
    entitlement ? { externalRef: (entitlement.external_ref as string | null) ?? null, integrationId: (entitlement.source_integration_id as string | null) ?? null } : null,
  );
}

/**
 * Create: the placeholder account names who it is for; the application's
 * live onboarding names the connection it reconciles against, which is the
 * one that reads the new account back to verify it.
 */
async function planNewAccount(tenantId: string, accountId: string | null, applicationId: string) {
  if (!accountId) return null;
  const admin = supabaseServiceRole();
  const [{ data: account }, { data: onboarding }] = await Promise.all([
    admin.from("accounts").select("tenant_id, status, identity_id, agent_id, application_id").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle(),
    admin.from("application_onboardings").select("tenant_id, promoted_config").eq("tenant_id", tenantId).eq("application_id", applicationId).maybeSingle(),
  ]);
  // Only a placeholder is created: a real account already exists on the system.
  if (!account || account.tenant_id !== tenantId || account.status !== "pending" || account.application_id !== applicationId) return null;
  if (!onboarding || onboarding.tenant_id !== tenantId) return null;
  const integrationId = ((onboarding.promoted_config as { integrationId?: string | null } | null)?.integrationId ?? null) || null;
  let q = admin.from("identities").select("tenant_id, email, username, display_name").eq("tenant_id", tenantId);
  q = account.agent_id ? q.eq("agent_id", account.agent_id as string) : q.eq("id", account.identity_id as string);
  const { data: identity } = await q.limit(1).maybeSingle();
  if (!identity || identity.tenant_id !== tenantId) return null;
  return newAccountTarget(
    { email: (identity.email as string | null) ?? null, username: (identity.username as string | null) ?? null, displayName: (identity.display_name as string | null) ?? null },
    integrationId,
  );
}

/**
 * Access for an account that does not exist yet: when a connector can
 * both create the account and then add the access, it creates the account
 * first. Returns the placeholder to create (its task then runs through the
 * connector), or null when a person handles it as before. A create the
 * connector already failed is the owner's again, so nothing waits on it.
 */
export async function accountToCreateFirst(tenantId: string, grantTaskId: string): Promise<string | null> {
  const admin = supabaseServiceRole();
  const { data: task } = await admin.from("access_fulfilment_tasks").select("tenant_id, kind, access_grant_id, application_id").eq("tenant_id", tenantId).eq("id", grantTaskId).maybeSingle();
  if (!task || task.tenant_id !== tenantId || task.kind !== "grant" || !task.access_grant_id) return null;
  const { data: grant } = await admin.from("access_grants").select("tenant_id, account_id").eq("tenant_id", tenantId).eq("id", task.access_grant_id as string).maybeSingle();
  if (!grant || grant.tenant_id !== tenantId) return null;
  const placeholder = await planNewAccount(tenantId, grant.account_id as string, task.application_id as string);
  if (!placeholder) return null;
  const [canCreate, canGrant] = await Promise.all([
    connectionCanWrite(tenantId, placeholder.integrationId, "create_account"),
    connectionCanWrite(tenantId, placeholder.integrationId, "grant_access"),
  ]);
  if (!canCreate || !canGrant) return null;
  const { data: failed } = await admin
    .from("access_fulfilment_tasks")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", "create_account")
    .eq("account_id", grant.account_id as string)
    .eq("status", "open")
    .eq("connector_status", "failed")
    .limit(1);
  if ((failed ?? []).length) return null;
  return grant.account_id as string;
}

/**
 * Once a placeholder's real account has arrived (pendingGrants.ts), the
 * access waiting on it can be added: each open grant task on the account
 * that no one has started goes to the connector, when one can do it.
 */
export async function resumeConnectorGrants(tenantId: string, accountId: string): Promise<number> {
  const admin = supabaseServiceRole();
  const { data: grants, error } = await admin
    .from("access_grants")
    .select("id, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId)
    .eq("fulfilment_status", "pending_fulfilment")
    .limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const grantIds = ((grants ?? []) as Row[]).filter((g) => g.tenant_id === tenantId).map((g) => g.id as string);
  if (!grantIds.length) return 0;
  const { data: tasks, error: taskError } = await admin
    .from("access_fulfilment_tasks")
    .select("id, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("kind", "grant")
    .eq("status", "open")
    .is("connector_status", null)
    .in("access_grant_id", grantIds);
  if (taskError) throw new ApiError(500, "QUERY_FAILED", taskError.message);
  let started = 0;
  for (const t of ((tasks ?? []) as Row[]).filter((r) => r.tenant_id === tenantId)) {
    const plan = await planConnectorFulfilment(tenantId, t.id as string).catch(() => null);
    if (!plan) continue;
    started++;
    runAfterResponse(() => runConnectorFulfilment(tenantId, plan));
  }
  return started;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a plan: claims the task for the connector (never twice at once),
 * tries the write, then completes the task or hands it back to its owner.
 * Returns what happened. `actorId` is the person who asked the connector
 * to try again, if one did.
 */
export async function runConnectorFulfilment(tenantId: string, plan: ConnectorPlan, actorId: string | null = null): Promise<"succeeded" | "failed" | "busy"> {
  const admin = supabaseServiceRole();
  const now = new Date().toISOString();
  // Claim: only an open task the connector is not already working on.
  const { data: claimed, error: claimError } = await admin
    .from("access_fulfilment_tasks")
    .update({ connector_status: "running", connector_integration_id: plan.integrationId, connector_started_at: now, connector_error: null, connector_uncertain_at: null, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", plan.taskId)
    .eq("status", "open")
    .or("connector_status.is.null,connector_status.eq.failed")
    .select("id, tenant_id, kind, access_grant_id, removal_grant_id, request_id, assignee_identity_id, connector_attempts")
    .maybeSingle();
  if (claimError) throw new ApiError(500, "UPDATE_FAILED", claimError.message);
  if (!claimed || claimed.tenant_id !== tenantId) return "busy";

  let attempts = claimed.connector_attempts as number;
  let thisRun = 0;
  let outcome: { status: string; error: string | null; id?: string; retryable?: boolean; uncertain?: boolean } = { status: "failed", error: "Not attempted" };
  while (attempts < MAX_ATTEMPTS_TOTAL) {
    attempts++;
    thisRun++;
    try {
      outcome = await executeConnectorWrite(tenantId, actorId, plan.integrationId, { operation: plan.operation, idempotencyKey: attemptKey(plan.taskId, attempts), taskKey: taskKey(plan.taskId), target: plan.target });
    } catch (err) {
      outcome = { status: "failed", error: err instanceof ApiError ? err.message : "The write could not be started", retryable: false };
    }
    if (!shouldRetry(outcome, thisRun, attempts)) break;
    await sleep(retryDelayMs(thisRun));
  }

  const done = new Date().toISOString();
  if (outcome.status === "succeeded") {
    const { error } = await admin
      .from("access_fulfilment_tasks")
      .update({
        status: "completed",
        completed_at: done,
        note: "Done by the connector; waiting for the next read of the system to verify it",
        connector_status: "succeeded",
        connector_attempts: attempts,
        updated_at: done,
      })
      .eq("tenant_id", tenantId)
      .eq("id", plan.taskId)
      .eq("connector_status", "running")
      // A read may have verified it meanwhile: never take a verified task back to completed.
      .neq("status", "verified");
    if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
    if (claimed.kind === "grant") {
      const { error: grantError } = await admin
        .from("access_grants")
        .update({ fulfilment_status: "fulfilled_unverified", updated_at: done })
        .eq("tenant_id", tenantId)
        .eq("id", claimed.access_grant_id as string)
        .eq("fulfilment_status", "pending_fulfilment");
      if (grantError) throw new ApiError(500, "UPDATE_FAILED", grantError.message);
    }
    if (claimed.kind === "remove") {
      const { error: grantError } = await admin
        .from("access_grants")
        .update({ removal_status: "removed_unverified", updated_at: done })
        .eq("tenant_id", tenantId)
        .eq("id", claimed.removal_grant_id as string)
        .eq("removal_status", "pending_removal");
      if (grantError) throw new ApiError(500, "UPDATE_FAILED", grantError.message);
    }
    await writeAudit({
      tenantId,
      actorId,
      actorType: actorId ? "user" : "system",
      action: "access.fulfilment_task_completed",
      objectType: "access_fulfilment_task",
      objectId: plan.taskId,
      outcome: "success",
      correlationId: outcome.id,
      metadata: { byConnector: true, integrationId: plan.integrationId, operation: plan.operation, attempts, requestId: claimed.request_id ?? null },
    });
    await startVerificationSync(tenantId, plan.integrationId);
    return "succeeded";
  }

  const uncertain = outcome.uncertain === true;
  const reason = uncertain ? uncertainReason(outcome.error) : (outcome.error ?? "The connector could not make the change").slice(0, 1000);
  const { error } = await admin
    .from("access_fulfilment_tasks")
    .update({ connector_status: "failed", connector_error: reason, connector_attempts: attempts, connector_uncertain_at: uncertain ? done : null, updated_at: done })
    .eq("tenant_id", tenantId)
    .eq("id", plan.taskId)
    .eq("connector_status", "running");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await writeAudit({
    tenantId,
    actorId,
    actorType: actorId ? "user" : "system",
    action: "access.fulfilment_task_connector_failed",
    objectType: "access_fulfilment_task",
    objectId: plan.taskId,
    outcome: "failure",
    correlationId: outcome.id,
    metadata: { integrationId: plan.integrationId, operation: plan.operation, attempts, status: outcome.status, error: reason, ...(uncertain ? { uncertain } : {}) },
  });
  // WID-H02: read the system rather than send it again; reconciliation closes the task if the change is there.
  if (uncertain) await startVerificationSync(tenantId, plan.integrationId);
  await tellOwner(tenantId, plan.taskId, (claimed.assignee_identity_id as string | null) ?? null, reason);
  return "failed";
}

async function tellOwner(tenantId: string, taskId: string, assigneeIdentityId: string | null, reason: string) {
  if (!assigneeIdentityId) return;
  const { data } = await supabaseServiceRole().from("identities").select("tenant_id, user_id").eq("tenant_id", tenantId).eq("id", assigneeIdentityId).maybeSingle();
  const userId = data && data.tenant_id === tenantId ? ((data.user_id as string | null) ?? null) : null;
  if (!userId) return;
  await notify({
    tenantId,
    userId,
    type: "fulfilment_task",
    title: "The connector could not make a change",
    body: `${reason.slice(0, 200)} Open Fulfilment Tasks to do it by hand or try the connector again.`,
    referenceType: "access_fulfilment_task",
    referenceId: taskId,
  });
}

/**
 * Daily (cron): a connector run still marked running long after it started
 * never reported back. Its outcome is unknown, so the task goes back to its
 * owner saying exactly that; the next read of the system shows what
 * happened. `tenantId` null sweeps every organization, row by row in its
 * own tenant.
 */
export async function releaseLostConnectorRuns(tenantId: string | null, now = new Date()): Promise<number> {
  const admin = supabaseServiceRole();
  let q = admin.from("access_fulfilment_tasks").select("id, tenant_id, assignee_identity_id, connector_started_at, connector_integration_id").eq("connector_status", "running").limit(500);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  let released = 0;
  for (const row of (data ?? []) as Row[]) {
    if (tenantId && row.tenant_id !== tenantId) continue;
    if (!runIsLost((row.connector_started_at as string | null) ?? null, now)) continue;
    const t = row.tenant_id as string;
    const reason = "The connector run did not report back. WonderID is reading the system again: if the change is there, this task closes by itself. Otherwise, finish it by hand or try the connector again once that read has finished.";
    const { data: updated } = await admin
      .from("access_fulfilment_tasks")
      // WID-H02: the outcome is unknown, so a retry waits for a read of the system.
      .update({ connector_status: "failed", connector_error: reason, connector_uncertain_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("tenant_id", t)
      .eq("id", row.id as string)
      .eq("connector_status", "running")
      .select("id")
      .maybeSingle();
    if (!updated) continue;
    released++;
    await writeAudit({ tenantId: t, actorType: "system", action: "access.fulfilment_task_connector_failed", objectType: "access_fulfilment_task", objectId: row.id as string, outcome: "failure", metadata: { error: "LOST_RUN", uncertain: true } });
    if (row.connector_integration_id) await startVerificationSync(t, row.connector_integration_id as string);
    await tellOwner(t, row.id as string, (row.assignee_identity_id as string | null) ?? null, reason);
  }
  return released;
}
