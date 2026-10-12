import type { FieldProvenance, IdentityAttributeDefinition, IdentityType, SourceAuthority, SourcedFields, SourcedIdentityField } from "@/lib/shared/types/agent-identity";
import { ApiError } from "@/lib/shared/types/foundation";
import { validateAttributes } from "./identityRules";

/**
 * INTEGRATION-P0-09's attribute precedence, owned by the Identity module
 * because it decides what may change on an identity. Pure (#9).
 *
 * For each incoming field:
 * - a field this source is authoritative for is written unless a
 *   higher-precedence source (lower priority number) set it last;
 * - any other field only fills a blank, and never replaces a value;
 * - an unchanged value is not a change.
 * Ties go to the incoming source, so a source can correct its own value.
 *
 * Custom attributes (INTEGRATION-P0-20) follow the same rules; an
 * authoritative source owns the ones it maps. Their provenance is kept
 * under `attributes.<name>`.
 */

type Skip = "higher_precedence" | "not_authoritative";

/**
 * WID-H01 (owner decision): a field this source owns but a higher-priority
 * source set to something else. The higher one still wins; this is kept so
 * people can review the disagreement.
 */
export type SourceDisagreement<K extends string = string, V = unknown> = { field: K; kept: V | null; keptSourceId: string; incoming: V | null };

function mergeSourced<K extends string, V>(
  current: Partial<Record<K, V | null>>,
  provenance: FieldProvenance,
  incoming: Partial<Record<K, V | null>>,
  owns: (key: K) => boolean,
  provenanceKey: (key: K) => string,
  source: SourceAuthority,
  at: string,
): { changes: Partial<Record<K, V | null>>; provenance: FieldProvenance; skipped: { field: K; reason: Skip }[]; disagreements: SourceDisagreement<K, V>[] } {
  const changes: Partial<Record<K, V | null>> = {};
  const nextProvenance: FieldProvenance = { ...provenance };
  const skipped: { field: K; reason: Skip }[] = [];
  const disagreements: SourceDisagreement<K, V>[] = [];
  const stamp = { sourceId: source.sourceId, priority: source.priority, at };

  for (const [key, raw] of Object.entries(incoming) as [K, V | null | undefined][]) {
    if (raw === undefined) continue;
    const value = raw === "" ? null : raw;
    const existing = current[key] ?? null;
    const pk = provenanceKey(key);
    if (value === existing) {
      if (owns(key) && value !== null) {
        const owner = provenance[pk];
        if (!owner || owner.priority >= source.priority) nextProvenance[pk] = stamp;
      }
      continue;
    }
    if (owns(key)) {
      const owner = provenance[pk];
      if (owner && owner.sourceId !== source.sourceId && owner.priority < source.priority) {
        skipped.push({ field: key, reason: "higher_precedence" });
        disagreements.push({ field: key, kept: existing, keptSourceId: owner.sourceId, incoming: value });
        continue;
      }
      changes[key] = value;
      nextProvenance[pk] = stamp;
    } else if (existing === null && value !== null) {
      changes[key] = value;
      nextProvenance[pk] = stamp;
    } else {
      skipped.push({ field: key, reason: "not_authoritative" });
    }
  }
  return { changes, provenance: nextProvenance, skipped, disagreements };
}

export function mergeSourcedFields(
  current: SourcedFields,
  provenance: FieldProvenance,
  incoming: SourcedFields,
  source: SourceAuthority,
  at: string,
): {
  changes: SourcedFields;
  provenance: FieldProvenance;
  skipped: { field: SourcedIdentityField; reason: Skip }[];
  disagreements: SourceDisagreement<SourcedIdentityField, string>[];
} {
  const authoritative = new Set(source.authoritativeFields);
  return mergeSourced<SourcedIdentityField, string>(current, provenance, incoming, (k) => authoritative.has(k), (k) => k, source, at) as {
    changes: SourcedFields;
    provenance: FieldProvenance;
    skipped: { field: SourcedIdentityField; reason: Skip }[];
    disagreements: SourceDisagreement<SourcedIdentityField, string>[];
  };
}

export type AttributeValue = string | number | boolean;

export function mergeSourcedAttributes(
  current: Record<string, AttributeValue | null>,
  provenance: FieldProvenance,
  incoming: Record<string, AttributeValue | null>,
  source: SourceAuthority,
  at: string,
) {
  return mergeSourced<string, AttributeValue>(current, provenance, incoming, () => source.ownsAttributes === true, (k) => `attributes.${k}`, source, at);
}

/**
 * Types the custom attribute values a source sent, with the same rules as
 * an edit (validateAttributes), except that a source need not send every
 * required attribute. A blank stays null (it clears an owned value).
 * Attributes retired or not defined for this identity type are left out.
 * Returns why the record cannot be used instead, when a value is invalid.
 */
