import "server-only";

import { DefinitionConnector } from "./engine";
import type { GatewaySession } from "../gateway/gateway";

/**
 * The production connector for integrations of type `connector`. Its
 * drivers come only from a Connector Gateway session, so every request it
 * makes passes the gateway's policies and is accounted
 * (modules/integrations/gateway). The caller opens the session and
 * flushes it when the run ends.
 */
export function createDefinitionConnector(gateway: GatewaySession): DefinitionConnector {
  return new DefinitionConnector(gateway.drivers);
}
