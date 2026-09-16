# Integration Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — INTEGRATION-P0-01 through P0-04 (initial implementation)

**Agent:** Integration Agent · **Branch:** `claude/wonderagent-setup-lasmly` (same
environment-pinned-branch deviation Foundation/Identity recorded).

**Built — full P0 backlog in one pass:**

- **INTEGRATION-P0-01.1** — `ConnectorAdapter` interface
  (`modules/integrations/connector.ts`) with every import* method returning
  `{ externalId, raw, normalized? }` — `normalized` is populated directly by
  connectors that know their source API's shape natively (Saviynt), and left
  undefined by config-driven connectors (Generic REST) for the sync executor
  to fill in via stored field mappings. This one adjustment to the backlog's
  literal method signatures (`Promise<NormalizedX[]>` → `Promise<ImportedRecord<NormalizedX>[]>`)
  was necessary to let both connector styles share one sync path without
  Generic REST faking a mapping engine internally; flagging it here since it
  changes the interface shape the backlog sketched, even though the
  capability-declaration mechanism itself is unchanged.
- **INTEGRATION-P0-01.2 (higher bar)** — `integration_types` (seeded: saviynt,
  generic_rest, mcp, webhook), `integrations`, and `integration_credentials`
  (migrations `0019`-`0021`). `integration_credentials` grants **no** RLS
  policy at all — same treatment as Foundation's `platform_admins` — reachable
  only via `supabaseServiceRole()` from this module's own credential/connector
  code. Verified directly (see below) that the encrypted secret is
  unreachable via the client even for the owning tenant, and
  `GET /api/v1/integrations/:id` returns only a `hasCredentials` boolean,
  never a credential field.
- **INTEGRATION-P0-01.3** — `integration_sync_jobs` (migration `0022`).
  Client-facing INSERT is allowed but its `WITH CHECK` pins every result
  field to its just-created default (`status = 'queued'`, counts at 0, no
  timestamps) — closing a loophole a bare tenant check would leave open,
  where a client could otherwise INSERT a row already claiming
  `status = 'succeeded'` with fabricated counts. Only the trusted sync
  executor (`modules/integrations/syncJobs.ts`, via
  `supabaseServiceRole()`) may update a job afterward. Verified live: a
  same-tenant attempt to insert a job pre-set to `'succeeded'` was rejected
  by this `WITH CHECK`, not merely filtered.
- **INTEGRATION-P0-01.4** — `integration_objects` (migration `0023`, no
  client write policy at all — imported data is never hand-typed) and
  `integration_mappings` (migration `0024`, client-facing CRUD scoped via a
  join to `integrations.tenant_id`, since the table has no `tenant_id` column
  of its own per its schema in the backlog).
- **INTEGRATION-P0-02.1** — `SaviyntConnector`
  (`modules/integrations/connectors/saviynt.ts`), READ-ONLY (no
  `createAccessRequest`/`removeAccess`/`importActivity` capability, per P0
  scope). **Flagged, not silently assumed**: this sandbox has no live
  Saviynt tenant to test against, so the connector's endpoint paths
  (`/ECM/api/v5/...`) and field names (`accountname`, `entitlementname`,
  etc.) are built from Saviynt's commonly documented REST API conventions,
  not verified against a real deployment — confirm and adjust
  `config.endpoints` and the normalization functions against the actual
  customer tenant before production use. This does not block the module's
  critical acceptance test, which the backlog explicitly scopes to the
  Generic REST connector instead.
- **INTEGRATION-P0-02.2** — Sync status/health via `Integration.status`,
  `lastSyncAt`/`nextSyncAt`, and `GET /api/v1/integrations/:id/jobs` (list)
  plus `GET .../jobs/:jobId` (one). Scheduled sync (`next_sync_at`-driven) is
  not wired to an actual scheduler in P0 — only manual
  (`POST /api/v1/integrations/:id/sync`) is triggered end-to-end; the column
  and the `'scheduled'` trigger value exist for a future cron route to use.
