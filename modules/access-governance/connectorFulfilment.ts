import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { notify } from "@/modules/operations/service";
import { connectionCanWrite, executeConnectorWrite, startVerificationSync } from "@/modules/integrations/service";
import {
  attemptKey,
  connectorOperation,
  connectorTarget,
  retryDelayMs,
  runIsLost,
  shouldRetry,
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
 * connection not disabled) → execute (connectorWrites, one idempotency key
 * per attempt; retried twice on a network, 429 or 5xx failure) → record
 * (the task completes, not yet verified, as when a person completes it) →
 * verify (a sync reads the system again; reconciliation closes the task
 * only when the change is really there) → audit at each step.
 *
 * A failure leaves the task open for its owner, with the reason, and tells
 * them. Nothing here grants access: only removals and disabling, the
 * reversible operations D3 allows first.
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
    .select("id, tenant_id, kind, status, removal_grant_id, account_id")
    .eq("tenant_id", tenantId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!task || task.tenant_id !== tenantId) return null;
  const operation = connectorOperation(task.kind as FulfilmentTaskKind);
  if (!operation) return null;

  let accountId = (task.account_id as string | null) ?? null;
  let entitlementId: string | null = null;
  if (operation === "revoke_access") {
    const { data: grant } = await admin
      .from("access_grants")
      .select("tenant_id, account_id, entitlement_id")
      .eq("tenant_id", tenantId)
      .eq("id", task.removal_grant_id as string)
      .maybeSingle();
    if (!grant || grant.tenant_id !== tenantId) return null;
    accountId = grant.account_id as string;
    entitlementId = grant.entitlement_id as string;
  }
  if (!accountId) return null;
  const [{ data: account }, { data: entitlement }] = await Promise.all([
    admin.from("accounts").select("tenant_id, external_account_ref, source_integration_id").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle(),
    entitlementId
      ? admin.from("entitlements").select("tenant_id, external_ref, source_integration_id").eq("tenant_id", tenantId).eq("id", entitlementId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!account || account.tenant_id !== tenantId) return null;
  if (entitlement && entitlement.tenant_id !== tenantId) return null;
  const planned = connectorTarget(
    operation,
    { externalRef: (account.external_account_ref as string | null) ?? null, integrationId: (account.source_integration_id as string | null) ?? null },
    entitlement ? { externalRef: (entitlement.external_ref as string | null) ?? null, integrationId: (entitlement.source_integration_id as string | null) ?? null } : null,
  );
  if (!planned) return null;
  if (!(await connectionCanWrite(tenantId, planned.integrationId, operation))) return null;
  return { taskId, operation, ...planned };
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
    .update({ connector_status: "running", connector_integration_id: plan.integrationId, connector_started_at: now, connector_error: null, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", plan.taskId)
    .eq("status", "open")
    .or("connector_status.is.null,connector_status.eq.failed")
    .select("id, tenant_id, kind, removal_grant_id, request_id, assignee_identity_id, connector_attempts")
    .maybeSingle();
  if (claimError) throw new ApiError(500, "UPDATE_FAILED", claimError.message);
  if (!claimed || claimed.tenant_id !== tenantId) return "busy";

  let attempts = claimed.connector_attempts as number;
  let thisRun = 0;
  let outcome: { status: string; error: string | null; id?: string; retryable?: boolean } = { status: "failed", error: "Not attempted" };
  while (attempts < MAX_ATTEMPTS_TOTAL) {
    attempts++;
    thisRun++;
    try {
      outcome = await executeConnectorWrite(tenantId, actorId, plan.integrationId, { operation: plan.operation, idempotencyKey: attemptKey(plan.taskId, attempts), target: plan.target });
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
      .eq("connector_status", "running");
    if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
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

  const reason = (outcome.error ?? "The connector could not make the change").slice(0, 1000);
  const { error } = await admin
    .from("access_fulfilment_tasks")
    .update({ connector_status: "failed", connector_error: reason, connector_attempts: attempts, updated_at: done })
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
    metadata: { integrationId: plan.integrationId, operation: plan.operation, attempts, status: outcome.status, error: reason },
  });
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
  let q = admin.from("access_fulfilment_tasks").select("id, tenant_id, assignee_identity_id, connector_started_at").eq("connector_status", "running").limit(500);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  let released = 0;
  for (const row of (data ?? []) as Row[]) {
    if (tenantId && row.tenant_id !== tenantId) continue;
    if (!runIsLost((row.connector_started_at as string | null) ?? null, now)) continue;
    const t = row.tenant_id as string;
    const reason = "The connector run did not report back. Check the system, then finish the task by hand or try the connector again.";
    const { data: updated } = await admin
      .from("access_fulfilment_tasks")
      .update({ connector_status: "failed", connector_error: reason, updated_at: now.toISOString() })
      .eq("tenant_id", t)
      .eq("id", row.id as string)
      .eq("connector_status", "running")
      .select("id")
      .maybeSingle();
    if (!updated) continue;
    released++;
    await writeAudit({ tenantId: t, actorType: "system", action: "access.fulfilment_task_connector_failed", objectType: "access_fulfilment_task", objectId: row.id as string, outcome: "failure", metadata: { error: "LOST_RUN" } });
    await tellOwner(t, row.id as string, (row.assignee_identity_id as string | null) ?? null, reason);
  }
  return released;
}
