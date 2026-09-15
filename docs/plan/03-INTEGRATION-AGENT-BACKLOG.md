# 03 — Integration Agent Backlog

**Agent name:** `Integration Agent`
**Module:** Integration Hub & Connectors
**Branch:** `module/integration`
**Status:** DORMANT — do not start until the user says "Run Integration Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every non-"Done" row is in
`docs/design/integration-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| INTEGRATION-P0-01.1 | Adapter contract & capability declaration | Done |
| INTEGRATION-P0-01.2 | Schema (higher bar on credential storage) | Done |
| INTEGRATION-P0-01.3 | `integration_sync_jobs` | Done |
| INTEGRATION-P0-01.4 | Normalized object storage | Done |
| INTEGRATION-P0-02.1 | Saviynt REST adapter | Partial — endpoint paths/HTTP method/pagination/auth verified against Saviynt's real API reference; response field names still unconfirmed against a live tenant |
| INTEGRATION-P0-02.2 | Sync status & health surfaces | Done |
| INTEGRATION-P0-03.1 | Configurable connector | Done — this is the connector the critical acceptance test runs against |
| INTEGRATION-P0-03.2 | Object/field mapping UI | Done |
| INTEGRATION-P0-04.1 | MCP server registration & tool discovery | Done — 2026-09-14: `object_type` classification question resolved now that Runtime Agent's `runtime_tools` model exists — confirmed to be a genuinely different concept (DID-only, populated solely from observed runtime events) from MCP discovery-time data, so `entitlement` remains the correct classification; see audit log |
| INTEGRATION-P0-04.2 | Runtime event ingestion via MCP (higher bar) | Done |
| INTEGRATION-P0-04.3 | Webhooks (generic inbound) | Done |
| INTEGRATION-P0-05.1 | Verified credential rotation (no overwrite until new credential proven) | Done — 2026-09-14, unit-tested |

---

## Dependencies

- **Foundation Agent**: tenant context, RBAC, `encryptSecret()`/`decryptSecret()`
  (credentials must use this, never a bespoke crypto implementation), `writeAudit()`.
- **Identity Agent**: publishes the identity-correlation contract Integration's
  imports feed into (Identity's `agent_identities` and the "discovered,
  unregistered" inbox from IDENTITY-P0-01.3). Integration does not write into
  Identity's tables directly — it writes to its own `integration_objects` and
  exposes a normalized read contract Identity/Access consume.

## Owned entities

`integrations`, `integration_types`, `integration_credentials`,
`integration_sync_jobs`, `integration_objects`, `integration_mappings`.

## Consumed entities

Foundation's tenant/RBAC/crypto primitives.

## Published contracts

- `lib/shared/types/integrations.ts`: `IntegrationType`, `ConnectorCapabilities`,
  `NormalizedIdentity`, `NormalizedAccount`, `NormalizedApplication`,
  `NormalizedEntitlement`, `NormalizedAccessGrant`, `SyncJobStatus`.
- `modules/integrations/connector.ts`: the connector adapter interface every
  connector implements (below). Identity/Access agents call
  `modules/integrations/service.ts`'s `getNormalizedObjects(integrationId, objectType)`
  to read imported data — never query `integration_objects` directly.
- `POST /api/v1/integrations/:id/sync` — triggers a sync job. Other modules never
  call a connector directly; they go through this route or the equivalent internal
  service function.

---

## Higher-bar stories

INTEGRATION-P0-01.2 (credential storage), INTEGRATION-P0-03.* (any operation that
could write back to a customer's IAM), and INTEGRATION-P0-04.2 (webhook signature
verification) are higher bar.

---

## Epic INTEGRATION-P0-01 — Connector Framework

### INTEGRATION-P0-01.1 — Adapter contract & capability declaration

Define the common adapter interface every connector implements:

```ts
interface ConnectorAdapter {
  authenticate(config: ConnectorConfig): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  discover?(): Promise<DiscoveredObject[]>;
  importIdentities?(): Promise<NormalizedIdentity[]>;
  importAccounts?(): Promise<NormalizedAccount[]>;
  importApplications?(): Promise<NormalizedApplication[]>;
  importEntitlements?(): Promise<NormalizedEntitlement[]>;
  importAccess?(): Promise<NormalizedAccessGrant[]>;
  importPolicies?(): Promise<NormalizedPolicy[]>;
  importActivity?(): Promise<NormalizedRuntimeEvent[]>;
  createAccessRequest?(request: AccessRequestInput): Promise<{ externalId: string }>;
  removeAccess?(grantRef: string): Promise<void>;
  getObject?(externalRef: string): Promise<DiscoveredObject | null>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}
