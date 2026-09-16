# Runtime Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — RUNTIME-P0-01 through P0-02 (full P0 backlog in one pass)

**Agent:** Runtime Agent · **Branch:** `claude/wonderagent-setup-lasmly` (same
environment-pinned-branch deviation every prior module recorded).

**Built:**

- **RUNTIME-P0-01.1** — `runtime_events`, `runtime_tools`, `runtime_resources`
  (migration `0032`), plus `runtime.read`/`runtime.ingest` permission-catalog
  rows (migration `0032`, same growth pattern Access Agent used for
  `access.*`). `runtime_events` is treated as evidentiary data — same
  lockdown as `access_grants`/`policy_evaluations`/`integration_objects`: a
  client-facing SELECT policy (for the timeline screen) but **no**
  client-facing INSERT/UPDATE policy at all. Allowing a client to insert its
  own event would let a tenant forge the DID evidence the product's central
  SHOULD/CAN/DID claim depends on — verified live (see below).
  **Flagged, not silently assumed**: the backlog's sketch of `runtime_tools`
  has no unique constraint, but "upsert on first sight, bump last_seen_at"
  needs one to be atomic — added `unique (tenant_id, agent_id, name)`,
  analogous to the constraint the backlog does specify on
  `runtime_resources`. A follow-up migration `0033` added three FK-covering
  indexes `get_advisors` flagged after `0032`, same pattern as Access
  Agent's `0031_access_indexes.sql`.
- **RUNTIME-P0-01.2 (higher bar)** — `ingestRuntimeEvent()`
  (`modules/runtime-assurance/events.ts`), writing via
  `supabaseServiceRole()`. `computeDedupeKey()` hashes
  `(source, tool, application, resource, action, eventTime, agentId)` with
  SHA-256 (not a delimited string) so an embedded delimiter in any field can
  never collide two distinct events. A duplicate submission hits the
  `unique (tenant_id, dedupe_key)` constraint (Postgres error `23505`),
  which is caught and resolved to the already-stored row — both calls
  return success, exactly one row exists. Tool/resource "first seen"
  upserts only happen on a genuinely new insert, never on a deduped
  resubmission, so a retry is a true no-op with zero side effects.
- **RUNTIME-P0-01.3** — `listRuntimeEvents()` /
  `GET /api/v1/runtime/events`, keyset-paginated (not offset) by
  `(event_time desc, id desc)` per `CLAUDE.md` §15, tenant-scoped both by
  RLS and an explicit `tenant_id` filter (defense-in-depth per §14).
- **RUNTIME-P0-02.1 (higher bar)** — `getDid()`
  (`modules/runtime-assurance/did.ts`): aggregates `runtime_events` in a
  window into distinct `{application, resource, action,
  data_classification}` tuples with first/last-seen and a count, each
  carrying a `sampleEventId` for evidence. **Flagged, not silently
  assumed**: the backlog's default window is "since last certification, or
  90 days if none" — Compliance Agent (the source of "last certification")
  doesn't exist yet in the run order, so every call currently falls through
  to the 90-day default, the same "module doesn't exist yet" situation
  Access Agent flagged for its own unresolved policy-condition facts.