- **INTEGRATION-P0-03.1** — `GenericRestConnector` plus the shared
  `RestHttpClient` (offset and cursor pagination, per-connector rate
  limiting, api_key/bearer/oauth2-as-bearer/basic auth; `mtls` explicitly
  rejected as not implemented in P0, per the backlog). This is the connector
  the module's critical acceptance test runs against.
- **INTEGRATION-P0-03.2** — `integration_mappings` CRUD plus
  `applyMappings()` (straight field-to-field dot-path copy, no scripted
  transforms, per the backlog's explicit DO-NOT-IMPLEMENT), and a bare
  functional mapping form on the integration detail page.
- **INTEGRATION-P0-04.1** — `McpConnector.discover()` speaks MCP's
  Streamable HTTP transport directly via a single `tools/list` JSON-RPC
  POST (no MCP client SDK dependency added). **Flagged, not silently
  guessed**: discovered tools are persisted as `integration_objects` with
  `object_type = 'entitlement'` — the closest fit among the existing
  seven-value enum for "a capability the agent may be granted" — since
  Runtime Agent's own `runtime_tools` model doesn't exist yet to confirm
  the better-fitting shape, exactly the situation the backlog said to flag
  rather than guess at silently. Tool→agent linking is **not** implemented
  here: it goes through Identity's own `linkAgentIdentity()`
  (`POST /api/v1/agents/:id/identities`, `identityType: 'mcp_server'`),
  which already exists — building a second link mutation in this module
  would have duplicated a write path Identity owns exclusively per the
  ownership map, and this module's own backlog already commits to
  "consumes Identity Agent's agents list read-only; does not create/modify
  agents rows itself."
- **INTEGRATION-P0-04.2 (higher bar)** — `POST /api/v1/integrations/mcp/:id/events`,
  authenticated by the integration's stored shared secret as a bearer token
  (never unauthenticated). Runtime Agent doesn't exist yet, so normalized
  events are buffered in `integration_objects` (`object_type = 'activity'`)
  rather than a `runtime_events` table that doesn't exist — the hand-off
  contract is explicitly pending, per the backlog's own instruction.
- **INTEGRATION-P0-04.3** — `POST /api/v1/integrations/webhooks/:id`, HMAC-SHA256
  over the exact raw request body (read via `request.text()`, never
  re-serialized JSON, so the signature is checked against the actual signed
  bytes), timing-safe comparison, using the same shared-secret mechanism as
  MCP events. A missing or invalid signature is rejected and never
  persisted — verified both by unit test (`webhooks.test.ts`) and live
  end-to-end (curl against a running server, see below).

**Verification run:**
- `npm run lint`, `npm run typecheck`, `npm run test` (26/26 passing across 6
  files — new: `mappings.test.ts` for `applyMappings()`'s dot-path
  resolution, `webhooks.test.ts` for HMAC accept/reject/tamper/malformed
  cases, `restHttpClient.test.ts` for offset pagination, cursor pagination,
  nested `dataPath` extraction, auth-header construction, and failure
  propagation), `npm run build` — all clean.
- Live smoke test against a locally started production server: unauthenticated
  hits to the webhook and MCP-event endpoints correctly return 401 with a
  clear rejection reason and never crash; **a real bug was caught and fixed
  this way** — `/integrations`, `/integrations/new`, and `/integrations/[id]`
  initially let an unauthenticated `ApiError` propagate out of the page
  component uncaught, producing a raw 500 instead of Identity's established
  redirect-to-sign-in pattern. Fixed to match that precedent; re-verified
  all three now return a 307 to `/sign-in`.
- Tenant isolation and credential-secrecy proof executed directly against the
  live dev Supabase project via the Supabase MCP `execute_sql` tool (same
  methodology as Foundation/Identity, for the same network-egress reason).
  Fixture: two tenants, one full integration graph each (integration +
  credential + sync job + object + mapping). Acting as Tenant A's user: every
  table returned only Tenant A's own rows; a same-tenant `SELECT` against
  `integration_credentials` returned **zero rows** (it has no policy at all,
  not even for the owning tenant); a same-tenant `INSERT` into
  `integration_objects` claiming a forged import was rejected; a same-tenant
  `INSERT` into `integration_sync_jobs` pre-set to `status = 'succeeded'`
  was rejected by the `WITH CHECK`; a cross-tenant `integration_mappings`
  insert (claiming Tenant B's `integration_id`) was rejected by the
  join-based policy; a cross-tenant `UPDATE` affected 0 rows. Fixture data
  deleted afterward; script committed at
  `tests/integration/tenant-isolation.sql`. `get_advisors` (security and
  performance) clean beyond the same previously-reviewed exceptions
  Foundation/Identity already accepted.

**Not started this session:** nothing in the P0 backlog was skipped — every
story has at least a `Done` or `Partial` entry in the Progress Tracker above.
Scheduled (cron-driven) sync execution is the one sub-piece left unwired (the
data model supports it; nothing invokes it yet) — noted under
INTEGRATION-P0-02.2 above rather than claimed as fully done.

**Dependencies consumed:** Foundation's `requirePermission()`, `writeAudit()`,
`encryptSecret()`/`decryptSecret()`, `supabaseServer()`/`supabaseServiceRole()`
— all used exactly as published, no modification to any Foundation file.
Identity Agent's `agents` domain is referenced only in documentation (the MCP
tool-linking note above) — no code in this module imports from
`modules/agent-identity/*`, since the actual linking UI lives on Identity's
own pages.

**Published this session, for Access/Runtime/Risk/Experience to consume once
dispatched:** `modules/integrations/service.ts` (barrel) and
`lib/shared/types/integrations.ts`. Most relevant to near-term dependents:
`getNormalizedObjects(tenantId, integrationId, objectType)` is the only
sanctioned way to read imported data (Access Agent will need this for
effective-access computation from Saviynt/Generic-REST imports), and the
MCP-event/webhook ingestion paths are the eventual feed for Runtime Agent's
`runtime_events` once that module exists and publishes a real hand-off
contract — until then, ingested activity sits in `integration_objects`
(`object_type = 'activity'`) as documented above.

---

## 2026-09-14 — Attempted Saviynt API doc verification (blocked, flagged not guessed)

The user asked to fetch Saviynt's real REST API documentation
(`https://documenter.getpostman.com/view/23973797/2s9Yyy8JLo`) and correct
`modules/integrations/connectors/saviynt.ts` against it, since that connector's
endpoint paths/field names were flagged in the entry above as built from
general Saviynt conventions rather than a verified deployment.

**Blocker, not a decision:** both `WebFetch` and a direct `curl` against
`documenter.getpostman.com` fail — the sandbox's network egress proxy returns
`EGRESS_BLOCKED` / a 403 on the CONNECT tunnel for that domain specifically
(the same category of restriction already noted for `*.supabase.co` direct
HTTP, which is why this project reaches Supabase only via the Supabase MCP
tool). There is no MCP tool in this environment that can fetch a Postman
documenter page, so the real API documentation could not be retrieved this
session. Per non-negotiable #18 and the stop-and-report rule, this is recorded
here rather than "fixed" with another round of unverified assumptions, which
would defeat the purpose of the user's request.

**No code changed as a result of this entry.** `saviynt.ts` is left exactly as
built, with its existing docblock warning intact — correcting it against
guesses would be strictly worse than leaving the honest "Partial, unverified"
status in place. The Progress Tracker row for INTEGRATION-P0-02.1 stays
`Partial` for the same reason.

**Open question for the user:** to close this out for real, either (a) paste
the relevant endpoint paths/methods, auth mechanism, pagination parameters,
and response field names directly into the conversation so they can be
transcribed into `saviynt.ts` and this audit log, or (b) confirm a Saviynt
sandbox/tenant `curl`-reachable from a network this environment can access, or
(c) accept the current documented-conventions implementation as the P0
baseline and treat live-tenant verification as an explicit customer-onboarding
step outside this repository's build (i.e., not something any sandbox agent
can complete without a real Saviynt tenant regardless of documentation
access). No code or backlog status was changed while this remains open.

