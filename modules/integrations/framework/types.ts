/**
 * The connector framework's definition format (schema version 1).
 *
 * A connector definition is data, not code: it says how to reach one
 * product (its settings, how to authenticate, which requests return which
 * records) and how each record maps onto WonderID's canonical objects.
 * One engine (engine.ts) runs every definition through a protocol driver,
 * so a new product needs a definition, never a new adapter class.
 *
 * WonderID ships built-in definitions (definitions/*); a system integrator
 * writes their own as JSON and stores it for their organization
 * (connector_definitions, migration 0108). Both go through validate.ts.
 *
 * Deliberately not a scripting language: mappings are field paths, string
 * templates and a closed list of transforms (`TRANSFORMS`). Anything that
 * would need code belongs in a driver, which WonderID owns and reviews.
 */

export const DEFINITION_SCHEMA_VERSION = 1;

export const CONNECTOR_CATEGORIES = [
  "hr",
  "identity_provider",
  "directory",
  "application",
  "database",
  "secrets",
  "infrastructure",
  "ai_runtime",
  "event_source",
  "other",
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

/** `none`: a connector that only receives (events, webhooks, gateway calls) and reads nothing. */
export const CONNECTOR_DRIVERS = ["http", "ldap", "sql", "mcp", "none"] as const;
export type ConnectorDriver = (typeof CONNECTOR_DRIVERS)[number];

/** The canonical object families a definition can produce (integration_objects.object_type). */
export const RESOURCE_KINDS = [
  "identity",
  "account",
  "entitlement",
  "access_grant",
  "application",
  "policy",
  "mcp_server",
  "mcp_tool",
  "mcp_resource",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Canonical fields per family. `externalId` is required everywhere. */
export const CANONICAL_FIELDS: Record<ResourceKind, { required: readonly string[]; optional: readonly string[]; arrays?: readonly string[]; objects?: readonly string[] }> = {
  identity: {
    required: ["externalId"],
    optional: [
      "displayName",
      "firstName",
      "lastName",
      "email",
      "username",
      "identityType",
      "subtype",
      "title",
      "department",
      "businessUnit",
      "location",
      "employmentType",
      "organization",
      "managerExternalId",
      "startDate",
      "endDate",
      "status",
    ],
  },
  account: {
    required: ["externalId"],
    optional: ["application", "username", "email", "displayName", "owner", "status", "accountType", "privileged", "lastLoginAt", "createdAt", "expiresAt", "entitlements"],
    arrays: ["entitlements"],
  },
  entitlement: {
    required: ["externalId", "name"],
    optional: ["application", "type", "description", "privilegeLevel", "dataClassification"],
  },
  access_grant: {
    required: ["externalId", "accountExternalId", "entitlementExternalId"],
    optional: ["grantType"],
  },
  application: {
    required: ["externalId", "name"],
    optional: ["category", "description"],
  },
  policy: {
    required: ["externalId", "name"],
    optional: ["type", "description"],
  },
  // The MCP families keep the field names Integration's MCP inventory reads (mcpInventory.ts).
  mcp_server: {
    required: ["externalId"],
    optional: ["endpoint", "serverName", "serverVersion", "protocolVersion"],
  },
  mcp_tool: {
    required: ["externalId", "name"],
    optional: ["description", "operation", "operationBasis", "destructive", "inputSchema"],
    objects: ["inputSchema"],
  },
  mcp_resource: {
    required: ["externalId", "uri"],
    optional: ["name", "mimeType"],
  },
};

/** What an inbound runtime event maps to before Runtime records it (runtime_events). */
export const RUNTIME_EVENT_FIELDS = {
  required: ["eventTime", "action", "success"],
  optional: [
    "externalId",
    "agentIdentityRef",
    "tool",
    "application",
    "resource",
    "dataClassification",
    "eventType",
    "sessionId",
    "correlationId",
    "mcpServer",
  ],
} as const;

export type SettingField = {
  key: string;
  label: string;
  type: "url" | "string" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  help?: string;
};

/** A secret value the organization enters. `optional` ones may be left empty (an MCP server without auth). */
export type SecretField = { key: string; label: string; help?: string; optional?: boolean };

/** Authentication. Secret values are only ever referenced here, as `{secret.<key>}`. */
export type AuthSpec =
  | { type: "none" }
  | { type: "basic"; username: string; password: string; fields: SecretField[] }
  | { type: "bearer"; token: string; fields: SecretField[] }
  | { type: "header"; name: string; value: string; fields: SecretField[] }
  | { type: "query"; name: string; value: string; fields: SecretField[] }
  | {
      type: "oauth2_client_credentials";
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
      /** Where the client credentials go: the form body (default) or HTTP Basic. */
      clientAuth?: "body" | "basic";
      fields: SecretField[];
    }
  | { type: "ldap_simple"; bindDn: string; password: string; fields: SecretField[] }
  | { type: "sql_password"; username: string; password: string; fields: SecretField[] };

export type Pagination =
  | { type: "none" }
  /** Page numbers: ?page=1,2,3… */
  | { type: "page"; param: string; sizeParam?: string; size: number; start?: number }
  /** Item offsets: ?first=0,100,200… (Keycloak). `in: "body"` sends them in a POST's JSON body (Saviynt). */
  | { type: "offset"; param: string; sizeParam: string; size: number; in?: "query" | "body" }
  /** A token from the response feeds the next request (Kubernetes `continue`). */
  | { type: "cursor"; param: string; from: string; sizeParam?: string; size?: number }
  /** RFC 8288 `Link: <…>; rel="next"` (Gitea, GitHub-style APIs). */
  | { type: "link_header"; sizeParam?: string; size?: number }
  /** SCIM 2.0: startIndex (1-based) and count, until totalResults. */
  | { type: "scim"; size: number };

export type HttpRequestSpec = {
  method?: "GET" | "POST";
  path: string;
  /** A list repeats the parameter (role[]=admin&role[]=agent). */
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  body?: unknown;
};

export const TRANSFORMS = ["lower", "upper", "trim", "first", "join", "string", "boolean", "not", "date", "number", "split", "present"] as const;
export type NamedTransform = (typeof TRANSFORMS)[number];
export type Transform =
  | NamedTransform
  | { map: Record<string, string | boolean | number | null>; default?: string | boolean | number | null }
  /** Whether the text starts with this prefix ("service-account-"). */
  | { prefix: string }
  /** Whether a list holds this value, or a space- or comma-separated text holds it as a word. */
  | { contains: string };

/**
 * Where a canonical field comes from:
 * - a string is a field path ("profile.email", "groups[].name");
 * - `template` builds a string from fields ("{firstName} {lastName}");
 * - `value` is a constant.
 */
export type FieldMapping =
  | string
  | {
      /** A list is tried in order; the first non-empty value wins ("username", then "id"). */
      path?: string | string[];
      template?: string;
      value?: string | number | boolean | null;
      transform?: Transform[];
      default?: string | number | boolean | null;
    };

/** Keeps a record when every given test passes. A path starting `parent.` reads the parent record. */
export type RecordFilter = {
  path: string;
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
  notIn?: unknown[];
  exists?: boolean;
  prefix?: string;
  notPrefix?: string;
};

export type ResourceSpec = {
  /** http driver */
  request?: HttpRequestSpec;
  /** Dot path to the array of records in the response; "" when the response is the array. A list is tried in order. */
  records?: string | string[];
  /** The records path holds an object keyed by id (Nextcloud): each value is a record, its key `_key`. */
  recordsKeyed?: boolean;
  pagination?: Pagination;
  /** ldap driver */
  search?: { base: string; filter: string; scope?: "base" | "one" | "sub"; attributes?: string[] };
  /** sql driver: one read-only statement. */
  query?: string;
  /** mcp driver: a JSON-RPC list method (tools/list, resources/list) or initialize. Paged by nextCursor. */
  rpc?: { method: "initialize" | "tools/list" | "resources/list" | "prompts/list" };
  /**
   * Run the request once per record of another resource, with that record
   * as `{parent.…}` (group → its members; user → its roles).
   */
  forEach?: ResourceKind;
  /** When that resource lists several requests, follow only this one (0-based). */
  forEachRequest?: number;
  /**
   * Turn each fetched record into one record per item of this list field,
   * with the fetched record as `{parent.…}` (an LDAP group's `member`
   * values become one membership each). Plain values arrive as `{ value }`.
   */
  unwind?: string;
  /** Keep only records matching every filter. */
  where?: RecordFilter[];
  /** A 404 means "none" rather than a failed sync (an empty LIST in Vault, a feature not enabled). */
  optional?: boolean;
  fields: Record<string, FieldMapping>;
  /** Hard ceiling for one sync (default 50 000). */
  maxRecords?: number;
};

export type ConnectorDefinition = {
  schemaVersion: 1;
  /** Stable id, lowercase with dashes: "keycloak", "frappe-hr". */
  key: string;
  /** Semantic version of this definition. */
  version: string;
  name: string;
  vendor?: string;
  category: ConnectorCategory;
  description: string;
  driver: ConnectorDriver;
  /** Non-secret settings the organization fills in. One `url` setting is the base address. */
  settings: SettingField[];
  auth: AuthSpec;
  /** A cheap authenticated call proving the connection works (none for a receive-only connector). */
  test?: { request?: HttpRequestSpec; search?: ResourceSpec["search"]; query?: string; rpc?: ResourceSpec["rpc"] };
  /** The application name recorded on accounts and entitlements ("{settings.realm}" allowed). */
  application?: string;
  /** One request per kind, or several whose records are combined (groups and roles). */
  resources: Partial<Record<ResourceKind, ResourceSpec | ResourceSpec[]>>;
  /** What the organization's systems may send WonderID (see ReceiveSpec). */
  receive?: ReceiveSpec;
  /** Requests per second (default 10). */
  rateLimitPerSecond?: number;
  /** Where an integrator can read about this product's API. */
  documentationUrl?: string;
};

export type RuntimeEventField = (typeof RUNTIME_EVENT_FIELDS.required)[number] | (typeof RUNTIME_EVENT_FIELDS.optional)[number];

/**
 * The receiving side: the only way an organization's systems may send data
 * to WonderID (CLAUDE.md non-negotiable #20). Each channel is served at
 * /api/connect/v1/<connection id>/<channel> and authenticated per
 * connection; nothing is accepted for a connection that is disabled.
 */
export type ReceiveSpec = {
  /**
   * Agent activity (tool calls, data access), recorded by Runtime as DID.
   * Authenticated by the connection's receiving secret: as a bearer token,
   * or as an HMAC-SHA256 signature of the raw body.
   */
  runtimeEvents?: {
    source: "mcp" | "rest" | "webhook";
    auth: "bearer" | "hmac_sha256";
    /** Header carrying the hex signature for hmac_sha256 (default x-wonderid-signature). */
    signatureHeader?: string;
    /** Path to a list of events in the body, for batches; "" or absent means the body is one event. */
    records?: string;
    fields: Partial<Record<RuntimeEventField, FieldMapping>>;
  };
  /** Any event, kept as an `activity` record for later processing. */
  webhook?: {
    auth: "bearer" | "hmac_sha256";
    signatureHeader?: string;
    /** Field holding the sender's event id, so a redelivery is not stored twice. */
    externalId?: string;
  };
  /**
   * The Runtime Gateway: an agent asks before it acts (authorize) and asks
   * which tools it may see (tools/filter). Authenticated by the agent's own
   * API key, which must belong to this connection's organization.
   */
  gateway?: { authorize: boolean; toolsFilter: boolean };
};

/** What an organization stores on an integration of type `connector`. */
export type ConnectorIntegrationConfig = {
  definition: { key: string; version: string; origin: "builtin" | "custom" };
  /**
   * The validated definition, snapshotted when the integration was created.
   * A connection to a built-in may omit it; the engine then uses exactly the
   * named built-in key and version from code.
   */
  manifest?: ConnectorDefinition;
  settings: Record<string, string | number | boolean>;
  /** The url setting the existing outbound guard checks at creation. */
  baseUrl?: string;
};

export type DefinitionIssue = { path: string; message: string };
