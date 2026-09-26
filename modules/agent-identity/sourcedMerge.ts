import type { FieldProvenance, SourceAuthority, SourcedFields, SourcedIdentityField } from "@/lib/shared/types/agent-identity";

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
 */
export function mergeSourcedFields(
  current: SourcedFields,
  provenance: FieldProvenance,
  incoming: SourcedFields,
  source: SourceAuthority,
  at: string,
): { changes: SourcedFields; provenance: FieldProvenance; skipped: { field: SourcedIdentityField; reason: "higher_precedence" | "not_authoritative" }[] } {
  const changes: SourcedFields = {};
  const nextProvenance: FieldProvenance = { ...provenance };
  const skipped: { field: SourcedIdentityField; reason: "higher_precedence" | "not_authoritative" }[] = [];
  const authoritative = new Set(source.authoritativeFields);

  for (const [key, raw] of Object.entries(incoming) as [SourcedIdentityField, string | null | undefined][]) {
    if (raw === undefined) continue;
    const value = raw === "" ? null : raw;
    const existing = current[key] ?? null;
    if (value === existing) {
      if (authoritative.has(key) && value !== null) {
        const owner = provenance[key];
        if (!owner || owner.priority >= source.priority) nextProvenance[key] = { sourceId: source.sourceId, priority: source.priority, at };
      }
      continue;
    }
    if (authoritative.has(key)) {
      const owner = provenance[key];
      if (owner && owner.sourceId !== source.sourceId && owner.priority < source.priority) {
        skipped.push({ field: key, reason: "higher_precedence" });
        continue;
      }
      changes[key] = value;
      nextProvenance[key] = { sourceId: source.sourceId, priority: source.priority, at };
    } else if (existing === null && value !== null) {
      changes[key] = value;
      nextProvenance[key] = { sourceId: source.sourceId, priority: source.priority, at };
    } else {
      skipped.push({ field: key, reason: "not_authoritative" });
    }
  }
  return { changes, provenance: nextProvenance, skipped };
}
