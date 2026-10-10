import type { AuthSpec, ConnectorDefinition, HttpRequestSpec, Pagination } from "./types";
import { fillTemplate, readPath, type TemplateScope } from "./mapping";

/**
 * The http driver: requests, authentication and paging for a definition.
 * Pure of any WonderID dependency: the caller passes the fetch to use, so
 * production goes through the Connector Gateway (modules/integrations/gateway:
 * rate limit, request budget, SSRF guard, timeouts, size caps, traffic
 * accounting) and the unit tests use a fake.
 */

export type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

export class ConnectorRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Hard ceilings for one session, whatever a definition says. */
export const LIMITS = { requestsPerSession: 10_000, pagesPerResource: 2_000, defaultMaxRecords: 50_000 };

/** The url setting that is the base address: `baseUrl` if present, else the first url setting. */
export function baseUrlOf(def: ConnectorDefinition, settings: Record<string, unknown>): string {
  const urlKeys = def.settings.filter((s) => s.type === "url").map((s) => s.key);
  const key = urlKeys.includes("baseUrl") ? "baseUrl" : urlKeys[0];
  const value = key ? settings[key] : undefined;
  if (typeof value !== "string" || !value) throw new ConnectorRequestError("The connection has no base address");
  return value.replace(/\/+$/, "");
}

/** The origins a session may call: those of its url settings, nothing else. */
export function allowedOrigins(def: ConnectorDefinition, settings: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const s of def.settings) {
    if (s.type !== "url") continue;
    const v = settings[s.key];
    if (typeof v === "string" && v) {
      try {
        out.add(new URL(v).origin);
      } catch {
        /* validated elsewhere */
      }
    }
  }
  return out;
}

export function parseLinkNext(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part.trim());
    if (m) return m[1];
  }
  return null;
}

export class HttpSession {
  private token: { value: string; expiresAt: number } | null = null;
  requestCount = 0;
  private readonly base: string;
  private readonly origins: Set<string>;

  constructor(
    private readonly def: ConnectorDefinition,
    private readonly settings: Record<string, string | number | boolean>,
    private readonly secrets: Record<string, string>,
    private readonly fetchImpl: FetchLike,
  ) {
    this.base = baseUrlOf(def, settings);
    this.origins = allowedOrigins(def, settings);
  }

  private authScope(): TemplateScope {
    return { settings: this.settings, secret: this.secrets };
  }

  /** Resolves a relative path (or a same-origin absolute next-page URL) against the base. */
  resolve(pathOrUrl: string): URL {
    const url = /^https?:\/\//i.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(this.base + pathOrUrl);
    if (!this.origins.has(url.origin)) throw new ConnectorRequestError(`Refused a request to ${url.origin}: not this connection's address`);
    return url;
  }

  private async oauthToken(force = false): Promise<string> {
    const auth = this.def.auth as Extract<AuthSpec, { type: "oauth2_client_credentials" }>;
    if (!force && this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const scope = this.authScope();
    const tokenUrl = this.resolve(fillTemplate(auth.tokenUrl, scope));
    const clientId = fillTemplate(auth.clientId, scope);
    const clientSecret = fillTemplate(auth.clientSecret, scope);
    const form = new URLSearchParams({ grant_type: "client_credentials" });
    if (auth.scope) form.set("scope", auth.scope);
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    if (auth.clientAuth === "basic") headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
    else {
      form.set("client_id", clientId);
      form.set("client_secret", clientSecret);
    }
    this.requestCount++;
    const res = await this.fetchImpl(tokenUrl.toString(), { method: "POST", headers, body: form.toString() });
    if (!res.ok) throw new ConnectorRequestError(`Getting an access token failed: HTTP ${res.status}`, res.status);
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new ConnectorRequestError("Getting an access token failed: no access_token in the response");
    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(30, Number(body.expires_in) || 300) * 1000 };
    return this.token.value;
  }

  private async authApply(url: URL, headers: Record<string, string>, forceToken = false) {
    const auth = this.def.auth;
    const scope = this.authScope();
    switch (auth.type) {
      case "none":
        return;
      case "basic":
        headers.Authorization = `Basic ${Buffer.from(`${fillTemplate(auth.username, scope)}:${fillTemplate(auth.password, scope)}`).toString("base64")}`;
        return;
      case "bearer": {
        // An optional token (an MCP server without auth) sends no header at all.
        const token = fillTemplate(auth.token, scope, { allowMissing: true });
        if (token) headers.Authorization = `Bearer ${token}`;
        return;
      }
      case "header":
        headers[fillTemplate(auth.name, scope)] = fillTemplate(auth.value, scope);
        return;
      case "query":
        url.searchParams.set(fillTemplate(auth.name, scope), fillTemplate(auth.value, scope));
        return;
      case "oauth2_client_credentials":
        headers.Authorization = `Bearer ${await this.oauthToken(forceToken)}`;
        return;
      default:
        throw new ConnectorRequestError(`The http driver cannot use ${auth.type} authentication`);
    }
  }

