// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QA-P0-07: connector contract tests. Every built-in connector is run
 * against a fake of its own system for the nine contract properties below.
 * The http suite is generated from each definition (its requests, paging,
 * records paths, fields and filters), so a new http built-in is covered
 * without a fixture. Other drivers have their own block, with fakes for
 * ldapts and pg. What a connector does not do is listed in GAPS, with the
 * reason; the last block checks every connector and property is either
 * tested or listed there.
 */

// ---------------------------------------------------------------- socket fakes (hoisted)

type LdapClientState = { options: Record<string, unknown>; binds: [string, string][]; searches: { base: string; options: Record<string, unknown> }[]; modifies: string[]; unbound: boolean };
type PgClientState = { config: Record<string, unknown>; queries: string[]; ended: boolean };

const ldap = vi.hoisted(() => ({
  clients: [] as LdapClientState[],
  entries: {} as Record<string, Record<string, unknown>[]>,
  bindError: null as Error | null,
  failFilter: null as string | null,
  modifyCode: null as number | null,
}));

const pg = vi.hoisted(() => ({
  clients: [] as PgClientState[],
  rows: {} as Record<string, Record<string, unknown>[]>,
  connectError: null as Error | null,
  failOn: null as RegExp | null,
}));

vi.mock("ldapts", () => {
  class Client {
    private readonly state: LdapClientState;
    constructor(options: Record<string, unknown>) {
      this.state = { options, binds: [], searches: [], modifies: [], unbound: false };
      ldap.clients.push(this.state);
    }
    async bind(dn: string, password: string) {
      this.state.binds.push([dn, password]);
      if (ldap.bindError) throw ldap.bindError;
    }
    async search(base: string, options: Record<string, unknown>) {
      this.state.searches.push({ base, options });
      if (options.filter === ldap.failFilter) throw Object.assign(new Error("Busy"), { code: 51 });
      return { searchEntries: ldap.entries[String(options.filter)] ?? [], searchReferences: [] };
    }
    async modify(dn: string) {
      this.state.modifies.push(dn);
      if (ldap.modifyCode !== null) throw Object.assign(new Error(`result ${ldap.modifyCode}`), { code: ldap.modifyCode });
    }
    async add(dn: string) {
      this.state.modifies.push(dn);
    }
    async unbind() {
      this.state.unbound = true;
    }
  }
  class Attribute {
    constructor(o: object) {
      Object.assign(this, o);
    }
  }
  class Change {
    constructor(o: object) {
      Object.assign(this, o);
    }
  }
  return { Client, Attribute, Change };
});

vi.mock("pg", () => {
  const kindOf = (sql: string) =>
    /current_user/.test(sql) ? "test" : /AS member, r\.rolname AS role/.test(sql) ? "access_grant" : /NOT r\.rolcanlogin/.test(sql) ? "entitlement" : /WHERE r\.rolcanlogin/.test(sql) ? "account" : "other";
  class Client {
    private readonly state: PgClientState;
    constructor(config: Record<string, unknown>) {
      this.state = { config, queries: [], ended: false };
      pg.clients.push(this.state);
    }
    async connect() {
      if (pg.connectError) throw pg.connectError;
    }
    async query(sql: string) {
      this.state.queries.push(sql);
      if (/^(BEGIN|ROLLBACK)/.test(sql)) return { rows: [] };
      if (pg.failOn?.test(sql)) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
      return { rows: pg.rows[kindOf(sql)] ?? [] };
    }
    async end() {
      this.state.ended = true;
    }
  }
  return { Client, default: { Client } };
});

vi.mock("./drivers/net", () => ({ resolveSafeHost: async () => "203.0.113.10" }));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ rpc: async () => ({ data: 1, error: null }) }) }));
vi.mock("@/lib/config/tenantConfig", () => ({ readTenantConfigStrict: async () => ({ "integration.allowedHosts": [] }) }));

import { BUILTIN_DEFINITIONS } from "./definitions";
import { DefinitionConnector, capabilitiesOf, httpDriver, kindsOf, specsOf, writeCapabilitiesOf, writeIsRepeatable } from "./engine";
import { ConnectorRequestError, LIMITS, type FetchLike } from "./http";
import { fillTemplate, mapRecord, readPath, templateVariables } from "./mapping";
import { validateDefinition } from "./validate";
import {
  CANONICAL_FIELDS,
  CONNECTOR_DRIVERS,
  RESOURCE_KINDS,
  type ConnectorDefinition,
  type ConnectorDriver,
  type DefinitionWriteOperation,
  type FieldMapping,
  type Pagination,
  type ResourceKind,
  type ResourceSpec,
} from "./types";
import { ldapDriver } from "./drivers/ldap";
import { sqlDriver } from "./drivers/sql";
import { fileDriver, type ConnectorFileStore, type FileFetch, type StoredFile } from "./drivers/file";
import { mcpDriver } from "./drivers/mcp";
import { eventRecords, mapRuntimeEvent, uploadTarget, verifySender, MAX_EVENTS_PER_REQUEST } from "./receiveRules";
import { SCIM_MAX_RESULTS, SCIM_USER_SCHEMA, mappingScope, scimPage } from "./scimRules";
import { openGateway } from "../gateway/gateway";
import { classifyOutboundError } from "../gateway/gatewayRules";
import { requestFingerprint, retryableWrite, systemKey, writeFailureKind } from "../connectorWriteRules";

// ---------------------------------------------------------------- the contract and its gaps

export const CONTRACT_PROPERTIES = ["authentication", "discovery", "pagination", "partial_failure", "retry", "rate_limiting", "idempotency", "credential_rotation", "traceability"] as const;
export type ContractProperty = (typeof CONTRACT_PROPERTIES)[number];

/** What the suites below test for every built-in of a driver. */
const TESTED_BY_DRIVER: Record<ConnectorDriver, readonly ContractProperty[]> = {
  http: CONTRACT_PROPERTIES,
  ldap: ["authentication", "discovery", "pagination", "partial_failure", "retry", "rate_limiting", "idempotency", "credential_rotation", "traceability"],
  sql: ["authentication", "discovery", "pagination", "partial_failure", "retry", "rate_limiting", "idempotency", "credential_rotation", "traceability"],
  file: ["authentication", "discovery", "pagination", "partial_failure", "retry", "rate_limiting", "idempotency", "credential_rotation", "traceability"],
  mcp: ["authentication", "discovery", "pagination", "partial_failure", "retry", "rate_limiting", "idempotency", "credential_rotation", "traceability"],
  none: ["authentication", "discovery", "idempotency", "credential_rotation", "traceability"],
};
/** Receive-only connectors with more to test than the driver's default. */
const TESTED_EXTRA: Record<string, readonly ContractProperty[]> = { "scim-inbound": ["pagination"], "runtime-gateway": ["partial_failure"] };

/**
 * What a connector does not do (or does only in part), by connector key or
 * `driver:<driver>`. A "tested" property can still have a gap: the test
 * then pins the current behaviour (a read sent once, a 429 not waited out).
 */
export const GAPS: readonly { scope: string; property: ContractProperty; reason: string }[] = [
  {
    scope: "driver:http",
    property: "retry",
    reason:
      "Reads are sent once: a 5xx, 408 or network error fails that kind for the run (an import error; nothing is marked missing) and the next sync is the retry. Only an OAuth 401 is retried, once, with a new token. A write is never resent by the driver; connectorWrites marks a failure retryable from writeFailureKind() and writeIsRepeatable().",
  },
  {
    scope: "driver:http",
    property: "rate_limiting",
    reason: "Pacing is outbound only (the Gateway's token bucket at rateLimitPerSecond). A 429 is not retried and Retry-After is not read: the kind fails for the run, categorised rate_limited.",
  },
  { scope: "openbao", property: "pagination", reason: "Vault/OpenBao LIST returns every key in one response; the definition declares no paging." },
  { scope: "driver:ldap", property: "retry", reason: "A failed bind or search is not retried; the kind fails for the run." },
  { scope: "driver:ldap", property: "rate_limiting", reason: "Gateway pacing only; a directory's busy or admin-limit answer fails the read." },
  { scope: "driver:ldap", property: "pagination", reason: "Paging is the LDAP paged-results control inside ldapts (page size min(500, maxRecords)); not observable to the fake beyond the options sent." },
  { scope: "driver:sql", property: "pagination", reason: "One read-only statement per kind, cut at LIMIT maxRecords; no keyset paging. A result at the limit is reported truncated." },
  { scope: "driver:sql", property: "retry", reason: "A failed connect or statement is not retried; the kind fails for the run." },
  { scope: "driver:sql", property: "rate_limiting", reason: "Gateway pacing only; PostgreSQL has no throttling answer to honour." },
  { scope: "driver:file", property: "pagination", reason: "One CSV per kind, at most 10 MB; nothing to page." },
  { scope: "driver:file", property: "retry", reason: "A failed download is not retried; the kind fails for the run." },
  { scope: "driver:file", property: "rate_limiting", reason: "Gateway pacing on addresses only; a 429 fails the read and Retry-After is not read." },
  { scope: "driver:mcp", property: "retry", reason: "A failed JSON-RPC call is not retried; the kind fails for the run." },
  { scope: "driver:mcp", property: "rate_limiting", reason: "Gateway pacing only; a 429 fails the read and Retry-After is not read." },
  { scope: "driver:none", property: "retry", reason: "Receive-only: the sender retries on a 5xx answer. Redelivery is deduplicated by the event's externalId in receive.ts, against the database (not unit-tested here)." },
  {
    scope: "driver:none",
    property: "rate_limiting",
    reason: `No per-connection rate limit on the /api/connect receivers: only body-size caps (MAX_RECEIVE_BYTES) and at most ${MAX_EVENTS_PER_REQUEST} events per request.`,
  },
  { scope: "driver:none", property: "idempotency", reason: "The dedupe itself (upsert on integration_id, object_type, external_id; runtime dedupeKey) runs in receive.ts against the database; here only the stable id it keys on is tested." },
  { scope: "webhook", property: "pagination", reason: "One payload per request; nothing is paged." },
  { scope: "runtime-gateway", property: "pagination", reason: "Events arrive pushed, at most 500 per request; nothing is paged." },
  { scope: "webhook", property: "partial_failure", reason: "One payload per request: stored whole or refused." },
  { scope: "scim-inbound", property: "partial_failure", reason: "One user per request (no SCIM bulk endpoint): stored whole or refused." },
];

