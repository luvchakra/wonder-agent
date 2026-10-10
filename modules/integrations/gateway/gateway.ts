import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, guardedFetch, type GuardedInit } from "../outboundFetch";
import { httpDriver, type ConnectorDriverSession, type DriverFactories, type DriverFactory } from "../framework/engine";
import { LIMITS, type FetchLike } from "../framework/http";
import { ldapDriver } from "../framework/drivers/ldap";
import { sqlDriver } from "../framework/drivers/sql";
import { mcpDriver } from "../framework/drivers/mcp";
import { fileDriver, type FileStoreFactory } from "../framework/drivers/file";
import { connectorFileStore } from "../framework/files";
import type { ConnectorDefinition } from "../framework/types";
import {
  GatewayRefusedError,
  RequestBudget,
  TokenBucket,
  TrafficLedger,
  approximateBytes,
  classifyInbound,
  classifyOutboundError,
  connectionAdmits,
  hostOf,
  operationLabel,
  statusCategory,
  type TrafficEntry,
} from "./gatewayRules";

/**
 * The Connector Gateway: the one place every connection's traffic passes
 * between WonderID and an organization's systems (non-negotiable #20; user
 * requirement 2026-10-10, "all such connections should pass through one
 * gateway which sits between WonderID and external world").
 *
 * - Outbound: the http, mcp, ldap and sql drivers are built only here, each
 *   wrapped so that every request first passes the connection's policies:
 *   the connection is not disabled, the per-run request budget is not
 *   spent, and the definition's rate limit (rateLimitPerSecond, a token
 *   bucket) is honoured. HTTP and MCP then go through guardedFetch (SSRF
 *   guard, timeout, response size cap); LDAP and PostgreSQL connect only
 *   to an address resolveSafeHost vetted.
 * - Inbound: the /api/connect receivers record each request here
 *   (receive.ts), so both directions land in the same ledger.
 * - Accounting: every request is counted in memory per session and written
 *   once, on flush(), into connector_traffic (migration 0110), by host name
 *   only. Never a path, query, header, body or credential.
 *
 * A session is one run: a sync, a connection test, an MCP discovery, a
 * preview, or one received request. Open it, hand `drivers` to the
 * connector (createDefinitionConnector), and flush() in a finally.
 */

export type GatewayConnection = {
  /** The organization the traffic belongs to: always the connection row's own tenant_id (§14). */
  tenantId: string;
  /** The connection; null only for a preview of an unsaved definition. */
  integrationId: string | null;
  /** The connection's status; a disabled connection passes nothing. */
  status?: string | null;
};

