# The WonderID connector framework

How WonderID reads identities and access from an organization's systems, and
how to write a connector for a system WonderID does not support yet.

Code: `modules/integrations/framework`. Built-in connectors:
`modules/integrations/framework/definitions`. Storage of organizations' own
connectors: `connector_definitions` (migration 0108).

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
                                 sync job ─▶ engine ─▶ driver (http | ldap | sql)
                                                        ▼
                                 integration_objects (identity, account, entitlement, access_grant, application)
                                                        ▼
                                 identity sources, account inventory, access, risk
```

## Using a connector

1. Go to **Integrations → Connect a system** and pick the product.
2. Enter a name, the settings and the credentials, then select **Connect**.
   - WonderID tests the credentials before storing them, and encrypts them
     (AES-256-GCM).
   - If the test fails, the integration is saved without credentials and
     the page says so.
3. On the integration's page, select **Run sync now**, or let the schedule run.
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

Each one is verified against a real system by
`modules/integrations/framework/live.test.ts` (see "Certifying a connector").

## Writing a connector

Go to **Integrations → Connect a system → Write a connector**, or start from
an existing one ("Use as a starting point" on its connect page).

The page checks the definition as you type, using the same rules the server
applies. **Try it against a system** runs one resource against a real system
without saving anything; that run is audited. **Publish** saves the
version for your organization only.

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
| `driver` | `http` (REST/JSON), `ldap` (LDAPS) or `sql` (PostgreSQL) |
| `settings` | Non-secret values the organization enters. `type` is `url`, `string`, `number`, `boolean` or `select` (with `options`). Each has an optional `default`. One `url` setting is the base address (`baseUrl` when present). |
| `auth` | How to authenticate. Secret values are declared in `auth.fields` and referenced only as `{secret.<key>}`. |
| `test` | A cheap authenticated call (`request`, `search` or `query`) that proves the connection works. |
| `application` | The application name recorded on accounts and entitlements. It may use `{settings.…}`. |
| `resources` | One request per canonical kind, or a list of up to 10 whose records are combined. |
| `rateLimitPerSecond` | Request rate. The default is 10. |

### Authentication (`auth.type`)

| Type | Driver | Fields |
|---|---|---|
| `none` | http | |
| `basic` | http | `username`, `password` |
| `bearer` | http | `token` |
| `header` | http | `name` and `value`, for example `Authorization: token {secret.key}:{secret.secret}` |
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

Conventions the built-in connectors follow, so downstream modules can rely on them:

- `status` is `active`, `inactive`, `disabled`, `terminated`, `suspended`, `expired` or `pending`.
- `accountType` is `human` or `service`.
- `privilegeLevel` is `standard`, `elevated` or `admin`.
- Dates are `YYYY-MM-DD`.

### A resource (one request)

| Field | Driver | Meaning |
|---|---|---|
| `request` | http | `{ path, method?, query?, headers?, body? }`. `path` must be relative. Templates may use `{settings.…}`, and `{parent.…}` under `forEach`. |
| `records` | http | Dot path to the list in the response (`"data"`, `"ocs.data.users"`). `""` means the response is the list. Plain values (ids, names) become `{ "value": … }`. |
| `recordsKeyed` | http | The `records` path holds an object keyed by id. Each value is one record, and its key is available as `_key`. |
| `pagination` | http | See below |
| `search` | ldap | `{ base, filter, scope?, attributes? }`. Paged automatically. Under `forEach`, template values are LDAP-escaped. |
| `query` | sql | One `SELECT` or `WITH` statement, with no templates. It runs in a read-only transaction with a row limit. |
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
| `offset` | `param`, `sizeParam`, `size` | Item offsets, such as Keycloak's `first`/`max` |
| `cursor` | `param`, `from` (path to the next token), `sizeParam?`, `size?` | Kubernetes `continue`, cursor APIs |
| `link_header` | `sizeParam?`, `size?` | RFC 8288 `Link: <…>; rel="next"`, as in Gitea and GitHub-style APIs. The next link must stay on the same origin. |
| `scim` | `size` | SCIM 2.0 `startIndex` and `count` |

**Field mappings.** A mapping is one of:

- `"path.to.field"`;
- `{ "path": "…" }`;
- `{ "template": "{record.a} {record.b}" }`;
- `{ "value": constant }`.

Each form also takes an optional `transform` list and a `default`. In a path:

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
