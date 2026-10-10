import "server-only";

import { ApiError } from "@/lib/shared/types/foundation";
import type { DefinitionConnector } from "./framework/engine";
import { createDefinitionConnector } from "./framework/connector";

/**
 * Every integration runs through the connector framework (non-negotiable
 * #20): one adapter that runs the connection's definition. The adapters
 * that once talked to Saviynt, generic REST APIs and MCP servers directly
 * are gone; those products are definitions now (migration 0109 converted
 * existing connections).
 */
export function createConnector(integrationTypeId: string): DefinitionConnector {
  if (integrationTypeId !== "connector") {
    throw new ApiError(400, "UNSUPPORTED_INTEGRATION", "This integration type is no longer supported; connect the system again from the connector catalog");
  }
  return createDefinitionConnector();
}
