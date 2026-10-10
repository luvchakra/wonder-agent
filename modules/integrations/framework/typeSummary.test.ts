import { describe, expect, it } from "vitest";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { connectionTypeHref, connectionTypeOf, connectorSummary, describeConnectionType, protocolLabel, receiveChannels } from "./typeSummary";
import type { ConnectorDefinition } from "./types";

const byKey = (key: string) => {
  const def = BUILTIN_DEFINITIONS.find((d) => d.key === key);
  if (!def) throw new Error(`no built-in ${key}`);
  return def;
};

describe("describeConnectionType", () => {
  it("describes an HTTP type: protocol, OAuth fields by label, pagination, reads", () => {
    const s = describeConnectionType(byKey("keycloak"), "builtin");
    expect(s.protocol).toBe("HTTP REST");
    expect(s.auth).toEqual({ type: "oauth2_client_credentials", label: "OAuth 2.0 client credentials", fields: ["Client ID", "Client secret"], carrier: null });
    expect(s.pagination).toContain("Item offsets");
    expect(s.reads.map((r) => r.label)).toEqual(["accounts", "roles and groups", "who has what"]);
    expect(s.receives).toEqual([]);
    expect(s.rateLimitPerSecond).toBe(25);
    expect(s.originLabel).toBe("Built-in");
    expect(s.categoryLabel).toBe("Identity providers");
    expect(s.documentationUrl).toMatch(/^https:\/\/www\.keycloak\.org\//);
  });

  it("names the header that carries an API key, never its value", () => {
    const s = describeConnectionType(byKey("openbao"), "builtin");
    expect(s.auth.label).toBe("API key in a header");
    expect(s.auth.carrier).toBe("X-Vault-Token");
  });

  it("describes LDAP, SQL and MCP drivers in their own terms", () => {
    const ldap = describeConnectionType(byKey("ldap-directory"), "builtin");
    expect(ldap.protocol).toBe("LDAP v3 (LDAPS)");
    expect(ldap.auth.label).toBe("LDAP simple bind");
    expect(ldap.pagination).toEqual(["LDAP paged results"]);
    expect(ldap.rateLimitPerSecond).toBe(10);
    const sql = describeConnectionType(byKey("postgresql"), "builtin");
    expect(sql.protocol).toBe("SQL (PostgreSQL, TLS)");
    expect(sql.pagination).toEqual(["One query, row-limited"]);
    const mcp = describeConnectionType(byKey("mcp-server"), "builtin");
    expect(mcp.protocol).toBe("MCP (Streamable HTTP)");
    expect(mcp.pagination).toEqual(["MCP nextCursor"]);
    expect(mcp.reads.map((r) => r.kind)).toContain("mcp_tool");
  });

  it("lists distinct pagination styles once", () => {
    expect(describeConnectionType(byKey("gitea"), "builtin").pagination).toEqual(["Link header (RFC 8288)"]);
  });

  it("never leaks a secret template, for every built-in, and every built-in reads or receives", () => {
    for (const def of BUILTIN_DEFINITIONS) {
      const s = describeConnectionType(def, "builtin");
      expect(JSON.stringify(s)).not.toMatch(/\{secret\./);
      expect(s.protocol).not.toBe("");
      expect(s.reads.length + s.receives.length).toBeGreaterThan(0);
    }
  });

  it("labels an organization's own type", () => {
    expect(describeConnectionType(byKey("gitea"), "custom").originLabel).toBe("Your organization");
  });

  it("falls back to the driver key for an unknown driver", () => {
    expect(protocolLabel("ftp" as ConnectorDefinition["driver"])).toBe("FTP");
  });
});

describe("receiveChannels", () => {
  it("is empty when a definition receives nothing", () => {
    expect(receiveChannels(byKey("gitea"))).toEqual([]);
  });

  it("describes the Runtime Gateway type: receive only, both gateway paths and bearer activity", () => {
    const s = describeConnectionType(byKey("runtime-gateway"), "builtin");
    expect(s.protocol).toBe("Receive only");
    expect(s.pagination).toEqual([]);
    expect(s.receives).toEqual([
      { channel: "runtimeEvents", label: "Agent activity", paths: ["events"], auth: "Receiving secret as a bearer token" },
      { channel: "gateway", label: "Runtime Gateway calls", paths: ["gateway/authorize", "gateway/tools/filter"], auth: "The agent's own API key" },
    ]);
  });

  it("names the signature header of an HMAC-signed webhook", () => {
    expect(receiveChannels(byKey("webhook"))).toEqual([
      { channel: "webhook", label: "Webhooks", paths: ["webhook"], auth: "HMAC-SHA256 of the body with the receiving secret, in x-webhook-signature" },
    ]);
  });

  it("uses the default signature header and leaves out a gateway that serves nothing", () => {
    const def = {
      ...byKey("webhook"),
      receive: { runtimeEvents: { source: "webhook", auth: "hmac_sha256", fields: {} }, gateway: { authorize: false, toolsFilter: false } },
    } as ConnectorDefinition;
    expect(receiveChannels(def)).toEqual([
      { channel: "runtimeEvents", label: "Agent activity", paths: ["events"], auth: "HMAC-SHA256 of the body with the receiving secret, in x-wonderid-signature" },
    ]);
  });
});

describe("connectorSummary", () => {
  it("says what a type reads and receives in one line", () => {
    expect(connectorSummary(["account", "entitlement"], [])).toBe("Reads accounts, roles and groups");
    expect(connectorSummary([], ["gateway", "runtimeEvents"])).toBe("Receives Runtime Gateway calls, agent activity");
    expect(connectorSummary(["mcp_tool"], ["runtimeEvents"])).toBe("Reads MCP tools; receives agent activity");
  });
});

describe("connectionTypeOf", () => {
  it("links a connection to its type page, named from its snapshot", () => {
    const ref = connectionTypeOf({ config: { definition: { key: "keycloak", version: "1.0.0", origin: "builtin" }, manifest: { name: "Keycloak" } } });
    expect(ref).toEqual({ name: "Keycloak", version: "1.0.0", href: "/integrations/types/builtin/keycloak" });
  });

  it("names a built-in from code when the connection keeps no snapshot", () => {
    const ref = connectionTypeOf({ config: { definition: { key: "runtime-gateway", version: "1.0.0", origin: "builtin" } } });
    expect(ref).toEqual({ name: "Agent runtime", version: "1.0.0", href: "/integrations/types/builtin/runtime-gateway" });
  });

  it("shows an unlinked 'Connector' when the config names no definition", () => {
    const unlinked = { name: "Connector", version: null, href: null };
    expect(connectionTypeOf({ config: { legacy: { type: "saviynt" } } })).toEqual(unlinked);
    expect(connectionTypeOf({ config: { definition: { key: "x", origin: "elsewhere" } } })).toEqual(unlinked);
    expect(connectionTypeOf({ config: null })).toEqual(unlinked);
  });

  it("encodes the key in the href", () => {
    expect(connectionTypeHref("custom", "a b")).toBe("/integrations/types/custom/a%20b");
  });
});
