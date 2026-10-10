# The WonderID connector framework

How WonderID reads identities and access from an organization's systems, and
how to write a connector for a system WonderID does not support yet.

Code: `modules/integrations/framework`. Built-in connectors:
`modules/integrations/framework/definitions`. Storage of organizations' own
connectors: `connector_definitions` (migration 0108).

## The rule (non-negotiable #20)

There is no direct connection between WonderID and an organization's data.
Every flow goes through this framework:

- **Outbound.** Only the framework's drivers call an organization's systems.
- **Inbound.** Only a connection's receivers accept data from them, at
  `/api/connect/v1/<connection id>/…`. This includes the Runtime Gateway.
- **Files.** A CSV is read by a connector (the `file` driver), whether it
  is fetched on a schedule, sent to a connection, or imported from an
  object page (see "Files, schedules and imports").

Product modules read only what the framework stored.
`tests/architecture/connector-boundary.test.ts` scans the source and fails
when any other module calls out or opens a machine route. Widening its
allowlists needs the user's approval.

## The Connector Gateway

User requirement (2026-10-10): "all such connections should pass through one
gateway which sits between WonderID and external world". The user also
explicitly approved adding the gateway to the outbound allowlist of
`tests/architecture/connector-boundary.test.ts` (2026-10-10, as non-negotiable
#20 requires for any widening). Code:
`modules/integrations/gateway` (`gateway.ts`, with its pure rules in
`gatewayRules.ts`).

```text
WonderID ── sync, test, MCP discovery, preview ──▶ ┌─────────────────────┐ ──▶ organization's systems
                                                   │  Connector Gateway  │
WonderID ◀── /api/connect receivers ────────────── │  policies + ledger  │ ◀── organization's systems
                                                   └─────────────────────┘
```

- **One place.** The http, mcp, ldap and sql drivers are built only inside
  the gateway. A connector gets its drivers from a gateway session
  (`createDefinitionConnector(gateway)`), and every receiver request passes a
  session too (`receive.ts`). `connector-boundary.test.ts` fails if a driver
  is built anywhere else, or if a receiver stops going through it.
- **A session is one run**: a sync, a connection test, a credential check,
  an MCP discovery, a preview, or one received request. The caller opens it
  with the connection row (`openGateway({ tenantId, integrationId, status })`)
  and calls `flush()` in a `finally`.
- **Policies, in this order, for every outbound request:**
  1. the connection is not disabled (a disabled connection also receives
     nothing);
  2. the run's request budget is not spent (10,000 requests across every
     driver);
  3. the definition's `rateLimitPerSecond` (default 10) is honoured, as a
     token bucket. This used to live in the http driver alone; it now
     covers MCP, LDAP and SQL too.
  4. HTTP and MCP then go through `guardedFetch` (SSRF guard, redirects,
     20 s timeout, 10 MB response cap). LDAP and PostgreSQL connect only
     to an address `resolveSafeHost` vetted, with their own timeouts and
     row limits.
- **Traffic ledger** (`connector_traffic`, migration 0110). Each request is
  counted in memory per session: direction, operation (`http GET`,
  `mcp tools/list`, `ldap search`, `sql query`, `receive events`), host,
  outcome (`ok`, `error`, `blocked`), error category, bytes in and out, and
  duration. `flush()` writes once per session through
  `record_connector_traffic()`, which adds to the minute's row, so a busy
  connection produces at most one row per minute per kind of traffic.
  - Only the host name is recorded: never a path, query string, header,
    body, error message or credential. For inbound traffic the sender's
    address is not recorded at all.
  - Receivers record an authentication failure as `blocked`
    (`unauthenticated`), and a disabled connection as `blocked`
    (`disabled`). A request for a connection that does not exist is not
    recorded: there is no organization to account it to.
  - A preview of an unsaved definition is recorded under the organization
    with no connection ("Connector previews").
  - A failure to record is logged and never fails the run: the traffic
    already happened.
  - Members of the organization read it; only the service role writes it.
    Rows older than 30 days are purged by the daily retention cron
    (`/api/cron/privacy` calls `purge_connector_traffic()`).
