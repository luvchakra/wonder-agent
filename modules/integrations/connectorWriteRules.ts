import { createHash } from "node:crypto";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  CONNECTOR_WRITE_OPERATIONS,
  WRITE_CAPABILITY_KEYS,
  type ConnectorCapabilities,
  type ConnectorWriteOperation,
} from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-11 — the deterministic parts of connector writes (#9, #12):
 * which capabilities an integration may declare, whether a write may run,
 * and what makes two requests "the same" for idempotency.
 */

const fail = (message: string): never => {
  throw new ApiError(400, "VALIDATION_FAILED", message);
};

/**
 * The capabilities an integration may declare: never a write (or any
 * capability) its connector does not support. Unknown keys are refused.
 */
export function validateDeclaredCapabilities(requested: unknown, supported: ConnectorCapabilities): ConnectorCapabilities {
  if (requested === undefined || requested === null) return {};
  if (typeof requested !== "object" || Array.isArray(requested)) fail("capabilities: an object of capability flags");
  const out: ConnectorCapabilities = {};
  for (const [key, value] of Object.entries(requested as Record<string, unknown>)) {
    if (typeof value !== "boolean") fail(`capabilities.${key}: true or false`);
    if (!(key in supported) && !WRITE_CAPABILITY_KEYS.includes(key as keyof ConnectorCapabilities)) {
      if (value) fail(`capabilities.${key}: not a capability of this connector`);
      continue;
    }
    if (value && supported[key as keyof ConnectorCapabilities] !== true) {
      fail(`capabilities.${key}: this connector cannot ${WRITE_CAPABILITY_KEYS.includes(key as keyof ConnectorCapabilities) ? "write" : "do"} that`);
    }
    out[key as keyof ConnectorCapabilities] = value as boolean;
  }
  return out;
}

/**
 * `idempotencyKey` names one attempt in WonderID's own record. `taskKey`
 * (WID-H02), when given, names the piece of work the attempt belongs to:
 * the key the system sees is derived from it and the request, so every
 * attempt at the same change sends the system the same key.
 */
export type WriteRequestInput = { operation?: unknown; idempotencyKey?: unknown; taskKey?: unknown; target?: unknown };

const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

export function validateWriteRequest(input: WriteRequestInput): { operation: ConnectorWriteOperation; idempotencyKey: string; taskKey: string | null; target: Record<string, string> } {
  const operation = input.operation;
  if (typeof operation !== "string" || !(operation in CONNECTOR_WRITE_OPERATIONS)) fail(`operation: one of ${Object.keys(CONNECTOR_WRITE_OPERATIONS).join(", ")}`);
  const key = input.idempotencyKey;
  if (typeof key !== "string" || !KEY_RE.test(key)) fail("idempotencyKey: 8 to 200 letters, digits or . _ : -");
  const taskKey = input.taskKey ?? null;
  if (taskKey !== null && (typeof taskKey !== "string" || !KEY_RE.test(taskKey) || taskKey.length > 180)) fail("taskKey: 8 to 180 letters, digits or . _ : -");
  const target = input.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) fail("target: an object naming the account, entitlement or identity");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) fail(`target.${k}: not a valid field name`);
    if (typeof v !== "string" || v.length > 300) fail(`target.${k}: text of at most 300 characters`);
    if (/secret|password|token|credential/i.test(k)) fail(`target.${k}: secrets never travel in a write request`);
    out[k] = v as string;
  }
  if (!Object.keys(out).length) fail("target: name at least one field");
  return { operation: operation as ConnectorWriteOperation, idempotencyKey: key as string, taskKey: taskKey as string | null, target: out };
}

/**
 * WID-H02: the `Idempotency-Key` the system receives. One per task and
 * request content: a retry of the same change sends the same key, so a
 * system that honours the key applies it once; a changed request (a
 * corrected mapping) is a different change with a different key. Without
 * a task, the attempt's own key.
 */
export function systemKey(request: { idempotencyKey: string; taskKey: string | null }, fingerprint: string): string {
  return request.taskKey ? `${request.taskKey}:${fingerprint.slice(0, 16)}` : request.idempotencyKey;
}

