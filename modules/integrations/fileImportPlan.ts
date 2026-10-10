import { MANUAL_IDENTITY_TYPES, SOURCED_IDENTITY_FIELDS, type IdentityType, type SourcedFields } from "@/lib/shared/types/agent-identity";
import type { AttributeMapping, ImportCounts, ImportDecision, ImportPlanRow, ImportRecord } from "@/lib/shared/types/integrations";
import { mapRecord, type TemplateScope } from "./framework/mapping";
import type { FieldMapping, ResourceKind } from "./framework/types";
import { normalizeRecord } from "./identitySourceRules";

/**
 * Pure rules for importing a CSV from an object page (2026-10-10, user
 * decision): the file is previewed first, then applied additively. A new
 * record is added and an existing one updated; a record missing from the
 * file is never removed or deactivated (there are no leavers here).
 *
 * The Integration module maps the file with the connector definition and,
 * for identities, decides which identity a record is (as identity sources
 * do); the owning module decides what changes and writes it.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A file import fills and updates fields, but a source of record (lower number) still wins. 1000 is the lowest precedence an identity source can have. */
export const FILE_IMPORT_PRIORITY = 1000;

export function emptyCounts(): ImportCounts {
  return { new: 0, update: 0, unchanged: 0, invalid: 0, review: 0 };
}

export function countDecisions(rows: { decision: ImportDecision }[]): ImportCounts {
  const counts = emptyCounts();
  for (const r of rows) counts[r.decision]++;
  return counts;
}

export function invalidRow(record: { row: number | null; externalId: string }, note: string): ImportPlanRow {
  return { row: record.row, externalId: record.externalId, decision: "invalid", targetId: null, changes: [], note };
}

/**
 * Maps parsed CSV records (csvRecords) with the definition's fields, as a
 * sync does (mapRecord). A record the mapping refuses, or one whose
 * external id repeats an earlier row's, is invalid rather than imported.
 */
export function mapImportRecords(
  kind: ResourceKind,
  fields: Record<string, FieldMapping>,
  settings: Record<string, unknown>,
  csvRows: Record<string, unknown>[],
  defaults: { application?: string } = {},
): { records: ImportRecord[]; invalid: ImportPlanRow[] } {
  const records: ImportRecord[] = [];
  const invalid: ImportPlanRow[] = [];
  const seen = new Map<string, number | null>();
  for (const record of csvRows) {
    const row = typeof record._row === "number" ? record._row : null;
    const scope: TemplateScope = { record, settings };
    const mapped = mapRecord(kind, fields, scope, defaults);
    if ("invalid" in mapped) {
      invalid.push(invalidRow({ row, externalId: "" }, mapped.invalid.replace(`${kind}: `, "")));
      continue;
    }
    if (seen.has(mapped.externalId)) {
      const first = seen.get(mapped.externalId);
      invalid.push(invalidRow({ row, externalId: mapped.externalId }, `the same record as row ${first ?? "above"}`));
      continue;
    }
    seen.set(mapped.externalId, row);
    records.push({ row, externalId: mapped.externalId, values: mapped.normalized });
  }
  return { records, invalid };
}

// ---------------------------------------------------------------- identities

const IDENTITY_MAPPINGS: AttributeMapping[] = [
  { source: "externalId", target: "externalId" },
  { source: "managerExternalId", target: "managerExternalId" },
  ...SOURCED_IDENTITY_FIELDS.filter((f) => f !== "managerIdentityId").map((f) => ({ source: f, target: f })),
];

export type ImportedIdentity = {
  externalId: string;
  identityType: IdentityType | null;
  fields: SourcedFields;
  managerExternalId: string | null;
};

/** One imported record as identity fields. An empty cell changes nothing: it is left out, never written as a blank. */
export function normalizeImportedIdentity(values: Record<string, unknown>): ImportedIdentity | { invalid: string } {
  const raw: Record<string, unknown> = { ...values };
  if (!raw.displayName && (raw.firstName || raw.lastName)) raw.displayName = [raw.firstName, raw.lastName].filter(Boolean).join(" ");
  const n = normalizeRecord(raw, IDENTITY_MAPPINGS, { requireDisplayName: false });
  if ("invalid" in n) return n;
  const fields: SourcedFields = {};
  for (const [k, v] of Object.entries(n.fields)) if (v !== null && v !== undefined) fields[k as keyof SourcedFields] = v;
  let identityType: IdentityType | null = null;
  if (typeof values.identityType === "string" && values.identityType.trim()) {
    const t = values.identityType.trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (!(MANUAL_IDENTITY_TYPES as readonly string[]).includes(t)) return { invalid: `identityType "${values.identityType.slice(0, 40)}" is not one of ${MANUAL_IDENTITY_TYPES.join(", ").toLowerCase()}` };
    identityType = t as IdentityType;
  }
  return { externalId: n.externalId, identityType, fields, managerExternalId: n.managerExternalId };
}

export type IdentityCandidate = { id: string; identityType: IdentityType; email: string | null; username: string | null; sourceNativeId: string | null };

export type IdentityMatch = { kind: "matched"; identityId: string; by: string } | { kind: "new" } | { kind: "review"; reason: string };

const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

function push(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

/** Indexes the tenant's identities once; matching a record is then a lookup, not a scan. */
export function identityMatcher(candidates: IdentityCandidate[]) {
  const byId = new Set(candidates.map((c) => c.id));
  const byNative = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  const byUsername = new Map<string, string[]>();
  for (const c of candidates) {
    push(byNative, (c.sourceNativeId ?? "").trim(), c.id);
    push(byEmail, lower(c.email), c.id);
    push(byUsername, lower(c.username), c.id);
  }
  const taken = new Map<string, string>();

  /**
   * Which identity a record is: the identity's own id (a file exported from
   * WonderID), then its source reference, then email, then username. One
   * match is that identity; several, or one an earlier row already took,
   * is held for a person (§17.6), never the closest guess.
   */
  function match(externalId: string, fields: SourcedFields): IdentityMatch {
    const tries: [string, string[] | undefined][] = [
      ["id", UUID_RE.test(externalId) && byId.has(externalId.toLowerCase()) ? [externalId.toLowerCase()] : undefined],
      ["external id", byNative.get(externalId.trim())],
      ["email", fields.email ? byEmail.get(lower(fields.email)) : undefined],
      ["username", fields.username ? byUsername.get(lower(fields.username)) : undefined],
    ];
    for (const [by, ids] of tries) {
      if (!ids || ids.length === 0) continue;
      if (ids.length > 1) return { kind: "review", reason: `${ids.length} identities have this ${by}` };
      const earlier = taken.get(ids[0]);
      if (earlier !== undefined) return { kind: "review", reason: `the same identity as ${earlier}` };
      taken.set(ids[0], externalId);
      return { kind: "matched", identityId: ids[0], by };
    }
    return { kind: "new" };
  }

  /** The identity a manager reference names, among existing identities (id, source reference, email). */
  function resolveManager(ref: string): string | null {
    if (UUID_RE.test(ref) && byId.has(ref.toLowerCase())) return ref.toLowerCase();
    for (const ids of [byNative.get(ref.trim()), byEmail.get(lower(ref))]) if (ids?.length === 1) return ids[0];
    return null;
  }

  return { match, resolveManager };
}

/** The identity type a page's import creates when the file has no identityType column. */
export function defaultIdentityType(scope: string | null | undefined): IdentityType {
  if (scope === "external-identities") return "EXTERNAL";
  if (scope === "machine-identities") return "MACHINE";
  return "HUMAN";
}