```

Not every connector implements every optional method. Each connector declares its
capabilities explicitly, stored on the `integrations` row:

```json
{
  "importIdentities": true,
  "importAccounts": true,
  "importEntitlements": true,
  "importAccess": true,
  "importActivity": false,
  "provision": false,
  "deprovision": false
}
```

Any UI or downstream module must check the declared capability before offering an
action (e.g. don't show "Remove Access" for a connector with `deprovision: false`).

### INTEGRATION-P0-01.2 — Schema (higher bar on credential storage)

```sql
create table integration_types (
  id text primary key,        -- 'saviynt', 'generic_rest', 'mcp', 'webhook'
  display_name text not null,
  category text not null check (category in ('iam_iga','pam','cloud','ai_runtime','mcp','siem','ticketing','custom_api')),
  default_capabilities jsonb not null default '{}'::jsonb
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_type_id text not null references integration_types(id),
  name text not null,
  config jsonb not null default '{}'::jsonb,       -- non-secret config: base URL, mappings, pagination
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'configured' check (status in ('configured','connected','error','disabled')),
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table integration_credentials (
  integration_id uuid primary key references integrations(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  auth_type text not null check (auth_type in ('oauth2','api_key','basic','bearer','mtls')),
  encrypted_secret text not null,   -- output of Foundation's encryptSecret()
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
```

`integration_credentials` has RLS enabled but **no** select policy for any
role other than service-role — API routes that need to *use* a credential
(e.g. to run a sync) fetch it server-side via `supabaseServiceRole()`, decrypt just
before use, and never include it in any API response, log line, or client-bound
payload. The `GET /api/v1/integrations/:id` response must never include
`integration_credentials` fields, even redacted-looking ones — omit the relation
entirely and return only a boolean `hasCredentials`.

**Acceptance criteria:** a test asserts that no API response body, anywhere, ever
contains the substring from a stored encrypted secret or its decrypted plaintext,
and that `integration_credentials` is unreachable via the browser Supabase client
regardless of role.

### INTEGRATION-P0-01.3 — `integration_sync_jobs`

```sql
create table integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid not null references integrations(id) on delete cascade,
  trigger text not null check (trigger in ('manual','scheduled')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','partial')),
  started_at timestamptz,
  ended_at timestamptz,
  records_processed integer not null default 0,
  records_failed integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
```

Sync flow: `User → Start Sync → Create Job (queued) → Worker picks it up (running) →
Connector calls → Normalize → Validate → Upsert into integration_objects → Audit →
job status succeeded/failed/partial`.

For P0, "worker" may be an async function invoked from the API route handler using
`after()`/a queued Vercel function — **do not place a long-running connector job
inside the synchronous request/response cycle** of the triggering API call; the
triggering call creates the `queued` job and returns immediately, and a
separate execution path (background function, or a `/api/v1/integrations/jobs/:id/run`
endpoint invoked async) does the actual work. If the project's hosting setup makes a
proper durable job queue impractical without adding new infrastructure (e.g. Redis,
a queue service) — stop and report; do not silently add new infra, and do not
silently degrade to a synchronous blocking call either.

### INTEGRATION-P0-01.4 — Normalized object storage

```sql
create table integration_objects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid not null references integrations(id) on delete cascade,
  object_type text not null check (object_type in ('identity','account','application','entitlement','access_grant','policy','activity')),
  external_id text not null,
  raw jsonb not null,
  normalized jsonb not null,
  sync_job_id uuid references integration_sync_jobs(id),
  imported_at timestamptz not null default now(),
  unique (integration_id, object_type, external_id)
);

create table integration_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  object_type text not null,
  source_field text not null,
  target_field text not null
);
```

`normalized` conforms to the shared `Normalized*` types published for that
`object_type`. Upserts key on `(integration_id, object_type, external_id)` so
repeated syncs update rather than duplicate.

---

## Epic INTEGRATION-P0-02 — Saviynt Connector (READ-ONLY in P0)

### INTEGRATION-P0-02.1 — Saviynt REST adapter

Implement `authenticate`, `testConnection`, `importIdentities`, `importAccounts`,
`importApplications`, `importEntitlements`, `importAccess`, `importPolicies` against
Saviynt's REST API. `importActivity`/`createAccessRequest`/`removeAccess` are
declared `false`/absent in capabilities for P0 (READ-ONLY only, per the module
brief) — implementing them is explicitly P1.

**Worked example (from the PRD's central scenario):** a Saviynt integration is
configured, `testConnection()` succeeds, a manual sync runs `importIdentities`,
`importAccounts`, `importApplications`, `importEntitlements`, `importAccess` for
FinanceBot's service account, producing `integration_objects` rows normalized into:

```json
{
  "object_type": "account",
  "normalized": {
    "external_id": "svc-finance-ai",
    "application": "Snowflake",
    "entitlements": ["Financial_Reporting_READ", "CustomerDB_READ"]
  }
}
```

This is the exact data the Access Agent's SHOULD-vs-CAN critical acceptance test
depends on (CustomerDB access showing up even though it's not in the approved
contract).

### INTEGRATION-P0-02.2 — Sync status & health surfaces

Expose per-integration: last sync, next sync, duration, records imported, errors,
warnings — via `GET /api/v1/integrations/:id` and `GET
/api/v1/integrations/:id/jobs`. Support both scheduled (stored `next_sync_at`,
executed by whatever scheduling mechanism Foundation's infra allows — a Vercel cron
route is acceptable) and manual (`POST .../sync`) sync.

---

## Epic INTEGRATION-P0-03 — Generic REST Connector

### INTEGRATION-P0-03.1 — Configurable connector

Customer-configurable: base URL, auth type (OAuth 2.0, API key, Basic Auth "where
unavoidable", Bearer token; mTLS is P1/"where feasible" — implement only if trivial
with existing libraries, otherwise defer), headers, pagination style (offset/cursor),
rate limits (requests/sec cap respected by the connector's own request loop), and
per-object-type field mappings (stored in `integration_mappings`).

`testConnection()` must actually attempt a lightweight authenticated call and report
a real pass/fail — never a hardcoded success.

### INTEGRATION-P0-03.2 — Object/field mapping UI

A functional (not necessarily polished) configuration screen: pick an object type,
map source JSON fields to normalized target fields. Store as
`integration_mappings` rows and apply them during import normalization.

**DO NOT IMPLEMENT** a general-purpose visual mapping/transform DSL — a straight
field-to-field mapping table is P0 scope; scripted transforms are P1.

---

## Epic INTEGRATION-P0-04 — MCP Integration

### INTEGRATION-P0-04.1 — MCP server registration & tool discovery

An `integrations` row with `integration_type_id = 'mcp'` stores the MCP server
endpoint. `discover()` lists the server's declared tools; store them as
`integration_objects` with `object_type` extended conceptually to tools (reuse
`activity`/`entitlement` normalized shapes as appropriate, or extend the
`object_type` check constraint with `'mcp_tool'` if a cleaner fit — if unsure which
normalization better matches Runtime Agent's future consumption of `runtime_tools`,
record the question in the audit log rather than guessing which shape downstream
Runtime Agent stories expect).

Tool → agent association: a user links a discovered MCP tool to a registered agent
(consumes Identity Agent's `agents` list read-only; does not create/modify
`agents` rows itself).

### INTEGRATION-P0-04.2 — Runtime event ingestion via MCP (higher bar)

`POST /api/v1/integrations/mcp/:id/events` (or an equivalent ingestion path) accepts
runtime observation events from an MCP proxy/observation client and republishes them
in the normalized `NormalizedRuntimeEvent` shape for Runtime Agent to consume once it
exists. Integration does **not** own `runtime_events`/the SHOULD-CAN-DID engine — it
only receives, authenticates, and normalizes the raw event, then hands it off via a
publish contract (a table Runtime Agent reads, or a direct insert into
`runtime_events` performed through a function Runtime Agent publishes once it
exists — until Runtime Agent exists, buffer normalized events in
`integration_objects` with `object_type = 'activity'` so no data is lost, and record
in the audit log that a hand-off contract is pending).

Authenticate MCP proxy submissions with a per-integration shared secret or signed
request (stored via the same `integration_credentials` mechanism) — never accept
unauthenticated event ingestion.

### INTEGRATION-P0-04.3 — Webhooks (generic inbound)

A generic authenticated webhook receiver
(`POST /api/v1/integrations/webhooks/:integrationId`) verifying a signature (HMAC
with a per-integration secret, stored encrypted) before accepting the payload,
storing it as an `integration_objects` row for later normalization/processing by
whichever connector type it's configured against.

**Acceptance criteria:** a request with a missing/invalid signature is rejected
(401/403) and never persisted; a validly signed request is persisted and produces a
`writeAudit()` entry (`action: 'integration.webhook_received'`).

---

## Critical acceptance test

Configure a test integration (Generic REST against a mock/test API is sufficient),
validate credentials via `testConnection()`, execute a sync job end-to-end,
normalize identities/accounts/applications/entitlements/access into
`integration_objects`, persist correlation IDs and errors on the job record, and
prove credentials never reach client-side code (per INTEGRATION-P0-01.2's
acceptance criteria).

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`03_INTEGRATIONS.md`) that expands this module's P0/P1/P2 scope beyond what
was already tracked above. Reconciled against the existing Progress Tracker
(nothing already `Done` was reopened, and INTEGRATION-P0-02.1's `Partial`
status — including this session's real Saviynt endpoint/pagination
correction documented in `docs/design/integration-agent-backlog-audit.md` —
is left exactly as-is). The new doc's flat `INTEG-P0-01`..`INTEG-P0-11`
numbering maps onto this backlog's epic-based stories by content, not by ID;
one item is genuinely new.

### INTEGRATION-P0-05.1 — Verified credential rotation

The new doc's `INTEG-P0-10` ("Credential Rotation") requires: allow
credential replacement without exposing previous values, **and** failed
authentication must not delete existing valid configuration until the
replacement is verified. `modules/integrations/credentials.ts`'s
`setCredential()` already satisfies the first half (it updates
`integration_credentials` in place and never returns the old or new
plaintext value, only `{ ok: true }`), but it does not satisfy the second
half: it overwrites the stored encrypted secret immediately, with no call to
the connector's `testConnection()` against the new credential before
committing — so a bad replacement credential currently clobbers a working
one with no rollback. **Objective:** before persisting a rotated credential,
run the integration's `testConnection()` against the *new* value first; only
commit the overwrite on success, and on failure return an error while
leaving the existing (still-valid) `integration_credentials` row untouched.
**Acceptance criteria:** a test proves that submitting an invalid
replacement credential leaves the previously-stored encrypted secret
byte-for-byte unchanged and a subsequent sync still succeeds using the old
credential; a valid replacement still audits as
`integration.credential_rotated` exactly as today. **Not started.**

### Already covered, no new tracker row needed

- `INTEG-P0-01` (Common Adapter Contract) and `INTEG-P0-02` (Connector
  Capability Model) — both map onto the existing `INTEGRATION-P0-01.1`
  (adapter interface + declared capabilities on the `integrations` row).
- `INTEG-P0-03` (Saviynt Read Connector) and `INTEG-P0-04` (Saviynt
  Normalization) — map onto `INTEGRATION-P0-02.1` (`Partial`, unchanged) plus
  the `raw`/`normalized`/`external_id` shape already established by
  `INTEGRATION-P0-01.4`, which preserves source IDs, source attributes and
  the full raw source object for investigation.
- `INTEG-P0-05` (Generic REST Connector) — maps onto `INTEGRATION-P0-03.1`.
- `INTEG-P0-06` (MCP Registration) — maps onto `INTEGRATION-P0-04.1`.
- `INTEG-P0-07` (Runtime Webhooks) — maps onto `INTEGRATION-P0-04.3`: HMAC
  signature verification, per-integration secret, event IDs
  (`parsed.id`/`parsed.eventId`), and idempotent processing (upsert on
  `(integration_id, object_type, external_id)`) are already implemented.
- `INTEG-P0-08` (Sync Jobs) — maps onto `INTEGRATION-P0-01.3`
  (`integration_sync_jobs` queued/running/succeeded/failed/partial states).
- `INTEG-P0-09` (Connection Health) — maps onto `INTEGRATION-P0-02.2` (last
  sync, next sync, duration, counts, errors via `GET
  /api/v1/integrations/:id` and `.../jobs`).
- `INTEG-P0-11` (Source Traceability) — maps onto `INTEGRATION-P0-01.4`
  (`integration_id`, `external_id`, `sync_job_id` on every
  `integration_objects` row).

**Ownership-map flag for the user:** `INTEG-P1-05` (SIEM Integration) asks
for delivery status and retry tracking on outbound normalized-event/finding
exports to a SIEM. No existing table (`integrations`, `integration_types`,
`integration_credentials`, `integration_sync_jobs`, `integration_objects`,
`integration_mappings`) is a clean fit for tracking outbound export
delivery/retry state — this looks like it would need a new table (e.g.
`integration_exports` or similar) that isn't in
`docs/design/ownership-map.md` yet. Not created here; flagged for the user
to add to the ownership map (naturally Integration Agent-owned, but map
changes require the process this task's constraints reserve to the user)
before that P1 story is picked up.

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## P1

SailPoint, Entra, Okta, AWS, Azure, SIEM, ServiceNow connectors. Saviynt
write/remediation (`createAccessRequest`, `removeAccess`). Full provisioning.
Automated deprovisioning. mTLS for generic REST (unless trivial in P0). A real
durable job queue if the P0 approach proves insufficient.

- AWS/Azure activity adapters specifically for agent execution and resource
  access *evidence* (runtime-observation angle), not just identity/access
  import — distinct from the generic AWS/Azure connector line above
  (`INTEG-P1-04`).
- SIEM export of normalized security events/findings with delivery status
  and retry, once the ownership-map addition flagged above is resolved
  (`INTEG-P1-05`).

## P2

- Integration marketplace: versioned connector catalog, install/configure/
  test lifecycle and compatibility metadata (`INTEG-P2-01`).
- Scalable event streaming/ingestion without changing the canonical
  runtime-event model (`INTEG-P2-02`).
- Documented connector adapter SDK, contract tests and a connector
  certification process (`INTEG-P2-03`).

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. No new
Integration-owned story found — the document's P0-23 explicitly asks to
reuse this module's existing adapter contract, which is already the case
everywhere else in the backlog. `INTEGRATION-P0-05.1` (verified credential
rotation, flagged in the 2026-09-14 refresh) remains the one open,
`Not started` item; not duplicated here.

## DO NOT IMPLEMENT

- Writing into `agents`, `agent_contracts`, `applications`, `entitlements`, or any
  other module's canonical tables directly — publish normalized data through the
  contract; the owning module persists it into its own schema.
- Any risk/finding/policy-evaluation logic.
- Any UI beyond functional configuration/status screens (Experience Agent restyles).
