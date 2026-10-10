import { classifyToolOperation } from "../../mcpNormalize";
import type { ConnectorDriverSession, DriverFactory } from "../engine";
import { ConnectorRequestError, type FetchLike } from "../http";
import { fillTemplate } from "../mapping";
import type { ConnectorDefinition } from "../types";

/**
 * The mcp driver: reads what an MCP server declares over the Streamable
 * HTTP transport (JSON-RPC 2.0). It opens a session with `initialize`,
 * keeps the server's `Mcp-Session-Id`, accepts JSON or server-sent-event
 * replies, and pages list methods by `nextCursor`.
 *
 * Read only: it calls `initialize` and the `*\/list` methods, never
 * `tools/call` or anything else that acts (non-negotiable #12). Each tool
 * gains `_operation`, `_operationBasis` and `_destructive` from the
 * deterministic classification (annotations first, then the verb its name
 * starts with), which a definition maps like any other field. A server's
 * descriptions are data, never instructions (§17.2).
 */

const PROTOCOL_VERSION = "2025-06-18";
const MAX_PAGES = 200;
const RECORDS_FOR: Record<string, string> = { "tools/list": "tools", "resources/list": "resources", "prompts/list": "prompts" };

type RpcResult = Record<string, unknown>;

/** The JSON-RPC response with this id, from a JSON body or a server-sent-event stream. */
export function parseRpcReply(contentType: string, text: string, id: number): { result?: RpcResult; error?: { code?: number; message?: string } } | null {
  const pick = (msg: unknown) => {
    const m = msg as { id?: unknown; result?: RpcResult; error?: { code?: number; message?: string } };
    return m && typeof m === "object" && m.id === id ? { result: m.result, error: m.error } : null;
  };
  if (contentType.includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const found = pick(JSON.parse(data));
        if (found) return found;
      } catch {
        /* not JSON: keep looking */
      }
    }
    return null;
  }
  try {
    const body = JSON.parse(text);
    if (Array.isArray(body)) {
      for (const m of body) {
        const found = pick(m);
        if (found) return found;
      }
      return null;
    }
    return pick(body);
  } catch {
    return null;
  }
}

export function mcpDriver(fetchImpl: FetchLike): DriverFactory {
  return async (def: ConnectorDefinition, settings, secrets): Promise<ConnectorDriverSession> => {
    const urlKey = def.settings.find((s) => s.key === "baseUrl" && s.type === "url")?.key ?? def.settings.find((s) => s.type === "url")!.key;
    const endpoint = new URL(String(settings[urlKey]));
    const scope = { settings, secret: secrets };
    let nextId = 1;
    let sessionId: string | null = null;
    let initialized: RpcResult | null = null;
    let requests = 0;

    const authHeaders = (): Record<string, string> => {
      const auth = def.auth;
      if (auth.type === "bearer") {
        const token = fillTemplate(auth.token, scope, { allowMissing: true });
        return token ? { Authorization: `Bearer ${token}` } : {};
      }
      if (auth.type === "header") return { [fillTemplate(auth.name, scope)]: fillTemplate(auth.value, scope) };
      return {};
    };

    async function post(body: Record<string, unknown>): Promise<Response> {
      if (++requests > 1000) throw new ConnectorRequestError("Stopped after 1000 MCP requests");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        ...authHeaders(),
      };
      if (sessionId) headers["Mcp-Session-Id"] = sessionId;
      return fetchImpl(endpoint.toString(), { method: "POST", headers, body: JSON.stringify(body) });
    }

    async function rpc(method: string, params: Record<string, unknown> = {}): Promise<RpcResult> {
      const id = nextId++;
      const res = await post({ jsonrpc: "2.0", id, method, params });
      if (!res.ok) throw new ConnectorRequestError(`MCP ${method} failed: HTTP ${res.status}`, res.status);
      const sid = res.headers.get("mcp-session-id");
      if (sid) sessionId = sid;
      const reply = parseRpcReply(res.headers.get("content-type") ?? "", await res.text(), id);
      if (!reply) throw new ConnectorRequestError(`MCP ${method} returned no reply`);
      if (reply.error) {
        // "Method not found": the server does not offer this list, which an optional resource treats as none.
        const status = reply.error.code === -32601 ? 404 : undefined;
        throw new ConnectorRequestError(`MCP ${method} error: ${String(reply.error.message ?? reply.error.code ?? "unknown").slice(0, 200)}`, status);
      }
      return reply.result ?? {};
    }

    async function open(): Promise<RpcResult> {
      if (initialized) return initialized;
      initialized = await rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "WonderID", version: "1.0" } });
      // Acknowledge, as the protocol asks; a server that does not care answers 202 or 200.
      const ack = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      await ack.text().catch(() => "");
      return initialized;
    }

    async function list(method: string, max: number): Promise<unknown[]> {
      await open();
      const out: unknown[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES && out.length < max; page++) {
        const result = await rpc(method, cursor ? { cursor } : {});
        const items = result[RECORDS_FOR[method]];
        if (Array.isArray(items)) out.push(...items);
        cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
        if (!cursor) break;
      }
      return out.slice(0, max);
    }

    return {
      async test() {
        await open();
        const method = def.test?.rpc?.method;
        if (method && method !== "initialize") await list(method, 1);
      },
      async fetch(resource, _scope, max) {
        const method = resource.rpc?.method;
        if (!method) throw new Error("This resource has no rpc method");
        if (method === "initialize") return [{ ...(await open()), endpoint: endpoint.toString() }];
        const records = await list(method, max);
        if (method !== "tools/list") return records;
        return records.map((t) => {
          if (typeof t !== "object" || t === null) return t;
          const tool = t as Record<string, unknown>;
          const op = classifyToolOperation(String(tool.name ?? ""), tool.annotations);
          return { ...tool, _operation: op.operation, _operationBasis: op.basis, _destructive: op.destructive };
        });
      },
    };
  };
}