- **Where to see it:** **Integrations → Gateway** (`/integrations/gateway`)
  shows the last 24 hours per connection, and each integration's page has a
  "Traffic (24h)" card.
- **Adding a driver** (for example a file driver): build it inside
  `gateway.ts` with `meteredDriver("<kind>", factory)` and add it to the
  session's `drivers`. Nothing else may construct it.

## The idea

A connector is a **definition**: JSON that describes one product's API. It
says which settings an organization enters, how to authenticate, which
requests return which records, and how each record maps onto WonderID's
canonical objects. One engine runs every definition, so supporting a new
product takes a definition, not new code.

- **Generic per product.** The `keycloak` connector works for any Keycloak.
  Each organization enters its own address, realm and credentials.
- **One connector per system.** HR, the identity provider, the directory and
  each application each get their own connection, so each keeps its own
  credentials, schedule and sync history.
- **Read only.** The framework imports. It has no write or remediation path
  (non-negotiable #12).
- **Not code.** Mappings use field paths, string templates and a fixed list
  of transforms. Anything that would need code belongs in a driver, which
  WonderID owns and reviews.

```text
definition (JSON) ──validate──▶ catalog ──connect──▶ integration (type "connector")
                                                        │  settings + encrypted secret
                                                        ▼
                                 sync job ─▶ engine ─▶ gateway ─▶ driver (http | ldap | sql | mcp | file)
                                                        ▼
                                 integration_objects (identity, account, entitlement, access_grant, application, policy, mcp_*)
                                                        ▼
                                 identity sources, account inventory, access, risk
```

## Connection types and connections

Integrations has two levels (user decision, 2026-10-10):

- A **connection type** is a definition: one kind of system and its
  protocol. **Integrations → Connection Types** (`/integrations/types`) lists
  the built-in types and your organization's, grouped by category, with the
  protocol, what each reads and receives, and its version. A type's page
  (`/integrations/types/{builtin|custom}/{key}`) shows the protocol details:
  driver (HTTP REST, MCP Streamable HTTP, LDAP, SQL, or receive only),
  authentication method and the fields it asks for (never their values),
  settings, pagination, rate limit, what it receives (each channel's path
  under `/api/connect/v1/<connection>/` and how the sender authenticates),
  origin, vendor and API reference. Its one action is **Create connection**.
- A **connection** is one of your organization's systems, connected with a
  type: its own settings, encrypted credentials, schedule and sync history.
  **Integrations → Connections** (`/integrations`) lists them with the type
  each was created from. **New connection** starts from the types list.

`describeConnectionType()` in `typeSummary.ts` derives the protocol details
from a definition, so the screens and the catalog summary say the same
thing; the receiving side comes from the definition's `receive`. The old `/integrations/connectors` pages redirect to the
new ones; the API paths below are unchanged.

## Using a connector

1. Go to **Integrations → Connection Types**, open the product's type and
   select **Create connection**
   (`/integrations/types/{origin}/{key}/connect`).
2. Enter a name, the settings and the credentials, then select **Connect**.
   - WonderID tests the credentials before storing them, and encrypts them
     (AES-256-GCM).
   - If the test fails, the integration is saved without credentials and
     the page says so.
3. On the integration's page, select **Run sync now**, or set a schedule
   (see "Files, schedules and imports").
4. For an HR connector, create an **identity source** with the source type
   "Integration" and choose the connection. The suggested mappings already
   read every canonical field (`normalized.*`).

An integration keeps a snapshot of the definition it was created with. A new
version of a definition never changes a running connection without its
owner's action.

## Built-in connectors

| Key | Category | Driver | Imports |
|---|---|---|---|
| `frappe-hr` | HR | http | identities (people, managers, joiners and leavers) |
| `erpnext` | application | http | accounts, roles, role assignments |
| `ldap-directory` | directory | ldap | accounts, groups, memberships |
| `keycloak` | identity provider | http | accounts (service accounts too), groups and realm roles, grants |
| `gitea` | application | http | accounts and bots, organization teams, membership |
| `mattermost` | application | http | accounts and bots, teams, membership |
| `nextcloud` | application | http | accounts, groups, membership |
| `postgresql` | database | sql | logins, group roles with their table privileges, membership |
| `openbao` | secrets | http | AppRoles, userpass logins, policies, assignments |
| `kubernetes` | infrastructure | http | service accounts, Roles and ClusterRoles, bindings |
| `saviynt` | identity provider | http | identities, accounts, endpoints, entitlements, assignments, security systems |
| `zendesk` | application | http | staff accounts, groups, membership |
| `mcp-server` | AI runtime | mcp | server, tools (classified read/write), resources; **receives** tool calls |
| `runtime-gateway` | AI runtime | none | **receives** Runtime Gateway calls and agent activity |
| `webhook` | event source | none | **receives** signed events from any system |
| `csv-file` | other | file | identities, accounts, entitlements, access, applications from CSV files at HTTPS addresses; **receives** CSV files |

Each one is verified against a real system by
`modules/integrations/framework/live.test.ts` (see "Certifying a connector").

## Receiving: how systems send WonderID data

A definition's `receive` section declares what the organization's systems
may send. Each channel is served per connection:

| Channel | Path | Sender proves itself with | What happens |
|---|---|---|---|
| `runtimeEvents` | `POST /api/connect/v1/<id>/events` | the connection's receiving secret, as `Authorization: Bearer …` or an HMAC-SHA256 (hex) of the raw body | Each event is mapped by the definition, validated, kept as the connection's `activity` evidence, and recorded by Runtime as DID. An unknown or ambiguous agent is quarantined (Shadow AI), never recorded. One event, or a list of up to 500. |
| `webhook` | `POST /api/connect/v1/<id>/webhook` | the receiving secret (bearer or HMAC) | The event is kept as an `activity` record; a redelivery with the same id is stored once. |
| `gateway` | `POST /api/connect/v1/<id>/gateway/authorize` and `…/gateway/tools/filter` | the agent's own API key, which must belong to the connection's organization | Runtime's decision (or tool filter) for that agent. |
| `file` | `POST /api/connect/v1/<id>/file`, the CSV as the body, header `x-wonderid-kind` (and optionally `x-wonderid-filename`) | the receiving secret (bearer or HMAC) | The file is checked, stored (`connector_files`) and read by the sync it starts. See "Files, schedules and imports". |

The rules every receiver follows:

- **Organization.** The organization is always the connection's own; nothing
  in a request can choose it, the connection or the event's source.
- **Disabled connections.** A connection that is disabled or deleted receives
  nothing.
- **Order of checks.** The sender is authenticated before the body is even
  parsed, so an unauthenticated sender learns nothing about the expected
  shape. Bodies are capped (1 MB for events and webhooks, 10 MB for a file,
  16 KB for the gateway).
- **The receiving secret.** WonderID issues it from the connection's page
  ("Issue secret") or `POST /api/v1/integrations/<id>/receiver-secret`. It is
  shown once and kept only encrypted. Replacing it stops the old one at once.

A runtime event maps to: `eventTime`, `action` and `success` (required);
`externalId` (makes redelivery a duplicate); `agentIdentityRef` (the agent's
WonderID id, or a reference an identity of it is linked under); `tool`,
`application`, `resource`, `dataClassification`, `eventType`, `sessionId`,
`correlationId` and `mcpServer`. WonderID's own format uses these names
directly (`definitions/runtime-event-fields.ts`).

## Files, schedules and imports

CSV is a connector type: the `file` driver. Every way a file reaches
WonderID ends in the same place, a file connection's sync, which maps the
rows with the definition and stores them in `integration_objects` like any
other connector.

### The file driver

- **One file per kind.** Each resource reads one CSV. Its `file.url` names a
  url setting holding the HTTPS address; when that is empty, the resource
  reads the newest file the connection received for its kind.
- **From an address.** Fetched through the Connector Gateway like the http
  driver (its policies and accounting, the SSRF guard), with the
  definition's auth (`none`, `bearer`, `basic` or
  `header`), a 20 s timeout and a 10 MB cap. Testing the connection reads
  each address and checks its columns.
