/**
 * INTEGRATION-P0-13 with ACCESS-P0-29 (decision D3) — the pure rules (#9)
 * for carrying out a fulfilment task through a connector: which tasks a
 * connector may do, what it is told to change, how often it tries, and
 * when a run that never answered counts as lost. The service
 * (connectorFulfilment.ts) loads and writes.
 */
import type { FulfilmentTaskKind } from "./fulfilmentTaskRules";

/**
 * D3: removing access and disabling an account came first (reversible);
 * adding access and creating an account follow, under the same rules:
 * declared per connection, turned on by an administrator, approved first.
 */
export type ConnectorOperation = "revoke_access" | "disable_account" | "grant_access" | "create_account";

export function connectorOperation(kind: FulfilmentTaskKind): ConnectorOperation | null {
  if (kind === "remove") return "revoke_access";
  if (kind === "disable_account") return "disable_account";
  if (kind === "grant") return "grant_access";
  if (kind === "create_account") return "create_account";
  return null;
}

/** `pending`: a placeholder holding a request until the real account exists (it has no id on the system). */
export type TargetAccount = { externalRef: string | null; integrationId: string | null; pending?: boolean };
export type TargetEntitlement = { externalRef: string | null; integrationId: string | null };

/**
 * What the connector is told to change, and through which connection: the
 * one the account was imported from. Adding or removing access also needs
 * the entitlement to come from that same connection, so a write never names
 * another system's id. Null when the task cannot be done by a connector
 * (including access for an account that does not exist yet).
 */
export function connectorTarget(
  operation: Exclude<ConnectorOperation, "create_account">,
  account: TargetAccount | null,
  entitlement: TargetEntitlement | null,
): { integrationId: string; target: Record<string, string> } | null {
  if (!account?.externalRef || !account.integrationId || account.pending) return null;
  if (operation === "disable_account") return { integrationId: account.integrationId, target: { account: account.externalRef } };
  if (!entitlement?.externalRef || entitlement.integrationId !== account.integrationId) return null;
  return { integrationId: account.integrationId, target: { account: account.externalRef, entitlement: entitlement.externalRef } };
}

export type NewAccountSubject = { email: string | null; username: string | null; displayName: string | null };

/**
 * A new account: named after the person or agent it is for, created
 * through the connection the application is onboarded with. Null without
 * that connection, or without an email or username to name it by (a
 * display name alone is not unique).
 */
export function newAccountTarget(subject: NewAccountSubject | null, integrationId: string | null): { integrationId: string; target: Record<string, string> } | null {
  if (!subject || !integrationId) return null;
  const target: Record<string, string> = {};
  for (const [key, value] of [["email", subject.email], ["username", subject.username], ["displayName", subject.displayName]] as const) {
    const v = value?.trim();
    if (v) target[key] = v.slice(0, 300);
  }
  if (!target.email && !target.username) return null;
  return { integrationId, target };
}

/** Tries per run: the first, then two more after a short wait, only for failures worth retrying. */
export const MAX_ATTEMPTS_PER_RUN = 3;
/** Across all runs (a person may ask the connector to try again). */
export const MAX_ATTEMPTS_TOTAL = 20;

export function retryDelayMs(attempt: number): number {
  return attempt <= 1 ? 2_000 : 8_000;
}

export function shouldRetry(result: { status: string; retryable?: boolean }, attemptsThisRun: number, attemptsTotal: number): boolean {
  return result.status === "failed" && result.retryable === true && attemptsThisRun < MAX_ATTEMPTS_PER_RUN && attemptsTotal < MAX_ATTEMPTS_TOTAL;
}

/** A run still marked running this long after it started never reported back (a lost process). */
export const LOST_RUN_MS = 15 * 60_000;

export function runIsLost(startedAt: string | null, now: Date): boolean {
  return !!startedAt && now.getTime() - Date.parse(startedAt) > LOST_RUN_MS;
}

/** The idempotency key of one attempt: per task and attempt, so a retry is a new request and a replay of one attempt is not. */
export function attemptKey(taskId: string, attempt: number): string {
  return `fulfil:${taskId}:${attempt}`;
}
