/**
 * INTEGRATION-P0-22 slice 3 — pure rules for receiving users over SCIM 2.0
 * (RFC 7643 schema, RFC 7644 protocol). receive.ts does the I/O.
 *
 * WonderID is the SCIM service provider here: an identity provider or HR
 * system pushes its people to a connection's receiver. Everything sent is
 * data (§17.2): a resource can never choose the organization, the
 * connection, its own `id` or its `meta`.
 */

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_ENTERPRISE_SCHEMA = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_MAX_RESULTS = 200;
export const SCIM_MAX_OPERATIONS = 100;

export type ScimResource = Record<string, unknown>;

/** What a request under scim/v2/ asks for; null for anything this receiver does not serve. */
export function scimTarget(channel: string): { kind: "config" } | { kind: "users"; id: string | null } | null {
  const rest = channel.replace(/^scim\/v2\/?/, "");
  if (rest === "ServiceProviderConfig") return { kind: "config" };
  if (rest === "Users") return { kind: "users", id: null };
  const m = /^Users\/([0-9a-f-]{36})$/i.exec(rest);
  return m ? { kind: "users", id: m[1].toLowerCase() } : null;
}

/** A SCIM error body (RFC 7644 §3.12). */
export function scimError(status: number, detail: string, scimType?: string): ScimResource {
  return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), ...(scimType ? { scimType } : {}), detail };
}

/**
 * The one filter identity providers send before creating a user:
 * `userName eq "x"` (or `externalId eq "x"`), case-insensitive for
 * userName as RFC 7643 says. Anything else is refused, never guessed.
 */
export function parseScimFilter(filter: string | null): { attribute: "userName" | "externalId"; value: string } | null | "invalid" {
  if (filter === null || filter.trim() === "") return null;
  const m = /^\s*(userName|externalId)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m) return "invalid";
  const attribute = m[1].toLowerCase() === "username" ? "userName" : "externalId";
  return { attribute, value: m[2].replace(/\\(.)/g, "$1") };
}

/** startIndex (1-based) and count, clamped to what this receiver serves. */
export function scimPage(startIndex: string | null, count: string | null): { offset: number; limit: number } {
  const start = Math.max(1, Number.parseInt(startIndex ?? "1", 10) || 1);
  const n = count === null ? SCIM_MAX_RESULTS : Math.max(0, Math.min(SCIM_MAX_RESULTS, Number.parseInt(count, 10) || 0));
  return { offset: start - 1, limit: n };
}

/** A user as sent, without what only the service provider sets; the problem instead when it is not a valid user. */
export function cleanUser(body: unknown): ScimResource | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "The body must be a SCIM User object";
  const user = { ...(body as ScimResource) };
  const schemas = user.schemas;
  if (!Array.isArray(schemas) || !schemas.includes(SCIM_USER_SCHEMA)) return `schemas must include ${SCIM_USER_SCHEMA}`;
  if (typeof user.userName !== "string" || !user.userName.trim()) return "userName is required";
  if (user.userName.length > 300) return "userName is too long";
  delete user.id;
  delete user.meta;
  delete user.password;
  return user;
}

/** The SCIM view of a stored user: what was sent, plus the id and meta WonderID owns. */
export function scimUser(stored: ScimResource, id: string, meta: { created: string; lastModified: string; location: string }): ScimResource {
  return { ...stored, id, meta: { resourceType: "User", created: meta.created, lastModified: meta.lastModified, location: meta.location } };
}

/**
 * The record mapping reads: the user, with the enterprise extension also
 * under `enterprise` (its schema URN has dots, which a field path cannot
 * address).
 */
export function mappingScope(user: ScimResource): { record: ScimResource } {
  const ext = user[SCIM_ENTERPRISE_SCHEMA];
  return { record: { ...user, enterprise: typeof ext === "object" && ext !== null ? ext : {} } };
}

const BLOCKED = new Set(["id", "meta", "schemas", "password"]);

/** Splits a simple attribute path (`active`, `name.givenName`, an extension's `urn:…:User:department`). */
function pathParts(path: string): string[] | null {
  if (path.startsWith(SCIM_ENTERPRISE_SCHEMA + ":")) return [SCIM_ENTERPRISE_SCHEMA, ...path.slice(SCIM_ENTERPRISE_SCHEMA.length + 1).split(".")];
  if (/[[\]]/.test(path)) return null;
  const parts = path.split(".");
  return parts.every((p) => /^[A-Za-z][A-Za-z0-9_$-]*$/.test(p)) ? parts : null;
}