const gapFor = (def: ConnectorDefinition, property: ContractProperty) => GAPS.find((g) => (g.scope === def.key || g.scope === `driver:${def.driver}`) && g.property === property);

// ---------------------------------------------------------------- helpers

type Json = Record<string, unknown>;
type Needs = { record: Map<string, unknown>; parent: Map<string, unknown> };

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
const isPlain = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const without = (o: unknown, ...keys: string[]) => (isPlain(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : o);
const builtin = (def: ConnectorDefinition, settings: Json) => ({ definition: { key: def.key, version: def.version, origin: "builtin" as const }, settings });
const custom = (def: ConnectorDefinition, settings: Json) => ({ definition: { key: def.key, version: def.version, origin: "custom" as const }, manifest: def, settings });

/** Sets a value at a field path (`a.b`, `list[0].x`, `list[].x`), never over a value already there. */
function setPath(target: Json, path: string, value: unknown): void {
  const parts = path.split(".");
  let node: Json = target;
  for (let i = 0; i < parts.length; i++) {
    const m = /^(.*?)(?:\[(\d*)\])?$/.exec(parts[i])!;
    const [key, index] = [m[1], m[2]];
    const last = i === parts.length - 1;
    if (index === undefined) {
      if (last) {
        if (node[key] === undefined) node[key] = value;
        return;
      }
      node[key] ??= {};
      if (!isPlain(node[key])) return;
      node = node[key] as Json;
    } else {
      node[key] ??= [];
      const list = node[key];
      if (!Array.isArray(list)) return;
      const at = Number(index || 0);
      if (last) {
        list[at] ??= value;
        return;
      }
      list[at] ??= {};
      if (!isPlain(list[at])) return;
      node = list[at] as Json;
    }
  }
}

function merge(...objs: Json[]): Json {
  const out: Json = {};
  for (const o of objs) for (const [k, v] of Object.entries(o)) out[k] = isPlain(out[k]) && isPlain(v) ? merge(out[k] as Json, v) : v;
  return out;
}

/** A record with a distinct value at every path it needs (forced values first). */
function build(paths: Map<string, unknown>, seed: string): Json {
  const out: Json = {};
  for (const [p, v] of paths) setPath(out, p, v !== undefined ? v : `${seed}${p.replace(/[^A-Za-z0-9]/g, "")}`);
  return out;
}

function allSpecs(def: ConnectorDefinition): [ResourceKind, ResourceSpec][] {
  return RESOURCE_KINDS.flatMap((k) => specsOf(def, k).map((s) => [k, s] as [ResourceKind, ResourceSpec]));
}

function need(map: Map<string, unknown>, path: string, value?: unknown) {
  if (!path || path === "$") return;
  if (value !== undefined) map.set(path, value);
  else if (!map.has(path)) map.set(path, undefined);
}
function addRef(n: Needs, ref: string, value?: unknown) {
  if (ref.startsWith("parent.")) need(n.parent, ref.slice(7), value);
  else need(n.record, ref.startsWith("record.") ? ref.slice(7) : ref, value);
}
function templateRefs(n: Needs, t: string) {
  for (const v of templateVariables(t)) if (v.startsWith("record.") || v.startsWith("parent.")) addRef(n, v);
}
function mappingRefs(n: Needs, m: FieldMapping) {
  if (typeof m === "string") return addRef(n, m);
  if (m.value !== undefined) return;
  if (m.template !== undefined) return templateRefs(n, m.template);
  if (m.path !== undefined) addRef(n, Array.isArray(m.path) ? m.path[0] : m.path);
}

/**
 * The fields a source record must hold for a resource: its filters (with
 * the value that passes), its mapped fields (required first), and what its
 * forEach children read from it as `{parent.…}`.
 */
function needsOf(def: ConnectorDefinition, spec: ResourceSpec, kind: ResourceKind): Needs {
  const n: Needs = { record: new Map(), parent: new Map() };
  for (const f of spec.where ?? []) {
    if (f.exists === false) continue;
    addRef(n, f.path, f.equals !== undefined ? f.equals : f.in?.length ? f.in[0] : f.prefix !== undefined ? `${f.prefix}x` : undefined);
  }
  const required = CANONICAL_FIELDS[kind].required;
  const rank = (field: string) => (required.includes(field) ? 0 : 1);
  for (const [, m] of Object.entries(spec.fields).sort(([a], [b]) => rank(a) - rank(b))) mappingRefs(n, m);
  if (spec.request) {
    templateRefs(n, spec.request.path);
    for (const v of Object.values(spec.request.query ?? {})) for (const t of [v].flat()) templateRefs(n, t);
  }
  for (const [childKind, child] of allSpecs(def)) if (child.forEach === kind) for (const [p] of needsOf(def, child, childKind).parent) need(n.record, p);
  return n;
}

function settingsFor(def: ConnectorDefinition): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const s of def.settings) {
    if (s.type === "url") out[s.key] = `https://${def.key}.contract.test`;
    else if (s.default !== undefined) out[s.key] = s.default;
    else if (s.type === "select") out[s.key] = s.options![0];
    else if (s.type === "number") out[s.key] = 1;
    else if (s.type === "boolean") out[s.key] = false;
    else if (s.required) out[s.key] = `s${s.key}`;
  }
  return out;
}

function secretsFor(def: ConnectorDefinition, tag: string): Record<string, string> {
  return def.auth.type === "none" ? {} : Object.fromEntries(def.auth.fields.map((f) => [f.key, `Sec${tag}${f.key}Zq9`]));
}

type Call = { url: URL; method: string; headers: Record<string, string>; body?: string; token: boolean; route?: Route; kind?: ResourceKind };

/** Everything a request carries that could hold a credential, Basic decoded. */
function material(call: Call): string {
  const parts = [call.url.toString(), call.body ?? "", ...Object.values(call.headers)];
  for (const v of Object.values(call.headers)) {
    const m = /^Basic (.+)$/.exec(v);
    if (m) parts.push(Buffer.from(m[1], "base64").toString());
  }
  return parts.join("\n");
}

type Route = {
  key: string;
  method: string;
  re: RegExp;
  query: string[];
  pagination: Pagination;
  records: string;
  keyed: boolean;
  total?: string;
  specs: { kind: ResourceKind; spec: ResourceSpec; needs: Needs }[];
};

/** The requests a definition makes, one route per method, path and query names (several resources may share one). */
function routesOf(def: ConnectorDefinition, settings: Json): Route[] {
  const byKey = new Map<string, Route>();
  for (const [kind, spec] of allSpecs(def)) {
    const req = spec.request!;
    const method = req.method ?? "GET";
    const query = Object.keys(req.query ?? {}).sort();
    const key = `${method} ${req.path} ${query.join("&")}`;
    let route = byKey.get(key);
    if (!route) {
      const pattern = req.path
        .split(/(\{parent\.[^}]+\})/)
        .map((part) => (part.startsWith("{parent.") ? "([^/]+)" : escapeRe(fillTemplate(part, { settings }, { encode: true }))))
        .join("");
      const pagination = spec.pagination ?? { type: "none" };
      const records = Array.isArray(spec.records) ? spec.records[0] : (spec.records ?? (pagination.type === "scim" ? "Resources" : ""));
      route = { key, method, re: new RegExp(`^${pattern}$`), query, pagination, records, keyed: spec.recordsKeyed === true, total: spec.total, specs: [] };
      byKey.set(key, route);
    }
    route.specs.push({ kind, spec, needs: needsOf(def, spec, kind) });
  }
  return [...byKey.values()];
}

/** A fake of the system a definition reads: serves records shaped by the definition, paged as it pages. */
class FakeSource {
  readonly calls: Call[] = [];
  /** Every record (and unwound item) served, as JSON, for traceability checks. */
  readonly served = new Set<string>();
  readonly routes: Route[];
  readonly testPath: string;
  readonly tokenPath: string | null;
  kind?: ResourceKind;
  count: (route: Route) => number = (r) => 2 * r.specs.length;
  duplicate = false;
  /** Return a response (or throw) to replace the normal answer to call `index`. */
  fault?: (call: Call, index: number) => Response | undefined;
  private tokens = 0;

