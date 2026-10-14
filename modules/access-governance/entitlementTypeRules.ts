import type { EntitlementTypeRequestMode } from "@/lib/shared/types/access-governance";

/**
 * ACCESS-P0-33 (design §5.4) — entitlement types per application, pure (#9):
 * what an integrator may set on a type, and what a request for an
 * entitlement of that type must respect.
 */

export const REQUEST_MODES: readonly EntitlementTypeRequestMode[] = ["single", "multiple", "free_text", "not_requestable"];

export type EntitlementTypeInput = { name?: unknown; requestMode?: unknown; certifiable?: unknown; defaultDurationDays?: unknown; maxDurationDays?: unknown; requestPolicyId?: unknown };
export type ValidEntitlementType = {
  name?: string;
  request_mode?: EntitlementTypeRequestMode;
  certifiable?: boolean;
  default_duration_days?: number | null;
  max_duration_days?: number | null;
  request_policy_id?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function days(v: unknown, field: string): number | null | { error: string } {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 3650) return { error: `${field}: whole days from 1 to 3650, or empty` };
  return n;
}

/** Validates a new type (name required) or a change (only what is given). */
export function validateEntitlementType(
  input: EntitlementTypeInput,
  creating: boolean,
  current?: { default_duration_days: number | null; max_duration_days: number | null },
): ValidEntitlementType | { error: string } {
  const out: ValidEntitlementType = {};
  if (creating || input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 100) return { error: "name: a type name of at most 100 characters" };
    out.name = name;
  }
  if (input.requestMode !== undefined) {
    if (!REQUEST_MODES.includes(input.requestMode as EntitlementTypeRequestMode)) return { error: `requestMode: one of ${REQUEST_MODES.join(", ")}` };
    out.request_mode = input.requestMode as EntitlementTypeRequestMode;
  }
  if (input.certifiable !== undefined) {
    if (typeof input.certifiable !== "boolean") return { error: "certifiable: true or false" };
    out.certifiable = input.certifiable;
  }
  for (const [key, col] of [
    ["defaultDurationDays", "default_duration_days"],
    ["maxDurationDays", "max_duration_days"],
  ] as const) {
    if (input[key] === undefined) continue;
    const d = days(input[key], key);
    if (d !== null && typeof d === "object") return d;
    out[col] = d;
  }
  const def = out.default_duration_days !== undefined ? out.default_duration_days : (current?.default_duration_days ?? null);
  const max = out.max_duration_days !== undefined ? out.max_duration_days : (current?.max_duration_days ?? null);
  if (def !== null && max !== null && def > max) return { error: "defaultDurationDays: at most the maximum" };
  if (input.requestPolicyId !== undefined) {
    if (input.requestPolicyId !== null && input.requestPolicyId !== "" && (typeof input.requestPolicyId !== "string" || !UUID_RE.test(input.requestPolicyId)))
      return { error: "requestPolicyId: a request policy, or empty" };
    out.request_policy_id = input.requestPolicyId ? (input.requestPolicyId as string) : null;
  }
  return out;
}

/** A connector's type word as a type name: trimmed, at most 100 characters; empty is no type. */
export function typeName(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const name = String(raw).trim().slice(0, 100);
  return name || null;
}

export type TypeForRequest = { requestMode: EntitlementTypeRequestMode; defaultDurationDays: number | null; maxDurationDays: number | null } | null;

/**
 * What a request for this entitlement must respect (grant or extend):
 * - an entitlement marked not requestable, or of a type shown but not
 *   requestable, is refused;
 * - the type's default duration applies when none is asked for, and its
 *   maximum caps it: more is refused, and open-ended becomes the maximum.
 * Returns the duration to use, or why not.
 */
export function entitlementRequestRules(
  entitlement: { requestable: boolean },
  type: TypeForRequest,
  durationDays: number | null,
): { ok: true; durationDays: number | null } | { ok: false; status: 400 | 403; code: string; message: string } {
  if (!entitlement.requestable || type?.requestMode === "not_requestable") return { ok: false, status: 403, code: "NOT_REQUESTABLE", message: "This access cannot be requested" };
  let duration = durationDays;
  if (duration === null && type?.defaultDurationDays) duration = type.defaultDurationDays;
  if (type?.maxDurationDays) {
    if (duration === null) duration = type.maxDurationDays;
    else if (duration > type.maxDurationDays) return { ok: false, status: 400, code: "DURATION_TOO_LONG", message: `durationDays: at most ${type.maxDurationDays} days for this kind of access` };
  }
  return { ok: true, durationDays: duration };
}