  /**
   * One request. Paths and query values are filled from the scope (path
   * values URL-encoded). An expired OAuth token is refreshed once on 401.
   * Error messages carry the path, never the query string (a query-string
   * credential must not reach a log).
   */
  async send(
    spec: HttpRequestSpec,
    scope: TemplateScope,
    extraQuery: Record<string, string> = {},
    absoluteUrl?: string,
    extraBody?: Record<string, unknown>,
  ): Promise<{ json: unknown; headers: Headers }> {
    if (++this.requestCount > LIMITS.requestsPerSession) throw new ConnectorRequestError(`Stopped after ${LIMITS.requestsPerSession} requests`);
    const url = absoluteUrl ? this.resolve(absoluteUrl) : this.resolve(fillTemplate(spec.path, scope, { encode: true }));
    if (!absoluteUrl) {
      for (const [k, v] of Object.entries(spec.query ?? {})) {
        if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, fillTemplate(item, scope, { allowMissing: true }));
        else url.searchParams.set(k, fillTemplate(v, scope, { allowMissing: true }));
      }
    }
    for (const [k, v] of Object.entries(extraQuery)) url.searchParams.set(k, v);
    const label = `${spec.method ?? "GET"} ${url.pathname}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = { Accept: "application/json" };
      for (const [k, v] of Object.entries(spec.headers ?? {})) headers[k] = fillTemplate(v, scope, { allowMissing: true });
      const target = new URL(url);
      await this.authApply(target, headers, attempt > 0);
      let body: string | undefined;
      if (spec.body !== undefined || extraBody) {
        headers["Content-Type"] = "application/json";
        const base = spec.body && typeof spec.body === "object" && !Array.isArray(spec.body) ? spec.body : spec.body === undefined ? {} : spec.body;
        body = JSON.stringify(extraBody && typeof base === "object" && !Array.isArray(base) ? { ...base, ...extraBody } : base);
      }
      // The definition's rateLimitPerSecond is enforced by the gateway, around fetchImpl.
      const res = await this.fetchImpl(target.toString(), { method: spec.method ?? "GET", headers, body });
      if (res.status === 401 && attempt === 0 && this.def.auth.type === "oauth2_client_credentials") continue;
      if (!res.ok) throw new ConnectorRequestError(`${label} failed: HTTP ${res.status}`, res.status);
      const text = await res.text();
      if (!text.trim()) return { json: null, headers: res.headers };
      try {
        return { json: JSON.parse(text), headers: res.headers };
      } catch {
        throw new ConnectorRequestError(`${label} did not return JSON`);
      }
    }
    throw new ConnectorRequestError(`${label} failed: HTTP 401 after refreshing the token`, 401);
  }

  /** Every record of a request, page by page, up to `maxRecords`. */
  async fetchAll(
    spec: HttpRequestSpec,
    recordsPath: string | string[] | undefined,
    pagination: Pagination | undefined,
    scope: TemplateScope,
    maxRecords: number,
    keyed = false,
  ): Promise<unknown[]> {
    const p = pagination ?? { type: "none" };
    const out: unknown[] = [];
    const paths = recordsPath === undefined ? [p.type === "scim" ? "Resources" : ""] : Array.isArray(recordsPath) ? recordsPath : [recordsPath];
    const take = (json: unknown) => {
      // The first records path that holds a list (or, when none does, the first that holds anything).
      let data: unknown = undefined;
      for (const path of paths) {
        const candidate = readPath(json, path);
        if (Array.isArray(candidate)) {
          data = candidate;
          break;
        }
        if (data === undefined && candidate !== undefined && candidate !== null) data = candidate;
      }
      const isMap = keyed && data !== null && typeof data === "object" && !Array.isArray(data);
      const items = isMap
        ? Object.entries(data as Record<string, unknown>).map(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? { ...v, _key: k } : { value: v, _key: k }))
        : Array.isArray(data)
          ? data
          : data && typeof data === "object" && paths.some((path) => path !== "")
            ? [data]
            : [];
      // A list of plain values (ids, names) becomes records of { value }.
      out.push(...items.map((v) => (v !== null && typeof v === "object" ? v : { value: v })));
      return items.length;
    };
    const full = () => out.length >= maxRecords;

    if (p.type === "none") {
      take((await this.send(spec, scope)).json);
      return out.slice(0, maxRecords);
    }
    for (let page = 0, cursor: string | null = null, next: string | null = null; page < LIMITS.pagesPerResource; page++) {
      let got = 0;
      if (p.type === "page") {
        const q: Record<string, string> = { [p.param]: String((p.start ?? 1) + page) };
        if (p.sizeParam) q[p.sizeParam] = String(p.size);
        got = take((await this.send(spec, scope, q)).json);
        if (got < p.size) break;
      } else if (p.type === "offset" && p.in === "body") {
        got = take((await this.send(spec, scope, {}, undefined, { [p.param]: page * p.size, [p.sizeParam]: p.size })).json);
        if (got < p.size) break;
      } else if (p.type === "offset") {
        got = take((await this.send(spec, scope, { [p.param]: String(page * p.size), [p.sizeParam]: String(p.size) })).json);
        if (got < p.size) break;
      } else if (p.type === "scim") {
        const r = (await this.send(spec, scope, { startIndex: String(1 + page * p.size), count: String(p.size) })).json as Record<string, unknown>;
        got = take(r);
        const total = Number(r?.totalResults ?? 0);
        if (got === 0 || out.length >= total) break;
      } else if (p.type === "cursor") {
        const q: Record<string, string> = {};
        if (cursor) q[p.param] = cursor;
        if (p.sizeParam && p.size) q[p.sizeParam] = String(p.size);
        const { json } = await this.send(spec, scope, q);
        got = take(json);
        const c = readPath(json, p.from);
        cursor = typeof c === "string" && c ? c : null;
        if (!cursor) break;
      } else if (p.type === "link_header") {
        const q: Record<string, string> = {};
        if (p.sizeParam && p.size) q[p.sizeParam] = String(p.size);
        const { json, headers } = next ? await this.send(spec, scope, {}, next) : await this.send(spec, scope, q);
        got = take(json);
        next = parseLinkNext(headers.get("link"));
        if (!next || got === 0) break;
      }
      if (full()) break;
    }
    return out.slice(0, maxRecords);
  }
}
