import { ApiError } from "@/lib/shared/types/foundation";
import { SOURCED_IDENTITY_FIELDS, type IdentityStatus, type SourcedFields, type SourcedIdentityField } from "@/lib/shared/types/agent-identity";
import {
  CORRELATION_KINDS,
  IDENTITY_SOURCE_TARGETS,
  IDENTITY_SOURCE_TEMPLATES,
  LEAVER_STRATEGIES,
  SOURCE_IDENTITY_TYPES,
  type AttributeMapping,
  type CorrelationRule,
  type IdentitySourceTarget,
} from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-08/09 — the deterministic parts of an identity source,
 * kept pure so each is unit-tested on its own (#9): configuration
 * validation, CSV parsing, mapping and normalization, correlation, and
 * the leaver guard. The service (identitySources.ts) does the I/O.
 */

const fail = (message: string): never => {
  throw new ApiError(400, "VALIDATION_FAILED", message);
};

export const MAX_RECORDS_PER_RUN = 10_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- configuration

export type SourceConfigInput = {
  name?: unknown;
  template?: unknown;
  integrationId?: unknown;
  identityType?: unknown;
  authoritative?: unknown;
  priority?: unknown;
  authoritativeFields?: unknown;
  attributeMappings?: unknown;
  correlationRules?: unknown;
  leaverStrategy?: unknown;
  leaverThresholdPercent?: unknown;
  schedule?: unknown;
  status?: unknown;
};

const flag = (v: unknown) => v === true || v === "true" || v === "on";

function parseJsonish<T>(value: unknown, field: string): T {
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fail(`${field}: not valid JSON`);
  }
}

export function validateMappings(value: unknown): AttributeMapping[] {
  const raw = parseJsonish<unknown>(value ?? [], "attributeMappings");
  if (!Array.isArray(raw)) fail("attributeMappings: a list of { source, target }");
  const out: AttributeMapping[] = [];
  const targets = new Set<string>();
  for (const m of raw as unknown[]) {
    const source = typeof (m as AttributeMapping)?.source === "string" ? (m as AttributeMapping).source.trim() : "";
    const target = (m as AttributeMapping)?.target;
    if (!source && !target) continue;
    if (!source || source.length > 120) fail("attributeMappings: every mapping needs a source column of at most 120 characters");
    if (typeof target !== "string" || !(IDENTITY_SOURCE_TARGETS as readonly string[]).includes(target)) {
      fail(`attributeMappings: "${source}" maps to an unknown field`);
    }
    if (targets.has(target)) fail(`attributeMappings: ${target} is mapped twice`);
    targets.add(target);
    out.push({ source, target: target as IdentitySourceTarget });
  }
  if (out.length > 40) fail("attributeMappings: at most 40 mappings");
  if (!targets.has("externalId")) fail("attributeMappings: map a column to externalId, the source's own unique id");
  if (!targets.has("displayName")) fail("attributeMappings: map a column to displayName");
  return out;
}

export function validateCorrelationRules(value: unknown): CorrelationRule[] {
  const raw = parseJsonish<unknown>(value ?? [], "correlationRules");
  if (!Array.isArray(raw)) fail("correlationRules: a list of rules");
  const out: CorrelationRule[] = [];
  for (const r of raw as unknown[]) {
    const kind = (r as CorrelationRule)?.kind;
    if (typeof kind !== "string" || !(CORRELATION_KINDS as readonly string[]).includes(kind)) fail(`correlationRules: kind is one of ${CORRELATION_KINDS.join(", ")}`);
    if (kind === "composite") {
      const fields = (r as CorrelationRule).fields;
      if (!Array.isArray(fields) || fields.length < 2 || fields.length > 4) fail("correlationRules: a composite rule names 2 to 4 fields");
      for (const f of fields!) if (!(SOURCED_IDENTITY_FIELDS as readonly string[]).includes(f) || f === "managerIdentityId") fail(`correlationRules: ${f} cannot be matched on`);
      out.push({ kind: "composite", fields: fields as SourcedIdentityField[] });
    } else {
      if (out.some((o) => o.kind === kind)) fail(`correlationRules: ${kind} is listed twice`);
      out.push({ kind: kind as "email" | "username" });
    }
  }
  if (out.length > 5) fail("correlationRules: at most 5 rules");
  return out;
}