/** A stable fingerprint of what was asked, to spot a key reused for something else. */
export function requestFingerprint(operation: string, target: Record<string, string>): string {
  const canonical = JSON.stringify([operation, Object.keys(target).sort().map((k) => [k, target[k]])]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type WriteDecision = { run: true } | { run: false; status: "blocked"; reason: string };

/** Whether a write may be attempted at all (#12): declared, and not paused. */
export function decideWrite(operation: ConnectorWriteOperation, declared: ConnectorCapabilities, integrationStatus: string): WriteDecision {
  if (integrationStatus === "disabled") return { run: false, status: "blocked", reason: "The integration is disabled" };
  const capability = CONNECTOR_WRITE_OPERATIONS[operation];
  if (declared[capability] !== true) return { run: false, status: "blocked", reason: `The integration is not declared to ${operation.replace(/_/g, " ")} (read-only for this operation)` };
  return { run: true };
}

/** The window of the mass-change guard (QA-P0-26). */
export const WRITE_WINDOW_MS = 60 * 60_000;

/**
 * QA-P0-26 — the mass-change guard on writes: a connection that has already
 * made (or is making) `limit` changes in the last hour makes no more until
 * the hour has passed. A run of bad approvals, a broken rule or a loop then
 * stops at the limit instead of changing everything; what is refused goes
 * to a person with the reason.
 */
export function overWriteLimit(recentWrites: number, limit: number): WriteDecision {
  if (recentWrites < limit) return { run: true };
  return {
    run: false,
    status: "blocked",
    reason: `Mass-change guard: this connection already made ${recentWrites} changes in the last hour (limit ${limit}). Do it by hand, or try again later`,
  };
}

/**
 * INTEGRATION-P0-13: the capabilities a connection declares once an
 * administrator turns writes on (everything its definition supports) or
 * off (no write at all). Reads are left as they are.
 */
export function capabilitiesWithWrites(current: ConnectorCapabilities, supported: ConnectorCapabilities, enabled: boolean): ConnectorCapabilities {
  const next: ConnectorCapabilities = { ...current, provision: false, deprovision: false };
  for (const key of WRITE_CAPABILITY_KEYS) next[key] = enabled && supported[key] === true;
  if (enabled) {
    next.deprovision = supported.deprovision === true;
    next.provision = supported.provision === true;
  }
  return next;
}

/** Whether a connection's declared capabilities let it write anything. */
export function writesEnabled(declared: ConnectorCapabilities): boolean {
  return WRITE_CAPABILITY_KEYS.some((k) => declared[k] === true);
}

/**
 * WID-H02: what a failed write says about the system.
 * - `not_applied`: the system did not take the change (429, or the
 *   connection never reached it). Trying again is safe.
 * - `unclear`: the request may have reached the system and been applied
 *   (a timeout, a dropped connection, 408 or 5xx, or a success answer
 *   WonderID could not read). Sending it again is safe only when the
 *   change is declared repeatable; otherwise the system must be read first.
 * - `refused`: the system said no (4xx), or WonderID refused to send it.
 *   It will fail the same way again.
 */
export type WriteFailure = "not_applied" | "unclear" | "refused";

const NOT_SENT = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$/;
const CUT_OFF = /^(ECONNRESET|EPIPE|ETIMEDOUT|ECONNABORTED|UND_ERR_SOCKET)$/;

export function writeFailureKind(f: { status?: number; code?: string; message?: string; network?: boolean; blocked?: boolean }): WriteFailure {
  if (f.blocked) return "refused";
  if (f.status !== undefined) return f.status === 429 ? "not_applied" : f.status === 408 || f.status >= 500 ? "unclear" : "refused";
  if (f.code && NOT_SENT.test(f.code)) return "not_applied";
  if (f.code && CUT_OFF.test(f.code)) return "unclear";
  const message = f.message ?? "";
  if (/timed? ?out|socket hang up|did not return JSON/i.test(message)) return "unclear";
  // fetch's own "fetch failed": it may have failed before or after sending.
  if (f.network) return "unclear";
  return "refused";
}

/** Whether to send a failed write again now: never refused; an unclear one only when repeating it cannot make the change twice. */
export function retryableWrite(kind: WriteFailure, repeatable: boolean): boolean {
  return kind === "not_applied" || (kind === "unclear" && repeatable);
}