  constructor(
    readonly def: ConnectorDefinition,
    readonly settings: Json,
  ) {
    this.routes = routesOf(def, settings);
    this.testPath = def.test?.request ? fillTemplate(def.test.request.path, { settings }, { encode: true }) : "";
    const auth = def.auth;
    this.tokenPath = auth.type === "oauth2_client_credentials" ? new URL(fillTemplate(auth.tokenUrl, { settings }), String(settings.baseUrl)).pathname : null;
  }

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const call: Call = { url: u, method, headers: { ...(init.headers ?? {}) }, body: init.body, token: method === "POST" && u.pathname === this.tokenPath, kind: this.kind };
    if (!call.token) call.route = this.match(u, method);
    this.calls.push(call);
    const injected = this.fault?.(call, this.calls.length - 1);
    if (injected) return injected;
    if (call.token) return json({ access_token: `tok${++this.tokens}`, expires_in: 300 });
    if (call.route) return this.respond(call.route, u, init.body);
    if (u.pathname === this.testPath) return json({ ok: true });
    if (method !== "GET") return new Response(null, { status: 204 });
    return new Response("{}", { status: 404 });
  };

  private match(u: URL, method: string): Route | undefined {
    const candidates = this.routes.filter((r) => r.method === method && r.re.test(u.pathname) && r.query.every((k) => u.searchParams.has(k)));
    return candidates.sort((a, b) => b.query.length - a.query.length)[0];
  }

  private records(route: Route, seed: string): Json[] {
    const n = this.count(route);
    const out: Json[] = [];
    for (let j = 0; out.length < n; j++) {
      const built = route.specs.map(({ spec, needs }, i) => {
        const s = `${seed}x${j}y${i}`;
        if (!spec.unwind) return build(needs.record, s);
        const parent = build(needs.parent, `${s}p`);
        setPath(parent, spec.unwind, [build(needs.record, `${s}a`), build(needs.record, `${s}b`)]);
        return parent;
      });
      for (let i = 0; i < built.length && out.length < n; i++) out.push(merge(...built.filter((_, x) => x !== i), built[i]));
    }
    return out;
  }

  private respond(route: Route, u: URL, body?: string): Response {
    const parts = [...(route.re.exec(u.pathname) ?? []).slice(1), ...route.query.map((k) => u.searchParams.getAll(k).join(""))];
    const seed = `r${this.routes.indexOf(route)}${parts.join("").replace(/[^A-Za-z0-9]/g, "")}`;
    let all = this.records(route, seed);
    if (this.duplicate) all = [...all, ...all];
    const p = route.pagination;
    const q = u.searchParams;
    const headers: Record<string, string> = {};
    let from = 0;
    let size = all.length;
    let finish: ((out: Json) => void) | null = null;
    switch (p.type) {
      case "page":
        size = p.sizeParam ? Number(q.get(p.sizeParam)) : p.size;
        from = (Number(q.get(p.param)) - (p.start ?? 1)) * size;
        break;
      case "offset": {
        const src = p.in === "body" ? (JSON.parse(body ?? "{}") as Json) : Object.fromEntries(q);
        from = Number(src[p.param]);
        size = Number(src[p.sizeParam]);
        break;
      }
      case "cursor": {
        from = Number(q.get(p.param) ?? 0);
        size = p.size ?? all.length;
        const next = from + size < all.length ? String(from + size) : "";
        finish = (out) => setPath(out, p.from, next);
        break;
      }
      case "link_header": {
        const k = Number(q.get("__page") ?? 0);
        size = p.size ?? all.length;
        from = k * size;
        if (from + size < all.length) {
          const next = new URL(u);
          next.searchParams.set("__page", String(k + 1));
          headers.link = `<${next}>; rel="next"`;
        }
        break;
      }
      case "scim":
        from = Number(q.get("startIndex")) - 1;
        size = Number(q.get("count"));
        finish = (out) => void (out.totalResults = all.length);
        break;
    }
    const page = all.slice(from, from + size);
    for (const r of page) {
      this.served.add(JSON.stringify(r));
      for (const { spec } of route.specs) if (spec.unwind) for (const item of [readPath(r, spec.unwind)].flat()) if (isPlain(item)) this.served.add(JSON.stringify(item));
    }
    const list = route.keyed ? Object.fromEntries(page.map((r, i) => [`k${from + i}`, r])) : page;
    let out: unknown = list;
    if (route.records) {
      const wrapped: Json = {};
      setPath(wrapped, route.records, list);
      out = wrapped;
    }
    if (finish) finish(out as Json);
    if (route.total?.startsWith("header:")) headers[route.total.slice(7)] = String(all.length);
    else if (route.total) setPath(out as Json, route.total, all.length);
    return json(out, headers);
  }
}

const pageSize = (p: Pagination): number => (p.type === "none" ? 0 : p.type === "link_header" || p.type === "cursor" ? (p.size ?? 0) : p.size);

// ---------------------------------------------------------------- http: every built-in, generated

const HTTP_DEFS = BUILTIN_DEFINITIONS.filter((d) => d.driver === "http");
const WRITE_CAPABILITY: Record<DefinitionWriteOperation, string> = { revoke_access: "revokeAccess", disable_account: "disableAccount", grant_access: "grantAccess", create_account: "createAccount" };

describe("contract: the generated http fixtures", () => {
  it("cover every http built-in", () => {
    expect(HTTP_DEFS.length).toBeGreaterThan(0);
    for (const def of HTTP_DEFS) expect(routesOf(def, settingsFor(def)).length).toBeGreaterThan(0);
  });
});