export function validateSourceConfig(input: SourceConfigInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 120) fail("name: 1 to 120 characters");
  const template = input.template;
  if (typeof template !== "string" || !(IDENTITY_SOURCE_TEMPLATES as readonly string[]).includes(template)) fail(`template: one of ${IDENTITY_SOURCE_TEMPLATES.join(", ")}`);
  const integrationId = typeof input.integrationId === "string" && input.integrationId ? input.integrationId : null;
  if (template === "integration" && !integrationId) fail("integrationId: choose the integration whose identities this source reads");
  if (integrationId && !/^[0-9a-f-]{36}$/i.test(integrationId)) fail("integrationId: must be an integration id");
  const identityType = input.identityType ?? "HUMAN";
  if (typeof identityType !== "string" || !(SOURCE_IDENTITY_TYPES as readonly string[]).includes(identityType)) fail(`identityType: one of ${SOURCE_IDENTITY_TYPES.join(", ")}`);
  const priority = input.priority === undefined || input.priority === "" ? 100 : Number(input.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 1000) fail("priority: a whole number from 1 (highest) to 1000");
  const rawFields = Array.isArray(input.authoritativeFields) ? input.authoritativeFields : typeof input.authoritativeFields === "string" && input.authoritativeFields ? input.authoritativeFields.split(",") : [];
  const authoritativeFields = [...new Set(rawFields.map((f) => String(f).trim()).filter(Boolean))];
  for (const f of authoritativeFields) if (!(SOURCED_IDENTITY_FIELDS as readonly string[]).includes(f)) fail(`authoritativeFields: ${f} is not an identity field`);
  const authoritative = flag(input.authoritative);
  if (!authoritative && authoritativeFields.length) fail("authoritativeFields: only an authoritative source owns fields");
  const leaverStrategy = input.leaverStrategy ?? "disable";
  if (typeof leaverStrategy !== "string" || !(LEAVER_STRATEGIES as readonly string[]).includes(leaverStrategy)) fail(`leaverStrategy: one of ${LEAVER_STRATEGIES.join(", ")}`);
  const leaverThresholdPercent = input.leaverThresholdPercent === undefined || input.leaverThresholdPercent === "" ? 20 : Number(input.leaverThresholdPercent);
  if (!Number.isInteger(leaverThresholdPercent) || leaverThresholdPercent < 1 || leaverThresholdPercent > 100) fail("leaverThresholdPercent: 1 to 100");
  const schedule = input.schedule ?? "manual";
  if (!["manual", "daily", "hourly"].includes(String(schedule))) fail("schedule: manual, daily or hourly");
  const status = input.status ?? "active";
  if (!["active", "paused"].includes(String(status))) fail("status: active or paused");
  return {
    name,
    template: template as (typeof IDENTITY_SOURCE_TEMPLATES)[number],
    integrationId,
    identityType: identityType as (typeof SOURCE_IDENTITY_TYPES)[number],
    authoritative,
    priority,
    authoritativeFields: authoritativeFields as SourcedIdentityField[],
    attributeMappings: validateMappings(input.attributeMappings),
    correlationRules: validateCorrelationRules(input.correlationRules ?? [{ kind: "email" }]),
    leaverStrategy: leaverStrategy as (typeof LEAVER_STRATEGIES)[number],
    leaverThresholdPercent,
    schedule: String(schedule) as "manual" | "daily" | "hourly",
    status: String(status) as "active" | "paused",
  };
}

// ---------------------------------------------------------------- CSV

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside
 * quotes, CRLF or LF. The first row is the header. Blank lines are skipped.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) records.push(row);
      row = [];
      if (records.length > MAX_RECORDS_PER_RUN + 1) fail(`file: at most ${MAX_RECORDS_PER_RUN} records per import`);
    } else field += c;
  }
  if (quoted) fail("file: a quoted field is not closed");
  row.push(field);
  if (row.some((v) => v !== "")) records.push(row);
  if (records.length === 0) fail("file: empty");
  const headers = records[0].map((h) => h.trim());
  if (headers.some((h) => !h)) fail("file: every column needs a header");
  if (new Set(headers).size !== headers.length) fail("file: two columns have the same header");
  const rows = records.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
    return obj;
  });
  if (rows.length > MAX_RECORDS_PER_RUN) fail(`file: at most ${MAX_RECORDS_PER_RUN} records per import`);
  return { headers, rows };
}

// ---------------------------------------------------------------- normalization

const STATUS_WORDS: Record<string, IdentityStatus> = {
  active: "active",
  a: "active",
  true: "active",
  "1": "active",
  enabled: "active",
  employed: "active",
  inactive: "inactive",
  i: "inactive",
  false: "inactive",
  "0": "inactive",
  disabled: "disabled",
  suspended: "disabled",
  loa: "inactive",
  leave: "inactive",
  terminated: "terminated",
  t: "terminated",
  term: "terminated",
  left: "terminated",
  pending: "pending",
  prehire: "pending",
  "pre-hire": "pending",
  future: "pending",
};

export type NormalizedSourceRecord = {
  externalId: string;
  fields: SourcedFields;
  managerExternalId: string | null;
};

/** Reads a dotted path ("profile.email") from a raw object. */
function read(raw: Record<string, unknown>, path: string): unknown {
  if (path in raw) return raw[path];
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), raw);
}

/**
 * Maps one source record to identity fields. Returns the reasons it is
 * invalid instead of a record when it cannot be used: it is then counted
 * and reported, never applied half-way.
 */
