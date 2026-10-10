import { BUILTIN_DEFINITIONS } from "./definitions";
import {
  RESOURCE_KINDS,
  type AuthSpec,
  type ConnectorCategory,
  type ConnectorDefinition,
  type ConnectorDriver,
  type Pagination,
  type ReceiveSpec,
  type ResourceKind,
  type ResourceSpec,
} from "./types";

/**
 * Connection types, described for people.
 *
 * A connection type is a connector definition (built-in or published by the
 * organization); a connection is one organization's system connected with
 * it. These pure functions turn a definition into the protocol details the
 * Connection types pages show (protocol, authentication, pagination, what it
 * reads and receives), so the pages stay thin and the wording lives in one
 * place. Nothing here reads a secret value: authentication is described by
 * its method and the names of the fields an organization fills in.
 */

export type TypeOrigin = "builtin" | "custom";

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  hr: "HR systems",
  identity_provider: "Identity providers",
  directory: "Directories",
  application: "Applications",
  database: "Databases",
  secrets: "Secrets managers",
  infrastructure: "Infrastructure",
  ai_runtime: "AI agents and MCP",
  event_source: "Events and webhooks",
  other: "Other",
};

/** The canonical object families, in the words the product uses for them. */
export const RESOURCE_LABEL: Record<ResourceKind, string> = {
  identity: "people",
  account: "accounts",
  entitlement: "roles and groups",
  access_grant: "who has what",
  application: "applications",
  policy: "policies",
  mcp_server: "MCP server",
  mcp_tool: "MCP tools",
  mcp_resource: "MCP resources",
};

/** The receiving channels (ReceiveSpec keys), in words. */
export const RECEIVE_LABEL: Record<string, string> = {
  runtimeEvents: "agent activity",
  webhook: "webhooks",
  gateway: "Runtime Gateway calls",
};

/** One line: what a connector reads and what it receives. */
export function connectorSummary(resources: ResourceKind[], receives: string[]): string {
  const parts: string[] = [];
  if (resources.length) parts.push(`Reads ${resources.map((r) => RESOURCE_LABEL[r]).join(", ")}`);
  if (receives.length) parts.push(`${resources.length ? "receives" : "Receives"} ${receives.map((r) => RECEIVE_LABEL[r] ?? r).join(", ")}`);
  return parts.join("; ");
}

export const ORIGIN_LABEL: Record<TypeOrigin, string> = {
  builtin: "Built-in",
  custom: "Your organization",
};

const PROTOCOL_LABEL: Record<ConnectorDriver, string> = {
  http: "HTTP REST",
  ldap: "LDAP v3 (LDAPS)",
  sql: "SQL (PostgreSQL, TLS)",
  mcp: "MCP (Streamable HTTP)",
  none: "Receive only",
};

const AUTH_LABEL: Record<AuthSpec["type"], string> = {
  none: "None",
  basic: "HTTP Basic",
  bearer: "Bearer token",
  header: "API key in a header",
  query: "API key in the query string",
  oauth2_client_credentials: "OAuth 2.0 client credentials",
  ldap_simple: "LDAP simple bind",
  sql_password: "Database user and password",
};

const PAGINATION_LABEL: Record<Pagination["type"], string> = {
  none: "Single request",
  page: "Page numbers",
  offset: "Item offsets",
  cursor: "Cursor token",
  link_header: "Link header (RFC 8288)",
  scim: "SCIM (startIndex, count)",
};

export const DEFAULT_RATE_LIMIT_PER_SECOND = 10;
const DEFAULT_SIGNATURE_HEADER = "x-wonderid-signature";

export type AuthSummary = {
  type: AuthSpec["type"];
  label: string;
  /** The labels of the secret fields an organization fills in. Never values. */
  fields: string[];
  /** The header or query parameter that carries the credential, when there is one. */
  carrier: string | null;
};

export type ReceiveSummary = {
  channel: keyof ReceiveSpec;
  label: string;
  /** The path under /api/connect/v1/<connection>/ each request goes to. */
  paths: string[];
  /** How the sender authenticates. Never a secret. */
  auth: string;
};

export type TypeSummary = {
  key: string;
  version: string;
  origin: TypeOrigin;
  originLabel: string;
  name: string;
  vendor: string | null;
  category: ConnectorCategory;
  categoryLabel: string;
  description: string;
  driver: ConnectorDriver;
  protocol: string;
  auth: AuthSummary;
  pagination: string[];
  reads: { kind: ResourceKind; label: string }[];
  receives: ReceiveSummary[];
  /** Labels of the non-secret settings an organization enters (address, realm…). */
  settings: string[];
  rateLimitPerSecond: number;
  documentationUrl: string | null;
};

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function protocolLabel(driver: ConnectorDriver): string {
  return PROTOCOL_LABEL[driver] ?? String(driver).toUpperCase();
}