---

## 2026-09-14 — Saviynt connector corrected against the real API reference (option (a) above)

The user pasted the actual "Saviynt Enterprise Identity Cloud API Reference
v24.2" product documentation directly into the conversation, resolving the
blocker above (option (a): paste the relevant details). This is a real,
substantive correction, not a re-guess — the reference document confirms
concrete request shapes, though it does not show response body schemas
anywhere (it is a Postman collection export — request examples only).

**Corrected, with verification:**
- **Endpoint paths** (all confirmed real, under `/ECM/api/v5/`): `getUser`
  (identities), `getAccounts` (accounts), `getEntitlements` (entitlements),
  `getSecuritySystems` (policies, see caveat below). **One path was
  actually wrong and is now fixed**: `applications` was
  `/ECM/api/v5/getApplications`, which does not exist in Saviynt's real API
  — the correct endpoint is `getEndpoints` (Saviynt's own term for what
  WonderAgent calls an "application" is "Endpoint," a child of a "Security
  System"). `access` (account-entitlement associations) now uses
  `getEntDetailsforUsers`, a real, paginated, flat user+account+entitlement
  endpoint — the connector previously invented a nonexistent
  `getAccountEntitlements` path.
- **Pagination mechanism — the single biggest correction**: every Saviynt
  list endpoint is a `POST` request with `max`/`offset` pagination
  parameters inside the JSON request body, not `GET` with query-string
  pagination as the connector previously assumed (and as
  `RestHttpClient.fetchAllPages()` only supports). Added
  `RestHttpClient.post()` and `RestHttpClient.postAllPages()`
  (`modules/integrations/connectors/restHttpClient.ts`) as new, additive
  methods — `fetchAllPages()`/`get()` are unchanged, so the Generic REST
  connector (which the module's own critical acceptance test actually
  exercises) is unaffected. `SaviyntConnector` now calls `postAllPages()`
  exclusively.
- **Auth flow confirmed**: `POST /ECM/api/login` with
  `{"username","password"}` returns a token; every other call sends
  `Authorization: Bearer <token>` — this matches the connector's existing
  `authType: "bearer"` choice exactly, so no change was needed there. The
  connector still does not perform the username/password exchange itself
  (consistent with every other connector never handling raw end-user
  credentials); `secret` is expected to already be a valid token, stored
  via Integration's existing `encryptSecret()` credential path.
- **Field-name guesses improved, not just re-asserted**: the reference
  document's own worked request-body examples repeatedly show the same
  object shapes as literal JSON (e.g. `getChildEntitlements`'s example body
  contains `{"endpointkey":"1","endpointname":"AWS",...}`), and Saviynt's
  documented filter/query-parameter names for each object type are
  consistent throughout (`entitlement_value`/`entitlementtype` for
  entitlements, not the previous guess of `entitlementname`; `name` for an
  account's own name field, not `accountname` — that term is actually only
  used as a request parameter in provisioning calls, not the object's own
  field). Updated all six `import*()` methods' field-normalization
  fallback chains accordingly.

**Still flagged, honestly, not resolved by this pass**: the reference is a
request-shape document; it never shows a response body anywhere. The field
names above are now grounded in the platform's own consistent naming
convention (a real improvement over generic REST-API guessing) but remain
unconfirmed against an actual tenant's JSON response, including the
response envelope itself (Saviynt commonly wraps list results under a named
key — `dataPath` is deliberately left unset/top-level in the connector
until that key is confirmed, rather than guessing one). Saviynt's core
Identity Administration API also has no generic "list of governance
policies" endpoint — `getSecuritySystems` remains the closest real,
confirmed, paginated list-all endpoint used for `importPolicies()`, not an
exact conceptual match; the reference's actual Segregation-of-Duties
ruleset/violation APIs (§8.0) and per-target-system "technical rules" APIs
are better conceptual fits but have distinct, purpose-specific shapes that
don't map cleanly onto `NormalizedPolicy` — left as a dedicated future
story rather than forced into this shape.

**Verification:** `npm run lint`/`typecheck`/`build` clean; `npm run test`
53/53 passing (two new `restHttpClient.test.ts` cases proving
`postAllPages()` sends `max`/`offset` in the POST body, merges a caller-
supplied base body, includes the Bearer/Content-Type headers, and stops on
a short page). No live Saviynt tenant exists to test against in this
sandbox, so end-to-end confirmation still requires a real tenant — this
pass is a documentation-grounded correction of previously-invented
mechanics, not a live-tenant proof.

**Progress Tracker updated**: INTEGRATION-P0-02.1 moves from "Partial —
built against documented conventions, not verified against a live Saviynt
tenant" to "Partial — endpoint paths/HTTP method/pagination/auth verified
against Saviynt's real API reference; response field names still
unconfirmed against a live tenant" — an honest, real improvement, not a
close-out, since response schemas remain unverified.

---

## 2026-09-14 — INTEGRATION-P0-05.1: Verified credential rotation

**Agent:** Integration Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Auto-chained after Identity Agent's own P0 completion, per the user's
"operate like before, focus on P0 only, continue automatically" instruction.
This was the module's only genuinely new P0 story from the 2026-09-14
requirements refresh.

**Built:** `modules/integrations/credentials.ts`'s `setCredential()` now
tests the *new* plaintext secret against the integration's own connector
(`authenticate()` + `testConnection()` — the same pair
`testIntegrationConnection()` already used) before persisting anything. A
failed test throws `ApiError(400, 'CREDENTIAL_VERIFICATION_FAILED', ...)`
without touching `integration_credentials` at all — the previously-stored
encrypted secret (if any) is left byte-for-byte untouched, so a bad
replacement can never clobber a working credential. Integration types with
no pull connector (`webhook`, which stores a signing secret rather than an
outbound API credential — `createConnector('webhook')` throws by design,
see `registry.ts`) skip the verification step rather than failing
spuriously; this is a deliberate, narrow exception, not a general escape
hatch — every connector-backed integration type is verified.

**Verified via 4 new unit tests** (`modules/integrations/credentials.test.ts`,
mocking `./registry`, `@/lib/security/encryptSecret`, `@/lib/audit/writeAudit`
and `@/lib/db/supabaseServer` — the first time this module mocks its own
I/O dependencies rather than testing a pure function directly, since the
actual acceptance criterion here *is* about call ordering/side-effect
gating, not a pure computation): (1) a failing `testConnection()` result
throws and neither `update()` nor `insert()` nor `writeAudit()` is ever
called; (2) a passing result persists and audits
`integration.credential_rotated` exactly as before; (3) an integration type
with no connector implementation skips verification and still persists;
(4) the first-time-set path (no prior credential) still inserts and audits
`integration.credential_set`, unchanged.

**Not verified against a real external endpoint** — this sandbox's network
egress is blocked to non-Supabase hosts (the same constraint documented
throughout this session), so a genuine live HTTP round-trip through
`GenericRestConnector`/`SaviyntConnector`'s `testConnection()` could not be
exercised; the mocked test suite above verifies the actual control-flow
change (persist-only-on-success) directly instead, which is the part this
story's acceptance criteria are actually about.

**Verification run**: `npm run typecheck`/`lint`/`build` clean, `npx vitest
run` — 94/94 passing (4 new). No schema change (no new migration) — this is
a pure application-logic change to already-`Done` code, scoped exactly to
what INTEGRATION-P0-05.1 asked for and nothing else.

## 2026-09-14 — INTEGRATION-P0-04.1: MCP tool object_type question resolved

**Agent:** Integration Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Picked up as part of a full sweep of every module's Partial/Deferred items,
starting from the first agent in run order.

INTEGRATION-P0-04.1's original flag ("object_type classification is a
flagged judgment call pending Runtime Agent") is now resolvable: Runtime
Agent's `runtime_tools` table exists (`supabase/migrations/0032_runtime_events.sql`).
Inspected its actual write path
(`modules/runtime-assurance/events.ts` — the `input.tool` branch of
`ingestRuntimeEvent()`): a `runtime_tools` row is only ever upserted from
an *observed runtime event* (DID — a tool the agent actually invoked at
runtime), never from a capability-discovery step. This confirms
`runtime_tools` was never the right shape for `discoverMcpTools()`'s data
(tools an MCP server *declares*, before any agent has invoked them) — the
two are genuinely different concepts (available capability vs. observed
usage), not the same thing modeled two ways. `object_type = 'entitlement'`
on `integration_objects` remains the correct classification and needs no
change. Updated the comment in `modules/integrations/mcpTools.ts` to
record this resolution in place of the old "pending Runtime Agent" note.

**Verified:** `npm run typecheck`, `npm run lint`, `npx vitest run`
(139/139, unchanged) — comment-only change, no behavior change, so no
migration or new test was needed.

INTEGRATION-P0-04.1 moves to `Done` in the Progress Tracker.
INTEGRATION-P0-02.1 (Saviynt REST adapter) remains `Partial` — its
response-field-name verification is blocked on a live Saviynt tenant this
sandbox has no access to and no way to simulate faithfully; unchanged.

---

## 2026-09-14 — Round 2 reconciliation against re-uploaded requirements doc (no changes made)

**Agent:** Integration Agent (documentation-only pass). The user re-uploaded
`03_INTEGRATIONS.md` (at
`/root/.claude/uploads/7af02f4f-be08-5f91-b0d5-fc0907e4645c/8727e764-03_INTEGRATIONS.md`)
framed as an updated/expanded version of the requirements package already
reconciled once in the "Requirements Refresh — 2026-09-14" section of this
module's backlog, and asked for a fresh, thorough re-check against it in case
it contained additional detail, new stories, or refined acceptance criteria.

**Method:** read the full 310-line uploaded document end to end, read the
full current backlog (`docs/plan/03-INTEGRATION-AGENT-BACKLOG.md`) including
its Progress Tracker and existing Requirements Refresh section, and sanity-
checked `modules/integrations/` and `supabase/migrations/0019`-`0025` against
what both documents describe as built. Then compared the uploaded document's
content section-by-section against the backlog:

- Its "Original Master PRD Requirements" sections (§21 Integration
  Architecture, §22 Integration Framework, §23 Saviynt Connector — P0, §24
  Generic REST Connector — P0, §25 MCP Integration — P0) and "Claude Code
  Execution Plan" are word-for-word identical to the master-PRD text the
  original `INTEGRATION-P0-01` through `P0-04` epics were already built
  from.
- Its "Expanded Requirements — Integration Hub P0/P1/P2" section contains
  exactly `INTEG-P0-01` through `INTEG-P0-11`, `INTEG-P1-01` through
  `INTEG-P1-05`, and `INTEG-P2-01` through `INTEG-P2-03` — 19 items, with
  wording identical to what the existing "Requirements Refresh — 2026-09-14"
  section below already enumerates and reconciles item-by-item (including
  the one genuinely new item that pass already caught and closed out,
  `INTEG-P0-10` → `INTEGRATION-P0-05.1`, `Done`, and the SIEM-export
  ownership-map flag for `INTEG-P1-05` that pass already raised for the
  user).
- No section, story ID, requirement, or acceptance-criterion text appears in
  this upload that is not already present, in substantively the same words,
  somewhere in the current backlog (either as an original epic story or in
  the existing Requirements Refresh section).

**Finding: nothing genuinely new.** This upload is, content-for-content, the
same requirements package already reconciled on 2026-09-14, not an expanded
successor to it — there is no additional detail, no new story, and no
refined acceptance criterion to add. Per the task's own instruction not to
fabricate gaps to appear thorough, **no new Progress Tracker row was added,
no "round 2" refresh section was written, and no other part of the backlog
was edited.** The existing Progress Tracker statuses (including the
`Partial` row for `INTEGRATION-P0-02.1` and every `Done` row) are left
exactly as they were.

**Codebase sanity check (per step 3 of the task):** `modules/integrations/`
(17 files: `connector.ts`, `credentials.ts`, `syncJobs.ts`, `webhooks.ts`,
`mcpEvents.ts`, `mcpTools.ts`, connectors/, etc.) and
`supabase/migrations/0019`-`0025` (`integration_types`, `integrations`,
`integration_credentials`, `integration_sync_jobs`, `integration_objects`,
`integration_mappings`, `integration_indexes`) match exactly what the
Progress Tracker and this audit log already describe as built — nothing
undocumented was found that would change any row's status, which is moot
here since no new rows were added.

---

## 2026-09-16 — notify() wiring (OPERATIONS-P0-02.2, from Operations Agent's pass)

**Agent:** Operations Agent (recorded here too since the actual code
change lives in this module's own file — `modules/integrations/syncJobs.ts`;
full rationale in Operations' own audit log entry of the same date).

`runSyncJob()` now calls `notify({type: 'integration_failure', ...})` on
both its failure paths: a completed run whose `finalStatus` resolves to
`'failed'` (zero records processed), and the outer `catch` for an
unhandled exception during the run. Not fired for `'partial'` (some
records still imported). No Progress Tracker row change — this doesn't
correspond to a new Integration Agent story.

---

## 2026-09-16 — pagination pass (QA-P0-04.3 follow-up, user-prioritized "what's left before launch")

Capped 2 previously-unbounded queries with the new shared
`DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`, 200), both ordered
`created_at desc` so the cap keeps the most recent rows: `integrations.ts`'s
`listIntegrations()` and `syncJobs.ts`'s `listSyncJobs()`. The latter feeds
`operations/jobs.ts`'s job-status summary (last run/last success/30-day
failure count) — a genuinely high-frequency integration could in theory
exceed 200 sync jobs within a 30-day window and slightly undercount, an
accepted approximation matching the same class of trade-off this
codebase's own precedents (`modules/operations/notifications.ts`'s
`.limit(100)`) already made. `mappings.ts`'s `listMappings()` (per-
integration field mappings, admin-curated and inherently small) was left
untouched.