- **Received files.** A sync reads the newest unread file per kind and marks
  it, and any older unread file of that kind, as read when the run ends. A
  newer file supersedes an older one that was never read.
- **The format.** RFC 4180: quoted fields with separators, line breaks and
  doubled quotes; CRLF, LF or CR; a byte-order mark. The first row names the
  columns. A file that has an unterminated quote, text after a closing
  quote, a row with a different number of fields, an unnamed or duplicate
  column, or more than 50,000 rows is refused whole, with the row.
- **Columns.** A record's keys are the column names, matched in any case and
  ignoring spaces, `_` and `-`: "Work Email" is read by the path
  `workemail`. A mapping usually lists alternatives
  (`{ "path": ["externalid", "id", "employeeid"] }`). `file.columns` names a
  string setting of renames, `identity.email = Work Email; account.username =
  Login`, so one connection can read its own headers without a new
  definition. Empty cells are left out, so a mapping's `default` applies.
  Columns no mapping reads are ignored (kept in the record's `raw`), so a
  WonderID export, which uses the canonical field names, imports back.
- **Before storing.** A received or imported file is checked first: its
  structure, then that the columns can fill every required field of the
  kind. A row that still cannot be mapped (an empty id) is reported on the
  sync job with its row number.

`csv-file` is the generic definition: five optional addresses (identities,
accounts, entitlements, access, applications), an application name for
accounts and entitlements without one, the column renames, an optional
Bearer token for the addresses, and the `file` receiver. By default each
column is read as the canonical field of the same name; an access row needs
`accountExternalId` and `entitlementExternalId` (its id is the two joined).

### Schedules

A connection's `schedule` (`integrations.schedule`) is `manual` (the
default), `daily` or `hourly`, set on its page ("Files" card for a file
connection). `GET /api/cron/connector-syncs` (Vercel Cron, bearer
`CRON_SECRET`) runs every due connection as an ordinary sync job of trigger
`scheduled`, for the connection's own tenant, audited as the system
(`integration.scheduled_sync_started`, then `integration.sync_completed`).
Each run is idempotent per connection and window (`d:2026-10-10` or
`h:2026-10-10T05`): a unique index refuses a second job for the same window.

