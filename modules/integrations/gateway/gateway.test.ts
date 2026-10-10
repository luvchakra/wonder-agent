// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: 1, error: null }));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ rpc }) }));

import { openGateway } from "./gateway";
import { DefinitionConnector, type DriverFactory } from "../framework/engine";
import type { ConnectorDefinition } from "../framework/types";
import type { GuardedInit } from "../outboundFetch";
import { mcpServer } from "../framework/definitions/mcp-server";
import { postgresql } from "../framework/definitions/postgresql";

const httpDef: ConnectorDefinition = {
  schemaVersion: 1,
  key: "acme-hr",
  version: "1.0.0",
  name: "Acme HR",
  category: "hr",
  description: "People from Acme HR.",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
  auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "Token" }] },
  test: { request: { path: "/api/me" } },
  rateLimitPerSecond: 5,
  resources: { identity: { request: { path: "/api/people", query: { key: "q" } }, records: "data", fields: { externalId: "id" } } },
} as ConnectorDefinition;

const config = { definition: { key: "acme-hr", version: "1.0.0", origin: "custom" }, manifest: httpDef, settings: { baseUrl: "https://hr.example.com" } };
const SECRET = "tok-SECRET-value";

function fakeTransport(handler: (url: string, init: GuardedInit) => Response | Promise<Response>) {
  const calls: { url: string; init: GuardedInit }[] = [];
  const transport = vi.fn(async (url: string, init: GuardedInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return { transport, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => rpc.mockClear());

describe("the Connector Gateway, outbound", () => {
  it("passes a connector's requests to the guarded transport with the caps, and accounts each by host only", async () => {
    const { transport, calls } = fakeTransport((url) => (url.includes("/api/me") ? json({ me: 1 }) : json({ data: [{ id: "p1" }, { id: "p2" }] })));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const gateway = openGateway({ tenantId: "tenant-a", integrationId: "int-1", status: "connected" }, { transport, sleep, timeoutMs: 5_000, maxBytes: 1024 });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(config, JSON.stringify({ token: SECRET }));
    expect(await connector.testConnection()).toEqual({ ok: true });
    expect(await connector.importKind("identity")).toHaveLength(2);
    await gateway.flush();

    expect(calls).toHaveLength(2);
    expect(calls[0].init).toMatchObject({ timeoutMs: 5_000, maxBytes: 1024 });
    // The rate limit (5/s, from the definition) made the second request wait.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, { p_rows }] = rpc.mock.calls[0] as [string, { p_rows: Record<string, unknown>[] }];
    expect(fn).toBe("record_connector_traffic");
    expect(p_rows).toHaveLength(1);
    expect(p_rows[0]).toMatchObject({ tenant_id: "tenant-a", integration_id: "int-1", direction: "outbound", operation: "http GET", host: "hr.example.com", outcome: "ok", requests: 2 });
    expect(Number(p_rows[0].bytes_in)).toBeGreaterThan(0);
    // Nothing but labels: no path, query, header or secret.
    expect(JSON.stringify(p_rows)).not.toMatch(/SECRET|api\/people|key=q|Bearer/);
  });

  it("refuses every request of a disabled connection, and records it as blocked", async () => {
    const { transport } = fakeTransport(() => json({}));
    const gateway = openGateway({ tenantId: "tenant-a", integrationId: "int-1", status: "disabled" }, { transport });
    expect(gateway.admits()).toBe(false);
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(config, JSON.stringify({ token: SECRET }));
    expect(await connector.testConnection()).toEqual({ ok: false, message: "This connection is disabled" });
    expect(transport).not.toHaveBeenCalled();
    await gateway.flush();
    const { p_rows } = rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] };
    expect(p_rows[0]).toMatchObject({ outcome: "blocked", error_category: "disabled", requests: 1 });
  });

  it("stops a run at its request budget", async () => {
    const { transport } = fakeTransport(() => json({ data: [{ id: "x" }] }));
    const gateway = openGateway({ tenantId: "t", integrationId: "i", status: "connected" }, { transport, requestBudget: 1, sleep: async () => undefined });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(config, JSON.stringify({ token: SECRET }));
    expect(await connector.testConnection()).toEqual({ ok: true });
    await expect(connector.importKind("identity")).rejects.toThrow(/Stopped after 1 requests/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("records an HTTP failure and a transport refusal by category", async () => {
    const { transport } = fakeTransport((url) => {
      if (url.includes("/api/me")) return json({ error: "no" }, 401);
      throw Object.assign(new Error("10.0.0.5 is not a public address"), { name: "OutboundBlockedError" });
    });
    const gateway = openGateway({ tenantId: "t", integrationId: "i", status: "connected" }, { transport, sleep: async () => undefined });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(config, JSON.stringify({ token: SECRET }));
    expect((await connector.testConnection()).ok).toBe(false);
    await expect(connector.importKind("identity")).rejects.toThrow(/not a public address/);
    await gateway.flush();
    const { p_rows } = rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] };
    expect(p_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "error", error_category: "auth" }),
        expect.objectContaining({ outcome: "blocked", error_category: "egress_policy" }),
      ]),
    );
  });

  it("labels MCP requests by JSON-RPC method", async () => {
    const { transport } = fakeTransport((_url, init) => {
      const body = JSON.parse(init.body ?? "{}");
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "s" } } });
      if (!body.id) return new Response(null, { status: 202 });
      return json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "read_report" }] } });
    });
    const gateway = openGateway({ tenantId: "t", integrationId: "i", status: "connected" }, { transport, sleep: async () => undefined });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate({ definition: { key: mcpServer.key, version: mcpServer.version, origin: "builtin" }, manifest: mcpServer, settings: { baseUrl: "https://mcp.example.com/mcp" } }, null);
    expect(await connector.importKind("mcp_tool")).toHaveLength(1);
    await gateway.flush();
    const ops = (rpc.mock.calls[0][1] as { p_rows: { operation: string }[] }).p_rows.map((r) => r.operation).sort();
    expect(ops).toEqual(["mcp initialize", "mcp notifications/initialized", "mcp tools/list"]);
  });

  it("meters a driver that opens its own connection (ldap, sql): connect, then each read", async () => {
    const fetchRows = vi.fn(async () => [{ rolname: "a" }, { rolname: "b" }]);
    const sqlFactory: DriverFactory = async () => ({ test: async () => undefined, fetch: fetchRows, close: async () => undefined });
    const gateway = openGateway({ tenantId: "t", integrationId: "i", status: "connected" }, { socketDrivers: { sql: sqlFactory }, sleep: async () => undefined });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(
      { definition: { key: postgresql.key, version: postgresql.version, origin: "builtin" }, manifest: postgresql, settings: { url: "postgres://db.example.com:5432/app?sslpassword=x" } },
      JSON.stringify({ username: "u", password: "SECRET-pw" }),
    );
    expect(await connector.importKind("account")).toHaveLength(2);
    await connector.close();
    await gateway.flush();
    const rows = (rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] }).p_rows;
    expect(rows.map((r) => r.operation).sort()).toEqual(["sql connect", "sql query"]);
    expect(rows.every((r) => r.host === "db.example.com")).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|sslpassword/);
  });

  it("records nothing and writes nothing when no traffic passed", async () => {
    const gateway = openGateway({ tenantId: "t", integrationId: "i", status: "connected" });
    await gateway.flush();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never fails the run when accounting fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } } as never);
    const gateway = openGateway({ tenantId: "t", integrationId: "i", status: "connected" });
    gateway.recordInbound({ channel: "events", status: 202, bytesIn: 10, bytesOut: 5, durationMs: 1 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(gateway.flush()).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("needs the connection's organization", () => {
    expect(() => openGateway({ tenantId: "", integrationId: "i" })).toThrow(/organization/);
  });
});

describe("the Connector Gateway, inbound", () => {
  it("records a received request by channel and outcome, with no sender address", async () => {
    const gateway = openGateway({ tenantId: "tenant-a", integrationId: "int-1", status: "connected" });
    gateway.recordInbound({ channel: "events", status: 202, bytesIn: 300, bytesOut: 40, durationMs: 12 });
    gateway.recordInbound({ channel: "events", status: 401, bytesIn: 300, bytesOut: 60, durationMs: 2 });
    gateway.recordInbound({ channel: "webhook", status: 404, bytesIn: 1, bytesOut: 1, durationMs: 1, refusal: "disabled" });
    await gateway.flush();
    const rows = (rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] }).p_rows;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenant_id: "tenant-a", direction: "inbound", operation: "receive events", host: null, outcome: "ok", bytes_in: 300 }),
        expect.objectContaining({ operation: "receive events", outcome: "blocked", error_category: "unauthenticated" }),
        expect.objectContaining({ operation: "receive webhook", outcome: "blocked", error_category: "disabled" }),
      ]),
    );
  });
});