for (const def of HTTP_DEFS) {
  describe(`contract: http connector ${def.key}`, () => {
    const settings = settingsFor(def);
    const config = builtin(def, settings);
    const secretsA = secretsFor(def, "A");
    const secretsB = secretsFor(def, "B");
    const oauth = def.auth.type === "oauth2_client_credentials";
    const kinds = kindsOf(def);
    const first = kinds[0];

    const connect = async (src: FakeSource, secrets = secretsA) => {
      const c = new DefinitionConnector({ http: httpDriver(src.fetch) });
      await c.authenticate(config, JSON.stringify(secrets));
      return c;
    };
    const importAll = async (c: DefinitionConnector, src: FakeSource) => {
      const out = {} as Record<ResourceKind, Awaited<ReturnType<DefinitionConnector["importKind"]>>>;
      for (const k of kinds) {
        src.kind = k;
        out[k] = await c.importKind(k);
      }
      return out;
    };
    const failure = (c: DefinitionConnector, k: ResourceKind) => c.importKind(k).then(() => null, (e: unknown) => e as ConnectorRequestError);

    it("authentication: every request carries the configured credential; a 401 fails truthfully without it", async () => {
      const src = new FakeSource(def, settings);
      const c = await connect(src);
      expect(await c.testConnection()).toEqual({ ok: true });
      await importAll(c, src);
      for (const call of src.calls) {
        // Credentials never travel in the address, where a log could keep them.
        for (const v of Object.values(secretsA)) expect(call.url.toString()).not.toContain(v);
        if (call.token) for (const v of Object.values(secretsA)) expect(material(call)).toContain(v);
        else if (oauth) expect(call.headers.Authorization).toMatch(/^Bearer tok\d+$/);
        else for (const v of Object.values(secretsA)) expect(material(call)).toContain(v);
      }
      if (oauth) expect(src.calls[0].token).toBe(true);

      const denied = new FakeSource(def, settings);
      denied.fault = (x) => (x.token ? undefined : new Response("{}", { status: 401 }));
      const d = await connect(denied);
      const result = await d.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/failed: HTTP 401$/);
      // OAuth gets one new token and one more try; any other credential is not retried.
      expect(denied.calls.filter((x) => !x.token)).toHaveLength(oauth ? 2 : 1);
      denied.kind = first;
      const err = await failure(d, first);
      expect(err).toBeInstanceOf(ConnectorRequestError);
      expect(err!.status).toBe(401);
      expect(classifyOutboundError(err)).toEqual({ outcome: "error", category: "auth" });
      for (const v of Object.values(secretsA)) {
        expect(result.message).not.toContain(v);
        expect(err!.message).not.toContain(v);
      }
      if (oauth) {
        const refused = new FakeSource(def, settings);
        refused.fault = (x) => (x.token ? new Response('{"error":"invalid_client"}', { status: 401 }) : undefined);
        const r = await (await connect(refused)).testConnection();
        expect(r).toEqual({ ok: false, message: "Getting an access token failed: HTTP 401" });
      }
    });

    it("discovery: the test request is one cheap read of its own address, and the declared capabilities match the resources", async () => {
      const test = def.test?.request;
      expect(test).toBeDefined();
      expect(["GET", "POST"]).toContain(test!.method ?? "GET");
      const src = new FakeSource(def, settings);
      const c = await connect(src);
      expect(await c.testConnection()).toEqual({ ok: true });
      const sent = src.calls.filter((x) => !x.token);
      expect(sent).toHaveLength(1);
      expect([sent[0].method, sent[0].url.origin, sent[0].url.pathname]).toEqual([test!.method ?? "GET", new URL(String(settings.baseUrl)).origin, src.testPath]);

      expect(c.kinds()).toEqual(RESOURCE_KINDS.filter((k) => def.resources[k] !== undefined));
      const r = def.resources;
      expect(capabilitiesOf(def)).toEqual({
        importIdentities: Boolean(r.identity),
        importAccounts: Boolean(r.account),
        importEntitlements: Boolean(r.entitlement),
        importAccess: Boolean(r.access_grant),
        importApplications: Boolean(r.application),
        importPolicies: Boolean(r.policy),
        importActivity: false,
        provision: false,
        deprovision: false,
      });
      // Reads read: no resource request may change anything.
      for (const [, spec] of allSpecs(def)) expect(["GET", "POST"]).toContain(spec.request?.method ?? "GET");
      // Writes are declared by the definition only, and never on by default.
      const declared = Object.keys(def.write ?? {}) as DefinitionWriteOperation[];
      const writes = writeCapabilitiesOf(def) as Record<string, boolean>;
      for (const op of Object.keys(WRITE_CAPABILITY) as DefinitionWriteOperation[]) {
        expect(writes[WRITE_CAPABILITY[op]]).toBe(declared.includes(op));
        expect((capabilitiesOf(def) as Record<string, unknown>)[WRITE_CAPABILITY[op]]).toBeUndefined();
      }
      if (!def.write) expect(Object.values(writes).some(Boolean)).toBe(false);
    });

    it("pagination: every page is read and the read stops after the last; a failed later page fails the read", async () => {
      const paged = routesOf(def, settings).filter((r) => r.pagination.type !== "none");
      if (paged.length === 0) {
        expect(gapFor(def, "pagination")).toBeDefined();
        return;
      }
      for (const route of paged) {
        const size = pageSize(route.pagination);
        expect(size).toBeGreaterThan(0);
        const { kind, spec, needs } = route.specs[0];
        const scope = { settings, ...(spec.forEach ? { parent: build(needs.parent, "parent") } : {}) };

        const src = new FakeSource(def, settings);
        src.count = (r) => (r.key === route.key ? size + 1 : 1);
        const session = await httpDriver(src.fetch)(def, settings, secretsA);
        const report = { truncated: false, unread: false };
        const records = await session.fetch(spec, scope, LIMITS.defaultMaxRecords, kind, report);
        expect(records).toHaveLength(size + 1);
        expect(new Set(records.map((x) => JSON.stringify(x))).size).toBe(size + 1);
        expect(src.calls.filter((x) => x.route?.key === route.key)).toHaveLength(2);
        expect(report.truncated).toBe(false);

        const broken = new FakeSource(def, settings);
        broken.count = src.count;
        let pages = 0;
        broken.fault = (x) => (x.route?.key === route.key && ++pages === 2 ? new Response("{}", { status: 502 }) : undefined);
        const s2 = await httpDriver(broken.fetch)(def, settings, secretsA);
        await expect(s2.fetch(spec, scope, LIMITS.defaultMaxRecords, kind, { truncated: false, unread: false })).rejects.toMatchObject({ status: 502 });
      }
    });

    it("partial failure: a failed request fails its kind, never a silent success; a capped read is reported truncated", async () => {
      const clean = new FakeSource(def, settings);
      await importAll(await connect(clean), clean);
      for (const kind of kinds) {
        const last = clean.calls.map((x, i) => [x.kind, i] as const).filter(([k]) => k === kind).pop()![1];
        const src = new FakeSource(def, settings);
        src.fault = (_x, i) => (i === last ? new Response("{}", { status: 500 }) : undefined);
        const run = await connect(src);
        for (const k of kinds) {
          src.kind = k;
          if (k !== kind) {
            await run.importKind(k);
            continue;
          }
          const err = await failure(run, k);
          expect(err).toBeInstanceOf(ConnectorRequestError);
          expect(err!.status).toBe(500);
          for (const v of Object.values(secretsA)) expect(err!.message).not.toContain(v);
          break;
        }
      }

      const complete = await connect(new FakeSource(def, settings));
      await complete.importKind(first);
      expect(complete.readReport(first)).toEqual({ truncated: false, unread: false });
      const capped = structuredClone(def);
      specsOf(capped, first).forEach((s) => (s.maxRecords = 1));
      const c = new DefinitionConnector({ http: httpDriver(new FakeSource(def, settings).fetch) });
      await c.authenticate(custom(capped, settings), JSON.stringify(secretsA));
      await c.importKind(first);
      expect(c.readReport(first).truncated).toBe(true);
    });

    it("retry: a transient read failure is reported after one attempt, not resent", async () => {
      expect(gapFor(def, "retry")).toBeDefined();
      const failures: (() => Response)[] = [
        () => new Response("{}", { status: 503 }),
        () => {
          throw new TypeError("fetch failed");
        },
      ];
      for (const fail of failures) {
        const src = new FakeSource(def, settings);
        let failed = -1;
        src.fault = (x, i) => {
          if (failed >= 0 || x.token) return undefined;
          failed = i;
          return fail();
        };
        const c = await connect(src);
        src.kind = first;
        await expect(c.importKind(first)).rejects.toThrow(/HTTP 503|fetch failed/);
        const target = src.calls[failed];
        expect(src.calls.filter((x) => x.url.toString() === target.url.toString() && x.method === target.method)).toHaveLength(1);
      }
    });

    it("rate limiting: the Gateway paces requests at the definition's rate; a 429 is reported, not waited out", async () => {
      const run = async (src: FakeSource) => {
        const sleeps: number[] = [];
        const gateway = openGateway(
          { tenantId: "tenant-contract", integrationId: "int-contract", status: "connected" },
          { transport: (url, init) => src.fetch(url, init), sleep: async (ms) => void sleeps.push(ms), now: () => 0, allowedHosts: [] },
        );
        const c = new DefinitionConnector(gateway.drivers);
        await c.authenticate(config, JSON.stringify(secretsA));
        return { c, sleeps };
      };
      const src = new FakeSource(def, settings);
      const { c, sleeps } = await run(src);
      expect(await c.testConnection()).toEqual({ ok: true });
      src.kind = first;
      await c.importKind(first);
      const rate = def.rateLimitPerSecond ?? 10;
      expect(src.calls.length).toBeGreaterThan(1);
      // A fixed clock: request k waits (k-1) tokens' worth, so nothing goes faster than the rate.
      expect(sleeps).toEqual(src.calls.slice(1).map((_, i) => Math.ceil(((i + 1) / rate) * 1000)));

      const limited = new FakeSource(def, settings);
      let hit = -1;
      limited.fault = (x, i) => {
        if (hit >= 0 || x.token) return undefined;
        hit = i;
        return new Response("{}", { status: 429, headers: { "Retry-After": "5" } });
      };
      const l = await run(limited);
      limited.kind = first;
      const err = await failure(l.c, first);
      expect(err!.status).toBe(429);
      expect(classifyOutboundError(err).category).toBe("rate_limited");
      expect(limited.calls.filter((x) => x.url.toString() === limited.calls[hit].url.toString())).toHaveLength(1);
      expect(l.sleeps).not.toContain(5000);
      expect(gapFor(def, "rate_limiting")).toBeDefined();
    });

    it("idempotency: a re-run reads the same records, and a record the source repeats is kept once", async () => {
      const ids = async (src: FakeSource) => {
        const all = await importAll(await connect(src), src);
        return Object.fromEntries(kinds.map((k) => [k, all[k].map((r) => r.externalId).sort()]));
      };
      const once = await ids(new FakeSource(def, settings));
      expect(await ids(new FakeSource(def, settings))).toEqual(once);
      const repeated = new FakeSource(def, settings);
      repeated.duplicate = true;
      expect(await ids(repeated)).toEqual(once);
    });

    it("credential rotation: new secrets take effect on the next session, with nothing of the old ones", async () => {
      const src = new FakeSource(def, settings);
      const c = await connect(src, secretsA);
      expect(await c.testConnection()).toEqual({ ok: true });
      await c.close();
      const mark = src.calls.length;
      await c.authenticate(config, JSON.stringify(secretsB));
      expect(await c.testConnection()).toEqual({ ok: true });
      src.kind = first;
      await c.importKind(first);
      const after = src.calls.slice(mark);
      const sent = after.map(material).join("\n");
      for (const v of Object.values(secretsB)) expect(sent).toContain(v);
      for (const v of Object.values(secretsA)) expect(sent).not.toContain(v);
      if (oauth) {
        expect(after[0].token).toBe(true);
        expect(after.filter((x) => !x.token).every((x) => x.headers.Authorization === "Bearer tok2")).toBe(true);
        // A token the system revokes mid-run is replaced once.
        const revoking = new FakeSource(def, settings);
        let revoked = false;
        revoking.fault = (x) => {
          if (x.token || revoked) return undefined;
          revoked = true;
          return new Response("", { status: 401 });
        };
        expect(await (await connect(revoking)).testConnection()).toEqual({ ok: true });
        expect(revoking.calls.map((x) => (x.token ? "token" : x.headers.Authorization))).toEqual(["token", "Bearer tok1", "token", "Bearer tok2"]);
      }
    });

    it("traceability: every record keeps its source record (and parent) and its source id", async () => {
      const src = new FakeSource(def, settings);
      const c = await connect(src);
      const all = await importAll(c, src);
      expect(c.drainIssues()).toEqual([]);
      for (const kind of kinds) {
        const specs = specsOf(def, kind);
        const nested = specs.every((s) => s.forEach || s.unwind);
        const flat = specs.every((s) => !s.forEach && !s.unwind);
        expect(all[kind].length).toBeGreaterThan(0);
        for (const r of all[kind]) {
          expect(r.externalId).not.toBe("");
          expect(r.normalized!.externalId).toBe(r.externalId);
          if (kind === "account" || kind === "entitlement") expect(r.normalized!.application).toBeTruthy();
          const parent = (r.raw as Json)._parent;
          expect(src.served.has(JSON.stringify(without(r.raw, "_parent", "_key")))).toBe(true);
          if (parent !== undefined) expect(src.served.has(JSON.stringify(without(parent, "_key")))).toBe(true);
          if (nested) expect(parent).toBeDefined();
          if (flat) expect(parent).toBeUndefined();
        }
      }
    });

    if (def.write) {
      const write = def.write;
      it("writes: every change carries the idempotency key, a repeat carries the same one; a failure is resent only when safe", async () => {
        const target = { account: "acct-1", entitlement: "ent-1", email: "dee@contract.test", username: "dee", displayName: "Dee" };
        for (const op of Object.keys(write) as DefinitionWriteOperation[]) {
          const src = new FakeSource(def, settings);
          const c = await connect(src);
          await c.write(op, target, "attempt-0001");
          await c.write(op, target, "attempt-0001");
          const sent = src.calls.filter((x) => !x.token);
          expect(sent.map((x) => [x.method, x.headers["Idempotency-Key"]])).toEqual([
            [write[op]!.request!.method, "attempt-0001"],
            [write[op]!.request!.method, "attempt-0001"],
          ]);
          expect(sent[0].url.toString()).toBe(sent[1].url.toString());
          expect(sent[0].body).toBe(sent[1].body);
          for (const status of [503, 429]) {
            const failing = new FakeSource(def, settings);
            failing.fault = (x) => (x.token ? undefined : new Response("{}", { status }));
            const err = await (await connect(failing)).write(op, target, "attempt-0002").then(() => null, (e: unknown) => e as ConnectorRequestError);
            expect(err!.status).toBe(status);
            expect(failing.calls.filter((x) => !x.token)).toHaveLength(1);
            expect(retryableWrite(writeFailureKind({ status }), writeIsRepeatable(def, op))).toBe(status === 429 || write[op]!.repeatable === true);
          }
        }
        // Every attempt at one task sends the system the same key.
        const fp = requestFingerprint("revoke_access", target);
        expect(systemKey({ idempotencyKey: "attempt-0001", taskKey: "task-00000001" }, fp)).toBe(systemKey({ idempotencyKey: "attempt-0002", taskKey: "task-00000001" }, fp));
      });
    }
  });
}