- **RUNTIME-P0-02.2 (higher bar)** — `compareShouldCanDid()`
  (`modules/runtime-assurance/compare.ts`): SHOULD from Identity's
  `getAgentContract()` (cross-product of `approved_applications` ×
  `approved_data`), CAN from Access's `getEffectiveAccess()`, DID from
  `getDid()`. Produces `excessive_access`/`insufficient_access`/
  `unused_capability`/`unexpected_capability`/`behavioral_violation`/
  `healthy` outcomes, each carrying the specific grant/event id that
  produced it. **Key design decision, flagged rather than silently
  guessed**: SHOULD's `approved_data` is free-text business language (e.g.
  "financial reporting") while CAN/DID's `data_classification` is a shorter
  code (e.g. "financial", "pii" — see the Access Agent's own FinanceBot
  fixture). The backlog's own worked example only reproduces if these are
  treated as compatible via case-insensitive substring containment, not
  exact equality — a real vocabulary mismatch the backlog doesn't resolve.
  Documented in `compare.ts`'s top comment, covered by three unit tests
  (`compare.test.ts`: the exact PRD scenario, a fully-healthy case, and a
  reproducibility check), and exercised live below. A future
  Compliance/Risk-owned data-classification taxonomy could replace this
  with exact lookup; until one exists, this is the documented behavior —
  not a placeholder for the user to fix, but a decision made and recorded
  per the "reasoned architecture decision, documented" pattern this build
  has used throughout (e.g. Access Agent's SoD/RETIRED-terminality calls).
  DO NOT IMPLEMENT items (severity, finding creation, notification) were
  not touched — Risk Agent's job.
- **Authentication decision for the direct ingestion endpoint, flagged
  rather than silently decided**: the backlog explicitly allows Runtime
  Agent to build its own MCP/REST ingestion endpoint rather than waiting on
  Integration Agent. `POST /api/v1/runtime/events` is gated by the standard
  `requirePermission('runtime.ingest')` tenant-scoped RBAC path — the same
  authenticated-session model every other write endpoint in this codebase
  uses — rather than a new shared-secret/bearer-token mechanism like
  Integration Agent's MCP/webhook endpoints. Integration Agent owns
  integration credential/shared-secret infrastructure per the ownership
  map; inventing a second one here would duplicate that ownership
  (non-negotiable #6/#14, and #18's "do not invent another module's
  architecture"). A dedicated machine-to-machine ingestion token, if a real
  MCP proxy deployment needs one, is Foundation's or Integration's to
  design — recorded here, not decided unilaterally.

**Verification run:**
- `npm run lint`, `npm run typecheck`, `npm run build` — all clean.
- `npm run test` — 40/40 passing across 9 files (new: `events.test.ts` for
  `computeDedupeKey()`'s determinism and non-collision across a shifted
  delimiter boundary; `compare.test.ts` for the exact PRD/backlog worked
  scenario, a fully-healthy case, and reproducibility — dependencies
  mocked so the pure comparison logic is tested in isolation from the
  database).
- Live smoke test against a locally started production server: unauthenticated
  hits to `/runtime/agents/:id`, `GET /api/v1/runtime/events`, and
  `POST /api/v1/runtime/events` all correctly return a 307-to-`/sign-in` or
  401 rather than a raw 500 (checked proactively, consistent with the
  pattern every module has verified since Integration Agent's bug).
- **The module's critical acceptance test, executed live against the dev
  Supabase project** (Supabase MCP `execute_sql`, same network-egress
  reason as every prior module): built the exact FinanceBot scenario (an
  active Agent Contract approving `{SAP, Snowflake} x {financial
  reporting}`, effective access including both `Financial_Reporting_READ`
  and the unapproved `CustomerDB_READ`), ingested the PRD's exact
  Snowflake/CustomerDB/PII/read event, and proved: (1) idempotency —
  resubmitting the identical `(tenant_id, dedupe_key)` pair was rejected by
  the unique constraint (`unique_violation`), leaving exactly one row; (2)
  DID reproduced exactly `{application: Snowflake, resource: CustomerDB,
  action: read, data_classification: PII}` from stored data alone; (3) the
  excessive-access evidence chain (grant → entitlement → application)
  resolves correctly; (4) tenant isolation — Tenant A only ever saw its own
  `CustomerDB` event; (5) forgery rejection — a same-tenant client INSERT
  into `runtime_events` was rejected by RLS (no client insert policy
  exists at all). Fixture data intentionally left in place (same as every
  prior module's script, cleanup commented out); script committed at
  `tests/runtime/idempotent-ingestion-and-central-scenario.sql`.
  `get_advisors` (security and performance) clean beyond the same
  previously-reviewed exceptions every prior module already accepted.

**Not started this session:** nothing in the P0 backlog was skipped.

**Dependencies consumed:** Foundation's `requirePermission()`,
`writeAudit()`, `supabaseServer()`/`supabaseServiceRole()`; Identity's
`getAgentContract()`; Access's `getEffectiveAccess()` — all used exactly as
published, no modification to any Foundation, Identity, or Access file.

**Published this session, for Risk/Compliance/Experience to consume once
dispatched:** `modules/runtime-assurance/service.ts` (barrel) and
`lib/shared/types/runtime.ts`. Most relevant to Risk Agent (the next module
in run order): `compareShouldCanDid()`'s `outcomes` array is the
reproducible evidence bundle Risk Agent turns into findings with an
assigned severity — Runtime Agent deliberately never assigns severity or
creates a finding itself, per its own DO-NOT-IMPLEMENT list.

---

## 2026-09-14 — RUNTIME-P0-11 (Ingestion Hardening), RUNTIME-P0-12 (SHOULD Normalization), RUNTIME-P0-13 (blocked), RUNTIME-P0-14 (Data Quality)

**Agent:** Runtime Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Auto-chained after Access Agent's own P0 completion, per the user's
"operate like before, focus on P0 only, continue automatically"
instruction. Three of this module's four new requirements-refresh stories
were built; the fourth is a genuine cross-module dependency gap, recorded
below rather than guessed at.

### RUNTIME-P0-11 — Ingestion Hardening: Replay Protection & Event Quarantine

New table `runtime_event_quarantine` (migration `0043`), evidentiary RLS
treatment (client SELECT only, service-role writes via the new
`modules/runtime-assurance/quarantine.ts`) — stores only safe fields
(source/action/submitted event time/attempted dedupe key), never the full
raw payload, so a malicious/misbehaving submitter can't use quarantine
itself as a place to stash sensitive data for later exfiltration via a
read. Replay protection, distinct from RUNTIME-P0-01.2's idempotency: a new
`isWithinReplayWindow()` (unit-tested, 6 cases) bounds a submitted
`eventTime` to within 5 minutes future / 30 days past of the server clock —
`ingestRuntimeEvent()` now checks this before inserting, throwing
`REPLAY_WINDOW_VIOLATION`. `POST /api/v1/runtime/events` quarantines both
shape-invalid submissions and replay-window violations before returning
400/422 (previously: a bare 400, nothing persisted). New route:
`GET /api/v1/runtime/quarantine`.

**Scoping note, not silently assumed:** ingestion is already gated by an
authenticated session (`requirePermission('runtime.ingest')`, documented in
the route's own prior comment as a deliberate choice not to invent a
second machine-to-machine credential mechanism when Integration Agent owns
that infrastructure). Real HTTP replay of a captured request therefore
already requires the victim's session, further narrowed by this session's
own new idle/absolute session-expiry enforcement (Foundation
FOUNDATION-P0-09). The eventTime-window check adds a second, independent
layer on top of that rather than replacing it.

### RUNTIME-P0-12 — SHOULD Normalization Model (unknown-safe)

`ShouldEntry` now carries `actions`/`tools` (populated from the contract's
`approvedActions`; `tools` seeded empty — no tool-approval concept exists
on `agent_contracts` yet, so it's schema-ready, not silently invented) and
`ShouldCanDidComparison` gained `shouldUnknown: boolean` — true when there
is no active contract or its `purpose` is unset/blank. `healthy` can now
only be reported when `shouldUnknown` is false — an ambiguous SHOULD must
never be silently read as "compliant." 4 new unit tests (2 new + fixed 1
existing "healthy" fixture that had no `purpose` field, which would now
correctly count as `shouldUnknown` — a real gap in the old fixture, not a
false failure).

### RUNTIME-P0-13 — Point-in-Time CAN Resolution & Historical Accuracy — DEFERRED, blocked

Per the backlog's own dependency note: this story requires Access Agent to
publish a point-in-time effective-access contract ("what was CAN as of
timestamp T"), which does not exist. Verified directly against Access
Agent's 2026-09-14 session (which ran immediately before this one and
published `getAccessGraph()`/`compareAccessToContract()`) — neither is
point-in-time; `getEffectiveAccess()` remains current-state-only. Per
CLAUDE.md non-negotiable #18, Runtime Agent does not invent this contract
inside Access Agent's owned tables/module. **Recorded as an explicit open
question for the user / a future Access Agent run**: Access Agent would
need either (a) a `valid_from`/`valid_to` history on `access_grants`
populated at revoke-time (an additive schema change to an Access-owned
table), or (b) a way to reconstruct point-in-time state from
`audit_logs`/`policy_evaluations` history — Runtime Agent has not decided
between these for Access Agent, since that is an Access Agent architecture
decision, not Runtime Agent's to make. Tracker marked `Deferred`, not
skipped silently.

### RUNTIME-P0-14 — Runtime Data Quality Tracking

New `modules/runtime-assurance/dataQuality.ts` —
`getDataQualityMetrics(tenantId, agentId?, windowMs?)`, a real aggregate
query (not a new stored table — "queryable" is satisfied by the query
itself; documented as a deliberate scoping choice, not an oversight) over
`runtime_events` counting `missingIdentityCount` (`identity_id is null`)
and `unknownResourceCount` (`application is null or resource is null`).
**Live-verified** (Supabase MCP) against the real FinanceBot fixture's
actual `runtime_events` row: raw SQL with the identical filter logic
returned `{total: 1, missing_identity: 1, unknown_resource: 0}`, matching
what the function's PostgREST-built filters compute. New route:
`GET /api/v1/runtime/data-quality`.

Also closes part of the new doc's "unknown must not silently become
compliant" requirement inside the comparison engine itself: a DID tuple
with no resolvable `application` (RUNTIME-P0-14's "unknown resource" case,
observed at compare-time rather than only at the aggregate-metrics level)
now produces a new `unscored_unknown` outcome instead of being scored as
`unexpected_capability`/`behavioral_violation` — previously, an
unattributable event was miscounted as a real behavioral violation, which
is exactly the "unknown treated as non-compliant" failure mode the new doc
warns against (the mirror-image bug of "unknown treated as compliant").
Unit-tested (1 new case) in `compare.test.ts`.

**Verification run**: `npm run typecheck`/`lint`/`build` clean (new routes:
`/api/v1/runtime/quarantine`, `/api/v1/runtime/data-quality`), `npx vitest
run` — 115/115 passing (16 new: 6 `isWithinReplayWindow` + 4
`compareShouldCanDid` shouldUnknown/unscored_unknown cases + fixed 1
existing fixture, net +9 in compare.test.ts, +6 in events.test.ts).
`get_advisors(security)` re-checked after migration `0043` — identical
accepted-exception set, `runtime_event_quarantine` correctly not flagged
(has a select policy). Live-verified via Supabase MCP against the
FinanceBot fixture tenants: `runtime_event_quarantine` enforces tenant
isolation on reads and rejects direct client inserts.

## 2026-09-14 — RUNTIME-P0-13: Point-in-Time CAN Resolution & Historical Accuracy

**Agent:** Runtime Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Picked up as part of a full sweep of every module's Partial/Deferred
items, starting from the first agent in run order. This story was
`Deferred`, blocked on a dependency note asking Access Agent to publish a
point-in-time effective-access contract — resolved (see Access Agent's
own audit log): `getEffectiveAccessAsOf(tenantId, agentId, asOf)` now
exists, backed by `access_grants`' existing `granted_at`/`revoked_at`
soft-delete columns (no schema change needed — the historical data was
always there).

`compareShouldCanDid(tenantId, agentId, asOf?)` gained an optional third
parameter. Omitted, behavior is byte-identical to before (calls
`getEffectiveAccess()`, same as every existing caller/test). Passed, it
calls `getEffectiveAccessAsOf()` instead, resolving CAN as of that
timestamp rather than today — so re-scoring a 90-day-old event no longer
silently loses a genuine historical `excessive_access` finding just
because the entitlement has since been revoked, per the story's own
acceptance criterion.

**Deliberately not done in this pass:** wiring `asOf` into any existing
caller (`modules/risk/rules.ts`'s finding generation, the `/api/v1/
runtime/agents/:id/compare` route, or either customer-facing page). The
acceptance criterion is that the *capability* exists ("compareShouldCanDid
(or a new time-scoped variant) can resolve CAN as of a given timestamp"),
which it now does; deciding *when* Risk Agent's own finding-generation
flow should re-evaluate against a specific historical timestamp (e.g.
each finding's originating event time) is that module's own judgment
call, not something to retrofit unilaterally into Risk's files per
non-negotiable #18. Left as an available capability for Risk Agent (or a
future dispatch of it) to adopt.

**Verified:** two new unit tests in `compare.test.ts` — omitting `asOf`
calls `getEffectiveAccess()` and never `getEffectiveAccessAsOf()`;
passing `asOf` calls `getEffectiveAccessAsOf()` with the exact tenant/
agent/timestamp and never `getEffectiveAccess()`, and a grant only
present in the point-in-time result (simulating one already revoked
today) still produces the `excessive_access` outcome. Full pipeline:
`npm run typecheck`, `npm run lint`, `npx vitest run` (141/141, up from
139 — the 2 new tests, every prior test unchanged and still green),
`npm run build` with `.next` deleted first, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` (no match) — all green.

RUNTIME-P0-13 moves from `Deferred` to `Partial` (not `Done`) — the core
comparison capability is real and tested, but nothing in this codebase
calls it with a real `asOf` value yet (no consumer wiring, per above), so
the story's full acceptance criterion ("re-running an evaluation... does
not retroactively erase evidence") isn't yet demonstrated end-to-end
against a real finding.

---

## 2026-09-14 — Documentation-only re-check against re-uploaded expanded requirements doc

**Agent:** Runtime Agent (documentation/planning pass only — no application
code, migrations, or tests touched). Triggered by the user re-uploading
`707001e1-05_RUNTIME_ASSURANCE.md`, described as a newer/expanded version of
the doc already reconciled in the "Requirements Refresh — 2026-09-14"
section of `docs/plan/05-RUNTIME-AGENT-BACKLOG.md`.

**Method:** read the full re-uploaded document; read the full current
backlog (Progress Tracker, all epics, the existing Requirements Refresh
section, and the P1/P2 prose); skimmed this audit log's prior entries; and
spot-checked `modules/runtime-assurance/*.ts` and
`supabase/migrations/0032_runtime_events.sql`,
`0033_runtime_indexes.sql`, `0043_runtime_ingestion_hardening.sql` to make
sure nothing the doc describes was already built without being reflected in
the backlog.

**Finding: no genuinely new requirements, stories, or acceptance criteria.**
The re-uploaded document's numbered "Expanded Requirements" section
(`RUNTIME-P0-01` through `RUNTIME-P0-10`, `RUNTIME-P1-01` through
`RUNTIME-P1-04`, `RUNTIME-P2-01` through `RUNTIME-P2-03`) and its PRD/
execution-plan sections are, substantively, the same content already
reconciled in the prior refresh pass — including detail-level items like the
`latency` canonical field and the "environments"/"delayed events"/
"unsupported actions" vocabulary, which the existing refresh section already
quotes and accounts for (as a flagged, not-spun-out schema gap for
`latency`, and as explicit scope of already-tracked `RUNTIME-P0-12` and
`RUNTIME-P0-14` respectively). Every numbered item in the doc traces to an
existing Progress Tracker row (`RUNTIME-P0-01.1/.2/.3`, `RUNTIME-P0-02.1/.2`,
`RUNTIME-P0-11` through `RUNTIME-P0-14`) or to an already-named story in the
backlog's `## P1`/`## P2` prose (`RUNTIME-P1-03`, `RUNTIME-P1-04`,
`RUNTIME-P2-01`, `RUNTIME-P2-02`, `RUNTIME-P2-03`, plus the AWS/Azure and
behavioral-baseline P1 items covered generically there). No item was found
that exists in the doc but nowhere in the backlog.

**No changes made to the Progress Tracker.** No row was added (nothing
qualified as genuinely new) and no existing row's status was changed —
`RUNTIME-P0-13`'s `Partial` status from the immediately prior entry above
was left exactly as is, per this task's explicit instruction not to reopen
or re-flag it.

**What was added:** a new dated section, "## Requirements Refresh —
2026-09-14 (round 2, expanded doc)," in
`docs/plan/05-RUNTIME-AGENT-BACKLOG.md` (placed directly above `## P1`),
recording this re-check and its per-item mapping so a future pass against
yet another re-upload of this doc has a clear record of what was already
checked and found to be identical.

**Not fabricated:** this entry deliberately reports zero new gaps rather
than inventing scope to appear thorough — the re-uploaded file's content,
line for line in its substantive sections, matches what the earlier,
smaller-labeled version already supplied.

---

## 2026-09-16 — RUNTIME-P0-13 unblocked: Risk adopted the real asOf caller

**Agent:** Risk Agent (small, paired change — the story is tracked under
Risk's own backlog as the caller-adoption half of `RUNTIME-P0-13`; full
account in Risk's audit log).

`compareShouldCanDid(tenantId, agentId, asOf?)` — built and unit-tested
2026-09-14, waiting on a real caller since — is now called by Risk's new
`getFindingAsOfDetection()` with a finding's own `created_at` as the
`asOf` timestamp. No change to this module's own files. Progress Tracker
row moves from `Partial` to `Done`.
