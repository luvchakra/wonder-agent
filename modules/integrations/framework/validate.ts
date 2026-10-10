import {
  CANONICAL_FIELDS,
  CONNECTOR_CATEGORIES,
  CONNECTOR_DRIVERS,
  DEFINITION_SCHEMA_VERSION,
  RESOURCE_KINDS,
  RUNTIME_EVENT_FIELDS,
  TRANSFORMS,
  type ConnectorDefinition,
  type DefinitionIssue,
  type ResourceKind,
} from "./types";
import { templateVariables } from "./mapping";

/**
 * Checks a connector definition before anything runs it. Built-in and
 * custom definitions go through the same rules, so a definition an
 * integrator writes is held to exactly what WonderID's own are.
 *
 * Security rules, not just shape:
 * - Secrets (`{secret.…}`) may appear only in the auth block, so a secret
 *   can never end up in a URL path, a query string, a log line or a record.
 * - Every request path is relative ("/api/…"): the organization's own base
 *   address decides the host, and the definition cannot point a credential
 *   at another server. A token URL must be relative or start from a url
 *   setting.
 * - LDAP needs ldaps:// and SQL needs TLS (sslmode), so credentials never
 *   cross the network in clear text.
 * - SQL is one read-only SELECT/WITH statement (and runs in a read-only
 *   transaction too).
 */

const KEY_RE = /^[a-z][a-z0-9-]{1,62}$/;
const SETTING_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const MAX_BYTES = 256 * 1024;

const AUTH_BY_DRIVER: Record<string, string[]> = {
  http: ["none", "basic", "bearer", "header", "query", "oauth2_client_credentials"],
  ldap: ["ldap_simple"],
  sql: ["sql_password"],
  mcp: ["none", "bearer", "header"],
  none: ["none"],
};

const MCP_METHODS = ["initialize", "tools/list", "resources/list", "prompts/list"];

type Ctx = { issues: DefinitionIssue[]; settings: Map<string, string>; secrets: Set<string> };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function issue(ctx: Ctx, path: string, message: string) {
  if (ctx.issues.length < 100) ctx.issues.push({ path, message });
}

/** Every `{…}` in a template must name something the scope will have. */
function checkTemplate(ctx: Ctx, path: string, template: string, allowed: ("settings" | "record" | "parent" | "secret" | "auth")[]) {
  for (const name of templateVariables(template)) {
    const [scope, ...rest] = name.split(".");
    if (!allowed.includes(scope as never)) {
      issue(ctx, path, `"{${name}}" is not allowed here (use ${allowed.map((a) => `{${a}.…}`).join(", ")})`);
      continue;
    }
    if (scope === "settings" && !ctx.settings.has(rest[0])) issue(ctx, path, `"{${name}}" names no setting`);
    if (scope === "secret" && !ctx.secrets.has(rest[0])) issue(ctx, path, `"{${name}}" names no secret field`);
  }
}

/** Any `{secret.…}` outside the auth block is refused, wherever it hides. */
function findSecretRefs(value: unknown, path: string, out: string[]) {
  if (typeof value === "string") {
    if (/\{secret\./.test(value)) out.push(path);
  } else if (Array.isArray(value)) value.forEach((v, i) => findSecretRefs(v, `${path}[${i}]`, out));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) findSecretRefs(v, `${path}.${k}`, out);
}

function checkRelativePath(ctx: Ctx, path: string, value: unknown, allowed: ("settings" | "record" | "parent")[]) {
  if (!str(value, 2000)) return issue(ctx, path, "is required");
  if (!value.startsWith("/") || value.startsWith("//") || /^[a-z]+:/i.test(value)) {
    return issue(ctx, path, "must be a path relative to the base address, starting with /");
  }
  checkTemplate(ctx, path, value, allowed);
}

