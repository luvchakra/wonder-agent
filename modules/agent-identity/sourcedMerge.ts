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

function mergeSourced<K extends string, V>(
  current: Partial<Record<K, V | null>>,
  provenance: FieldProvenance,
  incoming: Partial<Record<K, V | null>>,
  owns: (key: K) => boolean,
  provenanceKey: (key: K) => string,
  source: SourceAuthority,
  at: string,
): { changes: Partial<Record<K, V | null>>; provenance: FieldProvenance; skipped: { field: K; reason: Skip }[] } {
  const changes: Partial<Record<K, V | null>> = {};
  const nextProvenance: FieldProvenance = { ...provenance };
  const skipped: { field: K; reason: Skip }[] = [];
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
  return { changes, provenance: nextProvenance, skipped };
}

export function mergeSourcedFields(
  current: SourcedFields,
  provenance: FieldProvenance,
  incoming: SourcedFields,
  source: SourceAuthority,
  at: string,
): { changes: SourcedFields; provenance: FieldProvenance; skipped: { field: SourcedIdentityField; reason: Skip }[] } {
  const authoritative = new Set(source.authoritativeFields);
  return mergeSourced<SourcedIdentityField, string>(current, provenance, incoming, (k) => authoritative.has(k), (k) => k, source, at) as {
    changes: SourcedFields;
    provenance: FieldProvenance;
    skipped: { field: SourcedIdentityField; reason: Skip }[];
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
