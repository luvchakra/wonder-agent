import type { FieldMapping, RecordFilter, ResourceKind, Transform } from "./types";
import { CANONICAL_FIELDS } from "./types";

/**
 * Pure helpers shared by the validator and the engine: reading a value at a
 * path, filling `{…}` templates, applying the closed transform list, and
 * turning one source record into a canonical object.
 */

export class TemplateError extends Error {}

/**
 * Reads `a.b.c` from a value. `items[]` maps over an array ("groups[].name"
 * gives every group's name); `items[0]` takes one element. A key containing
 * a dot can be reached when it is a direct key of the object.
 */
export function readPath(source: unknown, path: string): unknown {
  if (path === "" || path === "$") return source;
  if (source && typeof source === "object" && !Array.isArray(source) && path in (source as Record<string, unknown>)) {
    return (source as Record<string, unknown>)[path];
  }
  const parts = path.split(".");
  let current: unknown = source;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || current === undefined) return undefined;
    const spread = part.endsWith("[]");
    const index = /^(.*)\[(\d+)\]$/.exec(part);
    const key = spread ? part.slice(0, -2) : index ? index[1] : part;
    let next: unknown = key === "" ? current : typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
    if (index) next = Array.isArray(next) ? next[Number(index[2])] : undefined;
    if (spread) {
      if (!Array.isArray(next)) return undefined;
      const rest = parts.slice(i + 1).join(".");
      return rest ? next.map((item) => readPath(item, rest)).flat().filter((v) => v !== undefined && v !== null) : next;
    }
    current = next;
  }
  return current;
}

export type TemplateScope = Record<string, unknown>;

const TEMPLATE_RE = /\{([a-zA-Z_][\w]*(?:\.[\w\[\]-]+)*)\}/g;

/** The `{a.b}` names used in a template, without braces. */
export function templateVariables(template: string): string[] {
  return [...template.matchAll(TEMPLATE_RE)].map((m) => m[1]);
}

/**
 * Fills `{scope.path}` placeholders. A missing value is an error rather
 * than an empty string, so a misspelled setting can never silently call
 * the wrong address. `encode` URL-encodes each value (for path segments);
 * `escape` applies a driver's own escaping (an LDAP filter value).
 */
export function fillTemplate(
  template: string,
  scope: TemplateScope,
  opts: { encode?: boolean; allowMissing?: boolean; escape?: (value: string) => string } = {},
): string {
  return template.replace(TEMPLATE_RE, (_, name: string) => {
    const value = readPath(scope, name);
    if (value === undefined || value === null || value === "") {
      if (opts.allowMissing) return "";
      throw new TemplateError(`"{${name}}" has no value`);
    }
    const text = Array.isArray(value) ? value.join(",") : String(value);
    // Values from a fetched record are escaped; the organization's own settings are not.
    if (opts.escape && (name.startsWith("parent.") || name.startsWith("record."))) return opts.escape(text);
    return opts.encode ? encodeURIComponent(text) : text;
  });
}

function toDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  // LDAP generalized time: 20240131120000Z
  const gt = /^(\d{4})(\d{2})(\d{2})\d{0,6}(?:\.\d+)?Z?$/.exec(text);
  if (gt) return `${gt[1]}-${gt[2]}-${gt[3]}`;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

export function applyTransform(value: unknown, transform: Transform): unknown {
  if (typeof transform === "object" && "contains" in transform) {
    const items = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[\s,]+/) : [];
    return items.includes(transform.contains);
  }
  if (typeof transform === "object" && "prefix" in transform) {
    const text = Array.isArray(value) ? value[0] : value;
    return typeof text === "string" && text.startsWith(transform.prefix);
  }
  if (typeof transform === "object") {
    const key = value === null || value === undefined ? "" : String(value);
    if (Object.prototype.hasOwnProperty.call(transform.map, key)) return transform.map[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(transform.map)) if (k.toLowerCase() === lower) return v;
    return transform.default !== undefined ? transform.default : value;
  }
  switch (transform) {
    case "lower":
      return typeof value === "string" ? value.toLowerCase() : value;
    case "upper":
      return typeof value === "string" ? value.toUpperCase() : value;
    case "trim":
      return typeof value === "string" ? value.trim() : value;
    case "first":
      return Array.isArray(value) ? value[0] : value;
    case "join":
      return Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined && v !== "").join(", ") : value;
    case "string":
      return value === null || value === undefined ? value : Array.isArray(value) ? value.join(", ") : String(value);
    case "number": {
      const n = Number(Array.isArray(value) ? value[0] : value);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      const v = Array.isArray(value) ? value[0] : value;
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") return ["true", "1", "yes", "y", "on", "enabled", "active"].includes(v.trim().toLowerCase());
      return false;
    }
    case "not":
      return !applyTransform(value, "boolean");
    case "date":
      return toDate(Array.isArray(value) ? value[0] : value);
    case "present":
      return !(value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0));
    case "split":
      return typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : value;
  }
}

