/**
 * INTEGRATION-P0-13 with ACCESS-P0-29 (decision D3) — the pure rules (#9)
 * for carrying out a fulfilment task through a connector: which tasks a
 * connector may do, what it is told to change, how often it tries, and
 * when a run that never answered counts as lost. The service
 * (connectorFulfilment.ts) loads and writes.
 */
import type { FulfilmentTaskKind } from "./fulfilmentTaskRules";

/** Reversible changes first (D3): removing access and disabling an account. Adding and creating follow. */
export type ConnectorOperation = "revoke_access" | "disable_account";

export function connectorOperation(kind: FulfilmentTaskKind): ConnectorOperation | null {
  if (kind === "remove") return "revoke_access";
  if (kind === "disable_account") return "disable_account";
  return null;
}

export type TargetAccount = { externalRef: string | null; integrationId: string | null };
export type TargetEntitlement = { externalRef: string | null; integrationId: string | null };

/**
 * What the connector is told to change, and through which connection: the
 * one the account was imported from. A removal also needs the entitlement
 * to come from that same connection, so a write never names another
 * system's id. Null when the task cannot be done by a connector.
 */
export function connectorTarget(
  operation: ConnectorOperation,
  account: TargetAccount | null,
  entitlement: TargetEntitlement | null,
): { integrationId: string; target: Record<string, string> } | null {
  if (!account?.externalRef || !account.integrationId) return null;
  if (operation === "disable_account") return { integrationId: account.integrationId, target: { account: account.externalRef } };
  if (!entitlement?.externalRef || entitlement.integrationId !== account.integrationId) return null;
  return { integrationId: account.integrationId, target: { account: account.externalRef, entitlement: entitlement.externalRef } };
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
