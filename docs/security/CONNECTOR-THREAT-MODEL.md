# Connector threat model (WID-H05)

What an organization's connections can be made to do, what stops each
threat, and how we know it. It covers the connector framework
(`modules/integrations/framework`), the Connector Gateway
(`modules/integrations/gateway`) and the receivers (`/api/connect/v1/…`).
Non-negotiable #20 makes these the only way an organization's data enters
or leaves WonderID, so this is the whole external surface for connections.

Written 13 October 2026 for the high-risk register's WID-H05 ("a holistic
threat model"). Kept current with the code: a change to a control below
updates this file in the same pull request.

## What is protected

- **Other organizations' data.** The worst outcome is one organization's
  connection reading, writing or receiving another's.
- **WonderID's own infrastructure:** the database, cloud metadata
  endpoints, internal services and the platform's secrets.
- **The organization's credentials:** API keys, OAuth tokens, client
  certificates and private keys held for its connections.
- **The organization's own systems,** against changes it did not approve.

## Who can act, and how

| Actor | What they control |
|---|---|
| An organization's administrator (or a compromised account of one) | Connection settings: base URL, credentials, schedules; connection types (definitions); turning writes on |
| A connected system, or whoever controls its DNS or responses | Response bodies, status codes, redirects, DNS answers, timing |
| Anyone on the internet | Requests to `/api/connect/v1/<connection>/…` receivers |
| An automation credential | The administration API, within its role (WID-H06) |

## Trust boundaries

1. **Browser or API → WonderID:** authentication, the tenant from
   membership (non-negotiable #2), and permissions (`requirePermission`).
2. **WonderID → an organization's system (outbound):** only through a
   Gateway session opened for one connection of one organization.
3. **An organization's system → WonderID (inbound):** only receivers,
   each bound to one connection and authenticated by that connection's
   secret.
4. **Connector definition → engine:** a definition is data that the engine
   interprets. It is never code that WonderID runs.

## Threats and controls

| # | Threat | Control | Evidence |
|---|---|---|---|
| T1 | SSRF: a base URL or redirect pointed at internal addresses (private ranges, loopback, link-local, CGNAT, IPv6 internal, 6to4, Teredo, NAT64, IPv4-compatible) or cloud metadata | `checkOutboundUrl` on the address and every redirect hop; `guardedLookup` checks every resolved address at connect time and connects to the checked one; https only. The private-network exception is a platform setting, never an organization's. | `outboundPolicy.test.ts`, `outboundFetch.test.ts` |
| T2 | DNS rebinding: a name that resolves public at check time and private at connect time | The address resolved at connect time is checked and is the one used; no second lookup | `outboundFetch.test.ts` (rebinding cases) |
| T3 | Credential leakage on redirect | `Authorization`, API-key headers (including a connection's custom header), cookies and the client certificate are dropped on a cross-origin redirect; a 307/308 that would resend a body to another origin is refused | `outboundFetch.test.ts` "WID-H05" |
| T4 | Egress to hosts an organization never meant to reach (a wrong or malicious URL in a definition or setting) | **New, 13 Oct:** the organization's allowed-hosts list (Global Configuration, `integration.allowedHosts`, security permission). When set, the Gateway refuses any other host, for every driver (HTTP, MCP, files, LDAP, SQL) and every redirect. If the list cannot be read, it refuses everything (fails closed). | `gateway.test.ts`, `outboundPolicy.test.ts`, `registry.test.ts` "WID-H05" |
| T5 | Cross-tenant access through a connection | A Gateway session belongs to one connection of one organization. The file driver reads only that connection's received files. Writes are recorded and filtered by the server-resolved tenant (§14). | `fileDriver.test.ts`, `receiveFile.test.ts`, tenant-isolation SQL suites |
| T6 | Forged inbound data | Each receiver is bound to one connection, authenticated by its secret (bearer or HMAC-SHA256 of the raw body, constant-time compare); SCIM by its own token. Unauthenticated requests are refused and recorded. | `receive.test.ts`, `receiveGateway.test.ts`, `scim.test.ts` |
| T7 | Resource exhaustion from a hostile or broken system | Response cap 10 MB, timeouts, per-session request budget (10,000), page and record limits, definition rate limit, bounded transforms (regex pattern ≤ 200, input ≤ 2,000, catastrophic shapes refused) | `framework.test.ts`, `gateway.test.ts` |
| T8 | Unapproved changes in an organization's system | Writes are declared per definition, off until the organization turns them on, gated by approval and the mass-change guard (per hour), idempotent per task. A read-only SQL connection runs in `BEGIN READ ONLY` with a statement timeout. | QA-P0-26 E2E `connector-provisioning.spec.ts`; `connectorWriteRules.test.ts` |
| T9 | Secret exposure | Credentials are encrypted at rest (AES-256-GCM, rotatable), masked on read, never logged (`redact`), and never sent to the browser. The traffic ledger records host and operation only, never paths, queries, headers or bodies. | `maskSecret.test.ts`, `gateway.test.ts` (ledger has no secrets) |
| T10 | Code execution through a definition | Definitions are validated JSON interpreted by the engine. There is no script, template evaluation or plug-in code, so nothing a definition contains is run as code. | `definitions.test.ts`, `validate.ts` |

## Sandboxing

The register asks for connector sandboxing. WonderID runs no
organization-supplied code, so there is nothing to sandbox in the usual
sense:
- A definition is data. The engine reads it and calls one of five fixed
  drivers (HTTP, MCP, LDAP, SQL, file).
- Every request a driver makes passes the Gateway: allowed hosts,
  disabled state, budget, rate limit, then the SSRF guard.
- Each driver holds its own limits: timeouts, size caps, row limits,
  read-only SQL.

A process-level sandbox would be needed if connectors ever ran custom code
(a script step, a user-supplied plug-in). That is not built, and adding it
would change this model first.

## Database roles and tenant context

- The Gateway and connector workers use the service role, with an explicit
  tenant filter on every statement (§14).
- RLS stays on every table. Members read under RLS.
- The tenant of a run comes from the connection row WonderID created, never
  from the system's data (§14, "a new connector is tenant-scoped from its
  first row").

## Residual risks, accepted or open

- A connected system that the organization allows can still send wrong
  data. Reconciliation, the mass-missing hold and the completeness checks
  (WID-H03) limit the damage; they cannot make a source honest.
- Without an allowed-hosts list, any public host can be reached from a
  connection an administrator configures. The list is the organization's
  choice; it is off by default so existing connections keep working.
- Self-hosted deployments rely on the operator's network for anything the
  platform cannot see (for example an egress proxy). See
  `SECURITY-CONTROLS.md` §5 for the address rules per deployment.