// ---------------------------------------------------------------- the gateway around socket drivers

/** Runs a connector through a Gateway session with a fixed clock, returning the waits it imposed. */
const gatewayRun = async (opts: Parameters<typeof openGateway>[1], config: Parameters<DefinitionConnector["authenticate"]>[0], secrets: string | null, run: (c: DefinitionConnector) => Promise<unknown>) => {
  const sleeps: number[] = [];
  const gateway = openGateway({ tenantId: "tenant-contract", integrationId: "int-contract", status: "connected" }, { ...opts, sleep: async (ms) => void sleeps.push(ms), now: () => 0, allowedHosts: [] });
  const c = new DefinitionConnector(gateway.drivers);
  await c.authenticate(config, secrets);
  await run(c);
  return sleeps;
};

// ---------------------------------------------------------------- ldap

const ldapDef = BUILTIN_DEFINITIONS.find((d) => d.key === "ldap-directory")!;

describe("contract: ldap connector ldap-directory", () => {
  const settings = { url: "ldaps://dir.contract.test", baseDn: "dc=contract,dc=test" };
  const config = builtin(ldapDef, settings);
  const secrets = (tag: string) => ({ bindDn: `cn=wonderid${tag},dc=contract,dc=test`, password: `Pw${tag}Zq9` });
  const people = "(objectClass=inetOrgPerson)";
  const groups = "(|(objectClass=groupOfNames)(objectClass=group))";
  const ana = { dn: "uid=ana,ou=People,dc=contract,dc=test", uid: ["ana"], mail: ["ANA@CONTRACT.TEST"], cn: ["Ana"] };
  const bo = { dn: "uid=bo,ou=People,dc=contract,dc=test", uid: ["bo"], mail: ["bo@contract.test"], cn: ["Bo"] };
  const fin = { dn: "cn=finance,ou=Groups,dc=contract,dc=test", cn: ["finance"], member: [ana.dn, bo.dn] };

  beforeEach(() => {
    ldap.clients.length = 0;
    ldap.entries = { [people]: [ana, bo], [groups]: [fin], "(objectClass=*)": [{ dn: settings.baseDn }] };
    ldap.bindError = null;
    ldap.failFilter = null;
    ldap.modifyCode = null;
  });
  const connect = async (tag = "A", def: ConnectorDefinition = ldapDef) => {
    const c = new DefinitionConnector({ ldap: ldapDriver });
    await c.authenticate(def === ldapDef ? config : custom(def, settings), JSON.stringify(secrets(tag)));
    return c;
  };

  it("authentication: binds over verified LDAPS with the secrets; a refused bind fails without the password", async () => {
    const c = await connect();
    expect(await c.testConnection()).toEqual({ ok: true });
    expect(ldap.clients[0].binds).toEqual([[secrets("A").bindDn, secrets("A").password]]);
    expect(ldap.clients[0].options).toMatchObject({ url: "ldaps://203.0.113.10:636", tlsOptions: { servername: "dir.contract.test", rejectUnauthorized: true } });
    ldap.bindError = Object.assign(new Error("Invalid Credentials"), { name: "InvalidCredentialsError", code: 49 });
    const denied = await (await connect()).testConnection();
    expect(denied.ok).toBe(false);
    expect(denied.message).not.toContain(secrets("A").password);
    expect(classifyOutboundError(ldap.bindError).category).toBe("auth");
  });

  it("discovery: the test is one base search; capabilities and the declared changes match the definition", async () => {
    const c = await connect();
    await c.testConnection();
    expect(ldap.clients[0].searches).toEqual([{ base: settings.baseDn, options: expect.objectContaining({ scope: "base", filter: "(objectClass=*)", sizeLimit: 1 }) }]);
    expect(capabilitiesOf(ldapDef)).toMatchObject({ importAccounts: true, importEntitlements: true, importAccess: true, importIdentities: false, provision: false, deprovision: false });
    expect(writeCapabilitiesOf(ldapDef)).toEqual({ revokeAccess: true, grantAccess: true, disableAccount: false, createAccount: false, deprovision: true, provision: true });
  });

  it("pagination: searches ask for paged results and a size limit; a read at the limit is truncated", async () => {
    const c = await connect();
    expect(await c.importKind("account")).toHaveLength(2);
    expect(ldap.clients[0].searches[0].options).toMatchObject({ filter: people, paged: { pageSize: 500 }, sizeLimit: LIMITS.defaultMaxRecords });
    expect(c.readReport("account").truncated).toBe(false);
    const capped = structuredClone(ldapDef);
    specsOf(capped, "account").forEach((s) => (s.maxRecords = 2));
    const d = await connect("A", capped);
    await d.importKind("account");
    expect(ldap.clients[1].searches[0].options).toMatchObject({ paged: { pageSize: 2 }, sizeLimit: 2 });
    expect(d.readReport("account").truncated).toBe(true);
    expect(gapFor(ldapDef, "pagination")).toBeDefined();
  });

  it("partial failure and retry: a failed search fails its kind once, others still read", async () => {
    ldap.failFilter = groups;
    const c = await connect();
    expect(await c.importKind("account")).toHaveLength(2);
    await expect(c.importKind("entitlement")).rejects.toThrow("Busy");
    expect(ldap.clients[0].searches.filter((s) => s.options.filter === groups)).toHaveLength(1);
    expect(gapFor(ldapDef, "retry")).toBeDefined();
  });

  it("rate limiting: the Gateway paces the connect, the test and each search", async () => {
    const sleeps = await gatewayRun({ socketDrivers: { ldap: ldapDriver } }, config, JSON.stringify(secrets("A")), async (c) => {
      await c.testConnection();
      await c.importKind("account");
    });
    const rate = ldapDef.rateLimitPerSecond ?? 10;
    expect(sleeps).toEqual([1, 2].map((k) => Math.ceil((k / rate) * 1000)));
  });

  it("idempotency: a change already in place counts as done; anything else fails without the password", async () => {
    expect(writeIsRepeatable(ldapDef, "grant_access")).toBe(true);
    expect(writeIsRepeatable(ldapDef, "revoke_access")).toBe(true);
    const target = { account: ana.dn, entitlement: fin.dn };
    const c = await connect();
    ldap.modifyCode = 20;
    await expect(c.write("grant_access", target, "attempt-0001")).resolves.toEqual({});
    ldap.modifyCode = 16;
    await expect(c.write("revoke_access", target, "attempt-0002")).resolves.toEqual({});
    ldap.modifyCode = 50;
    const err = await c.write("revoke_access", target, "attempt-0003").then(() => null, (e: Error) => e);
    expect(err!.message).toBe("The directory refused the change (LDAP result 50)");
    expect(ldap.clients[0].modifies).toEqual([fin.dn, fin.dn, fin.dn]);
    const first = (await (await connect()).importKind("account")).map((r) => r.externalId);
    expect((await (await connect()).importKind("account")).map((r) => r.externalId)).toEqual(first);
  });

  it("credential rotation: the next session binds with the new secrets, and the old one is closed", async () => {
    const c = await connect("A");
    await c.testConnection();
    await c.close();
    await c.authenticate(config, JSON.stringify(secrets("B")));
    await c.testConnection();
    expect(ldap.clients[0].unbound).toBe(true);
    expect(ldap.clients[1].binds).toEqual([[secrets("B").bindDn, secrets("B").password]]);
  });

  it("traceability: records are keyed by DN and keep the entry; memberships keep their group", async () => {
    const c = await connect();
    const accounts = await c.importKind("account");
    expect(accounts.map((r) => [r.externalId, r.raw])).toEqual([
      [ana.dn, ana],
      [bo.dn, bo],
    ]);
    const grants = await c.importKind("access_grant");
    expect(grants.map((r) => [r.normalized!.accountExternalId, (r.raw as Json)._parent])).toEqual([
      [ana.dn, fin],
      [bo.dn, fin],
    ]);
  });
});

