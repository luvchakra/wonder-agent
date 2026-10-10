import "server-only";

import { guardedFetch } from "../outboundFetch";
import { DefinitionConnector, httpDriver } from "./engine";
import { ldapDriver } from "./drivers/ldap";
import { sqlDriver } from "./drivers/sql";
import { mcpDriver } from "./drivers/mcp";

/** The production connector for integrations of type `connector`: every request through the SSRF guard. */
export function createDefinitionConnector(): DefinitionConnector {
  return new DefinitionConnector({
    http: httpDriver((url, init) => guardedFetch(url, init)),
    ldap: ldapDriver,
    sql: sqlDriver,
    mcp: mcpDriver((url, init) => guardedFetch(url, init)),
  });
}
