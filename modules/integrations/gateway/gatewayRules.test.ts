// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OutboundBlockedError } from "../outboundPolicy";
import { ConnectorRequestError } from "../framework/http";
import {
  GatewayRefusedError,
  RequestBudget,
  TokenBucket,
  TrafficLedger,
  classifyInbound,
  classifyOutboundError,
  connectionAdmits,
  hostOf,
  minuteOf,
  operationLabel,
  statusCategory,
} from "./gatewayRules";

const T0 = Date.UTC(2026, 9, 10, 12, 0, 5);

describe("hostOf: the host name only", () => {
  it("drops the path, query, port and credentials", () => {
    expect(hostOf("https://user:pa55@HR.Example.com:8443/api/people?token=s3cret#x")).toBe("hr.example.com");
    expect(hostOf(new URL("ldaps://dir.example.com:636/dc=example"))).toBe("dir.example.com");
    expect(hostOf("https://[2001:db8::1]/x")).toBe("2001:db8::1");
  });
  it("is null for what is not a URL", () => {
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf(null)).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("operationLabel", () => {
  it("keeps a short fixed shape whatever a server sends", () => {
    expect(operationLabel("mcp", "tools/list")).toBe("mcp tools/list");
    expect(operationLabel("http", "GET")).toBe("http GET");
    expect(operationLabel("mcp", "x<script>alert(1)</script>".repeat(10)).length).toBeLessThanOrEqual(64);
    expect(operationLabel("mcp", "a\nb\"c")).toBe("mcp abc");
  });
});

describe("TrafficLedger: aggregates in memory, one row per bucket", () => {
  it("counts requests per minute, direction, operation, host, outcome and category", () => {
    const ledger = new TrafficLedger();
    const ok = { direction: "outbound" as const, operation: "http GET", host: "hr.example.com", outcome: "ok" as const };
    ledger.record({ ...ok, bytesIn: 100, bytesOut: 10, durationMs: 20, at: T0 });
    ledger.record({ ...ok, bytesIn: 50, durationMs: 30, at: T0 + 30_000 });
    ledger.record({ ...ok, outcome: "error", errorCategory: "server", durationMs: 5, at: T0 + 40_000 });
    ledger.record({ ...ok, at: T0 + 60_000 }); // the next minute
    ledger.record({ direction: "inbound", operation: "receive events", host: null, outcome: "blocked", errorCategory: "unauthenticated", at: T0 });
    expect(ledger.size).toBe(4);
    const rows = ledger.drain();
    expect(ledger.size).toBe(0);
    expect(rows).toContainEqual({
      window_start: "2026-10-10T12:00:00.000Z",
      direction: "outbound",
      operation: "http GET",
      host: "hr.example.com",
      outcome: "ok",
      error_category: null,
      requests: 2,
      bytes_in: 150,
      bytes_out: 10,
      duration_ms: 50,
    });
    expect(rows.find((r) => r.outcome === "error")).toMatchObject({ requests: 1, error_category: "server" });
    expect(rows.find((r) => r.window_start === "2026-10-10T12:01:00.000Z")).toMatchObject({ requests: 1 });
    expect(rows.find((r) => r.direction === "inbound")).toMatchObject({ host: null, outcome: "blocked", error_category: "unauthenticated" });
  });

  it("records an ok request with no category, and never a negative or fractional figure", () => {
    const ledger = new TrafficLedger();
    ledger.record({ direction: "outbound", operation: "sql query", host: "db.example.com", outcome: "ok", errorCategory: "ignored", bytesIn: -5, durationMs: 2.6, at: T0 });
    expect(ledger.drain()[0]).toMatchObject({ error_category: null, bytes_in: 0, duration_ms: 3 });
  });

  it("never stores more than the entry's labels: no path, query or secret can reach a row", () => {
    const ledger = new TrafficLedger();
    ledger.record({ direction: "outbound", operation: "http GET", host: hostOf("https://api.example.com/users?api_key=SECRET-123"), outcome: "ok", at: T0 });
    expect(JSON.stringify(ledger.drain())).not.toMatch(/SECRET|api_key|users/);
  });

  it("buckets by the minute", () => {
    expect(minuteOf(T0)).toBe("2026-10-10T12:00:00.000Z");
  });
});

describe("TokenBucket: the definition's rate limit", () => {
  it("spaces requests at the rate, queueing concurrent callers", () => {
    let now = T0;
    const bucket = new TokenBucket(10, 1, () => now);
    expect(bucket.reserve()).toBe(0);
    expect(bucket.reserve()).toBe(100);
    expect(bucket.reserve()).toBe(200);
    now += 1000; // a second later the bucket has refilled (to its burst of 1)
    expect(bucket.reserve()).toBe(0);
    expect(bucket.reserve()).toBe(100);
  });
  it("allows a burst when configured", () => {
    const now = T0;
    const bucket = new TokenBucket(2, 3, () => now);
    expect([bucket.reserve(), bucket.reserve(), bucket.reserve(), bucket.reserve()]).toEqual([0, 0, 0, 500]);
  });
});

describe("RequestBudget", () => {
  it("refuses past its ceiling", () => {
    const budget = new RequestBudget(2);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
  });
});

describe("connectionAdmits", () => {
  it("refuses a disabled connection only", () => {
    expect(connectionAdmits("disabled")).toBe(false);
    expect(connectionAdmits("connected")).toBe(true);
    expect(connectionAdmits("error")).toBe(true);
    expect(connectionAdmits("configured")).toBe(true);
  });
});

describe("classification", () => {
  it("maps HTTP statuses to a fixed vocabulary", () => {
    expect([401, 403, 404, 429, 400, 500, 503].map(statusCategory)).toEqual(["auth", "auth", "not_found", "rate_limited", "client", "server", "server"]);
  });
  it("records policy refusals as blocked and failures as errors", () => {
    expect(classifyOutboundError(new GatewayRefusedError("disabled", "x"))).toEqual({ outcome: "blocked", category: "disabled" });
    expect(classifyOutboundError(new GatewayRefusedError("budget", "x"))).toEqual({ outcome: "blocked", category: "budget" });
    expect(classifyOutboundError(new OutboundBlockedError("10.0.0.1 is not a public address"))).toEqual({ outcome: "blocked", category: "egress_policy" });
    expect(classifyOutboundError(new OutboundBlockedError("The response from x is larger than 10 MB"))).toEqual({ outcome: "blocked", category: "too_large" });
    expect(classifyOutboundError(new ConnectorRequestError("Refused a request to https://evil.example: not this connection's address"))).toEqual({ outcome: "blocked", category: "origin" });
    expect(classifyOutboundError(new ConnectorRequestError("GET /x failed: HTTP 401", 401))).toEqual({ outcome: "error", category: "auth" });
    expect(classifyOutboundError(new Error("The request to x timed out after 20 s"))).toEqual({ outcome: "error", category: "timeout" });
    expect(classifyOutboundError(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toEqual({ outcome: "error", category: "network" });
    expect(classifyOutboundError(Object.assign(new Error("password authentication failed"), { code: "28P01" }))).toEqual({ outcome: "error", category: "auth" });
    expect(classifyOutboundError("weird")).toEqual({ outcome: "error", category: "error" });
  });
  it("classifies a received request by the status it was answered with", () => {
    expect(classifyInbound(202)).toEqual({ outcome: "ok", category: null });
    expect(classifyInbound(401)).toEqual({ outcome: "blocked", category: "unauthenticated" });
    expect(classifyInbound(413)).toEqual({ outcome: "blocked", category: "too_large" });
    expect(classifyInbound(404)).toEqual({ outcome: "blocked", category: "not_declared" });
    expect(classifyInbound(400)).toEqual({ outcome: "error", category: "invalid" });
    expect(classifyInbound(500)).toEqual({ outcome: "error", category: "server" });
  });
});