function checkRequest(ctx: Ctx, path: string, req: unknown, allowed: ("settings" | "record" | "parent")[]) {
  if (!isObj(req)) return issue(ctx, path, "must be an object");
  if (req.method !== undefined && req.method !== "GET" && req.method !== "POST") issue(ctx, `${path}.method`, "must be GET or POST");
  checkRelativePath(ctx, `${path}.path`, req.path, allowed);
  for (const key of ["query", "headers"] as const) {
    const v = req[key];
    if (v === undefined) continue;
    if (!isObj(v)) {
      issue(ctx, `${path}.${key}`, "must be an object of strings");
      continue;
    }
    for (const [k, val] of Object.entries(v)) {
      const values = key === "query" && Array.isArray(val) ? val : [val];
      if (values.length === 0 || values.length > 20) issue(ctx, `${path}.${key}.${k}`, "a list needs one to twenty values");
      for (const item of values) {
        if (typeof item !== "string") issue(ctx, `${path}.${key}.${k}`, key === "query" ? "must be a string or a list of strings" : "must be a string");
        else checkTemplate(ctx, `${path}.${key}.${k}`, item, allowed);
      }
      if (key === "headers" && /^(authorization|cookie|proxy-authorization|host)$/i.test(k)) issue(ctx, `${path}.headers.${k}`, "is set by the auth block, not here");
    }
  }
}

function checkPagination(ctx: Ctx, path: string, p: unknown) {
  if (p === undefined) return;
  if (!isObj(p)) return issue(ctx, path, "must be an object");
  const size = (v: unknown, required: boolean) => {
    if (v === undefined && !required) return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) issue(ctx, `${path}.size`, "must be a whole number from 1 to 1000");
  };
  switch (p.type) {
    case "none":
      return;
    case "page":
      if (!str(p.param, 50)) issue(ctx, `${path}.param`, "is required");
      size(p.size, true);
      return;
    case "offset":
      if (!str(p.param, 50)) issue(ctx, `${path}.param`, "is required");
      if (!str(p.sizeParam, 50)) issue(ctx, `${path}.sizeParam`, "is required");
      size(p.size, true);
      if (p.in !== undefined && p.in !== "query" && p.in !== "body") issue(ctx, `${path}.in`, "must be query or body");
      return;
    case "cursor":
      if (!str(p.param, 50)) issue(ctx, `${path}.param`, "is required");
      if (!str(p.from, 200)) issue(ctx, `${path}.from`, "is required (where the next cursor is in the response)");
      size(p.size, false);
      return;
    case "link_header":
      size(p.size, false);
      return;
    case "scim":
      size(p.size, true);
      return;
    default:
      issue(ctx, `${path}.type`, "must be none, page, offset, cursor, link_header or scim");
  }
}

function checkRecordsPath(ctx: Ctx, path: string, v: unknown) {
  if (v === undefined || typeof v === "string") return;
  if (!Array.isArray(v) || v.length === 0 || v.length > 5 || v.some((x) => typeof x !== "string")) issue(ctx, path, "must be a field path, or a list of up to five to try in order");
}

function checkMapping(ctx: Ctx, path: string, m: unknown, kind: ResourceKind | "runtime_event") {
  const allowed: ("settings" | "record" | "parent")[] = ["record", "parent", "settings"];
  if (typeof m === "string") {
    if (!m.trim()) issue(ctx, path, "must name a field");
    return;
  }
  if (!isObj(m)) return issue(ctx, path, "must be a field path or an object");
  const sources = ["path", "template", "value"].filter((k) => m[k] !== undefined);
  if (sources.length !== 1) issue(ctx, path, "needs exactly one of path, template or value");
  if (m.path !== undefined && !str(m.path, 300) && !(Array.isArray(m.path) && m.path.length > 0 && m.path.length <= 5 && m.path.every((x) => str(x, 300)))) {
    issue(ctx, `${path}.path`, "must be a field path, or a list of up to five to try in order");
  }
  if (m.template !== undefined) {
    if (typeof m.template !== "string") issue(ctx, `${path}.template`, "must be a string");
    else checkTemplate(ctx, `${path}.template`, m.template, allowed);
  }
  if (m.transform !== undefined) {
    if (!Array.isArray(m.transform)) issue(ctx, `${path}.transform`, "must be a list");
    else
      m.transform.forEach((t, i) => {
        if (typeof t === "string") {
          if (!(TRANSFORMS as readonly string[]).includes(t)) issue(ctx, `${path}.transform[${i}]`, `must be one of ${TRANSFORMS.join(", ")}, { map: {…} } or { prefix: \"…\" }`);
        } else if (isObj(t) && (t.prefix !== undefined || t.contains !== undefined)) {
          const v = t.prefix ?? t.contains;
          if (!str(v, 200) || Object.keys(t).length !== 1) issue(ctx, `${path}.transform[${i}]`, "{ prefix } and { contains } take one non-empty string");
        } else if (!isObj(t) || !isObj(t.map)) issue(ctx, `${path}.transform[${i}]`, "must be a transform name, { map: {…} } or { prefix: \"…\" }");
      });
  }
  void kind;
}