The current Vercel plan allows daily crons only, so the cron runs once a day
(20:45 UTC). A daily connection runs once per day; an hourly one runs at
every cron run, which today is also daily. `hourly` is kept as chosen and
takes effect when the cron runs more often. A run that does not start within
the cron's time budget waits for the next run.

The same cron keeps each connection's newest five received files and
deletes older files a sync has read. An unread file is never deleted.

### Importing from an object page

User decision (2026-10-10): an import from an object page is **previewed
first** and **additive**. The rows go straight into that page's list: new
records are added and existing ones updated. A record missing from the file
is never removed, revoked or deactivated (there are no leavers here).

Two calls, both `multipart/form-data` with the same fields, both needing a
session with `integration.execute` (the permission that runs a sync) **and**
the page's manage permission (`identity.manage` for identities,
`access.manage` for the rest):

| Field | Value |
|---|---|
| `kind` | `identity`, `account`, `entitlement`, `access_grant` or `application` |
| `file` | the CSV, at most 10 MB and 5,000 rows |
| `scope` | the page (`people`, `external-identities`, `machine-identities`, `identities`): the type new identities get when the file has no `identityType` column |

1. **`POST /api/v1/imports/preview`** reads and maps the file with the File
   imports connection's definition and settings (exactly as its sync will)
   and matches each record against the page's records. Nothing is stored or
   changed. `200 { data: { kind, rows, counts: { new, update, unchanged,
   invalid, review }, columns, shown: [{ row, externalId, decision, values,
   changes: [{ field, from, to }], note }] } }`. At most 500 rows are sent
   (rows that will not be imported first); the counts cover the whole file.
