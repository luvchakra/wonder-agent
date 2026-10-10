import type { FieldMapping, RuntimeEventField } from "../types";

/**
 * WonderID's own runtime event format, as an agent runtime or MCP proxy
 * sends it. Shared by the connectors that receive runtime events in that
 * format; a definition for a product with its own format maps that instead.
 */
export const WONDERID_RUNTIME_EVENT_FIELDS: Partial<Record<RuntimeEventField, FieldMapping>> = {
  externalId: "externalId",
  // The agent's WonderID id, or a reference an identity of it is linked under.
  agentIdentityRef: { path: ["agentIdentityRef", "agentRef", "agentId"] },
  eventTime: "eventTime",
  tool: "tool",
  application: "application",
  resource: "resource",
  action: "action",
  dataClassification: "dataClassification",
  success: "success",
  eventType: "eventType",
  sessionId: "sessionId",
  correlationId: "correlationId",
  mcpServer: "mcpServer",
};
