import { OutboundBlockedError } from "../outboundPolicy";
import { ConnectorRequestError } from "../framework/http";

/**
 * The Connector Gateway's rules, pure so each is unit-tested: how traffic
 * is classified and aggregated, the rate limit and the request budget.
 * gateway.ts applies them to every connection's traffic.
 *
 * What is recorded about a request is deliberately small: its direction,
 * an operation label ("http GET", "mcp tools/list", "ldap search",
 * "receive events"), the host name only (never a path, query string,
 * header or credential), the outcome and an error category from a fixed
 * vocabulary (never an error message, which can quote a response).
 */

export type TrafficDirection = "outbound" | "inbound";
export type TrafficOutcome = "ok" | "error" | "blocked";

export type TrafficEntry = {
  direction: TrafficDirection;
  operation: string;
  host: string | null;
  outcome: TrafficOutcome;
  errorCategory?: string | null;
  bytesIn?: number;
  bytesOut?: number;
  durationMs?: number;
  /** Epoch milliseconds. */
  at: number;
};

/** One aggregated row, in connector_traffic's column names (tenant and connection are added on flush). */
export type TrafficRow = {
  window_start: string;
  direction: TrafficDirection;
  operation: string;
  host: string | null;
  outcome: TrafficOutcome;
  error_category: string | null;
  requests: number;
  bytes_in: number;
  bytes_out: number;
  duration_ms: number;
};

/** Refusals the gateway itself makes. */
export type GatewayRefusal = "disabled" | "budget";

export class GatewayRefusedError extends Error {
  constructor(
    readonly reason: GatewayRefusal,
    message: string,
  ) {
    super(message);
    this.name = "GatewayRefusedError";
  }
}

/** The host name of a URL, lower-cased: never its path, query, port or credentials. Null when it is not a URL. */
export function hostOf(url: string | URL | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = (url instanceof URL ? url : new URL(url)).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

/** An operation label safe to store: a short fixed shape, whatever a definition or a server sends. */
export function operationLabel(kind: string, detail?: string | null): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9 /._:-]/g, "").trim();
  const label = detail ? `${clean(kind)} ${clean(detail)}` : clean(kind);
  return (label || "unknown").slice(0, 64);
}

/** The start of the minute an instant falls in, as ISO 8601. */
export function minuteOf(at: number): string {
  return new Date(Math.floor(at / 60_000) * 60_000).toISOString();
}

const nonNegative = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * Aggregates a session's traffic in memory: one row per minute and
 * (direction, operation, host, outcome, error category), however many
 * requests passed. The gateway writes these rows once, on flush.
 */
export class TrafficLedger {
  private readonly rowsByKey = new Map<string, TrafficRow>();

  record(e: TrafficEntry): void {
    const row: Omit<TrafficRow, "requests" | "bytes_in" | "bytes_out" | "duration_ms"> = {
      window_start: minuteOf(e.at),
      direction: e.direction,
      operation: operationLabel(e.operation),
      host: e.host ? e.host.toLowerCase().slice(0, 253) : null,
      outcome: e.outcome,
      error_category: e.outcome === "ok" ? null : (e.errorCategory ?? "error").slice(0, 40),
    };
    const key = JSON.stringify([row.window_start, row.direction, row.operation, row.host, row.outcome, row.error_category]);
    const existing = this.rowsByKey.get(key) ?? { ...row, requests: 0, bytes_in: 0, bytes_out: 0, duration_ms: 0 };
    existing.requests += 1;
    existing.bytes_in += nonNegative(e.bytesIn);
    existing.bytes_out += nonNegative(e.bytesOut);
    existing.duration_ms += nonNegative(e.durationMs);
    this.rowsByKey.set(key, existing);
  }

  get size(): number {
    return this.rowsByKey.size;
  }

  /** The aggregated rows, and empties the ledger (a flush writes each row once). */
  drain(): TrafficRow[] {
    const out = [...this.rowsByKey.values()];
    this.rowsByKey.clear();
    return out;
  }
}

/**
 * A token bucket: `ratePerSecond` tokens a second, holding at most `burst`.
 * `reserve()` takes one token and says how long to wait before using it, so
 * concurrent callers queue fairly instead of all waking at once.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly now: () => number;
  readonly ratePerSecond: number;
  readonly burst: number;

  constructor(ratePerSecond: number, burst = 1, now: () => number = Date.now) {
    this.ratePerSecond = Math.min(Math.max(ratePerSecond, 0.1), 1000);
    this.burst = Math.max(1, burst);
    this.now = now;
    this.tokens = this.burst;
    this.last = now();
  }

  /** Milliseconds to wait before the reserved request may go (0 when a token is free). */
  reserve(): number {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSecond);
    this.last = t;
    this.tokens -= 1;
    return this.tokens >= 0 ? 0 : Math.ceil((-this.tokens / this.ratePerSecond) * 1000);
  }
}

/** A per-session ceiling on requests, across every driver. */
export class RequestBudget {
  used = 0;
  constructor(readonly max: number) {}
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
}

/** Whether a connection's status lets traffic pass. Disabled (or unknown) connections pass nothing. */
export function connectionAdmits(status: string | null | undefined): boolean {
  return status !== "disabled";
}

/** The error category for an HTTP status that is not a success. */
export function statusCategory(status: number): string {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "unexpected";
}

/** How an outbound failure is recorded: blocked (a policy refused it) or error, with a category. */
export function classifyOutboundError(err: unknown): { outcome: TrafficOutcome; category: string } {
  if (err instanceof GatewayRefusedError) return { outcome: "blocked", category: err.reason };
  const message = err instanceof Error ? err.message : "";
  if (err instanceof OutboundBlockedError || (err instanceof Error && err.name === "OutboundBlockedError")) {
    if (/larger than/i.test(message)) return { outcome: "blocked", category: "too_large" };
    if (/redirect/i.test(message)) return { outcome: "blocked", category: "redirects" };
    return { outcome: "blocked", category: "egress_policy" };
  }
  if (err instanceof ConnectorRequestError && err.status) return { outcome: "error", category: statusCategory(err.status) };
  if (/refused a request to/i.test(message)) return { outcome: "blocked", category: "origin" };
  const code = (err as { code?: unknown })?.code;
  const name = err instanceof Error ? err.name : "";
  if (/timed? ?out/i.test(message) || code === "ETIMEDOUT") return { outcome: "error", category: "timeout" };
  if (/InvalidCredentials/i.test(name) || (typeof code === "string" && /^28/.test(code))) return { outcome: "error", category: "auth" };
  if (typeof code === "string" && /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$/.test(code)) return { outcome: "error", category: "network" };
  if (/certificate|self.signed|TLS/i.test(message)) return { outcome: "error", category: "tls" };
  return { outcome: "error", category: "error" };
}

/** How a received request is recorded, from the status it was answered with. */
export function classifyInbound(status: number): { outcome: TrafficOutcome; category: string | null } {
  if (status >= 200 && status < 300) return { outcome: "ok", category: null };
  if (status === 401 || status === 403) return { outcome: "blocked", category: "unauthenticated" };
  if (status === 413) return { outcome: "blocked", category: "too_large" };
  if (status === 404) return { outcome: "blocked", category: "not_declared" };
  if (status === 503) return { outcome: "error", category: "unavailable" };
  if (status >= 500) return { outcome: "error", category: "server" };
  return { outcome: "error", category: "invalid" };
}

/** The approximate size of driver records (ldap entries, sql rows), for accounting. */
export function approximateBytes(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    return text ? Buffer.byteLength(text, "utf8") : 0;
  } catch {
    return 0;
  }
}