export type GatewayOptions = {
  /** Overrides the definition's rateLimitPerSecond. */
  rateLimitPerSecond?: number;
  /** Requests one session may make across every driver (default: the framework's per-session ceiling). */
  requestBudget?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /** Tests only: the transport under the gateway (production: guardedFetch) and the socket drivers. */
  transport?: (url: string, init: GuardedInit) => Promise<Response>;
  socketDrivers?: { ldap?: DriverFactory; sql?: DriverFactory };
  /** Tests only: where the file driver reads received files (production: connector_files). */
  fileStore?: FileStoreFactory;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** The connection's address: its `baseUrl` setting, else its first url setting. */
function addressOf(def: ConnectorDefinition, settings: Record<string, unknown>): string | null {
  const urls = def.settings.filter((s) => s.type === "url").map((s) => s.key);
  const value = settings[urls.includes("baseUrl") ? "baseUrl" : urls[0]];
  return typeof value === "string" ? value : null;
}

/** The JSON-RPC method of an MCP request body, for its operation label. */
function rpcMethod(body: string | undefined): string {
  try {
    const m = (JSON.parse(body ?? "") as { method?: unknown }).method;
    return typeof m === "string" ? m : "request";
  } catch {
    return "request";
  }
}

export class GatewaySession {
  /** The drivers a DefinitionConnector runs on: every one of them metered by this session. */
  readonly drivers: DriverFactories;
  private readonly ledger = new TrafficLedger();
  private readonly budget: RequestBudget;
  private bucket: TokenBucket | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly connection: GatewayConnection,
    private readonly opts: GatewayOptions = {},
  ) {
    if (!connection.tenantId) throw new Error("A gateway session needs the connection's organization");
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.budget = new RequestBudget(opts.requestBudget ?? LIMITS.requestsPerSession);
    this.drivers = {
      http: this.withDefinition(httpDriver(this.meteredFetch("http"))),
      mcp: this.withDefinition(mcpDriver(this.meteredFetch("mcp"))),
      ldap: this.meteredDriver("ldap", opts.socketDrivers?.ldap ?? ldapDriver),
      sql: this.meteredDriver("sql", opts.socketDrivers?.sql ?? sqlDriver),
      // CSV files: an address is fetched through the metered fetch (policies, guard, 10 MB cap);
      // a received file is read from connector_files for this session's own connection only.
      file: this.withDefinition(this.ownConnection(fileDriver({ fetch: this.meteredFetch("file"), store: opts.fileStore ?? connectorFileStore }))),
    };
  }

  /** Whether this connection may pass traffic at all. */
  admits(): boolean {
    return connectionAdmits(this.connection.status);
  }

  /** The definition's rate limit applies from the first driver opened. */
  private useDefinition(def: ConnectorDefinition) {
    this.bucket ??= new TokenBucket(this.opts.rateLimitPerSecond ?? def.rateLimitPerSecond ?? 10, 1, this.now);
  }

  /**
   * The driver's connection is this session's, whatever the caller passed:
   * the organization and connection the gateway was opened for (§14). A
   * preview (no connection) has none, so it reads no received files.
   */
  private ownConnection(factory: DriverFactory): DriverFactory {
    const { tenantId, integrationId } = this.connection;
    return (def, settings, secrets) => factory(def, settings, secrets, integrationId ? { tenantId, integrationId } : undefined);
  }

  private withDefinition(factory: DriverFactory): DriverFactory {
    return (def, settings, secrets, context) => {
      this.useDefinition(def);
      return factory(def, settings, secrets, context);
    };
  }

  private record(e: Omit<TrafficEntry, "at">) {
    this.ledger.record({ ...e, at: this.now() });
  }

  /** The connection's policies, in order: not disabled, budget left, then wait for the rate limit. */
  private async admit(operation: string, host: string | null): Promise<void> {
    let refusal: GatewayRefusedError | null = null;
    if (!this.admits()) refusal = new GatewayRefusedError("disabled", "This connection is disabled");
    else if (!this.budget.take()) refusal = new GatewayRefusedError("budget", `Stopped after ${this.budget.max} requests in one run`);
    if (refusal) {
      this.record({ direction: "outbound", operation, host, outcome: "blocked", errorCategory: refusal.reason });
      throw refusal;
    }
    const wait = this.bucket?.reserve() ?? 0;
    if (wait > 0) await this.sleep(wait);
  }

  /** HTTP and MCP: every request through the policies above, then guardedFetch. */
  private meteredFetch(kind: "http" | "mcp" | "file"): FetchLike {
    const transport = this.opts.transport ?? guardedFetch;
    return async (url, init) => {
      const host = hostOf(url);
      const operation = kind === "mcp" ? operationLabel("mcp", rpcMethod(init.body)) : operationLabel(kind, init.method ?? "GET");
      await this.admit(operation, host);
      const started = this.now();
      const bytesOut = init.body ? Buffer.byteLength(init.body, "utf8") : 0;
      try {
        const res = await transport(url, { ...init, timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBytes: this.opts.maxBytes ?? DEFAULT_MAX_BYTES });
        const body = await res.arrayBuffer();
        this.record({
          direction: "outbound",
          operation,
          host,
          outcome: res.ok ? "ok" : "error",
          errorCategory: res.ok ? null : statusCategory(res.status),
          bytesIn: body.byteLength,
          bytesOut,
          durationMs: this.now() - started,
        });
        return new Response(NULL_BODY_STATUSES.has(res.status) ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch (err) {
        const { outcome, category } = classifyOutboundError(err);
        this.record({ direction: "outbound", operation, host, outcome, errorCategory: category, bytesOut, durationMs: this.now() - started });
        throw err;
      }
    };
  }

  private async metered<T>(operation: string, host: string | null, run: () => Promise<T>, sizeOf?: (value: T) => number): Promise<T> {
    await this.admit(operation, host);
    const started = this.now();
    try {
      const value = await run();
      this.record({ direction: "outbound", operation, host, outcome: "ok", bytesIn: sizeOf?.(value) ?? 0, durationMs: this.now() - started });
      return value;
    } catch (err) {
      const { outcome, category } = classifyOutboundError(err);
      this.record({ direction: "outbound", operation, host, outcome, errorCategory: category, durationMs: this.now() - started });
      throw err;
    }
  }

  /**
   * A driver that opens its own connection (LDAP, PostgreSQL; a new driver
   * is wired the same way): connecting, and each test or fetch, pass the
   * policies and are accounted. The driver itself vets the address
   * (resolveSafeHost) and holds its own timeouts and row limits.
   */
  meteredDriver(kind: string, factory: DriverFactory): DriverFactory {
    const verb = kind === "ldap" ? "search" : kind === "sql" ? "query" : "read";
    return async (def, settings, secrets, context): Promise<ConnectorDriverSession> => {
      this.useDefinition(def);
      const host = hostOf(addressOf(def, settings));
      const session = await this.metered(operationLabel(kind, "connect"), host, () => factory(def, settings, secrets, context));
      return {
        test: () => this.metered(operationLabel(kind, verb), host, () => session.test()),
        fetch: (resource, scope, max, resourceKind) => this.metered(operationLabel(kind, verb), host, () => session.fetch(resource, scope, max, resourceKind), approximateBytes),
        close: session.close ? () => session.close!() : undefined,
      };
    };
  }

  /** A request received at /api/connect for this connection, recorded by the status it was answered with. */
  recordInbound(e: { channel: string; status: number; bytesIn: number; bytesOut: number; durationMs: number; refusal?: "disabled" }) {
    const { outcome, category } = e.refusal ? { outcome: "blocked" as const, category: e.refusal } : classifyInbound(e.status);
    this.record({
      direction: "inbound",
      operation: operationLabel("receive", e.channel),
      // The sender's address is not recorded.
      host: null,
      outcome,
      errorCategory: category,
      bytesIn: e.bytesIn,
      bytesOut: e.bytesOut,
      durationMs: e.durationMs,
    });
  }

  /**
   * Writes the session's traffic: one row per minute bucket, added to any
   * row already there (record_connector_traffic, migration 0110). Service
   * role, so the organization is set here, explicitly, from the connection
   * row the session was opened with, never from anything in the traffic
   * (§14). A failure to account is logged, never turned into a failed sync
   * or a refused delivery: the traffic itself already happened.
   */
  async flush(): Promise<void> {
    const rows = this.ledger.drain();
    if (rows.length === 0) return;
    const { tenantId, integrationId } = this.connection;
    const payload = rows.map((r) => ({ ...r, tenant_id: tenantId, integration_id: integrationId }));
    try {
      const { error } = await supabaseServiceRole().rpc("record_connector_traffic", { p_rows: payload });
      if (error) console.error("connector gateway: traffic not recorded", { integrationId, code: error.code });
    } catch {
      console.error("connector gateway: traffic not recorded", { integrationId });
    }
  }
}

/** Opens a gateway session for one run of a connection. */
export function openGateway(connection: GatewayConnection, opts: GatewayOptions = {}): GatewaySession {
  return new GatewaySession(connection, opts);
}
