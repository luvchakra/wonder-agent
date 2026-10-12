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

/**
 * `none`: a connector that only receives (events, webhooks, gateway calls) and reads nothing.
 * `file`: CSV files, fetched from an HTTPS address or sent to the connection's `file` receiver.
 */
export const CONNECTOR_DRIVERS = ["http", "ldap", "sql", "mcp", "file", "none"] as const;
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
  // FOUNDATION-P0-32: people to invite as members of WonderID (imported from the users page).
  "member",
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
  // FOUNDATION-P0-32: a member is identified by e-mail; Foundation applies them as invitations.
  member: {
    required: ["externalId", "email"],
    optional: ["displayName", "roles", "accountType", "authMethod"],
    arrays: ["roles"],
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

/**
 * INTEGRATION-P0-21: where an authorization-code connection keeps its tokens
 * inside its encrypted credential. A definition's secret fields may not use
 * these names (or any name starting with `_`).
 */
export const OAUTH_TOKEN_KEYS = { refresh: "_oauth_refresh_token", access: "_oauth_access_token", expiresAt: "_oauth_expires_at" } as const;

/** INTEGRATION-P0-21: how a private key signs a JWT assertion. */
export const JWT_ALGORITHMS = ["RS256", "ES256"] as const;
export type JwtAlgorithm = (typeof JWT_ALGORITHMS)[number];

/** Authentication. Secret values are only ever referenced here, as `{secret.<key>}`. */
export type AuthSpec =
  | { type: "none" }
  | { type: "basic"; username: string; password: string; fields: SecretField[] }
  | { type: "bearer"; token: string; fields: SecretField[] }
  | { type: "header"; name: string; value: string; fields: SecretField[] }
  | { type: "query"; name: string; value: string; fields: SecretField[] }
  /** INTEGRATION-P0-21: an API key sent as a field of every request's JSON body (the API takes POST only). */
  | { type: "body"; name: string; value: string; fields: SecretField[] }
  | {
      type: "oauth2_client_credentials";
      tokenUrl: string;
      clientId: string;
      /** Required unless the client proves itself with a private key (private_key_jwt, or the jwt_bearer grant). */
      clientSecret?: string;
      scope?: string;
      /**
       * How the client proves itself: its secret in the form body (default)
       * or HTTP Basic, or (INTEGRATION-P0-21) a JWT signed with its private
       * key (RFC 7523 `private_key_jwt`).
       */
      clientAuth?: "body" | "basic" | "private_key_jwt";
      /**
       * INTEGRATION-P0-21: `jwt_bearer` asks for a token with a signed
       * assertion instead (RFC 7523 §2.1, the service-account flow), issued
       * by `clientId` for `subject` (default the client itself).
       */
      grant?: "client_credentials" | "jwt_bearer";
      /** `{secret.…}`: the PEM private key that signs assertions. */
      privateKey?: string;
      /** RS256 (default) or ES256. */
      algorithm?: JwtAlgorithm;
      keyId?: string;
      subject?: string;
      fields: SecretField[];
    }
  /**
   * INTEGRATION-P0-21: OAuth 2.0 authorization code with PKCE. An
   * administrator connects once on the system's own sign-in page; the
   * callback arrives at the connection's receiver; the refresh token is kept
   * encrypted with the connection's credentials and used for every sync.
   * `authorizeUrl` and `tokenUrl` are paths or start with a url setting.
   */
  | {
      type: "oauth2_authorization_code";
      authorizeUrl: string;
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
      /** Extra query parameters for the sign-in page (access_type=offline, prompt=consent); never secrets. */
      authorizeParams?: Record<string, string>;
      fields: SecretField[];
    }
  /** INTEGRATION-P0-21: mutual TLS: the connection presents a client certificate (PEM) to its own address only. */
  | { type: "client_certificate"; certificate: string; privateKey: string; fields: SecretField[] }
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
  /** Reads and the test use GET or POST; writes (`write`) may also use PUT, PATCH and DELETE. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  | { contains: string }
  /**
   * INTEGRATION-P0-21: the part of the text a regular expression matches:
   * capture `group` (default the first group, or the whole match when the
   * pattern has none); null when it does not match.
   */
  | { regex: string; group?: number }
  /** Every occurrence of this text replaced (not a pattern). */
  | { replace: string; with: string }
  /** When the value is empty, the first of these fields that is not. */
  | { coalesce: string[] }
  /** The date moved by this many days (or months, or years); null when the value is not a date. */
  | { dateAdd: number; unit?: "days" | "months" | "years" };

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

export type ChangesSpec = { request: HttpRequestSpec; records?: string | string[]; pagination?: Pagination };

/** The cursor values a `changes` request may use. */
export const CURSOR_FIELDS = ["since", "sinceEpoch", "sinceEpochMs"] as const;

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
   * file driver: where this kind's CSV comes from. Each row is a record
   * keyed by its column names, matched case-insensitively and ignoring
   * spaces, `_` and `-` ("Work Email" is read as `workemail`). Without a
   * `url` (or when it fills to nothing), the newest file sent to the
   * connection's `file` receiver for this kind is read.
   */
  file?: FileSourceSpec;
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
  /**
   * INTEGRATION-P0-21: how to ask the system for only what changed since the
   * last successful sync (http driver, a resource without forEach or
   * unwind). The request uses `{cursor.since}` (ISO 8601),
   * `{cursor.sinceEpoch}` or `{cursor.sinceEpochMs}`; records and
   * pagination default to the resource's own. Scheduled syncs use it; a
   * full sync (and everything that verifies a change) reads the whole list.
   */
  changes?: ChangesSpec;
  /** Keep only records matching every filter. */
  where?: RecordFilter[];
  /** A 404 means "none" rather than a failed sync (an empty LIST in Vault, a feature not enabled). */
  optional?: boolean;
  fields: Record<string, FieldMapping>;
  /** Hard ceiling for one sync (default 50 000). */
  maxRecords?: number;
};

