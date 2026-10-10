// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DefinitionConnector, httpDriver } from "./engine";
import { mcpDriver, parseRpcReply } from "./drivers/mcp";
import { mcpServer } from "./definitions/mcp-server";
import { saviynt } from "./definitions/saviynt";
import type { FetchLike } from "./http";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> | null };

/** A fake MCP server: a session id on initialize, SSE replies for tools, two pages of tools, no resources. */
function fakeMcp(): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body });
    const reply = (result: unknown, sse = false, extra: Record<string, string> = {}) => {
      const msg = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
      return new Response(sse ? `event: message\ndata: ${msg}\n\n` : msg, { status: 200, headers: { "content-type": sse ? "text/event-stream" : "application/json", ...extra } });
    };
    switch (body?.method) {
      case "initialize":
        return reply({ protocolVersion: "2025-06-18", serverInfo: { name: "finance-mcp", version: "1.4.2" } }, false, { "mcp-session-id": "s-1" });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list":
        return body.params?.cursor
          ? reply({ tools: [{ name: "delete_invoice", annotations: { destructiveHint: true } }] }, true)
          : reply({ tools: [{ name: "get_report", description: "Reads a report", inputSchema: { type: "object" } }, { name: "frobnicate" }], nextCursor: "p2" }, true);
      default:
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body?.id, error: { code: -32601, message: "Method not found" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
  };
  return { fetchImpl, calls };
}

const config = (manifest: unknown, settings: Record<string, unknown>) => ({ definition: { key: "x", version: "1.0.0", origin: "builtin" }, manifest, settings });

describe("mcp driver", () => {
  it("parses JSON and server-sent-event replies by id", () => {
    expect(parseRpcReply("application/json", '{"jsonrpc":"2.0","id":3,"result":{"a":1}}', 3)).toEqual({ result: { a: 1 }, error: undefined });
    expect(parseRpcReply("text/event-stream", 'data: {"jsonrpc":"2.0","id":9,"result":{}}\n\ndata: {"jsonrpc":"2.0","id":4,"result":{"b":2}}\n\n', 4)).toEqual({ result: { b: 2 }, error: undefined });
    expect(parseRpcReply("application/json", "not json", 1)).toBeNull();
  });

  it("reads the server, its tools across pages (classified) and treats a missing resources list as none", async () => {
    const { fetchImpl, calls } = fakeMcp();
    const c = new DefinitionConnector({ mcp: mcpDriver(fetchImpl) });
    await c.authenticate(config(mcpServer, { baseUrl: "https://mcp.example.com/mcp" }), null);
    expect(await c.testConnection()).toEqual({ ok: true });
    expect(c.kinds()).toEqual(["mcp_server", "mcp_tool", "mcp_resource"]);

    const [server] = await c.importKind("mcp_server");
    expect(server.normalized).toMatchObject({ externalId: "server", serverName: "finance-mcp", serverVersion: "1.4.2", protocolVersion: "2025-06-18", endpoint: "https://mcp.example.com/mcp" });

    const tools = await c.importKind("mcp_tool");
    expect(tools.map((t) => [t.externalId, t.normalized?.operation, t.normalized?.destructive])).toEqual([
      ["get_report", "read", false],
      ["frobnicate", "unknown", false],
      ["delete_invoice", "write", true],
    ]);
    expect(tools[0].normalized?.inputSchema).toEqual({ type: "object" });
    expect(await c.importKind("mcp_resource")).toEqual([]);

    // The session id from initialize is sent back; no token is configured, so no Authorization header.
    const after = calls.filter((x) => x.body?.method !== "initialize");
    expect(after.every((x) => x.headers["Mcp-Session-Id"] === "s-1")).toBe(true);
    expect(calls.every((x) => !("Authorization" in x.headers))).toBe(true);
    // Read only: nothing but initialize, the ack and list methods was ever sent.
    expect(new Set(calls.map((x) => x.body?.method))).toEqual(new Set(["initialize", "notifications/initialized", "tools/list", "resources/list"]));
  });

  it("sends the bearer token when one is configured", async () => {
    const { fetchImpl, calls } = fakeMcp();
    const c = new DefinitionConnector({ mcp: mcpDriver(fetchImpl) });
    await c.authenticate(config(mcpServer, { baseUrl: "https://mcp.example.com/mcp" }), JSON.stringify({ token: "t0k" }));
    await c.importKind("mcp_tool");
    expect(calls[0].headers.Authorization).toBe("Bearer t0k");
  });
});

describe("http driver additions", () => {
  it("pages Saviynt-style in the POST body, tries records paths in order, and keeps a plain-string credential working", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      const all = [{ username: "fbot" }, { id: "u2" }, { username: "ava" }];
      const slice = all.slice(body.offset, body.offset + body.max);
      return new Response(JSON.stringify(body.offset === 0 ? { userlist: slice } : slice), { status: 200, headers: { "content-type": "application/json" } });
    };
    const small = { ...saviynt, resources: { identity: { ...(saviynt.resources.identity as object), pagination: { type: "offset", param: "offset", sizeParam: "max", size: 2, in: "body" } } } };
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    // A token saved before this connector existed is one plain string.
    await c.authenticate(config(small, { baseUrl: "https://tenant.saviyntcloud.com" }), "legacy-token");
    const ids = (await c.importKind("identity")).map((r) => r.externalId);
    expect(ids).toEqual(["fbot", "u2", "ava"]);
    expect(bodies.map((b) => [b.offset, b.max])).toEqual([
      [0, 2],
      [2, 2],
    ]);
  });
});
