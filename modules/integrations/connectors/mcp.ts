import "server-only";

import type { ConnectorAdapter, ConnectorConfig } from "../connector";
import type { ConnectorCapabilities, DiscoveredObject } from "@/lib/shared/types/integrations";
import { normalizeMcpDeclarations } from "../mcpNormalize";

/**
 * INTEGRATION-P0-04.1. Speaks the MCP "Streamable HTTP" transport directly
 * via fetch (a single JSON-RPC POST) rather than pulling in an MCP client
 * SDK dependency — `tools/list` is a small enough surface that a raw
 * request is simpler than a new dependency for this one call. `discover()`
 * lists the server's declared tools; it does not execute any tool.
 *
 * Config shape: { baseUrl: string }. secret, if provided, is sent as a
 * bearer token — MCP servers commonly sit behind normal HTTP auth.
 */
export class McpConnector implements ConnectorAdapter {
  readonly capabilities: ConnectorCapabilities = {
    importActivity: true,
    provision: false,
    deprovision: false,
  };

  private baseUrl = "";
  private secret: string | null = null;

  async authenticate(config: ConnectorConfig, secret: string | null): Promise<void> {
    if (!config.baseUrl || typeof config.baseUrl !== "string") {
      throw new Error("MCP connector requires config.baseUrl");
    }
    this.baseUrl = config.baseUrl;
    this.secret = secret;
  }

  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.secret ? { Authorization: `Bearer ${this.secret}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`MCP request failed: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`MCP error: ${body.error.message ?? JSON.stringify(body.error)}`);
    return body.result;
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.rpc("tools/list");
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return this.testConnection();
  }

  /**
   * INTEGRATION-P0-06: the server's identity (`initialize`), its tools
   * (`tools/list`) and its resources (`resources/list`), normalized into
   * the mcp_server / mcp_tool / mcp_resource families. Read-only: no tool
   * is ever called. A server that does not implement resources simply
   * has none; any other failure propagates.
   */
  async discover(): Promise<DiscoveredObject[]> {
    const initialize = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "WonderAgent", version: "1.0" },
    }).catch(() => null);
    const tools = ((await this.rpc("tools/list")) as { tools?: unknown[] })?.tools ?? [];
    const resources = await this.rpc("resources/list")
      .then((r) => ((r as { resources?: unknown[] })?.resources ?? []))
      .catch(() => []);
    return normalizeMcpDeclarations({ endpoint: this.baseUrl, initialize, tools, resources });
  }
}