/**
 * A field path reads the current record; one starting with `parent.` reads
 * the record a forEach resource was fetched for (a group, for its members).
 */
function readField(scope: TemplateScope, path: string): unknown {
  if (path.startsWith("parent.") && scope.parent !== undefined) return readPath(scope.parent, path.slice("parent.".length));
  return readPath(scope.record, path);
}

/** One canonical field's value for a record, or undefined when it has none. */
export function mapField(mapping: FieldMapping, scope: TemplateScope): unknown {
  if (typeof mapping === "string") return clean(readField(scope, mapping));
  let value: unknown;
  if (mapping.value !== undefined) value = mapping.value;
  else if (mapping.template !== undefined) {
    const filled = fillTemplate(mapping.template, scope, { allowMissing: true }).replace(/\s+/g, " ").trim();
    value = filled === "" ? undefined : filled;
  } else if (mapping.path !== undefined) value = readField(scope, mapping.path);
  for (const t of mapping.transform ?? []) value = applyTransform(value, t);
  value = clean(value);
  if ((value === undefined || value === null || value === "") && mapping.default !== undefined) value = mapping.default;
  return value;
}

function clean(value: unknown): unknown {
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? undefined : t;
  }
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined && v !== "");
    return items;
  }
  return value;
}

export function matchesFilters(record: unknown, filters: RecordFilter[] | undefined, parent?: unknown): boolean {
  for (const f of filters ?? []) {
    const raw = readField({ record, parent }, f.path);
    const value = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    const present = value !== undefined && value !== null && value !== "";
    if (f.exists !== undefined && present !== f.exists) return false;
    if (f.equals !== undefined && value !== f.equals) return false;
    if (f.notEquals !== undefined && value === f.notEquals) return false;
    if (f.in && !f.in.includes(value)) return false;
    if (f.notIn && f.notIn.includes(value)) return false;
    if (f.prefix !== undefined && !(typeof value === "string" && value.startsWith(f.prefix))) return false;
    if (f.notPrefix !== undefined && typeof value === "string" && value.startsWith(f.notPrefix)) return false;
  }
  return true;
}

export type MappedRecord = { externalId: string; normalized: Record<string, unknown> };

/**
 * Maps one source record to a canonical object. Returns the reason instead
 * when a required field has no value, so the sync can count and report it
 * rather than store half a record.
 */
export function mapRecord(
  kind: ResourceKind,
  fields: Record<string, FieldMapping>,
  scope: TemplateScope,
  defaults: { application?: string } = {},
): MappedRecord | { invalid: string } {
  const normalized: Record<string, unknown> = {};
  for (const [target, mapping] of Object.entries(fields)) {
    const value = mapField(mapping, scope);
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (CANONICAL_FIELDS[kind].arrays?.includes(target)) normalized[target] = value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)));
      else if (value.length) normalized[target] = typeof value[0] === "object" ? JSON.stringify(value[0]) : value.map(String).join(", ");
      continue;
    }
    normalized[target] = typeof value === "object" ? JSON.stringify(value) : value;
  }
  if ((kind === "account" || kind === "entitlement") && normalized.application === undefined && defaults.application) {
    normalized.application = defaults.application;
  }
  for (const req of CANONICAL_FIELDS[kind].required) {
    if (normalized[req] === undefined || normalized[req] === "") return { invalid: `${kind}: no value for ${req}` };
  }
  normalized.externalId = String(normalized.externalId);
  return { externalId: normalized.externalId as string, normalized };
}