// ---------------------------------------------------------------- sql

const sqlDef = BUILTIN_DEFINITIONS.find((d) => d.key === "postgresql")!;

describe("contract: sql connector postgresql", () => {
  const settings = { url: "postgres://db.contract.test:5432/app" };
  const config = builtin(sqlDef, settings);
  const secrets = (tag: string) => ({ username: `login${tag}`, password: `Pw${tag}Zq9` });
  const anaRow = { rolname: "ana", privileged: false, status: "active", valid_until: null, comment: "Ana" };

  beforeEach(() => {
    pg.clients.length = 0;
    pg.rows = {
      test: [{ current_user: "loginA" }],
      account: [anaRow, { rolname: "bo", privileged: true, status: "active", valid_until: null, comment: null }],
      entitlement: [{ rolname: "finance", comment: null, privileges: "SELECT on public.ledger", writes: false }],
      access_grant: [{ member: "ana", role: "finance" }],
    };
    pg.connectError = null;
    pg.failOn = null;
  });
  const connect = async (tag = "A", def: ConnectorDefinition = sqlDef) => {
    const c = new DefinitionConnector({ sql: sqlDriver });
    await c.authenticate(def === sqlDef ? config : custom(def, settings), JSON.stringify(secrets(tag)));
    return c;
  };

  it("authentication: logs in with the secrets over verified TLS; a refused login fails without the password", async () => {
    const c = await connect();
    expect(await c.testConnection()).toEqual({ ok: true });
    expect(pg.clients[0].config).toMatchObject({ host: "203.0.113.10", port: 5432, database: "app", user: "loginA", password: "PwAZq9", ssl: { rejectUnauthorized: true, servername: "db.contract.test" } });
    pg.connectError = Object.assign(new Error('password authentication failed for user "loginA"'), { code: "28P01" });
    const denied = await (await connect()).testConnection();
    expect(denied.ok).toBe(false);
    expect(denied.message).not.toContain("PwAZq9");
    expect(classifyOutboundError(pg.connectError).category).toBe("auth");
  });

  it("discovery: the test is one read-only statement; the connector declares reads and can never write", async () => {
    const c = await connect();
    await c.testConnection();
    expect(pg.clients[0].queries).toEqual(["BEGIN READ ONLY", "SELECT * FROM (SELECT current_user) AS wonderid_source LIMIT 1", "ROLLBACK"]);
    expect(capabilitiesOf(sqlDef)).toMatchObject({ importAccounts: true, importEntitlements: true, importAccess: true, provision: false, deprovision: false });
    expect(Object.values(writeCapabilitiesOf(sqlDef)).some(Boolean)).toBe(false);
    const writing = { ...sqlDef, write: { revoke_access: { request: { method: "DELETE", path: "/{target.account}/{target.entitlement}" } } } };
    expect(validateDefinition(writing).issues.map((i) => i.message).join()).toMatch(/only an http or ldap connector can write/);
  });

  it("pagination: one statement cut at the record limit; a result at the limit is truncated", async () => {
    const c = await connect();
    await c.importKind("account");
    expect(pg.clients[0].queries[1]).toMatch(new RegExp(`LIMIT ${LIMITS.defaultMaxRecords}$`));
    expect(c.readReport("account").truncated).toBe(false);
    const capped = structuredClone(sqlDef);
    specsOf(capped, "account").forEach((s) => (s.maxRecords = 2));
    const d = await connect("A", capped);
    await d.importKind("account");
    expect(pg.clients[1].queries[1]).toMatch(/LIMIT 2$/);
    expect(d.readReport("account").truncated).toBe(true);
    expect(gapFor(sqlDef, "pagination")).toBeDefined();
  });

  it("partial failure and retry: a failed statement fails its kind once and still rolls back", async () => {
    pg.failOn = /AS member, r\.rolname AS role/;
    const c = await connect();
    expect(await c.importKind("account")).toHaveLength(2);
    await expect(c.importKind("access_grant")).rejects.toThrow(/statement timeout/);
    const q = pg.clients[0].queries;
    expect(q.filter((s) => pg.failOn!.test(s))).toHaveLength(1);
    expect(q[q.length - 1]).toBe("ROLLBACK");
    expect(gapFor(sqlDef, "retry")).toBeDefined();
  });

  it("rate limiting: the Gateway paces the connect, the test and each statement", async () => {
    const sleeps = await gatewayRun({ socketDrivers: { sql: sqlDriver } }, config, JSON.stringify(secrets("A")), async (c) => {
      await c.testConnection();
      await c.importKind("account");
    });
    const rate = sqlDef.rateLimitPerSecond ?? 10;
    expect(sleeps).toEqual([1, 2].map((k) => Math.ceil((k / rate) * 1000)));
  });

  it("idempotency: every read runs in a read-only transaction that is rolled back; a repeated row is kept once", async () => {
    pg.rows.account = [anaRow, anaRow];
    const c = await connect();
    expect(await c.importKind("account")).toHaveLength(1);
    expect(pg.clients[0].queries.filter((s) => !/^(BEGIN READ ONLY|ROLLBACK)$/.test(s)).every((s) => s.startsWith("SELECT * FROM ("))).toBe(true);
    expect(pg.clients[0].queries.filter((s) => s === "BEGIN READ ONLY")).toHaveLength(pg.clients[0].queries.filter((s) => s === "ROLLBACK").length);
  });

  it("credential rotation: the next session logs in with the new secrets, and the old one is closed", async () => {
    const c = await connect("A");
    await c.testConnection();
    await c.close();
    await c.authenticate(config, JSON.stringify(secrets("B")));
    await c.testConnection();
    expect(pg.clients[0].ended).toBe(true);
    expect(pg.clients[1].config).toMatchObject({ user: "loginB", password: "PwBZq9" });
  });

  it("traceability: records are keyed by role name and keep the catalog row", async () => {
    const c = await connect();
    const grants = await c.importKind("access_grant");
    expect(grants).toEqual([{ externalId: "ana:finance", raw: { member: "ana", role: "finance" }, normalized: expect.objectContaining({ accountExternalId: "ana", entitlementExternalId: "finance" }) }]);
    expect((await c.importKind("account"))[0].raw).toEqual(anaRow);
  });
});

// ---------------------------------------------------------------- file (CSV)

const csvDef = BUILTIN_DEFINITIONS.find((d) => d.key === "csv-file")!;

