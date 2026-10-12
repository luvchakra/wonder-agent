import { assertionClaims, privateKeyFrom, signJwt } from "./jwt";
import { OAUTH_TOKEN_KEYS, type AuthSpec, type ConnectorDefinition, type HttpRequestSpec, type Pagination } from "./types";
import { fillTemplate, readPath, type TemplateScope } from "./mapping";

/**
 * The http driver: requests, authentication and paging for a definition.
 * Pure of any WonderID dependency: the caller passes the fetch to use, so
 * production goes through the Connector Gateway (modules/integrations/gateway:
 * rate limit, request budget, SSRF guard, timeouts, size caps, traffic
 * accounting) and the unit tests use a fake.
 */

/** `clientCert` (INTEGRATION-P0-21): a PEM certificate and key the TLS layer presents (mutual TLS). */
export type ClientCertificate = { cert: string; key: string };
export type FetchLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; clientCert?: ClientCertificate; credentialHeaders?: string[] },
) => Promise<Response>;

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
  /** INTEGRATION-P0-21: tokens this session obtained, for the caller to store encrypted (rotatedSecrets()). */
  private obtained: Record<string, string> = {};

  constructor(
    private readonly def: ConnectorDefinition,
    private readonly settings: Record<string, string | number | boolean>,
    private readonly secrets: Record<string, string>,
    private readonly fetchImpl: FetchLike,
  ) {
    this.base = baseUrlOf(def, settings);
    this.origins = allowedOrigins(def, settings);
    // A stored access token still valid is used as is, so a run need not refresh.
    if (def.auth.type === "oauth2_authorization_code") {
      const value = secrets[OAUTH_TOKEN_KEYS.access];
      const expiresAt = Number(secrets[OAUTH_TOKEN_KEYS.expiresAt]);
      if (value && Number.isFinite(expiresAt)) this.token = { value, expiresAt };
    }
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
    if (this.def.auth.type === "oauth2_authorization_code") return this.refreshedToken(force);
    const auth = this.def.auth as Extract<AuthSpec, { type: "oauth2_client_credentials" }>;
    if (!force && this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const scope = this.authScope();
    const tokenUrl = this.resolve(fillTemplate(auth.tokenUrl, scope));
    const clientId = fillTemplate(auth.clientId, scope);
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    let form: URLSearchParams;
    if (auth.grant === "jwt_bearer" || auth.clientAuth === "private_key_jwt") {
      // INTEGRATION-P0-21 (RFC 7523): a short-lived assertion signed with the organization's private key.
      const algorithm = auth.algorithm ?? "RS256";
      const key = privateKeyFrom(fillTemplate(auth.privateKey ?? "", scope), algorithm);
      const keyId = auth.keyId ? fillTemplate(auth.keyId, scope, { allowMissing: true }) || undefined : undefined;
      const audience = tokenUrl.toString();
      if (auth.grant === "jwt_bearer") {
        const subject = auth.subject ? fillTemplate(auth.subject, scope, { allowMissing: true }) || clientId : clientId;
        form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer" });
        form.set("assertion", signJwt(assertionClaims({ issuer: clientId, subject, audience, scope: auth.scope }), key, algorithm, keyId));
      } else {
        form = new URLSearchParams({ grant_type: "client_credentials" });
        if (auth.scope) form.set("scope", auth.scope);
        form.set("client_id", clientId);
        form.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        form.set("client_assertion", signJwt(assertionClaims({ issuer: clientId, subject: clientId, audience }), key, algorithm, keyId));
      }
    } else {
      const clientSecret = fillTemplate(auth.clientSecret ?? "", scope);
      form = new URLSearchParams({ grant_type: "client_credentials" });
      if (auth.scope) form.set("scope", auth.scope);
      if (auth.clientAuth === "basic") headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
      else {
        form.set("client_id", clientId);
        form.set("client_secret", clientSecret);
      }
    }
    this.requestCount++;
    const res = await this.fetchImpl(tokenUrl.toString(), { method: "POST", headers, body: form.toString() });
    if (!res.ok) throw new ConnectorRequestError(`Getting an access token failed: HTTP ${res.status}`, res.status);
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new ConnectorRequestError("Getting an access token failed: no access_token in the response");
    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(30, Number(body.expires_in) || 300) * 1000 };
    return this.token.value;
  }

  private codeAuth() {
    const auth = this.def.auth;
    if (auth.type !== "oauth2_authorization_code") throw new ConnectorRequestError("This connection does not sign in with the provider");
    const scope = this.authScope();
    return { auth, tokenUrl: this.resolve(fillTemplate(auth.tokenUrl, scope)), clientId: fillTemplate(auth.clientId, scope), clientSecret: fillTemplate(auth.clientSecret, scope) };
  }

  /** One token request of the authorization-code flow; keeps what it obtains (rotatedSecrets()). */
  private async tokenRequest(form: URLSearchParams, failure: string): Promise<{ refreshToken?: string }> {
    const { tokenUrl, clientId, clientSecret } = this.codeAuth();
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    this.requestCount++;
    const res = await this.fetchImpl(tokenUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
    // The provider's error body may echo what was sent; only the status is reported.
    if (!res.ok) throw new ConnectorRequestError(`${failure}: HTTP ${res.status}`, res.status);
    const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token) throw new ConnectorRequestError(`${failure}: no access_token in the response`);
    const expiresAt = Date.now() + Math.max(30, Number(body.expires_in) || 300) * 1000;
    this.token = { value: body.access_token, expiresAt };
    this.obtained[OAUTH_TOKEN_KEYS.access] = body.access_token;
    this.obtained[OAUTH_TOKEN_KEYS.expiresAt] = String(expiresAt);
    const refreshToken = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined;
    if (refreshToken) this.obtained[OAUTH_TOKEN_KEYS.refresh] = refreshToken;
    return { refreshToken };
  }

  /** INTEGRATION-P0-21: an access token from the stored refresh token (authorization code). */
  private async refreshedToken(force: boolean): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const refreshToken = this.obtained[OAUTH_TOKEN_KEYS.refresh] ?? this.secrets[OAUTH_TOKEN_KEYS.refresh];
    if (!refreshToken) throw new ConnectorRequestError("Not connected yet: an administrator must connect this connection on its page");
    const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    const { auth } = this.codeAuth();
    if (auth.scope) form.set("scope", auth.scope);
    try {
      await this.tokenRequest(form, "Refreshing the sign-in failed");
    } catch (err) {
      if (err instanceof ConnectorRequestError && (err.status === 400 || err.status === 401)) {
        throw new ConnectorRequestError("The sign-in has expired or was revoked: connect the connection again", err.status);
      }
      throw err;
    }
    return this.token!.value;
  }

  /**
   * INTEGRATION-P0-21: the provider's sign-in address for this connection,
   * with PKCE. Only its own address (resolve() refuses any other) and no
   * secret: the browser sees it.
   */
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    const { auth } = this.codeAuth();
    const scope = this.authScope();
    const url = this.resolve(fillTemplate(auth.authorizeUrl, scope));
    for (const [k, v] of Object.entries(auth.authorizeParams ?? {})) url.searchParams.set(k, fillTemplate(v, { settings: this.settings }));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", fillTemplate(auth.clientId, scope));
    url.searchParams.set("redirect_uri", input.redirectUri);
    if (auth.scope) url.searchParams.set("scope", auth.scope);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  /** INTEGRATION-P0-21: trades the code from the callback for tokens; the provider must give a refresh token. */
  async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<void> {
    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
    const { refreshToken } = await this.tokenRequest(form, "Connecting failed");
    if (!refreshToken) throw new ConnectorRequestError("Connecting failed: the provider gave no refresh token (ask for offline access in authorizeParams)");
  }

  /** The tokens this session obtained (to store with the connection's credentials), or null. */
  rotatedSecrets(): Record<string, string> | null {
    return Object.keys(this.obtained).length ? { ...this.obtained } : null;
  }

  /**
   * INTEGRATION-P0-21: the connection's client certificate, for a request
   * to its own address (resolve() refuses any other) over https only.
   */
  private clientCertificate(url: URL): ClientCertificate | null {
    const auth = this.def.auth;
    if (auth.type !== "client_certificate") return null;
    if (url.protocol !== "https:") throw new ConnectorRequestError(`${url.pathname}: a client certificate is only sent over https`);
    const scope = this.authScope();
    return { cert: fillTemplate(auth.certificate, scope), key: fillTemplate(auth.privateKey, scope) };
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
      case "body":
        // Added to the body in send(); nothing goes in the URL or headers.
        return;
      case "oauth2_client_credentials":
      case "oauth2_authorization_code":
        headers.Authorization = `Bearer ${await this.oauthToken(forceToken)}`;
        return;
      case "client_certificate":
        // Presented by the TLS layer (clientCertificate()); nothing goes in the request.
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
      // INTEGRATION-P0-21: an API key in the body is one more body field, filled from the secret.
      const auth = this.def.auth;
      const authBody = auth.type === "body" ? { [fillTemplate(auth.name, this.authScope())]: fillTemplate(auth.value, this.authScope()) } : undefined;
      if (authBody && (spec.method ?? "GET") === "GET") throw new ConnectorRequestError(`${label}: the API key travels in the body, so the request cannot be a GET`);
      const extra = extraBody || authBody ? { ...(extraBody ?? {}), ...(authBody ?? {}) } : undefined;
      if (spec.body !== undefined || extra) {
        headers["Content-Type"] = "application/json";
        const base = spec.body && typeof spec.body === "object" && !Array.isArray(spec.body) ? spec.body : spec.body === undefined ? {} : spec.body;
        if (authBody && (typeof base !== "object" || base === null || Array.isArray(base))) throw new ConnectorRequestError(`${label}: the API key travels in the body, so the body must be an object`);
        body = JSON.stringify(extra && typeof base === "object" && !Array.isArray(base) ? { ...base, ...extra } : base);
      }
      // The definition's rateLimitPerSecond is enforced by the gateway, around fetchImpl.
      const clientCert = this.clientCertificate(target);
      // WID-H05: a custom API-key header is the credential; the guard drops it on a redirect to another origin.
      const credentialHeaders = auth.type === "header" ? [fillTemplate(auth.name, this.authScope())] : undefined;
      const res = await this.fetchImpl(target.toString(), { method: spec.method ?? "GET", headers, body, ...(clientCert ? { clientCert } : {}), ...(credentialHeaders ? { credentialHeaders } : {}) });
      if (res.status === 401 && attempt === 0 && (this.def.auth.type === "oauth2_client_credentials" || this.def.auth.type === "oauth2_authorization_code")) continue;
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
    report?: { truncated: boolean; short?: boolean },
    totalPath?: string,
  ): Promise<unknown[]> {
    const p = pagination ?? { type: "none" };
    const out: unknown[] = [];
    // WID-H03: the record count the system reports, from the first response (SCIM: totalResults).
    const countPath = totalPath ?? (p.type === "scim" ? "totalResults" : undefined);
    let declared: number | null | undefined = undefined;
    const counted = <T extends { json: unknown; headers: Headers }>(res: T): T => {
      if (countPath && declared === undefined) declared = reportedTotal(res, countPath);
      return res;
    };
    const finish = () => {
      // Fewer than the system holds (and not cut at our own limit), or a declared count that could not be read.
      if (countPath && report && out.length < maxRecords && (declared === null || (declared !== undefined && out.length < declared))) report.short = true;
      return out.slice(0, maxRecords);
    };
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
      take(counted(await this.send(spec, scope)).json);
      return finish();
    }
    for (let page = 0, cursor: string | null = null, next: string | null = null; page < LIMITS.pagesPerResource; page++) {
      let got = 0;
      if (p.type === "page") {
        const q: Record<string, string> = { [p.param]: String((p.start ?? 1) + page) };
        if (p.sizeParam) q[p.sizeParam] = String(p.size);
        got = take(counted(await this.send(spec, scope, q)).json);
        if (got < p.size) break;
      } else if (p.type === "offset" && p.in === "body") {
        got = take(counted(await this.send(spec, scope, {}, undefined, { [p.param]: page * p.size, [p.sizeParam]: p.size })).json);
        if (got < p.size) break;
      } else if (p.type === "offset") {
        got = take(counted(await this.send(spec, scope, { [p.param]: String(page * p.size), [p.sizeParam]: String(p.size) })).json);
        if (got < p.size) break;
      } else if (p.type === "scim") {
        const r = counted(await this.send(spec, scope, { startIndex: String(1 + page * p.size), count: String(p.size) })).json as Record<string, unknown>;
        got = take(r);
        const total = Number(r?.totalResults ?? 0);
        if (got === 0 || out.length >= total) break;
      } else if (p.type === "cursor") {
        const q: Record<string, string> = {};
        if (cursor) q[p.param] = cursor;
        if (p.sizeParam && p.size) q[p.sizeParam] = String(p.size);
        const { json } = counted(await this.send(spec, scope, q));
        got = take(json);
        const c = readPath(json, p.from);
        cursor = typeof c === "string" && c ? c : null;
        if (!cursor) break;
      } else if (p.type === "link_header") {
        const q: Record<string, string> = {};
        if (p.sizeParam && p.size) q[p.sizeParam] = String(p.size);
        const { json, headers } = counted(next ? await this.send(spec, scope, {}, next) : await this.send(spec, scope, q));
        got = take(json);
        next = parseLinkNext(headers.get("link"));
        if (!next || got === 0) break;
      }
      if (full()) break;
      // INTEGRATION-P0-18: the last allowed page was read and the source still had more.
      if (page === LIMITS.pagesPerResource - 1 && report) report.truncated = true;
    }
    return finish();
  }
}

/**
 * WID-H03: the record count a response reports, at a dot path or
 * `header:<Name>`; null when it is declared but missing or not a count.
 */
export function reportedTotal(res: { json: unknown; headers: Headers }, path: string): number | null {
  const raw = path.startsWith("header:") ? res.headers.get(path.slice(7)) : readPath(res.json, path);
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}