function checkResource(ctx: Ctx, def: Record<string, unknown>, kind: ResourceKind, r: unknown, kinds: Set<string>, path: string) {
  if (!isObj(r)) return issue(ctx, path, "must be an object");
  const driver = def.driver;
  const parentAllowed: ("settings" | "record" | "parent")[] = r.forEach ? ["settings", "parent"] : ["settings"];
  if (r.forEach && r.unwind) issue(ctx, `${path}.unwind`, "cannot be combined with forEach");
  if (driver === "http") {
    checkRequest(ctx, `${path}.request`, r.request, parentAllowed);
    checkRecordsPath(ctx, `${path}.records`, r.records);
    if (r.recordsKeyed !== undefined && typeof r.recordsKeyed !== "boolean") issue(ctx, `${path}.recordsKeyed`, "must be true or false");
    checkPagination(ctx, `${path}.pagination`, r.pagination);
  } else if (driver === "ldap") {
    const s = r.search;
    if (!isObj(s)) issue(ctx, `${path}.search`, "is required for the ldap driver");
    else {
      if (!str(s.base, 500)) issue(ctx, `${path}.search.base`, "is required");
      else checkTemplate(ctx, `${path}.search.base`, s.base, parentAllowed);
      if (!str(s.filter, 2000)) issue(ctx, `${path}.search.filter`, "is required");
      else checkTemplate(ctx, `${path}.search.filter`, s.filter, parentAllowed);
      if (s.scope !== undefined && !["base", "one", "sub"].includes(String(s.scope))) issue(ctx, `${path}.search.scope`, "must be base, one or sub");
    }
  } else if (driver === "sql") {
    checkSql(ctx, `${path}.query`, r.query);
  } else if (driver === "mcp") {
    if (!isObj(r.rpc) || !MCP_METHODS.includes(String(r.rpc.method))) issue(ctx, `${path}.rpc.method`, `must be one of ${MCP_METHODS.join(", ")}`);
    checkRecordsPath(ctx, `${path}.records`, r.records);
    if (r.forEach !== undefined) issue(ctx, `${path}.forEach`, "is not available for the mcp driver");
  }
  if (r.forEach !== undefined) {
    if (!(RESOURCE_KINDS as readonly string[]).includes(String(r.forEach)) || r.forEach === kind) issue(ctx, `${path}.forEach`, "must name another resource");
    else if (!kinds.has(String(r.forEach))) issue(ctx, `${path}.forEach`, `there is no ${String(r.forEach)} resource`);
    else {
      const parentValue = (def.resources as Record<string, unknown>)[String(r.forEach)];
      const parents = (Array.isArray(parentValue) ? parentValue : [parentValue]) as Record<string, unknown>[];
      if (parents.some((p) => p?.forEach)) issue(ctx, `${path}.forEach`, "cannot follow a resource that itself uses forEach");
      if (r.forEachRequest !== undefined && !(Number.isInteger(r.forEachRequest) && Number(r.forEachRequest) >= 0 && Number(r.forEachRequest) < parents.length)) {
        issue(ctx, `${path}.forEachRequest`, `must be the index of one of the ${String(r.forEach)} requests (0–${parents.length - 1})`);
      }
    }
  } else if (r.forEachRequest !== undefined) issue(ctx, `${path}.forEachRequest`, "needs forEach");
  if (r.unwind !== undefined && !str(r.unwind, 200)) issue(ctx, `${path}.unwind`, "must name a list field");
  if (r.where !== undefined) {
    if (!Array.isArray(r.where)) issue(ctx, `${path}.where`, "must be a list");
    else
      r.where.forEach((w, i) => {
        if (!isObj(w) || !str(w.path, 200)) return issue(ctx, `${path}.where[${i}]`, "needs a path");
        for (const k of ["prefix", "notPrefix"]) if (w[k] !== undefined && !str(w[k], 200)) issue(ctx, `${path}.where[${i}].${k}`, "must be a non-empty string");
        for (const k of ["in", "notIn"]) if (w[k] !== undefined && !Array.isArray(w[k])) issue(ctx, `${path}.where[${i}].${k}`, "must be a list");
      });
  }
  if (r.optional !== undefined && typeof r.optional !== "boolean") issue(ctx, `${path}.optional`, "must be true or false");
  if (r.maxRecords !== undefined && (typeof r.maxRecords !== "number" || r.maxRecords < 1 || r.maxRecords > 200_000)) {
    issue(ctx, `${path}.maxRecords`, "must be from 1 to 200000");
  }
  if (!isObj(r.fields)) return issue(ctx, `${path}.fields`, "is required");
  const canon = CANONICAL_FIELDS[kind];
  const known = new Set([...canon.required, ...canon.optional]);
  for (const [target, mapping] of Object.entries(r.fields)) {
    if (!known.has(target)) issue(ctx, `${path}.fields.${target}`, `is not a ${kind} field (${[...known].join(", ")})`);
    checkMapping(ctx, `${path}.fields.${target}`, mapping, kind);
  }
  for (const req of canon.required) if (!(req in r.fields)) issue(ctx, `${path}.fields.${req}`, "is required");
}