2. **`POST /api/v1/imports`** (after the person clicks **Confirm import**).
   The file becomes an upload of the organization's single **File imports**
   connection (`csv-file`, created on first use, `config.purpose =
   "file_imports"`), whose sync reads, maps and stores it in
   `integration_objects`. What that sync stored (its `sync_job_id`) is then
   handed to the module that owns the records, which re-plans it against
   the current data and writes it. `200 { data: { jobId, integrationId,
   rows, counts: { created, updated, unchanged, skipped, failed }, problems:
   [{ row, externalId, message }] } }`.

Errors: `400 INVALID_FILE` with `details: [{ row, column?, message }]` (row 1
is the header; nothing was stored); `409` when the File imports connection
is disabled or reads that kind from an address; `502 SYNC_FAILED` when the
connection could not read the file (nothing was added).

The whole file is refused when a record appears twice (the sync would keep
only the last), when an account or entitlement file has no `application`
column (and the connection names no application), or above 5,000 rows.

**How each record is matched and written:**

| Kind | Matched by | Written by | Notes |
|---|---|---|---|
| identity | WonderID id, then source reference (`source_native_id`), then email, then username; several matches → **needs review** | Integration plans; Identity's `applySourcedIdentities` writes (precedence 1000, the lowest: a source of record such as HR keeps the fields it owns) | An empty cell changes nothing. New identities keep the external id as their source reference. Managers are set after every record has an identity. |
| application | WonderID id, then name | Access's `registerApplication` / `updateApplication` | A rename only when the row names the application by its id. |
| entitlement | WonderID id, then application + name | Access (`fileImport.ts`), batched | The application must already exist. |
| account | WonderID id, then application + external id | Access (`fileImport.ts`), batched | `owner` links an unlinked account to an identity; an account already linked keeps its owner. |
| access_grant | account + entitlement | Access's `createManualAccessGrant` | The same rules as access granted by hand (an AI agent's account, separation of duties). Existing access is left as it is. |

The service functions are `previewFileForObject(ctx, kind, scope, csvText)`
and `importFileForObject(ctx, kind, scope, filename, csvText)` in
`modules/integrations/service.ts`; the pure rules are
`modules/integrations/fileImportPlan.ts` and
`modules/access-governance/fileImportRules.ts`. Audit: every import
(`integration.file_imported`, with kind, row count, size and SHA-256) and
its outcome (`integration.file_applied`, with the counts), plus the owning
module's own events (`identity.created`/`identity.updated`,
`application.registered`/`application.updated`, `entitlement.imported`,
`account.imported`, `access.grant_created`). Never the rows' values.

In the app, the object page's **Actions → Import CSV…** dialog shows the
preview as a table in the page's own columns, with each row's result
(**New**, **Update** with old → new values, **No change**, **Needs review**,
**Not imported** with the reason), and **Confirm import** or **Cancel
import**. After the import it says what was added and updated, lists rows
not imported, and refreshes the page's list.

**Platform limit.** Vercel accepts request bodies up to 4.5 MB, so a file
sent or imported through the hosted app is limited to that; a file fetched
from an address can be 10 MB.

## Writing a connector

