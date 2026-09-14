import "server-only";

import { ApiError } from "@/lib/shared/types/foundation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FOUNDATION-P0-11 — shared input-validation contract for API route
 * request-body/query-param trust boundaries. Published here so future
 * routes have one sanctioned way to validate structured input instead of
 * hand-rolling ad hoc checks per module; existing shipped route handlers
 * are not rewritten to adopt this retroactively (CLAUDE.md §3: don't
 * refactor unrelated code while implementing a story) — this is the
 * contract for new/future routes to use.
 *
 * Every assertion throws ApiError(400, "VALIDATION_FAILED", ...) on
 * failure, matching the existing error-response convention
 * (lib/shared/apiError.ts) so a validation failure surfaces as a normal
 * 400 JSON error, not an unhandled exception.
 */

function fail(field: string, reason: string): never {
  throw new ApiError(400, "VALIDATION_FAILED", `${field}: ${reason}`);
}

export function assertNonEmptyString(
  value: unknown,
  field: string,
  opts: { maxLength?: number } = {},
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(field, "must be a non-empty string");
  }
  const trimmed = (value as string).trim();
  const maxLength = opts.maxLength ?? 10_000;
  if (trimmed.length > maxLength) {
    fail(field, `must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    fail(field, "must be a valid UUID");
  }
  return value as string;
}

export function assertOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(field, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function assertPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(field, "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Guards against oversized JSON payloads being stored in a `jsonb` column
 * (e.g. sso_connections.idp_metadata, agent_contracts fields) — a cheap,
 * deterministic denial-of-service/storage-abuse control at the API
 * boundary, independent of whatever the database's own column limits are.
 */
export function assertJsonSizeWithinLimit(value: unknown, field: string, maxBytes: number): void {
  const size = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (size > maxBytes) {
    fail(field, `must serialize to at most ${maxBytes} bytes`);
  }
}

/**
 * Strips control characters (other than \n/\t) and caps length — for any
 * free-text field that will be persisted and later rendered (defense in
 * depth on top of React's own JSX auto-escaping, which already prevents
 * script injection for anything rendered as text content).
 */
export function sanitizePlainText(value: string, maxLength = 10_000): string {
  const stripped = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return stripped.slice(0, maxLength);
}
