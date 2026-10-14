/**
 * EXPERIENCE-P0-30 — pure helpers for the guided connector editor. The form
 * edits the same definition object the JSON view shows; nothing here
 * validates (the server's validateDefinition does, on every keystroke) or
 * invents values the integrator did not choose beyond a starting shape.
 */
import type { AuthSpec, ConnectorDefinition, FieldMapping, Pagination, ResourceKind, ResourceSpec } from "@/modules/integrations/framework/types";

/** The authentication types the form edits; the others stay in the JSON view. */
export const FORM_AUTH_TYPES = ["none", "bearer", "basic", "header", "query", "oauth2_client_credentials"] as const;
export type FormAuthType = (typeof FORM_AUTH_TYPES)[number];

/** The pagination styles the form edits (cursor needs a response path, still simple enough). */
export const FORM_PAGINATION_TYPES = ["none", "page", "offset", "cursor", "link_header", "scim"] as const;
export type FormPaginationType = (typeof FORM_PAGINATION_TYPES)[number];

/** A starting shape for an authentication type: secrets referenced as `{secret.<key>}`, with their fields. */
export function authPreset(type: FormAuthType): AuthSpec {
  switch (type) {
    case "none":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "API token" }] };
    case "basic":
      return { type: "basic", username: "{secret.username}", password: "{secret.password}", fields: [{ key: "username", label: "Username" }, { key: "password", label: "Password" }] };
    case "header":
      return { type: "header", name: "X-API-Key", value: "{secret.apiKey}", fields: [{ key: "apiKey", label: "API key" }] };
    case "query":
      return { type: "query", name: "api_key", value: "{secret.apiKey}", fields: [{ key: "apiKey", label: "API key" }] };
    case "oauth2_client_credentials":
      return { type: "oauth2_client_credentials", tokenUrl: "/oauth/token", clientId: "{secret.clientId}", clientSecret: "{secret.clientSecret}", fields: [{ key: "clientId", label: "Client ID" }, { key: "clientSecret", label: "Client secret" }] };
  }
}

/** A starting shape for a pagination style. */
export function paginationPreset(type: FormPaginationType): Pagination {
  switch (type) {
    case "none":
      return { type: "none" };
    case "page":
      return { type: "page", param: "page", sizeParam: "per_page", size: 100 };
    case "offset":
      return { type: "offset", param: "offset", sizeParam: "limit", size: 100 };
    case "cursor":
      return { type: "cursor", param: "cursor", from: "next" };
    case "link_header":
      return { type: "link_header" };
    case "scim":
      return { type: "scim", size: 100 };
  }
}

/** The resource the form edits for a kind: its first request when it lists several. */
export function resourceOf(def: ConnectorDefinition, kind: ResourceKind): ResourceSpec | null {
  const r = def.resources[kind];
  if (!r) return null;
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

/** Whether the kind lists several requests (the form edits the first; the rest stay as they are). */
export function hasSeveralRequests(def: ConnectorDefinition, kind: ResourceKind): boolean {
  const r = def.resources[kind];
  return Array.isArray(r) && r.length > 1;
}

/** The definition with the kind's (first) resource replaced. */
export function withResource(def: ConnectorDefinition, kind: ResourceKind, next: ResourceSpec): ConnectorDefinition {
  const current = def.resources[kind];
  const value = Array.isArray(current) ? [next, ...current.slice(1)] : next;
  return { ...def, resources: { ...def.resources, [kind]: value } };
}

/** A new resource for a kind, with the required canonical fields to fill. */
export function newResource(required: readonly string[]): ResourceSpec {
  return { request: { path: "/" }, records: "", pagination: { type: "none" }, fields: Object.fromEntries(required.map((f) => [f, ""])) };
}

/** The single field path a mapping reads, when it is that simple; null for templates, constants and lists. */
export function pathOf(mapping: FieldMapping | undefined): string | null {
  if (mapping === undefined) return "";
  if (typeof mapping === "string") return mapping;
  if (mapping.template !== undefined || mapping.value !== undefined || Array.isArray(mapping.path)) return null;
  return mapping.path ?? "";
}

/** The fields with one canonical field's path set (an empty path removes it); transforms and defaults are kept. */
export function withFieldPath(fields: Record<string, FieldMapping>, field: string, path: string): Record<string, FieldMapping> {
  const next = { ...fields };
  const current = fields[field];
  const p = path.trim();
  if (!p) {
    delete next[field];
    return next;
  }
  next[field] = current && typeof current === "object" && (current.transform || current.default !== undefined) ? { ...current, path: p } : p;
  return next;
}

export type SamplePath = { path: string; example: string };

/**
 * Every field path in a sample record, in the definition's path syntax
 * (`profile.email`, `groups[].name`), each with an example value: what the
 * field picker offers. Bounded, so a huge response stays usable.
 */
export function samplePaths(record: unknown, max = 200): SamplePath[] {
  const out: SamplePath[] = [];
  const seen = new Set<string>();
  const add = (path: string, value: unknown) => {
    if (!path || seen.has(path) || out.length >= max) return;
    seen.add(path);
    const text = value === null ? "null" : typeof value === "object" ? JSON.stringify(value) : String(value);
    out.push({ path, example: text.length > 60 ? `${text.slice(0, 57)}…` : text });
  };
  const walk = (value: unknown, path: string, depth: number) => {
    if (out.length >= max || depth > 6) return;
    if (Array.isArray(value)) {
      const objects = value.filter((v) => v && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown>[];
      if (objects.length) {
        for (const o of objects.slice(0, 5)) for (const [k, v] of Object.entries(o)) walk(v, `${path}[].${k}`, depth + 1);
      } else add(path, value);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, depth + 1);
      return;
    }
    add(path, value);
  };
  walk(record, "", 0);
  return out;
}