describe("contract: file connector csv-file", () => {
  const people = "https://files.contract.test/people.csv?sig=SIGq1w2e3";
  const accounts = "https://files.contract.test/accounts.csv";
  const csv = "Employee ID,First Name,Work Email\nE1,Ada,ADA@X.TEST\nE2,Grace,grace@x.test\n";

  function files(map: Record<string, { status?: number; body: string }>) {
    const calls: { url: string; headers: Record<string, string>; maxBytes?: number }[] = [];
    const fetch: FileFetch = async (url, init) => {
      calls.push({ url, headers: init.headers ?? {}, maxBytes: init.maxBytes });
      const f = map[url];
      return new Response(f?.body ?? "", { status: f ? (f.status ?? 200) : 404 });
    };
    return { fetch, calls };
  }
  function uploads(initial: Partial<Record<ResourceKind, StoredFile>>) {
    const unread = { ...initial };
    const store: ConnectorFileStore = {
      newest: async (kind) => unread[kind] ?? null,
      markRead: async (kind) => void delete unread[kind],
    };
    return () => store;
  }
  const connect = async (fetch: FileFetch, settings: Json, token: string | null, store?: () => ConnectorFileStore) => {
    const c = new DefinitionConnector({ file: fileDriver({ fetch, store }) });
    await c.authenticate(builtin(csvDef, settings), token === null ? null : JSON.stringify({ token }));
    return c;
  };
  const ctx = { tenantId: "tenant-contract", integrationId: "int-contract" };
  const withContext = (driver: ReturnType<typeof fileDriver>): ReturnType<typeof fileDriver> => (def, s, sec) => driver(def, s, sec, ctx);

  it("authentication: the token goes to the address as a bearer; a 401 names the file but no query or token", async () => {
    const ok = files({ [people]: { body: csv } });
    await (await connect(ok.fetch, { identityUrl: people }, "TokAZq9")).importKind("identity");
    expect(ok.calls[0].headers.Authorization).toBe("Bearer TokAZq9");
    const anonymous = files({ [people]: { body: csv } });
    await (await connect(anonymous.fetch, { identityUrl: people }, null)).importKind("identity");
    expect(anonymous.calls[0].headers.Authorization).toBeUndefined();
    const denied = files({ [people]: { status: 401, body: "" } });
    const err = await (await connect(denied.fetch, { identityUrl: people }, "TokAZq9")).importKind("identity").then(() => null, (e: ConnectorRequestError) => e);
    expect(err!.message).toBe("GET files.contract.test/people.csv failed: HTTP 401");
    expect(err!.status).toBe(401);
    expect(classifyOutboundError(err).category).toBe("auth");
  });

  it("discovery: the test reads each configured address and nothing else; reads only, uploads declared", async () => {
    const f = files({ [people]: { body: csv } });
    const newest = vi.fn(async () => null);
    const c = new DefinitionConnector({ file: withContext(fileDriver({ fetch: f.fetch, store: () => ({ newest, markRead: async () => undefined }) })) });
    await c.authenticate(builtin(csvDef, { identityUrl: people }), null);
    expect(await c.testConnection()).toEqual({ ok: true });
    expect(f.calls.map((x) => x.url)).toEqual([people]);
    expect(newest).not.toHaveBeenCalled();
    expect(capabilitiesOf(csvDef)).toMatchObject({ importIdentities: true, importAccounts: true, importEntitlements: true, importAccess: true, importApplications: true, provision: false });
    expect(Object.values(writeCapabilitiesOf(csvDef)).some(Boolean)).toBe(false);
    expect(uploadTarget(csvDef, { identityUrl: people }, "account")).toMatchObject({ kind: "account" });
    expect(uploadTarget(csvDef, { identityUrl: people }, "identity")).toMatchObject({ status: 409 });
  });

  it("pagination: one capped file per kind", async () => {
    const f = files({ [people]: { body: csv } });
    await (await connect(f.fetch, { identityUrl: people }, null)).importKind("identity");
    expect(f.calls[0].maxBytes).toBe(10 * 1024 * 1024);
    expect(gapFor(csvDef, "pagination")).toBeDefined();
  });

  it("partial failure and retry: a malformed file fails its kind once; an unmappable row is reported with its row; no new upload is unread", async () => {
    const bad = files({ [people]: { body: 'id,email\n1,"a@x\n' } });
    const c = await connect(bad.fetch, { identityUrl: people }, null);
    await expect(c.importKind("identity")).rejects.toThrow(/row 2/);
    expect(bad.calls).toHaveLength(1);
    const partial = files({ [people]: { body: "id,email\n,nobody@x.test\n2,b@x.test\n" } });
    const p = await connect(partial.fetch, { identityUrl: people }, null);
    expect(await p.importKind("identity")).toHaveLength(1);
    expect(p.drainIssues()).toEqual([{ objectType: "identity", message: "identity: no value for externalId (row 2)" }]);
    const empty = new DefinitionConnector({ file: withContext(fileDriver({ fetch: bad.fetch, store: uploads({}) })) });
    await empty.authenticate(builtin(csvDef, {}), null);
    expect(await empty.importKind("account")).toEqual([]);
    expect(empty.readReport("account")).toEqual({ truncated: false, unread: true });
    expect(gapFor(csvDef, "retry")).toBeDefined();
  });

  it("rate limiting: the Gateway paces each download", async () => {
    const f = files({ [people]: { body: csv }, [accounts]: { body: "id,username\nA1,ada\n" } });
    const sleeps = await gatewayRun({ transport: (url, init) => f.fetch(url, init), fileStore: uploads({}) }, builtin(csvDef, { identityUrl: people, accountUrl: accounts }), null, (c) => c.testConnection());
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([Math.ceil((1 / (csvDef.rateLimitPerSecond ?? 10)) * 1000)]);
  });

  it("idempotency: an upload is read once (marked read when the run closes); a repeated row is kept once", async () => {
    const store = uploads({ account: { id: "file-1", filename: "accounts.csv", content: "id,username\nA1,ada\nA1,ada\n" } });
    const f = files({});
    const c = new DefinitionConnector({ file: withContext(fileDriver({ fetch: f.fetch, store })) });
    await c.authenticate(builtin(csvDef, {}), null);
    expect((await c.importKind("account")).map((r) => r.externalId)).toEqual(["A1"]);
    await c.close();
    await c.authenticate(builtin(csvDef, {}), null);
    expect(await c.importKind("account")).toEqual([]);
    expect(c.readReport("account").unread).toBe(true);
  });

  it("credential rotation: the next session sends the new token only", async () => {
    const f = files({ [people]: { body: csv } });
    const c = await connect(f.fetch, { identityUrl: people }, "TokAZq9");
    await c.importKind("identity");
    await c.authenticate(builtin(csvDef, { identityUrl: people }), JSON.stringify({ token: "TokBZq9" }));
    await c.importKind("identity");
    expect(f.calls.map((x) => x.headers.Authorization)).toEqual(["Bearer TokAZq9", "Bearer TokBZq9"]);
  });

  it("traceability: each record keeps its row and its row number", async () => {
    const f = files({ [people]: { body: csv } });
    const records = await (await connect(f.fetch, { identityUrl: people }, null)).importKind("identity");
    expect(records.map((r) => [r.externalId, (r.raw as Json)._row])).toEqual([
      ["E1", 2],
      ["E2", 3],
    ]);
  });
});

// ---------------------------------------------------------------- mcp

const mcpDef = BUILTIN_DEFINITIONS.find((d) => d.key === "mcp-server")!;

describe("contract: mcp connector mcp-server", () => {
  const settings = { baseUrl: "https://mcp.contract.test/mcp" };
  const config = builtin(mcpDef, settings);
  type Rpc = { method?: string; id?: number; params?: { cursor?: string } };
  function server(opts: { status?: number; failPage2?: boolean; duplicate?: boolean } = {}) {
    const calls: { headers: Record<string, string>; body: Rpc }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body ?? "{}") as Rpc;
      calls.push({ headers: init.headers ?? {}, body });
      if (opts.status) return new Response("{}", { status: opts.status });
      const reply = (result: unknown, extra: Record<string, string> = {}) => json({ jsonrpc: "2.0", id: body.id, result }, extra);
      switch (body.method) {
        case "initialize":
          return reply({ protocolVersion: "2025-06-18", serverInfo: { name: "finance-mcp", version: "1.0.0" } }, { "mcp-session-id": "s-1" });
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          if (!body.params?.cursor) return reply({ tools: [{ name: "get_report" }, ...(opts.duplicate ? [{ name: "get_report" }] : [])], nextCursor: "p2" });
          if (opts.failPage2) return new Response("{}", { status: 500 });
          return reply({ tools: [{ name: "delete_invoice", annotations: { destructiveHint: true } }] });
        default:
          return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
      }
    };
    return { fetchImpl, calls };
  }
  const connect = async (fetchImpl: FetchLike, token: string | null) => {
    const c = new DefinitionConnector({ mcp: mcpDriver(fetchImpl) });
    await c.authenticate(config, token === null ? null : JSON.stringify({ token }));
    return c;
  };

  it("authentication: the bearer goes on every call; a 401 fails without the token", async () => {
    const s = server();
    await (await connect(s.fetchImpl, "TokAZq9")).importKind("mcp_tool");
    expect(s.calls.every((x) => x.headers.Authorization === "Bearer TokAZq9")).toBe(true);
    const denied = server({ status: 401 });
    const err = await (await connect(denied.fetchImpl, "TokAZq9")).importKind("mcp_tool").then(() => null, (e: ConnectorRequestError) => e);
    expect(err!.message).toBe("MCP initialize failed: HTTP 401");
    expect(err!.status).toBe(401);
    expect(classifyOutboundError(err).category).toBe("auth");
  });

  it("discovery: the test opens a session and lists tools; nothing that acts is ever called", async () => {
    const s = server();
    const c = await connect(s.fetchImpl, null);
    expect(await c.testConnection()).toEqual({ ok: true });
    expect(s.calls.map((x) => x.body.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    for (const k of c.kinds()) await c.importKind(k);
    expect(new Set(s.calls.map((x) => x.body.method))).toEqual(new Set(["initialize", "notifications/initialized", "tools/list", "resources/list"]));
    expect(capabilitiesOf(mcpDef)).toMatchObject({ importActivity: true, provision: false, deprovision: false });
    expect(Object.values(writeCapabilitiesOf(mcpDef)).some(Boolean)).toBe(false);
  });

  it("pagination: list methods follow nextCursor to the end", async () => {
    const s = server();
    expect((await (await connect(s.fetchImpl, null)).importKind("mcp_tool")).map((t) => t.externalId)).toEqual(["get_report", "delete_invoice"]);
    expect(s.calls.filter((x) => x.body.method === "tools/list").map((x) => x.body.params?.cursor ?? null)).toEqual([null, "p2"]);
  });

  it("partial failure and retry: a failed later page fails the kind once; a list the server lacks is none", async () => {
    const s = server({ failPage2: true });
    const c = await connect(s.fetchImpl, null);
    await expect(c.importKind("mcp_tool")).rejects.toMatchObject({ status: 500 });
    expect(s.calls.filter((x) => x.body.params?.cursor === "p2")).toHaveLength(1);
    expect(await c.importKind("mcp_resource")).toEqual([]);
    expect(gapFor(mcpDef, "retry")).toBeDefined();
  });

  it("rate limiting: the Gateway paces every JSON-RPC call", async () => {
    const s = server();
    const sleeps = await gatewayRun({ transport: (url, init) => s.fetchImpl(url, init) }, config, null, (c) => c.testConnection());
    expect(s.calls).toHaveLength(3);
    expect(sleeps).toEqual([1, 2].map((k) => Math.ceil((k / (mcpDef.rateLimitPerSecond ?? 10)) * 1000)));
  });

  it("idempotency: the session is reused and a tool listed twice is kept once", async () => {
    const s = server({ duplicate: true });
    expect(await (await connect(s.fetchImpl, null)).importKind("mcp_tool")).toHaveLength(2);
    expect(s.calls.filter((x) => x.body.method !== "initialize").every((x) => x.headers["Mcp-Session-Id"] === "s-1")).toBe(true);
  });

  it("credential rotation: the next session opens anew with the new token", async () => {
    const s = server();
    const c = await connect(s.fetchImpl, "TokAZq9");
    await c.testConnection();
    const mark = s.calls.length;
    await c.authenticate(config, JSON.stringify({ token: "TokBZq9" }));
    await c.testConnection();
    const after = s.calls.slice(mark);
    expect(after[0].body.method).toBe("initialize");
    expect(after.every((x) => x.headers.Authorization === "Bearer TokBZq9")).toBe(true);
  });

  it("traceability: a tool keeps its declaration and the classification derived from it", async () => {
    const tools = await (await connect(server().fetchImpl, null)).importKind("mcp_tool");
    expect(tools[1]).toMatchObject({ externalId: "delete_invoice", raw: { name: "delete_invoice", annotations: { destructiveHint: true }, _operation: "write", _destructive: true }, normalized: { operation: "write", destructive: true } });
  });
});

