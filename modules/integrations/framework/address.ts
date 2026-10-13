import type { ConnectorDefinition } from "./types";

/**
 * WID-H05: the one setting that names a connection's address: its `baseUrl`
 * url setting, else its first url setting. The Gateway checks this address
 * against the organization's allowed hosts, and the drivers that open their
 * own connections (LDAP, PostgreSQL, MCP) connect to this same one, so what
 * is checked is what is reached.
 */
export function addressKey(def: Pick<ConnectorDefinition, "settings">): string | undefined {
  const urls = def.settings.filter((s) => s.type === "url").map((s) => s.key);
  return urls.includes("baseUrl") ? "baseUrl" : urls[0];
}

/** The connection's address, or null when it has none or it is not text. */
export function addressOf(def: Pick<ConnectorDefinition, "settings">, settings: Record<string, unknown>): string | null {
  const key = addressKey(def);
  const value = key ? settings[key] : undefined;
  return typeof value === "string" ? value : null;
}