Verification covered as part of the full cross-module pass — see
`INTEGRATION_STATUS.md` §5's update note for the shared pipeline run.

---

## 2026-09-16 — Retried the two items this log recorded as egress-blocked

**1. `documenter.getpostman.com` is reachable again.** The "Attempted Saviynt
API doc verification" entry above recorded a hard blocker: the egress proxy
returned `EGRESS_BLOCKED`/403 on the CONNECT tunnel for that host. Re-tested
today: `curl https://documenter.getpostman.com/view/23973797/2s9Yyy8JLo`
returns 200. **No connector change follows from this**, because the blocker
was already resolved by a different route — the user pasted the Saviynt
Enterprise Identity Cloud API Reference v24.2 directly, and
`modules/integrations/connectors/saviynt.ts` was corrected against it (see
that entry, and the connector's own docblock: `POST` list endpoints with
`max`/`offset` body pagination, the real `/ECM/api/v5/` paths, the flagged
absence of a generic policy-list endpoint). Recorded here only so the stale
"this could not be retrieved" note does not mislead a future session into
thinking the connector is still built on guesses.

**2. `GenericRestConnector.testConnection()` exercised against a real
endpoint at last.** The INTEGRATION-P0-04.2 entry above noted the
persist-only-on-success change was verified with mocks because "a genuine
live HTTP round-trip could not be exercised." It can now. Ran three live
round-trips through the real connector (temporary test file, deleted after —
the committed suite stays hermetic and network-free on purpose):

- reachable endpoint (`https://httpbin.org/get`) → `{"ok":true}`
- real error status (`/status/503`) → `{"ok":false,"message":"HTTP 503"}` —
  the status is surfaced, not swallowed
- unresolvable host (`.invalid` TLD) → `{"ok":false,"message":"fetch failed"}`
  — reported as a message, not an uncaught throw

So `RestHttpClient` + `testConnection()`'s error handling behave against a
real network exactly as the mocked tests assert. The mocked tests remain the
committed ones; this is a one-off live confirmation, not new permanent
coverage.
