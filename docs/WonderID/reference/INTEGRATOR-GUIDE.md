# Integrator guide: what you can configure today

For a system integrator setting WonderID up for a customer. It lists what is
configurable now, where, and with which permission, and says what is still
planned. The planned items and their phases are in
`docs/WonderID/reference/WONDERID-FOUNDATION-DESIGN.md` §8.1 (the plan of record) and
§10. Checked against the code on 2026-10-12; keep this file in step with each
phase.

Two things to know first:

- **Everything is tenant-scoped.** You configure one organization at a time,
  signed in as a member of it with the permissions named below.
- **Scripts use an automation credential.** `/api/v1/*` accepts a signed-in
  session or `Authorization: Bearer wa_ac_…` from an approved automation
  credential (Admin → Users & Permissions → Automation Credentials, §10).

## 1. Connect systems

| What | Where | Permission |
|---|---|---|
| Browse connection types (built-in and your organization's) | Integrations → Connection Types (`/integrations/types`) | `integration.read` |
| Create a connection from a type: name, settings, credentials (tested before they are stored, then encrypted) | the type's page → Create connection | `integration.create` |
| Run a sync now; see sync history | the connection's page (`/integrations/{id}`) | `integration.update` |
| Schedule (daily; "hourly" also runs daily today) | every connection's page; `PUT /api/v1/integrations/{id}/schedule` | `integration.update` |
| Let a connection make approved changes in the system (add or remove access, create or disable accounts), when its connection type declares `write`. Off by default; failures go back to the task's owner | the connection's page → Changes in the system; `PUT /api/v1/integrations/{id}/writes` | `integration.update` |
| Replace credentials | the connection's page; `POST /api/v1/integrations/{id}/connector-credentials` | `integration.update` |

Built-in types: Frappe HR, ERPNext, LDAP directory, Keycloak, Gitea,
Mattermost, Nextcloud, PostgreSQL, OpenBao, Kubernetes, Saviynt, Zendesk, MCP
server, Runtime Gateway, webhook, CSV file (`CONNECTOR-FRAMEWORK.md`, "Built-in
connectors").

Planned: a schedule on every connection and incremental syncs (F1, F3);
provisioning writes (F3); Entra ID, an HR system and ServiceNow (F3).

## 2. Write a custom connector

A connector is a JSON definition, not code. Write one at Integrations →
Connection Types → **Write a connection type** (`/integrations/types/new`),
or open a built-in type and use **Use as a starting point**.

- The editor validates the definition as you type, with the server's rules.
- **Try it against a system** runs one resource against a live system without
  saving anything (the run is audited).
- **Publish** stores an immutable version for your organization.
- The same over the API: `GET/POST /api/v1/integrations/connectors`,
  `POST …/connectors/preview`, `POST …/connectors/connect` (permissions
  `integration.read`, `integration.create`).

What a definition can do: drivers `http`, `ldap`, `sql` (PostgreSQL, one
read-only statement), `mcp`, `file`, `none` (receive only); authentication
`none`, `basic`, `bearer`, `header`, `query`, `body`, `oauth2_client_credentials`
(with a secret, or a private key: `private_key_jwt` and the `jwt_bearer` grant),
`oauth2_authorization_code` (an administrator connects on the provider's own sign-in page),
`client_certificate` (mutual TLS),
`ldap_simple`, `sql_password`; pagination `none`, `page`, `offset`, `cursor`,
`link_header`, `scim`; field paths, templates, a fixed transform list and
`where` filters; `forEach`, `unwind`, keyed records; incremental `changes`
requests for scheduled syncs; export as a file and import elsewhere; upgrading a
connection to a newer version after a preview of what changes; inbound channels
(`receive`) for webhooks, files, runtime events and the gateway. The full
reference is `CONNECTOR-FRAMEWORK.md`, "Definition reference".

Needs a WonderID change today: other SQL engines; SOAP; transforms outside the fixed list
(which now includes `regex`, `replace`, `coalesce` and `dateAdd`). Write operations are
declared in a definition's `write` (see "Changes in the system"). These
are the extensions in the design's §5.8.2 (F3, F7).

## 3. Bring identities in

| What | Where | Permission |
|---|---|---|
| Identity source: template, identity type, precedence, authoritative flag and per-attribute authority, mapping rows, correlation rules (email, username, composite), leaver strategy and safety limit | Integrations → Identity Sources → New (`/integrations/sources/new`) | `integration.create` |
| Run a source: CSV upload or from a connection; full or partial; dry run first | the source's page; `POST /api/v1/integrations/identity-sources/{id}/runs` | `integration.update` |
| Resolve pending matches | `/integrations/correlations` | `integration.update` |
| Custom identity attributes: type, required, sensitive, unique, enum values, pattern | Admin → Identities → Identity Attributes (`/identities/attributes`); `/api/v1/identities/attributes` | `identity.manage` |
| Bulk import from CSV on any object page (people, accounts, entitlements, applications, access): preview, then apply, with a template to download | the page's Actions menu → Import; `POST /api/v1/imports[/preview]` | the page's own manage permission |

Mapping targets are the standard identity fields and, since INTEGRATION-P0-20,
the organization's active custom attributes for the source's identity type
(`attribute:<name>`). A mapping to an attribute that does not exist, is
retired or is for another identity type is refused. Values are typed by the
attribute's data type; an invalid value or a unique value another identity
holds leaves that record unapplied and reported. An authoritative source owns
the attributes it maps; others only fill blanks. A source's schedule runs with
its connection (INTEGRATION-P0-19).

## 4. Onboard the people who sign in

| What | Where | Permission |
|---|---|---|
| Invite a member, set status, assign roles | Admin → Users (`/settings/users/new`) | `user.manage` (invite), `users.update`, `users.suspend`, `users.remove` |
| Invite many members at once (FOUNDATION-P0-32): from a CSV with a preview (new, already a member, invalid), or by API (`POST /api/v1/users/invitations`, `dryRun` to preview; idempotent on e-mail). Invitations expire after Global Configuration's "Invitations expire after" (30 days by default) and can be sent again from the user's page | Admin → Users → Actions → Import CSV… | `users.invite` and `integration.execute` (CSV); `roles.assign` to give roles, and only roles within the inviter's own permissions. A script can call it with an automation credential (§10) |
| Custom roles from the permission catalogue | Admin → Roles (`/settings/roles`); `/api/v1/roles` | `role.manage` |
| Groups | Admin → User Groups (`/settings/groups`) | `groups.create`, `groups.update`, `groups.manage_members` |
| Scoped, time-boxed and MFA-conditioned role assignments; authorization policies | Admin → Users; Admin → Policies → Authorization Policies | `tenant.security.manage` (view with `permissions.view`) |
| SSO connection (SAML or OIDC) with claims-to-role mapping | Admin → Authentication → Single Sign-On (`/settings/sso`); `/api/v1/sso` | `sso.manage` |

The SSO sign-in itself waits on a Supabase SSO provider that the platform
owner configures; the claims-to-role mapping is ready. Bulk invitation and an
invitation API are FOUNDATION-P0-32 (F2).

## 5. Onboard an application

| What | Where | Permission |
|---|---|---|
| Register the application: name, type, vendor, category, URL, business and technical owner | `/access/applications/new` | `access.manage` |
| Onboarding wizard: mode (quick start, assisted, advanced), connector, entitlement source, account identifier field, correlation field, request policy, certification policy; then Validate → Simulate → Approve (a second person) → Promote | `/access/applications/{id}/onboarding`; `/api/v1/access/applications/{id}/onboarding` | `access.manage`; approval by a different person |
| Mapping proposals from an OpenAPI document or a sample record | the onboarding page | `access.manage` |
| Reconcile accounts from the connection | the application's page → Reconcile; `POST …/applications/{id}/reconciliations` | `access.manage` |
| Discovered applications | `/integrations/discovery` | `integration.read` |

The provisioning toggles in the wizard are recorded but do nothing until F3.
Entitlement types per application, classification rules (F4) and onboarding
templates with a questionnaire (F7) are planned.

## 6. Requests, approvals and packages

| What | Where | Permission |
|---|---|---|
| Request policies: who may ask (self, managers, access managers), durations, justification, risk threshold, auto-approval, approval route | Admin → Policies → Request Policies (`/access/request-policies`) | `access.manage` |
| Access packages: contents, eligible identity types and departments, owner | `/access/packages` | `access.manage` |
| Catalog visibility | follows the request policies | |

Approval creates no grant yet; fulfilment is a manual "mark fulfilled" until
F2.

## 7. Rules

None of these exist yet; they are phase F4 (lifecycle and attribute rules,
classification rules) and F7 (event subscriptions, outbound webhooks):

- birthright and mover rules (technical rules);
- attribute derivation (user update rules);
- "when this happens, do that" with notifications and webhooks.

What exists today: lifecycle events (joiner, mover, leaver) open fixed task
types for people to act on (`/identities/lifecycle`); agent policies with a
JSON condition over fixed agent facts (`/policies`), which report violations.

## 8. AI agents

| What | Where | Permission |
|---|---|---|
| Discovery inbox (fed by every connection that imports identities) and decisions | AI Agents / Onboarding → Agent Discovery (`/agents/discovery`) | `agent.read`, `agent.create` |
| Duplicate review | `/agents/duplicates` | `agent.create` |
| Register an agent; owners; versioned contract (purpose, approved applications, data, actions, autonomy, tools); lifecycle; API keys | `/agents/new`, `/agents/{id}` | `agent.create` (register), `agent.update` (owners, contract, lifecycle, keys) |
| Runtime Gateway connection and MCP server inventory | `/integrations/gateway`, `/integrations/mcp` | `integration.read` |
| Emergency controls: kill switch, tool and server suspension, session termination | Runtime (`/runtime`) | `tenant.security.manage` |
| Tuning: duplicate match percent, unregistered window, alert throttle, key rotation days, active keys per agent | Admin → Global Configuration (`/settings/configuration`) | `tenant.settings` |

Discovery rules, agent classes with contract templates and tool
classification overrides are IDENTITY-P0-22 (F6).

## 9. Tenant settings

| What | Where | Permission |
|---|---|---|
| Global Configuration (versioned, restorable) | `/settings/configuration`; `GET` / `PATCH /api/v1/tenant/configuration` (an object of setting keys and values; any invalid value refuses the whole save) | `tenant.settings`; session limits need `tenant.security.manage` |
| Organization name and details | `/settings` | `tenant.settings` |
| Notifications (each member turns optional e-mails on or off) | `/settings/notifications` | member |
| MFA, AI provider, privacy, billing | `/settings/security`, `/settings/ai`, `/settings/privacy`, `/settings/billing` | as labelled |

## 10. The API

Prefixes under `/api/v1/`: `access/*` (accounts, applications, catalog,
entitlements, grants, packages, request-policies, requests), `agents`, `audit`,
`authorization-policies`, `compliance`, `exports`, `findings`, `groups`,
`identities`, `imports`, `integrations/*` (connectors, correlations,
discoveries, identity-sources, types, `{id}`), `jobs`, `notifications`,
`policies`, `reports`, `risk`, `roles`, `runtime`, `search`, `sso`, `tenant`,
`users`, `automation-credentials`. Every route checks a permission
server-side.

**Authentication.** A signed-in session, or an automation credential
(FOUNDATION-P0-31): `Authorization: Bearer wa_ac_…`, on `/api/v1/*` only.

| What | Where | Permission |
|---|---|---|
| Create a credential for an application identity: a role, expiry (1–365 days, 90 by default), optional allowed addresses (CIDR), calls a minute (120 by default). The secret is shown once | Admin → Users & Permissions → Automation Credentials (`/settings/automation`); `POST /api/v1/automation-credentials` | `automation.manage` |
| Approve it. It works only after a second administrator approves (the creator cannot) | same page; `POST /api/v1/automation-credentials/{id}` `{ "action": "approve" }` | `automation.manage` |
| Extend (another administrator approves), rotate the secret, revoke, give or remove a role | same page → Manage; actions `request_extension`, `approve_extension`, `rotate`, `revoke`, `assign_role`, `remove_role` | `automation.manage` |

- A credential acts with its roles only, in its own organization. A role
  can carry only permissions its giver holds, and never `automation.manage`.
  The built-in **Configuration Administrator** role (integrations, policies,
  organization settings, notifications; no personal data) is the default.
- Every call is audited (`automation.api_call`) with the application identity
  as on-behalf-of. Refused calls: 401 (unknown, pending, expired, revoked),
  403 (role, or an address outside the allowlist), 429 (over the limit).
- Connection schedules: `GET` / `PUT /api/v1/integrations/{id}/schedule`.

Inbound, for the customer's systems: `/api/connect/v1/{connection}/…`
(webhooks, files, runtime events, the gateway), authenticated with the
connection's secret (`CONNECTOR-FRAMEWORK.md`, "Receiving").

## 11. Suggested setup order

1. Give the integrator's account the built-in Configuration Administrator
   role (scoped and time-boxed, with MFA). For scripts, create an
   application identity and an automation credential with the same role,
   and have another administrator approve it.
2. Connect the HR system and the directory; run syncs by hand until schedules
   run (F1).
3. Create identity sources for them; dry-run, fix mappings, run full.
4. Register and onboard applications; reconcile accounts; review pending
   matches.
5. Set request policies and packages.
6. Connect the Runtime Gateway or MCP servers; review the discovery inbox;
   register agents with owners and contracts.
7. Set Global Configuration.
8. Keep a record of every setting: configuration bundles for promotion
   between tenants are F7.