// ---------------------------------------------------------------- receive-only and receiving channels

describe("contract: receiving connectors", () => {
  const receivers = BUILTIN_DEFINITIONS.filter((d) => d.receive && Object.keys(d.receive).length > 0);
  const secret = "wr_SecAZq9";
  const rotated = "wr_SecBZq9";
  const headersFor = (mode: "bearer" | "hmac_sha256", key: string, body: string, header = "x-wonderid-signature") =>
    new Headers(mode === "bearer" ? { authorization: `Bearer ${key}` } : { [header]: createHmac("sha256", key).update(body).digest("hex") });
  const event = { externalId: "evt-1", agentRef: "financebot", eventTime: "2026-10-10T10:00:00Z", action: "read", success: true, application: "Snowflake" };

  it("discovery: a receive-only connector reads nothing and calls nothing; what it receives is what it declares", async () => {
    for (const def of BUILTIN_DEFINITIONS.filter((d) => d.driver === "none")) {
      const c = new DefinitionConnector({});
      await c.authenticate(builtin(def, {}), null);
      expect(await c.testConnection()).toEqual({ ok: true, message: "Receives only" });
      expect(c.kinds()).toEqual([]);
      const caps = capabilitiesOf(def);
      expect(caps.importIdentities).toBe(Boolean(def.receive?.scim));
      expect(caps.importActivity).toBe(Boolean(def.receive?.runtimeEvents));
      expect(Object.values(writeCapabilitiesOf(def)).some(Boolean)).toBe(false);
    }
  });

  for (const def of receivers) {
    const r = def.receive!;
    const channels: [string, "bearer" | "hmac_sha256", string | undefined][] = [
      ...(r.runtimeEvents ? [["events", r.runtimeEvents.auth, r.runtimeEvents.signatureHeader] as [string, "bearer" | "hmac_sha256", string | undefined]] : []),
      ...(r.webhook ? [["webhook", r.webhook.auth, r.webhook.signatureHeader] as [string, "bearer" | "hmac_sha256", string | undefined]] : []),
      ...(r.file ? [["file", r.file.auth, r.file.signatureHeader] as [string, "bearer" | "hmac_sha256", string | undefined]] : []),
      ...(r.scim ? [["scim", "bearer", undefined] as [string, "bearer" | "hmac_sha256", string | undefined]] : []),
    ];
    it(`${def.key}: authentication and credential rotation: only the current receiving secret is accepted, per channel`, () => {
      expect(channels.length).toBeGreaterThan(0);
      const body = JSON.stringify(event);
      for (const [, mode, header] of channels) {
        expect(verifySender(mode, secret, body, headersFor(mode, secret, body, header), header)).toBe(true);
        expect(verifySender(mode, rotated, body, headersFor(mode, secret, body, header), header)).toBe(false);
        expect(verifySender(mode, rotated, body, headersFor(mode, rotated, body, header), header)).toBe(true);
        expect(verifySender(mode, secret, body, new Headers(), header)).toBe(false);
        if (mode === "hmac_sha256") expect(verifySender(mode, secret, `${body} `, headersFor(mode, secret, body, header), header)).toBe(false);
      }
    });
  }

  it("runtime events: a batch maps per event (partial failure), each keeps its sender id (traceability, idempotency)", () => {
    for (const def of receivers.filter((d) => d.receive?.runtimeEvents)) {
      const spec = def.receive!.runtimeEvents!;
      const records = eventRecords(spec, [event, { ...event, externalId: "evt-2", eventTime: "yesterday" }]);
      expect(Array.isArray(records)).toBe(true);
      const mapped = (records as unknown[]).map((x) => mapRuntimeEvent(spec, x));
      expect(mapped[0]).toMatchObject({ externalId: "evt-1", agentIdentityRef: "financebot" });
      expect(mapped[1]).toBe("eventTime: must be an ISO timestamp");
      expect(mapRuntimeEvent(spec, event)).toEqual(mapped[0]);
      expect(eventRecords(spec, Array(MAX_EVENTS_PER_REQUEST + 1).fill(event))).toMatch(/at most/);
    }
  });

  it("webhook: a redelivery carries the same id it is stored under", () => {
    const spec = BUILTIN_DEFINITIONS.find((d) => d.key === "webhook")!.receive!.webhook!;
    const payload = { id: "wh-42", type: "user.updated" };
    expect(readPath(payload, spec.externalId!)).toBe("wh-42");
    expect(readPath({ ...payload }, spec.externalId!)).toBe(readPath(payload, spec.externalId!));
  });

  it("scim-inbound: a pushed user maps to an identity under its SCIM id; lists are served in clamped pages", () => {
    const def = BUILTIN_DEFINITIONS.find((d) => d.key === "scim-inbound")!;
    const user = { schemas: [SCIM_USER_SCHEMA], userName: "Ana@Example.com", name: { givenName: "Ana" }, active: false };
    const fields = { ...(def.receive!.scim!.fields as Record<string, FieldMapping>), externalId: { value: "3f2c1a9e" } };
    expect(mapRecord("identity", fields, mappingScope(user))).toEqual({
      externalId: "3f2c1a9e",
      normalized: expect.objectContaining({ externalId: "3f2c1a9e", email: "ana@example.com", username: "Ana@Example.com", firstName: "Ana", status: "disabled" }),
    });
    expect(scimPage("1", "1000")).toEqual({ offset: 0, limit: SCIM_MAX_RESULTS });
    expect(scimPage("201", "50")).toEqual({ offset: 200, limit: 50 });
  });
});

// ---------------------------------------------------------------- coverage of the contract

describe("contract: every built-in is covered for every property, or has a documented gap", () => {
  const keys = new Set(BUILTIN_DEFINITIONS.map((d) => d.key));

  it("the GAPS table names real connectors and drivers, each property once", () => {
    const seen = new Set<string>();
    for (const g of GAPS) {
      const driver = g.scope.startsWith("driver:") ? g.scope.slice(7) : null;
      expect(driver === null ? keys.has(g.scope) : (CONNECTOR_DRIVERS as readonly string[]).includes(driver), g.scope).toBe(true);
      expect(CONTRACT_PROPERTIES).toContain(g.property);
      expect(g.reason.length).toBeGreaterThan(20);
      expect(seen.has(`${g.scope}|${g.property}`)).toBe(false);
      seen.add(`${g.scope}|${g.property}`);
    }
  });

  it("each connector and property is tested or a documented gap", () => {
    const missing: string[] = [];
    for (const def of BUILTIN_DEFINITIONS) {
      const tested = new Set([...TESTED_BY_DRIVER[def.driver], ...(TESTED_EXTRA[def.key] ?? [])]);
      for (const p of CONTRACT_PROPERTIES) if (!tested.has(p) && !gapFor(def, p)) missing.push(`${def.key}: ${p}`);
    }
    expect(missing).toEqual([]);
  });

  it("each non-http built-in has its own block above", () => {
    const covered = new Set(["ldap-directory", "postgresql", "csv-file", "mcp-server", "webhook", "runtime-gateway", "scim-inbound"]);
    expect(BUILTIN_DEFINITIONS.filter((d) => d.driver !== "http" && !covered.has(d.key)).map((d) => d.key)).toEqual([]);
  });
});
