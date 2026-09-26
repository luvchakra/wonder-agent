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

export type WriteRequestInput = { operation?: unknown; idempotencyKey?: unknown; target?: unknown };

export function validateWriteRequest(input: WriteRequestInput): { operation: ConnectorWriteOperation; idempotencyKey: string; target: Record<string, string> } {
  const operation = input.operation;
  if (typeof operation !== "string" || !(operation in CONNECTOR_WRITE_OPERATIONS)) fail(`operation: one of ${Object.keys(CONNECTOR_WRITE_OPERATIONS).join(", ")}`);
  const key = input.idempotencyKey;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) fail("idempotencyKey: 8 to 200 letters, digits or . _ : -");
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
  return { operation: operation as ConnectorWriteOperation, idempotencyKey: key as string, target: out };
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