export function coerceSourcedAttributes(
  values: Record<string, string | null>,
  definitions: Pick<IdentityAttributeDefinition, "name" | "displayName" | "identityType" | "dataType" | "required" | "allowedValues" | "validationRegex" | "active">[],
  identityType: IdentityType,
): { values: Record<string, AttributeValue | null> } | { invalid: string } {
  const applicable = definitions.filter((d) => d.active && (d.identityType === null || d.identityType === identityType));
  const known = new Set(applicable.map((d) => d.name));
  const present: Record<string, string> = {};
  const out: Record<string, AttributeValue | null> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!known.has(name)) continue;
    if (value === null || value === "") out[name] = null;
    else present[name] = value;
  }
  try {
    const typed = validateAttributes(present, applicable.filter((d) => d.name in present).map((d) => ({ ...d, required: false })), identityType);
    return { values: { ...out, ...(typed as Record<string, AttributeValue>) } };
  } catch (err) {
    if (err instanceof ApiError) return { invalid: err.message };
    throw err;
  }
}

/** An open disagreement as stored (identity_source_conflicts). */
export type OpenDisagreement = { id: string; field: string; keptValue: string | null; keptSourceId: string | null; otherValue: string | null; otherSourceId: string };

const asText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).slice(0, 500));

/**
 * WID-H01: how one person's open disagreements change after one source's
 * record was merged. Pure.
 * - each field this source owns but lost is opened, or refreshed when open;
 * - an open one from this source on a field it sent and no longer loses is
 *   resolved (the sources agree again, or it now owns the field);
 * - when this source wrote a field another source disagreed on, that
 *   disagreement takes the new value, or resolves when the two now agree.
 * `field` is the identity field, or `attributes.<name>` for a custom one.
 */
export function planDisagreements(
  open: OpenDisagreement[],
  sourceId: string,
  sent: string[],
  disagreements: SourceDisagreement[],
  written: Record<string, unknown>,
): {
  insert: { field: string; keptValue: string | null; keptSourceId: string; otherValue: string | null }[];
  update: { id: string; keptValue: string | null; keptSourceId: string; otherValue: string | null }[];
  resolve: string[];
} {
  const insert: ReturnType<typeof planDisagreements>["insert"] = [];
  const update: ReturnType<typeof planDisagreements>["update"] = [];
  const resolve: string[] = [];
  const mine = new Map(open.filter((o) => o.otherSourceId === sourceId).map((o) => [o.field, o]));
  const losing = new Set<string>();
  for (const d of disagreements) {
    losing.add(d.field);
    const row = { keptValue: asText(d.kept), keptSourceId: d.keptSourceId, otherValue: asText(d.incoming) };
    const existing = mine.get(d.field);
    if (existing) update.push({ id: existing.id, ...row });
    else insert.push({ field: d.field, ...row });
  }
  const sentFields = new Set(sent);
  for (const o of mine.values()) if (sentFields.has(o.field) && !losing.has(o.field)) resolve.push(o.id);
  for (const o of open) {
    if (o.otherSourceId === sourceId || !(o.field in written)) continue;
    const value = asText(written[o.field]);
    if (value === o.otherValue) resolve.push(o.id);
    else update.push({ id: o.id, keptValue: value, keptSourceId: sourceId, otherValue: o.otherValue });
  }
  return { insert, update, resolve };
}

/** One value a source record changed on an identity (identity_source_changes). */
export type RecordedChange = {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  oldProvenance: FieldProvenance[string] | null;
  changedAt: string;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * WID-H01 (owner decision): what unlinking a source record restores. Pure.
 * For each field the record changed, the value before its first change
 * comes back, with that value's provenance, unless the field has changed
 * since its last change (another source or a person set it): then it is
 * kept and reported. Every change is marked undone either way.
 */
export function planRevert(
  changes: RecordedChange[],
  current: Record<string, unknown>,
): { restore: { field: string; value: unknown; provenance: FieldProvenance[string] | null }[]; kept: string[]; undone: string[] } {
  const byField = new Map<string, RecordedChange[]>();
  for (const c of [...changes].sort((a, b) => a.changedAt.localeCompare(b.changedAt))) {
    const list = byField.get(c.field) ?? [];
    list.push(c);
    byField.set(c.field, list);
  }
  const restore: { field: string; value: unknown; provenance: FieldProvenance[string] | null }[] = [];
  const kept: string[] = [];
  for (const [field, list] of byField) {
    const first = list[0];
    const last = list[list.length - 1];
    if (same(current[field], last.newValue)) restore.push({ field, value: first.oldValue ?? null, provenance: first.oldProvenance });
    else kept.push(field);
  }
  return { restore, kept, undone: changes.map((c) => c.id) };
}
