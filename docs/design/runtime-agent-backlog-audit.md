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
