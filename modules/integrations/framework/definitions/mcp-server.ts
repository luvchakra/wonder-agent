import type { ConnectorDefinition } from "../types";
import { WONDERID_RUNTIME_EVENT_FIELDS } from "./runtime-event-fields";

/** An MCP server: what it declares (tools, resources), and the tool calls its proxy reports. */
export const mcpServer: ConnectorDefinition = {
  schemaVersion: 1,
  key: "mcp-server",
  version: "1.0.0",
  name: "MCP server",
  vendor: "Model Context Protocol",
  category: "ai_runtime",
  description:
    "The tools and resources an MCP server declares, each tool classified as read or write, and the tool calls its MCP proxy or gateway reports to WonderID. Never calls a tool.",
  documentationUrl: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports",
  driver: "mcp",
  settings: [{ key: "baseUrl", label: "MCP endpoint", type: "url", required: true, help: "The server's Streamable HTTP address, for example https://mcp.example.com/mcp" }],
  auth: {
    type: "bearer",
    token: "{secret.token}",
    fields: [{ key: "token", label: "Bearer token", optional: true, help: "Only if the server requires one" }],
  },
  test: { rpc: { method: "tools/list" } },
  application: "MCP",
  resources: {
    mcp_server: {
      rpc: { method: "initialize" },
      fields: {
        externalId: { value: "server" },
        endpoint: "endpoint",
        serverName: "serverInfo.name",
        serverVersion: "serverInfo.version",
        protocolVersion: "protocolVersion",
      },
    },
    mcp_tool: {
      rpc: { method: "tools/list" },
      fields: {
        externalId: "name",
        name: "name",
        description: "description",
        operation: "_operation",
        operationBasis: "_operationBasis",
        destructive: "_destructive",
        inputSchema: "inputSchema",
      },
    },
    mcp_resource: {
      rpc: { method: "resources/list" },
      // A server without resources answers "method not found".
      optional: true,
      fields: { externalId: "uri", uri: "uri", name: "name", mimeType: "mimeType" },
    },
  },
  receive: {
    runtimeEvents: { source: "mcp", auth: "bearer", fields: WONDERID_RUNTIME_EVENT_FIELDS },
  },
};