function setPath(target: ScimResource, parts: string[], value: unknown) {
  let node = target;
  for (const p of parts.slice(0, -1)) {
    const next = node[p];
    node[p] = typeof next === "object" && next !== null && !Array.isArray(next) ? { ...(next as ScimResource) } : {};
    node = node[p] as ScimResource;
  }
  if (value === undefined) delete node[parts[parts.length - 1]];
  else node[parts[parts.length - 1]] = value;
}

/** Entra sends booleans as strings ("False"); SCIM `active` is a boolean. */
function coerce(parts: string[], value: unknown): unknown {
  if (parts.length === 1 && parts[0] === "active" && typeof value === "string") return value.toLowerCase() === "true";
  return value;
}

/**
 * Applies a PatchOp (RFC 7644 §3.5.2) to a stored user. Supported: add and
 * replace with a simple path or with no path (a set of attributes), and
 * remove with a simple path. Filters in paths (`emails[type eq "work"]`)
 * are refused, never approximated. The result is checked like a new user.
 */
export type PatchResult = { ok: true; user: ScimResource } | { ok: false; status: number; detail: string; scimType?: string };

export function applyScimPatch(user: ScimResource, body: unknown): PatchResult {
  if (typeof body !== "object" || body === null) return { ok: false, status: 400, detail: "The body must be a PatchOp", scimType: "invalidSyntax" };
  const { schemas, Operations } = body as { schemas?: unknown; Operations?: unknown };
  if (!Array.isArray(schemas) || !schemas.includes(SCIM_PATCH_SCHEMA)) return { ok: false, status: 400, detail: `schemas must include ${SCIM_PATCH_SCHEMA}`, scimType: "invalidSyntax" };
  if (!Array.isArray(Operations) || !Operations.length || Operations.length > SCIM_MAX_OPERATIONS) return { ok: false, status: 400, detail: `Operations: 1 to ${SCIM_MAX_OPERATIONS}`, scimType: "invalidSyntax" };
  let next: ScimResource = { ...user };
  for (const raw of Operations) {
    const op = typeof raw === "object" && raw !== null ? (raw as { op?: unknown; path?: unknown; value?: unknown }) : {};
    const kind = typeof op.op === "string" ? op.op.toLowerCase() : "";
    if (!["add", "replace", "remove"].includes(kind)) return { ok: false, status: 400, detail: "op: add, replace or remove", scimType: "invalidSyntax" };
    if (op.path === undefined || op.path === null || op.path === "") {
      if (kind === "remove") return { ok: false, status: 400, detail: "remove needs a path", scimType: "noTarget" };
      if (typeof op.value !== "object" || op.value === null || Array.isArray(op.value)) return { ok: false, status: 400, detail: "value: an object of attributes when there is no path", scimType: "invalidValue" };
      for (const [key, value] of Object.entries(op.value as ScimResource)) {
        const parts = pathParts(key);
        if (!parts || BLOCKED.has(parts[0])) return { ok: false, status: 400, detail: `${key} cannot be changed`, scimType: "mutability" };
        setPath(next, parts, coerce(parts, value));
      }
      continue;
    }
    if (typeof op.path !== "string") return { ok: false, status: 400, detail: "path must be a string", scimType: "invalidPath" };
    const parts = pathParts(op.path);
    if (!parts) return { ok: false, status: 400, detail: `path ${op.path.slice(0, 80)} is not supported`, scimType: "invalidPath" };
    if (BLOCKED.has(parts[0])) return { ok: false, status: 400, detail: `${parts[0]} cannot be changed`, scimType: "mutability" };
    next = { ...next };
    setPath(next, parts, kind === "remove" ? undefined : coerce(parts, op.value));
  }
  const checked = cleanUser(next);
  return typeof checked === "string" ? { ok: false, status: 400, detail: checked, scimType: "invalidValue" } : { ok: true, user: checked };
}

/** What this receiver supports (RFC 7643 §5). */
export function serviceProviderConfig(location: string): ScimResource {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: SCIM_MAX_RESULTS },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "The connection's receiving secret" }],
    meta: { resourceType: "ServiceProviderConfig", location },
  };
}
