/**
 * FOUNDATION-P0-33: the attribute-level change a configuration edit made,
 * for the audit record. Each changed field is listed with its old and new
 * value, so the Audit Trail answers "what exactly changed" without a second
 * lookup.
 *
 * Two kinds of value are never written (only the fact that they changed):
 * - text a person typed (descriptions, notes, reasons): WID-H07 keeps it on
 *   the record, where erasure can reach it; pass it as `typedText` instead;
 * - anything secret-shaped (non-negotiable #10).
 *
 * Pure; the caller passes the row as it was and the fields it wrote.
 */

export type AuditFieldChange = {
  field: string;
  from?: unknown;
  to?: unknown;
  /** Why the values are not shown. */
  omitted?: "text" | "secret" | "too_long";
};

/** Bookkeeping columns: never a change a person made. */
const IGNORED = new Set([
  "id",
  "tenant_id",
  "ref",
  "version",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "publish_requested_by",
  "publish_requested_at",
  "last_simulated_at",
]);

const TEXT = /^(description|notes?|reason|justification|comment|exception_?process|exceptionProcess)$/i;
const SECRET = /secret|password|passphrase|token|api_?key|apikey|private_?key|privatekey|credential/i;
const MAX_VALUE = 2000;
const MAX_CHANGES = 50;

function same(a: unknown, b: unknown): boolean {
  return stable(a ?? null) === stable(b ?? null);
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}

/**
 * The fields of `after` whose value differs from `before`. `text` and
 * `secret` name further fields to keep values out of, beyond the defaults.
 */
export function fieldChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  opts: { text?: string[]; secret?: string[]; ignore?: string[] } = {},
): AuditFieldChange[] {
  const out: AuditFieldChange[] = [];
  for (const [field, to] of Object.entries(after)) {
    if (to === undefined || IGNORED.has(field) || opts.ignore?.includes(field)) continue;
    const from = before?.[field];
    if (same(from, to)) continue;
    if (SECRET.test(field) || opts.secret?.includes(field)) out.push({ field, omitted: "secret" });
    else if (TEXT.test(field) || opts.text?.includes(field)) out.push({ field, omitted: "text" });
    else if (stable(from ?? null).length > MAX_VALUE || stable(to).length > MAX_VALUE) out.push({ field, omitted: "too_long" });
    else out.push({ field, from: from ?? null, to });
    if (out.length >= MAX_CHANGES) break;
  }
  return out;
}

/** Reads `metadata.changes` back from an audit row; anything malformed is dropped. */
export function readFieldChanges(metadata: Record<string, unknown> | null | undefined): AuditFieldChange[] {
  const raw = metadata?.changes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is AuditFieldChange => !!c && typeof c === "object" && typeof (c as AuditFieldChange).field === "string").slice(0, MAX_CHANGES);
}