function checkSql(ctx: Ctx, path: string, q: unknown) {
  if (!str(q, 10_000)) return issue(ctx, path, "is required for the sql driver");
  const body = q.trim().replace(/;\s*$/, "");
  if (body.includes(";")) issue(ctx, path, "must be a single statement");
  if (!/^(select|with)\b/i.test(body)) issue(ctx, path, "must be a SELECT (or WITH … SELECT) statement");
  if (/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|set|reset|lock|vacuum|refresh|listen|notify)\b/i.test(body.replace(/'[^']*'/g, "''"))) {
    issue(ctx, path, "may only read (no INSERT, UPDATE, DDL, COPY, SET or similar)");
  }
  if (/\b(pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|pg_sleep)\b/i.test(body)) issue(ctx, path, "uses a function that is not allowed");
  checkTemplate(ctx, path, q, []);
}

const HEADER_RE = /^[a-zA-Z][a-zA-Z0-9-]{1,60}$/;

function checkReceive(ctx: Ctx, rec: unknown) {
  if (rec === undefined) return;
  if (!isObj(rec)) return issue(ctx, "receive", "must be an object");
  const known = new Set(["runtimeEvents", "webhook", "gateway"]);
  for (const k of Object.keys(rec)) if (!known.has(k)) issue(ctx, `receive.${k}`, "must be runtimeEvents, webhook or gateway");
  const checkAuth = (path: string, c: Record<string, unknown>) => {
    if (c.auth !== "bearer" && c.auth !== "hmac_sha256") issue(ctx, `${path}.auth`, "must be bearer or hmac_sha256");
    if (c.signatureHeader !== undefined && !(typeof c.signatureHeader === "string" && HEADER_RE.test(c.signatureHeader))) issue(ctx, `${path}.signatureHeader`, "must be a header name");
  };
  const ev = rec.runtimeEvents;
  if (ev !== undefined) {
    if (!isObj(ev)) issue(ctx, "receive.runtimeEvents", "must be an object");
    else {
      checkAuth("receive.runtimeEvents", ev);
      if (!["mcp", "rest", "webhook"].includes(String(ev.source))) issue(ctx, "receive.runtimeEvents.source", "must be mcp, rest or webhook");
      if (ev.records !== undefined && typeof ev.records !== "string") issue(ctx, "receive.runtimeEvents.records", "must be a field path");
      if (!isObj(ev.fields)) issue(ctx, "receive.runtimeEvents.fields", "is required");
      else {
        const all = new Set<string>([...RUNTIME_EVENT_FIELDS.required, ...RUNTIME_EVENT_FIELDS.optional]);
        for (const [target, mapping] of Object.entries(ev.fields)) {
          if (!all.has(target)) issue(ctx, `receive.runtimeEvents.fields.${target}`, `is not a runtime event field (${[...all].join(", ")})`);
          checkMapping(ctx, `receive.runtimeEvents.fields.${target}`, mapping, "runtime_event");
        }
        for (const req of RUNTIME_EVENT_FIELDS.required) if (!(req in ev.fields)) issue(ctx, `receive.runtimeEvents.fields.${req}`, "is required");
      }
    }
  }
  const wh = rec.webhook;
  if (wh !== undefined) {
    if (!isObj(wh)) issue(ctx, "receive.webhook", "must be an object");
    else {
      checkAuth("receive.webhook", wh);
      if (wh.externalId !== undefined && !str(wh.externalId, 200)) issue(ctx, "receive.webhook.externalId", "must be a field path");
    }
  }
  const gw = rec.gateway;
  if (gw !== undefined && (!isObj(gw) || typeof gw.authorize !== "boolean" || typeof gw.toolsFilter !== "boolean")) {
    issue(ctx, "receive.gateway", "must be { authorize: true|false, toolsFilter: true|false }");
  }
}