export function authSummary(auth: AuthSpec): AuthSummary {
  return {
    type: auth.type,
    label: AUTH_LABEL[auth.type],
    fields: auth.type === "none" ? [] : auth.fields.map((f) => (f.optional ? `${f.label} (optional)` : f.label)),
    carrier: auth.type === "header" || auth.type === "query" ? auth.name : null,
  };
}

function specs(def: ConnectorDefinition): ResourceSpec[] {
  return RESOURCE_KINDS.flatMap((k) => {
    const r = def.resources[k];
    return r ? (Array.isArray(r) ? r : [r]) : [];
  });
}

/** The distinct pagination styles a definition's requests use. */
export function paginationStyles(def: ConnectorDefinition): string[] {
  const all = specs(def);
  if (all.length === 0) return [];
  if (def.driver === "ldap") return ["LDAP paged results"];
  if (def.driver === "sql") return ["One query, row-limited"];
  if (def.driver === "mcp") return ["MCP nextCursor"];
  return [...new Set(all.map((r) => PAGINATION_LABEL[r.pagination?.type ?? "none"]))];
}

function senderAuth(auth: "bearer" | "hmac_sha256", signatureHeader?: string): string {
  return auth === "bearer" ? "Receiving secret as a bearer token" : `HMAC-SHA256 of the body with the receiving secret, in ${signatureHeader ?? DEFAULT_SIGNATURE_HEADER}`;
}

/** The receiving side of a definition (`receive`): each channel, its endpoint paths and how the sender authenticates. */
export function receiveChannels(def: ConnectorDefinition): ReceiveSummary[] {
  const r = def.receive ?? {};
  const out: ReceiveSummary[] = [];
  if (r.runtimeEvents) {
    out.push({ channel: "runtimeEvents", label: capitalize(RECEIVE_LABEL.runtimeEvents), paths: ["events"], auth: senderAuth(r.runtimeEvents.auth, r.runtimeEvents.signatureHeader) });
  }
  if (r.webhook) {
    out.push({ channel: "webhook", label: capitalize(RECEIVE_LABEL.webhook), paths: ["webhook"], auth: senderAuth(r.webhook.auth, r.webhook.signatureHeader) });
  }
  if (r.gateway && (r.gateway.authorize || r.gateway.toolsFilter)) {
    out.push({
      channel: "gateway",
      label: RECEIVE_LABEL.gateway,
      paths: [...(r.gateway.authorize ? ["gateway/authorize"] : []), ...(r.gateway.toolsFilter ? ["gateway/tools/filter"] : [])],
      auth: "The agent's own API key",
    });
  }
  return out;
}

/** Everything the Connection types pages say about one definition. */
export function describeConnectionType(def: ConnectorDefinition, origin: TypeOrigin): TypeSummary {
  return {
    key: def.key,
    version: def.version,
    origin,
    originLabel: ORIGIN_LABEL[origin],
    name: def.name,
    vendor: def.vendor ?? null,
    category: def.category,
    categoryLabel: CATEGORY_LABEL[def.category],
    description: def.description,
    driver: def.driver,
    protocol: protocolLabel(def.driver),
    auth: authSummary(def.auth),
    pagination: paginationStyles(def),
    reads: RESOURCE_KINDS.filter((k) => def.resources[k]).map((kind) => ({ kind, label: RESOURCE_LABEL[kind] })),
    receives: receiveChannels(def),
    settings: def.settings.map((s) => s.label),
    rateLimitPerSecond: def.rateLimitPerSecond ?? DEFAULT_RATE_LIMIT_PER_SECOND,
    documentationUrl: def.documentationUrl ?? null,
  };
}

/** The Connection type page of a definition. */
export function connectionTypeHref(origin: TypeOrigin, key: string): string {
  return `/integrations/types/${origin}/${encodeURIComponent(key)}`;
}

export type ConnectionTypeRef = { name: string; version: string | null; href: string | null };

/**
 * Which connection type a connection (an `integrations` row of type
 * `connector`) was created from: its config names the definition, and
 * carries a snapshot of it unless it uses a built-in from code. A row whose
 * config names no definition (a retired legacy row) shows "Connector",
 * unlinked.
 */
export function connectionTypeOf(integration: { config: Record<string, unknown> | null | undefined }): ConnectionTypeRef {
  const config = integration.config ?? {};
  const ref = config.definition as { key?: unknown; version?: unknown; origin?: unknown } | undefined;
  if (!ref || typeof ref.key !== "string" || (ref.origin !== "builtin" && ref.origin !== "custom")) return { name: "Connector", version: null, href: null };
  const version = typeof ref.version === "string" ? ref.version : null;
  const manifest = config.manifest as { name?: unknown } | undefined;
  const builtin = ref.origin === "builtin" ? BUILTIN_DEFINITIONS.find((d) => d.key === ref.key) : undefined;
  const name = typeof manifest?.name === "string" && manifest.name ? manifest.name : (builtin?.name ?? ref.key);
  return { name, version, href: connectionTypeHref(ref.origin, ref.key) };
}