/**
 * INTEGRATION-P0-11 / P0-13 (decision D3, 2026-10-12): the writes a
 * definition can make. Reversible ones come first: removing an
 * entitlement from an account and disabling an account.
 */
export const DEFINITION_WRITE_OPERATIONS = ["revoke_access", "disable_account", "grant_access", "create_account"] as const;
export type DefinitionWriteOperation = (typeof DEFINITION_WRITE_OPERATIONS)[number];

/**
 * One write (http driver): a request whose path, query, headers and body
 * strings may use `{settings.…}` and the target, `{target.account}` (the
 * account's id in the system) and, for revoke_access,
 * `{target.entitlement}` (the entitlement's id there). A connection
 * declares what its definition supports but writes only once an
 * administrator turns writes on for it.
 */
/**
 * INTEGRATION-P0-22: an LDAP change. `dn` is the entry: exactly
 * `{target.account}` or `{target.entitlement}` (a DN WonderID read), or a
 * template whose filled values are escaped as DN values (RFC 4514).
 * `modify` changes attributes of an existing entry; `add` creates one.
 */
export type LdapWriteSpec = {
  dn: string;
  modify?: { operation: "add" | "delete" | "replace"; attribute: string; values: string[] }[];
  add?: Record<string, string[]>;
};

/**
 * One declared change: an http request (http driver) or an LDAP change (ldap driver).
 * WID-H02: `repeatable: true` declares that sending the same http change
 * twice cannot make it twice: the system honours `Idempotency-Key`, or the
 * change sets a state (adds a member who may already be there, sets
 * `active` to false). Only then is a change whose outcome is unclear (a
 * timeout, a 5xx) sent again without reading the system first. LDAP
 * changes are always repeatable: "already there" counts as done.
 */
export type WriteSpec = { request: HttpRequestSpec; repeatable?: boolean; ldap?: never } | { ldap: LdapWriteSpec; request?: never; repeatable?: never };

export type FileSourceSpec = {
  /** `{settings.<url setting>}`: the HTTPS address of the CSV. Empty means "read uploaded files". */
  url?: string;
  /**
   * `{settings.<string setting>}` holding column renames, one per line or
   * `;`-separated: `email = Work Email`, or `identity.email = Work Email`
   * for one kind only. That column is then read as the field's name.
   */
  columns?: string;
  /** Field separator (default `,`). */
  delimiter?: "," | ";" | "\t" | "|";
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
  /** What this connector can change in the system (see WriteSpec). Absent: read-only. */
  write?: Partial<Record<DefinitionWriteOperation, WriteSpec>>;
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
  /**
   * CSV files for a file connector: POST /api/connect/v1/<id>/file, one
   * kind per request (header `x-wonderid-kind`), authenticated by the
   * connection's receiving secret. The stored file is read by the sync the
   * upload starts.
   */
  file?: { auth: "bearer" | "hmac_sha256"; signatureHeader?: string };
  /**
   * INTEGRATION-P0-22: users pushed over SCIM 2.0 (RFC 7644) to
   * /api/connect/v1/<id>/scim/v2/Users, authenticated by the connection's
   * receiving secret as a bearer token. Each user is kept as an `identity`
   * of this connection, mapped with `fields` (paths into the SCIM user; the
   * enterprise extension is also under `enterprise`); the identity sources
   * that read the connection then take it in. A deleted user is marked
   * missing, so the next run treats it as a leaver.
   */
  scim?: { fields: Partial<Record<(typeof CANONICAL_FIELDS)["identity"]["optional"][number], FieldMapping>> };
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
  /** INTEGRATION-P0-21: when the connection last moved to another version; earlier runs are no base for an incremental read. */
  upgradedAt?: string;
  /** The url setting the existing outbound guard checks at creation. */
  baseUrl?: string;
};

export type DefinitionIssue = { path: string; message: string };