export function normalizeRecord(raw: Record<string, unknown>, mappings: AttributeMapping[]): NormalizedSourceRecord | { invalid: string } {
  const fields: SourcedFields = {};
  let externalId = "";
  let managerExternalId: string | null = null;
  for (const { source, target } of mappings) {
    const value = read(raw, source);
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (target === "externalId") {
      externalId = text;
      continue;
    }
    if (target === "managerExternalId") {
      managerExternalId = text || null;
      continue;
    }
    if (!text) {
      fields[target] = null;
      continue;
    }
    if (target === "email") {
      if (!EMAIL_RE.test(text)) return { invalid: `email "${text.slice(0, 80)}" is not an email address` };
      fields.email = text.toLowerCase();
    } else if (target === "startDate" || target === "endDate") {
      if (!DATE_RE.test(text) || Number.isNaN(Date.parse(text.slice(0, 10)))) return { invalid: `${target} "${text.slice(0, 40)}" is not a date (YYYY-MM-DD)` };
      fields[target] = text.slice(0, 10);
    } else if (target === "status") {
      const status = STATUS_WORDS[text.toLowerCase()];
      if (!status) return { invalid: `status "${text.slice(0, 40)}" is not a known status` };
      fields.status = status;
    } else {
      fields[target] = text.slice(0, target === "displayName" ? 200 : 300);
    }
  }
  if (!externalId) return { invalid: "no external id" };
  if (externalId.length > 300) return { invalid: "external id longer than 300 characters" };
  if (!fields.displayName) return { invalid: "no display name" };
  if (fields.startDate && fields.endDate && fields.endDate < fields.startDate) return { invalid: "endDate is before startDate" };
  return { externalId, fields, managerExternalId };
}

// ---------------------------------------------------------------- correlation

export type CorrelationIndexEntry = { id: string; email: string | null; username: string | null } & Partial<Record<SourcedIdentityField, string | null>>;

export type CorrelationOutcome =
  | { kind: "linked"; identityId: string }
  | { kind: "matched"; identityId: string; rule: string }
  | { kind: "new" }
  | { kind: "ambiguous"; candidateIds: string[]; reason: string };

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * Which identity a source record is. The source's own link wins; then each
 * rule in order, where exactly one candidate is a match, several are
 * ambiguous (a person decides, never the closest guess, §17.6), and none
 * falls through to the next rule. Identities already linked to another
 * record of this source are never candidates.
 */
export function correlate(
  record: NormalizedSourceRecord,
  rules: CorrelationRule[],
  index: CorrelationIndexEntry[],
  linkedIdentityId: string | null,
  takenIdentityIds: Set<string>,
): CorrelationOutcome {
  if (linkedIdentityId) return { kind: "linked", identityId: linkedIdentityId };
  const pool = index.filter((e) => !takenIdentityIds.has(e.id));
  for (const rule of rules) {
    let matches: CorrelationIndexEntry[] = [];
    let label: string = rule.kind;
    if (rule.kind === "email") {
      const v = norm(record.fields.email);
      if (!v) continue;
      matches = pool.filter((e) => norm(e.email) === v);
    } else if (rule.kind === "username") {
      const v = norm(record.fields.username);
      if (!v) continue;
      matches = pool.filter((e) => norm(e.username) === v);
    } else {
      const fields = rule.fields ?? [];
      const values = fields.map((f) => norm(record.fields[f]));
      if (values.some((v) => !v)) continue;
      matches = pool.filter((e) => fields.every((f, i) => norm(e[f]) === values[i]));
      label = `composite(${fields.join("+")})`;
    }
    if (matches.length === 1) return { kind: "matched", identityId: matches[0].id, rule: label };
    if (matches.length > 1) {
      return { kind: "ambiguous", candidateIds: matches.slice(0, 10).map((m) => m.id), reason: `${matches.length} identities match on ${label}` };
    }
  }
  return { kind: "new" };
}

// ---------------------------------------------------------------- leavers

/**
 * Who left: linked records that were present before and are absent from a
 * full run. When that is more than `thresholdPercent` of the linked
 * population (and at least 5), the run is suspect (a truncated file, a
 * failed page) and no one is treated as a leaver; the run asks for review
 * instead ("a failed run never erases identities").
 */
export function planLeavers(
  presentLinks: { externalId: string; identityId: string }[],
  seen: Set<string>,
  thresholdPercent: number,
): { leavers: { externalId: string; identityId: string }[]; guardTripped: boolean } {
  const absent = presentLinks.filter((l) => !seen.has(l.externalId));
  if (absent.length >= 5 && presentLinks.length > 0 && (absent.length / presentLinks.length) * 100 > thresholdPercent) {
    return { leavers: [], guardTripped: true };
  }
  return { leavers: absent, guardTripped: false };
}