export function validateDefinition(input: unknown): { definition: ConnectorDefinition | null; issues: DefinitionIssue[] } {
  const ctx: Ctx = { issues: [], settings: new Map(), secrets: new Set() };
  if (!isObj(input)) return { definition: null, issues: [{ path: "", message: "must be a JSON object" }] };
  if (JSON.stringify(input).length > MAX_BYTES) return { definition: null, issues: [{ path: "", message: "is larger than 256 KB" }] };
  const d = input;

  if (d.schemaVersion !== DEFINITION_SCHEMA_VERSION) issue(ctx, "schemaVersion", `must be ${DEFINITION_SCHEMA_VERSION}`);
  if (typeof d.key !== "string" || !KEY_RE.test(d.key)) issue(ctx, "key", "must be lowercase letters, digits and dashes, 2–63 characters, starting with a letter");
  if (typeof d.version !== "string" || !SEMVER_RE.test(d.version)) issue(ctx, "version", "must look like 1.0.0");
  if (!str(d.name, 80)) issue(ctx, "name", "is required (at most 80 characters)");
  if (!str(d.description, 600)) issue(ctx, "description", "is required (at most 600 characters)");
  if (d.vendor !== undefined && !str(d.vendor, 80)) issue(ctx, "vendor", "must be text (at most 80 characters)");
  if (!(CONNECTOR_CATEGORIES as readonly string[]).includes(String(d.category))) issue(ctx, "category", `must be one of ${CONNECTOR_CATEGORIES.join(", ")}`);
  if (!(CONNECTOR_DRIVERS as readonly string[]).includes(String(d.driver))) issue(ctx, "driver", `must be one of ${CONNECTOR_DRIVERS.join(", ")}`);
  if (d.rateLimitPerSecond !== undefined && (typeof d.rateLimitPerSecond !== "number" || d.rateLimitPerSecond < 1 || d.rateLimitPerSecond > 50)) {
    issue(ctx, "rateLimitPerSecond", "must be from 1 to 50");
  }
  if (d.documentationUrl !== undefined && (typeof d.documentationUrl !== "string" || !/^https:\/\//.test(d.documentationUrl))) issue(ctx, "documentationUrl", "must be an https:// address");

  // Settings
  if (!Array.isArray(d.settings)) issue(ctx, "settings", "must be a list");
  else
    d.settings.forEach((s, i) => {
      const p = `settings[${i}]`;
      if (!isObj(s)) return issue(ctx, p, "must be an object");
      if (typeof s.key !== "string" || !SETTING_RE.test(s.key)) return issue(ctx, `${p}.key`, "must be letters, digits or _ (starting with a letter)");
      if (ctx.settings.has(s.key)) issue(ctx, `${p}.key`, `"${s.key}" is listed twice`);
      if (!str(s.label, 80)) issue(ctx, `${p}.label`, "is required");
      if (!["url", "string", "number", "boolean", "select"].includes(String(s.type))) issue(ctx, `${p}.type`, "must be url, string, number, boolean or select");
      if (s.type === "select" && (!Array.isArray(s.options) || s.options.length === 0)) issue(ctx, `${p}.options`, "a select needs options");
      ctx.settings.set(s.key, String(s.type));
    });
  const urlSettings = [...ctx.settings].filter(([, t]) => t === "url").map(([k]) => k);
  if ((d.driver === "http" || d.driver === "mcp") && urlSettings.length === 0) issue(ctx, "settings", `an ${String(d.driver)} connector needs a url setting (the base address)`);
  if ((d.driver === "ldap" || d.driver === "sql") && urlSettings.length === 0) issue(ctx, "settings", "needs a url setting (ldaps://host:636 or postgres://host:5432/db)");

  // Auth
  const auth = d.auth;
  if (!isObj(auth)) issue(ctx, "auth", "is required");
  else {
    const allowedAuth = AUTH_BY_DRIVER[String(d.driver)] ?? [];
    if (!allowedAuth.includes(String(auth.type))) issue(ctx, "auth.type", `must be one of ${allowedAuth.join(", ") || "(choose a driver first)"}`);
    if (auth.type !== "none") {
      if (!Array.isArray(auth.fields) || auth.fields.length === 0) issue(ctx, "auth.fields", "lists the secret values the organization enters");
      else
        auth.fields.forEach((f, i) => {
          if (!isObj(f) || typeof f.key !== "string" || !SETTING_RE.test(f.key)) issue(ctx, `auth.fields[${i}].key`, "must be letters, digits or _");
          else if (ctx.secrets.has(f.key)) issue(ctx, `auth.fields[${i}].key`, "is listed twice");
          else ctx.secrets.add(f.key);
          if (!isObj(f) || !str(f.label, 80)) issue(ctx, `auth.fields[${i}].label`, "is required");
          if (isObj(f) && f.optional !== undefined && typeof f.optional !== "boolean") issue(ctx, `auth.fields[${i}].optional`, "must be true or false");
        });
    }
    const templated: Record<string, string[]> = {
      basic: ["username", "password"],
      bearer: ["token"],
      header: ["name", "value"],
      query: ["name", "value"],
      oauth2_client_credentials: ["clientId", "clientSecret"],
      ldap_simple: ["bindDn", "password"],
      sql_password: ["username", "password"],
    };
    for (const k of templated[String(auth.type)] ?? []) {
      if (!str(auth[k], 1000)) issue(ctx, `auth.${k}`, "is required");
      else checkTemplate(ctx, `auth.${k}`, auth[k] as string, ["secret", "settings"]);
    }
    if (auth.type === "header" && typeof auth.name === "string" && /^(host|cookie)$/i.test(auth.name)) issue(ctx, "auth.name", "cannot be Host or Cookie");
    if (auth.type === "oauth2_client_credentials") {
      const t = auth.tokenUrl;
      if (!str(t, 1000)) issue(ctx, "auth.tokenUrl", "is required");
      else {
        const fromSetting = /^\{settings\.([a-zA-Z0-9_]+)\}/.exec(t);
        if (!t.startsWith("/") && !(fromSetting && ctx.settings.get(fromSetting[1]) === "url")) {
          issue(ctx, "auth.tokenUrl", "must be a path (/…) or start with a url setting ({settings.<url>}/…)");
        }
        checkTemplate(ctx, "auth.tokenUrl", t, ["settings"]);
      }
      if (auth.scope !== undefined && typeof auth.scope !== "string") issue(ctx, "auth.scope", "must be text");
      if (auth.clientAuth !== undefined && auth.clientAuth !== "body" && auth.clientAuth !== "basic") issue(ctx, "auth.clientAuth", "must be body or basic");
    }
  }

  // No secret outside auth.
  const leaks: string[] = [];
  for (const [k, v] of Object.entries(d)) if (k !== "auth") findSecretRefs(v, k, leaks);
  for (const p of leaks) issue(ctx, p, "secrets may only be used in the auth block");

  // Test
  if (d.driver === "none") {
    if (d.test !== undefined) issue(ctx, "test", "a receive-only connector has nothing to test");
  } else if (!isObj(d.test)) issue(ctx, "test", "is required (a cheap call that proves the connection works)");
  else if (d.driver === "mcp") {
    if (!isObj(d.test.rpc) || !MCP_METHODS.includes(String(d.test.rpc.method))) issue(ctx, "test.rpc.method", `must be one of ${MCP_METHODS.join(", ")}`);
  } else if (d.driver === "http") checkRequest(ctx, "test.request", d.test.request, ["settings"]);
  else if (d.driver === "ldap") {
    if (!isObj(d.test.search) || !str(d.test.search.base, 500) || !str(d.test.search.filter, 500)) issue(ctx, "test.search", "needs a base and filter");
  } else if (d.driver === "sql") checkSql(ctx, "test.query", d.test.query);

  if (d.application !== undefined) {
    if (!str(d.application, 200)) issue(ctx, "application", "must be text");
    else checkTemplate(ctx, "application", d.application, ["settings"]);
  }

  // Receiving side
  checkReceive(ctx, d.receive);

  // Resources
  const receives = isObj(d.receive) && Object.keys(d.receive).length > 0;
  if (!isObj(d.resources)) issue(ctx, "resources", "must be an object");
  else if (d.driver === "none") {
    if (Object.keys(d.resources).length) issue(ctx, "resources", "a receive-only connector (driver none) reads nothing");
    if (!receives) issue(ctx, "receive", "a connector with driver none must receive something");
  } else if (Object.keys(d.resources).length === 0) issue(ctx, "resources", `needs at least one of ${RESOURCE_KINDS.join(", ")}`);
  else {
    const kinds = new Set(Object.keys(d.resources));
    for (const k of kinds) {
      if (!(RESOURCE_KINDS as readonly string[]).includes(k)) issue(ctx, `resources.${k}`, `must be one of ${RESOURCE_KINDS.join(", ")}`);
      else {
        const value = (d.resources as Record<string, unknown>)[k];
        const list = Array.isArray(value) ? value : [value];
        if (list.length === 0 || list.length > 10) issue(ctx, `resources.${k}`, "needs one to ten requests");
        list.forEach((spec, i) => checkResource(ctx, d, k as ResourceKind, spec, kinds, Array.isArray(value) ? `resources.${k}[${i}]` : `resources.${k}`));
      }
    }
  }

  return { definition: ctx.issues.length ? null : (d as unknown as ConnectorDefinition), issues: ctx.issues };
}

/** The setting values an organization entered, checked against the definition. */
export function validateSettings(def: ConnectorDefinition, input: unknown): { settings: Record<string, string | number | boolean>; issues: DefinitionIssue[] } {
  const issues: DefinitionIssue[] = [];
  const values = isObj(input) ? input : {};
  const settings: Record<string, string | number | boolean> = {};
  for (const s of def.settings) {
    let v = values[s.key];
    if ((v === undefined || v === "") && s.default !== undefined) v = s.default;
    if (v === undefined || v === "" || v === null) {
      if (s.required) issues.push({ path: `settings.${s.key}`, message: `${s.label} is required` });
      continue;
    }
    if (s.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) issues.push({ path: `settings.${s.key}`, message: `${s.label} must be a number` });
      else settings[s.key] = n;
    } else if (s.type === "boolean") settings[s.key] = v === true || v === "true" || v === "on";
    else {
      const text = String(v).trim();
      if (text.length > 20_000) issues.push({ path: `settings.${s.key}`, message: `${s.label} is too long` });
      if (s.type === "select" && !s.options?.includes(text)) issues.push({ path: `settings.${s.key}`, message: `${s.label} must be one of ${s.options?.join(", ")}` });
      if (s.type === "url") {
        const scheme = def.driver === "ldap" ? "ldaps:" : def.driver === "sql" ? "postgres:" : "https:";
        let u: URL | null = null;
        try {
          u = new URL(text);
        } catch {
          /* reported below */
        }
        const devHttp = (def.driver === "http" || def.driver === "mcp") && u?.protocol === "http:";
        if (!u || (u.protocol !== scheme && !(devHttp && process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS === "true") && !(def.driver === "sql" && u.protocol === "postgresql:"))) {
          issues.push({ path: `settings.${s.key}`, message: `${s.label} must be a ${scheme}// address` });
        } else if (u.username || u.password) issues.push({ path: `settings.${s.key}`, message: `${s.label} must not contain a user name or password` });
      }
      settings[s.key] = s.type === "url" ? text.replace(/\/+$/, "") : text;
    }
  }
  return { settings, issues };
}

/** The secret values an organization entered, as the JSON stored (encrypted) in integration_credentials. */
export function validateSecrets(def: ConnectorDefinition, input: unknown): { secret: string | null; issues: DefinitionIssue[] } {
  if (def.auth.type === "none") return { secret: null, issues: [] };
  const values = isObj(input) ? input : {};
  const issues: DefinitionIssue[] = [];
  const out: Record<string, string> = {};
  for (const f of def.auth.fields) {
    const v = values[f.key];
    if (f.optional && (v === undefined || v === null || (typeof v === "string" && !v.trim()))) continue;
    if (typeof v !== "string" || !v.trim()) issues.push({ path: `secret.${f.key}`, message: `${f.label} is required` });
    else if (v.length > 8000) issues.push({ path: `secret.${f.key}`, message: `${f.label} is too long` });
    else out[f.key] = v.trim();
  }
  if (!issues.length && Object.keys(out).length === 0) return { secret: null, issues };
  return { secret: issues.length ? null : JSON.stringify(out), issues };
}