Go to **Integrations → Connection Types → Write a connection type**
(`/integrations/types/new`), or start from an existing one ("Use as a
starting point" under "Definition" on its type page).

The page checks the definition as you type, using the same rules the server
applies. **Try it against a system** runs one resource against a real system
without saving anything; that run is audited. **Publish** saves the
version for your organization only and opens its type page.

Versions are immutable. To change a definition, raise `version` and publish
again. Existing connections keep the version they were created with.

The same operations are available over the API (session authentication):

| Method and path | Permission | Does |
|---|---|---|
| `GET /api/v1/integrations/connectors` | `integration.read` | Lists the catalog: built-in definitions, then your organization's |
| `GET /api/v1/integrations/connectors/{builtin\|custom}/{key}` | `integration.read` | Returns one definition (`?version=`), plus your organization's versions of it |
| `POST /api/v1/integrations/connectors` | `integration.create` | Publishes a definition (the request body) |
| `POST /api/v1/integrations/connectors/preview` | `integration.create` | Runs one resource. Body: `{ manifest, settings, secret, resource, limit? }` |
| `POST /api/v1/integrations/connectors/connect` | `integration.create` | Creates a connection. Body: `{ origin, key, version?, name, settings, secret? }` |
| `POST /api/v1/integrations/{id}/connector-credentials` | `integration.update` | Replaces a connection's credentials. Body: `{ secret: { … } }` |

## Definition reference (schema version 1)

```json
{
  "schemaVersion": 1,
  "key": "acme-hr",
  "version": "1.0.0",
  "name": "Acme HR",
  "vendor": "Acme",
  "category": "hr",
  "description": "Employees from Acme HR.",
  "documentationUrl": "https://docs.acme.example/api",
  "driver": "http",
  "settings": [{ "key": "baseUrl", "label": "Acme HR address", "type": "url", "required": true }],
  "auth": { "type": "bearer", "token": "{secret.token}", "fields": [{ "key": "token", "label": "API token" }] },
  "test": { "request": { "path": "/api/me" } },
  "application": "Acme HR",
  "rateLimitPerSecond": 10,
  "resources": {
    "identity": {
      "request": { "path": "/api/people", "query": { "fields": "all" } },
      "records": "data",
      "pagination": { "type": "page", "param": "page", "sizeParam": "per_page", "size": 100 },
      "fields": {
        "externalId": "id",
        "displayName": { "template": "{record.first} {record.last}" },
        "email": { "path": "work_email", "transform": ["lower"] },
        "managerExternalId": "manager.id",
        "status": { "path": "state", "transform": [{ "map": { "Active": "active", "Left": "terminated" }, "default": "active" }] }
      }
    }
  }
}
```

### Top level

| Field | Meaning |
|---|---|
| `key` | Stable id: lowercase letters, digits and dashes, 2–63 characters. The keys of built-in connectors are reserved. |
| `version` | `major.minor.patch`. A published version never changes. |
| `category` | `hr`, `identity_provider`, `directory`, `application`, `database`, `secrets`, `infrastructure` or `other` |
| `driver` | `http` (REST/JSON), `ldap` (LDAPS), `sql` (PostgreSQL), `mcp` (an MCP server over Streamable HTTP), `file` (CSV files), or `none` (receives only) |
| `settings` | Non-secret values the organization enters. `type` is `url`, `string`, `number`, `boolean` or `select` (with `options`). Each has an optional `default`. One `url` setting is the base address (`baseUrl` when present). |
| `auth` | How to authenticate. Secret values are declared in `auth.fields` and referenced only as `{secret.<key>}`. |
| `test` | A cheap authenticated call (`request`, `search`, `query` or `rpc`) that proves the connection works. A `none` or `file` connector has none (a file connection's test reads its addresses). |
| `receive` | What the organization's systems may send WonderID (see "Receiving"). |
| `application` | The application name recorded on accounts and entitlements. It may use `{settings.…}`. |
| `resources` | One request per canonical kind, or a list of up to 10 whose records are combined. Empty for a `none` connector. |
| `rateLimitPerSecond` | Request rate. The default is 10. |

### Authentication (`auth.type`)

| Type | Driver | Fields |
|---|---|---|
| `none` | http, mcp, file, none | |
| `basic` | http, file | `username`, `password` |
| `bearer` | http, mcp, file | `token` (an optional token field sends no header when empty) |
| `header` | http, mcp, file | `name` and `value`, for example `Authorization: token {secret.key}:{secret.secret}` |
| `query` | http | `name` and `value` (avoid it where the API offers a header) |
| `oauth2_client_credentials` | http | `tokenUrl` (relative, or starting with a url setting), `clientId`, `clientSecret`, optional `scope`, `clientAuth` (`body` or `basic`). The token is cached, and refreshed once on a 401. |
| `ldap_simple` | ldap | `bindDn`, `password` |
| `sql_password` | sql | `username`, `password` |

### Canonical kinds and fields

`externalId` is required everywhere. It must be the system's own stable id.

| Kind | Required | Optional |
|---|---|---|
| `identity` | `externalId` | `displayName`, `firstName`, `lastName`, `email`, `username`, `identityType`, `subtype`, `title`, `department`, `businessUnit`, `location`, `employmentType`, `organization`, `managerExternalId`, `startDate`, `endDate`, `status` |
| `account` | `externalId` | `application`, `username`, `email`, `displayName`, `owner`, `status`, `accountType`, `privileged`, `lastLoginAt`, `createdAt`, `expiresAt`, `entitlements` (a list) |
| `entitlement` | `externalId`, `name` | `application`, `type`, `description`, `privilegeLevel`, `dataClassification` |
| `access_grant` | `externalId`, `accountExternalId`, `entitlementExternalId` | `grantType` |
| `application` | `externalId`, `name` | `category`, `description` |
| `policy` | `externalId`, `name` | `type`, `description` |
| `mcp_server` | `externalId` | `endpoint`, `serverName`, `serverVersion`, `protocolVersion` |
| `mcp_tool` | `externalId`, `name` | `description`, `operation`, `operationBasis`, `destructive`, `inputSchema` |
| `mcp_resource` | `externalId`, `uri` | `name`, `mimeType` |

Conventions the built-in connectors follow, so downstream modules can rely on them:

- `status` is `active`, `inactive`, `disabled`, `terminated`, `suspended`, `expired` or `pending`.
- `accountType` is `human` or `service`.
- `privilegeLevel` is `standard`, `elevated` or `admin`.
- Dates are `YYYY-MM-DD`.

### A resource (one request)

| Field | Driver | Meaning |
|---|---|---|
| `request` | http | `{ path, method?, query?, headers?, body? }`. `path` must be relative. Templates may use `{settings.…}`, and `{parent.…}` under `forEach`. |
| `records` | http, mcp | Dot path to the list in the response (`"data"`, `"ocs.data.users"`). `""` means the response is the list. A list of paths is tried in order (Saviynt: `["userlist", ""]`). Plain values (ids, names) become `{ "value": … }`. |
| `recordsKeyed` | http | The `records` path holds an object keyed by id. Each value is one record, and its key is available as `_key`. |
| `pagination` | http | See below |
| `search` | ldap | `{ base, filter, scope?, attributes? }`. Paged automatically. Under `forEach`, template values are LDAP-escaped. |
| `query` | sql | One `SELECT` or `WITH` statement, with no templates. It runs in a read-only transaction with a row limit. |
| `rpc` | mcp | `{ method }`: `initialize` (the server itself), `tools/list`, `resources/list` or `prompts/list`. Paged by `nextCursor`. Each tool gains `_operation`, `_operationBasis` and `_destructive` from the deterministic classification. |
| `file` | file | `{ url?, columns?, delimiter? }`: `url` is `{settings.<url setting>}` (empty: read received files), `columns` is `{settings.<string setting>}` holding renames, `delimiter` is `,` (default), `;`, tab or `\|`. One resource per kind; no `forEach` or `unwind`. |
| `forEach` | all | Runs the request once per record of another kind, which is available as `{parent.…}` (for example, a group's members). |
| `forEachRequest` | all | When that kind lists several requests, follows only this one (0-based). |
| `unwind` | all | Turns each record into one record per item of this list field. The record itself becomes the parent. |
| `where` | all | A list of filters. A record is kept only when all of them pass. |
| `optional` | http | A 404 means "none" rather than a failed sync. Use it for an empty LIST in Vault or OpenBao, or a feature that may be turned off. |
| `fields` | all | Canonical field → mapping |
| `maxRecords` | all | A ceiling for one sync. The default is 50,000. |

**Pagination** (`pagination.type`):

| Type | Fields | Use for |
|---|---|---|
| `none` | | One request returns everything |
| `page` | `param`, `sizeParam?`, `size`, `start?` (1 by default) | Page numbers |
| `offset` | `param`, `sizeParam`, `size`, `in?` (`query` or `body`) | Item offsets, such as Keycloak's `first`/`max`; `in: "body"` puts them in a POST's JSON body (Saviynt) |
| `cursor` | `param`, `from` (path to the next token), `sizeParam?`, `size?` | Kubernetes `continue`, cursor APIs |
| `link_header` | `sizeParam?`, `size?` | RFC 8288 `Link: <…>; rel="next"`, as in Gitea and GitHub-style APIs. The next link must stay on the same origin. |
| `scim` | `size` | SCIM 2.0 `startIndex` and `count` |

**Field mappings.** A mapping is one of:

- `"path.to.field"`;
- `{ "path": "…" }`;
- `{ "template": "{record.a} {record.b}" }`;
- `{ "value": constant }`.

Each form also takes an optional `transform` list and a `default`. A `path`
may be a list, tried in order: the first non-empty value wins. In a path:

- `a.b` reads a nested field;
- `list[]` spreads a list, and `list[0]` indexes it;
- a path starting `parent.` reads the parent record.

**Transforms**, applied in order:

- `lower`, `upper` and `trim`;
- `first`, the first item of a list;
- `join`, which joins a list with `, `;
- `split`, which splits on commas;
- `string`, `number` and `boolean`;
- `not`;
- `date`, which accepts ISO dates, epoch seconds or milliseconds, and LDAP generalized time;
- `present`, true when the value is non-empty;
- `{ "map": { from: to }, "default"? }`;
- `{ "prefix": "…" }`, true when the text starts with it;
- `{ "contains": "…" }`, true when a list holds the value, or a space- or comma-separated text holds it as a word.

**Filters** (`where` items): `{ path, equals?, notEquals?, in?, notIn?,
exists?, prefix?, notPrefix? }`. The path may start with `parent.`.

### Security rules the validator enforces

These hold for built-in and custom definitions alike:

- `{secret.…}` appears only inside `auth`, never in a path, a query, a
  header outside `auth`, or a field mapping.
- Request paths are relative. The organization's base address decides the
  host, so a definition cannot send credentials elsewhere. The OAuth token
  URL must be relative, or start from a url setting.
- Requests and next-page links stay on the origins of the organization's url
  settings. Every address also passes WonderID's outbound guard: no private,
  loopback or metadata addresses.
- LDAP is `ldaps://` only, and PostgreSQL always uses verified TLS. A private
  CA goes in a `caCertificate` setting; verification is never turned off.
- SQL is a single read-only statement: no DML, no DDL, `COPY` or `SET`, and
  no file or sleep functions.
- A definition is at most 256 KB. One sync is capped at 10,000 requests,
  2,000 pages per resource and 50,000 records per resource.

Records that cannot be mapped (for example, a missing `externalId`) are
counted and reported on the sync job. They are not stored half-filled.

A secret field may be marked `optional` (an MCP server that needs no token).
A query parameter may be a list, which repeats it (`role[]=agent&role[]=admin`).

A connection made from a built-in may store the definition's key and version
instead of a copy (`{ definition: { key, version, origin: "builtin" } }`). The
engine then uses exactly that version from code, and refuses a mismatch.

## Certifying a connector

`live.test.ts` runs connectors against real systems through the production
engine and outbound guard. For each connection it tests the connection,
imports every resource, and fails on any record it cannot map:

```bash
CONNECTOR_LIVE_FILE=connections.json [CONNECTOR_LIVE_ONLY=keycloak,gitea] \
  npx vitest run modules/integrations/framework/live.test.ts
```

`connections.json` is a list of
`{ "system", "connector", "settings", "secret" }` entries. The Planet Express
demo company (`demo-org/`) writes one for all ten built-in connectors. Keep
the file out of source control: it holds live credentials.

## Adding a built-in connector

1. Add `definitions/<key>.ts` and list it in `definitions/index.ts`.
   `definitions.test.ts` then validates it.
2. Seed a realistic instance in `demo-org/seed/<system>.py`, and record its
   connection with `connection(...)`.
3. Run the live test until every resource imports with no issues.
4. Record the work in `docs/design/integration-agent-backlog-audit.md`.
