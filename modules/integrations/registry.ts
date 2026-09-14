import "server-only";

import type { ConnectorAdapter } from "./connector";
import { GenericRestConnector } from "./connectors/genericRest";
import { SaviyntConnector } from "./connectors/saviynt";
import { McpConnector } from "./connectors/mcp";

/**
 * Factory mapping integration_type_id to a fresh connector instance.
 * 'webhook' is intentionally absent — it's a push-based ingestion path, not
 * a pull connector, and has no ConnectorAdapter of its own (see
 * modules/integrations/webhooks.ts).
 */
export function createConnector(integrationTypeId: string): ConnectorAdapter {
  switch (integrationTypeId) {
    case "generic_rest":
      return new GenericRestConnector();
    case "saviynt":
      return new SaviyntConnector();
    case "mcp":
      return new McpConnector();
    default:
      throw new Error(`No connector implementation for integration type: ${integrationTypeId}`);
  }
}
