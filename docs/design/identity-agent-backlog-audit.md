# Identity Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-13 — IDENTITY-P0-01 through P0-03 (initial implementation)

**Agent:** Identity Agent · **Branch:** `claude/wonderagent-setup-lasmly` (same
deviation Foundation Agent recorded: this environment pins all work to the
harness-assigned branch rather than a separate `module/identity` worktree).

**Built — full P0 backlog in one pass:**

- **IDENTITY-P0-01.1** — `agents` table (migration `0012`) with RLS: client-facing
  tenant-scoped SELECT/INSERT/UPDATE (no DELETE — retirement is a lifecycle
  transition, never a row deletion). `createAgent()`/`getAgent()`/`listAgents()`
  in `modules/agent-identity/agents.ts`, exposed at `POST/GET /api/v1/agents` and
  `GET /api/v1/agents/:id`, plus bare functional pages `/agents` and
  `/agents/new` matching the worked example's exact fields.
- **IDENTITY-P0-01.2** — `agent_identities` (migration `0013`), manual linking
  only per the backlog's explicit P0 scope (no fuzzy-matching engine).
  `linkAgentIdentity()`/`listAgentIdentities()`, `POST/GET
  /api/v1/agents/:id/identities`.
- **IDENTITY-P0-01.3** — discovery inbox: `listAgents(tenantId, { status:
  "discovered_unregistered" })` always returns `[]` right now — **Integration
  Agent has not been dispatched**, so there is no normalized import contract to
  read through yet. This is the documented, allowed "don't block, don't invent
  the other module's architecture" path from `CLAUDE.md` §7, not an oversight.
  Revisit once Integration Agent publishes its contract.
- **IDENTITY-P0-02.1 (higher bar)** — `agent_lifecycle_events` (migration
  `0015`) and the full transition state machine in
  `modules/agent-identity/lifecycle.ts`, reproducing the backlog's table
  exactly: `DISCOVERED→REGISTERED` (requires active business_owner +
  technical_owner, non-empty purpose, source_system set),
  `REGISTERED→APPROVED` (requires an active `agent_contracts` row, and the
  actor must be an agent owner or hold `IAM_ADMIN`/`TENANT_SUPER_ADMIN`),
  `APPROVED→PROVISIONED` and `PROVISIONED→ACTIVE` (manual, no extra
  precondition), `ACTIVE→CERTIFICATION_DUE` (system-actor only, computed lazily
  on read via `maybeMarkCertificationDue()` inside `getAgent()`/`listAgents()`
  rather than a cron, exactly as the backlog allows),
  `ACTIVE→RESTRICTED`, `CERTIFICATION_DUE→ACTIVE`, `RESTRICTED→SUSPENDED`
  (requires `SECURITY_ADMIN`/`IAM_ADMIN`/`TENANT_SUPER_ADMIN`),
  `SUSPENDED→RETIRED`, and the "any state → SUSPENDED" emergency wildcard
  (requires `SECURITY_ADMIN`/`TENANT_SUPER_ADMIN`). Every transition writes
  both the `agent_lifecycle_events` row and a `writeAudit()` call, exactly as
  specified. Exposed at `POST/GET /api/v1/agents/:id/lifecycle`.

  **Judgment call, flagged rather than left silent:** the backlog's transition
  table doesn't say whether "any state → SUSPENDED" includes `RETIRED` as a
  valid `from`. I read `RETIRED` as terminal (nothing transitions out of it,
  full stop) since the backlog's whole chain treats it as the end state and no
  other row in the table ever transitions *from* `RETIRED`. Implemented that
  way in `isStructurallyAllowedTransition()`; flagging in case the intent was
  different.

  **Backlog inconsistency noted, not silently resolved:** the state list
  (`DISCOVERED → REGISTERED → ASSESSED → APPROVED → ...`) includes `ASSESSED`,
  and the `agents.lifecycle_state` CHECK constraint includes it too, but the
  backlog's own "Allowed transitions" table has no row transitioning into or
  out of `ASSESSED` anywhere — `REGISTERED` goes straight to `APPROVED`. I
  implemented exactly what the transition table says (no path through
  `ASSESSED` in P0), leaving the state reachable only for schema
  forward-compatibility. Not treating this as an ambiguity worth stopping for
  since the transition table is unambiguous on its own; noting it so a future
  session doesn't wonder why `ASSESSED` is unreachable.

- **IDENTITY-P0-02.2** — `agent_owners` (migration `0014`), client-facing RLS
  (tenant-scoped, same pattern as `agents`). `assignOwner()`/`removeOwner()`
  (soft-remove via `removed_at`)/`listOwners()`/`getOwnershipIssues()` in
  `modules/agent-identity/owners.ts` — the last one returns
  `missing_owner`/`inactive_owner`/`ownership_conflict`/
  `missing_recommended_owner` facts only, never a `risk_findings` row (Risk
  Agent's job once it exists). Exposed at `POST/GET /api/v1/agents/:id/owners`
  and `GET /api/v1/agents/:id/ownership-issues`.
- **IDENTITY-P0-02.3** — `agent_relationships` (migration `0017`), client-facing
  RLS. `addRelationship()`/`listRelationships()`/`removeRelationship()`,
  exposed at `POST/GET/DELETE /api/v1/agents/:id/relationships`. No automatic
  discovery from runtime traces, per the backlog's explicit P0 boundary.
- **IDENTITY-P0-03.1 (higher bar)** — `agent_contracts` (migration `0016`),
  versioned exactly as specified: `createContractVersion()` supersedes the
  prior active row and inserts `version + 1` as the new active one, backed by
  a partial unique index (`agent_contracts_one_active_per_agent`) enforcing
  "at most one active contract per agent" at the database level, not only in
  application code. `getAgentContract()` (active only) and
  `listContractVersions()` (full history). Exposed at `POST/GET
  /api/v1/agents/:id/contracts`.

**Security design decision (not explicit in the backlog, but a direct
extension of Foundation's own reviewed precedent for `audit_logs`), recorded
here rather than left implicit:** `agent_lifecycle_events` and
`agent_contracts` grant **no** client-facing INSERT/UPDATE policy at all —
only `transitionAgentLifecycle()` and `createContractVersion()` (via
`supabaseServiceRole()`, after their own validation) may write them. Every
other Identity table (`agents`, `agent_identities`, `agent_owners`,
`agent_relationships`) uses ordinary tenant-scoped client RLS plus an
app-layer `requirePermission()` check, matching how the backlog explicitly
described `agents` itself. Rationale: the transition table's validity and the
contract's versioning invariant are business rules no RLS tenant-check can
enforce — a client-facing INSERT policy on either table would let any tenant
member forge lifecycle/SHOULD history via a direct REST call, bypassing this
module's own logic entirely. Verified directly: see
`tests/identity/tenant-isolation.sql` — a same-tenant, correctly-scoped
`INSERT` into both tables is rejected by RLS specifically *because* no client
policy exists, not merely because of a tenant mismatch.

**Verification run:**
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean.
- `npm run test` — 12/12 passing, including
  `modules/agent-identity/lifecycle.test.ts` (pure unit tests for
  `isStructurallyAllowedTransition()` covering every row of the transition
  table, the any-state-to-SUSPENDED wildcard, and RETIRED's terminality).
- Tenant isolation proof executed directly against the live dev Supabase
  project via the Supabase MCP `execute_sql` tool (same methodology Foundation
  used, for the same reason: this sandbox's network egress cannot reach
  Supabase directly). Fixture: two tenants, one full agent graph each
  (agent + owner + identity + active contract + lifecycle event). Result,
  acting as Tenant A's user: every table returned only Tenant A's own row;
  Tenant B's agent was invisible even by primary-key lookup and a direct
  `UPDATE` against it affected 0 rows; a cross-tenant `agent_owners` insert
  was rejected; and — the specific case this design decision is meant to
  prevent — a **same-tenant** insert into `agent_lifecycle_events` and
  `agent_contracts` was also rejected, since neither table grants a client
  INSERT policy at all. Fixture data deleted afterward; script committed at
  `tests/identity/tenant-isolation.sql`. `get_advisors` (security and
  performance) clean after migration `0018` (tenant_id indexes on the five new
  tables) — no findings beyond the ones Foundation already reviewed and
  accepted (`current_tenant_ids`/`create_tenant_with_owner` REST-RPC exposure,
  `platform_admins`' intentional no-policy state, and the pre-existing
  Supabase-managed `rls_auto_enable`).

**Not started this session (deferred, not blocking other agents):** none of
IDENTITY-P0-01 through P0-03 was skipped — the full P0 backlog for this module
is implemented. The only gap is IDENTITY-P0-01.3's discovery inbox returning
empty pending Integration Agent, documented above.

**Dependencies consumed:** Foundation's `getTenantContext()`,
`requirePermission()`, `writeAudit()`, `supabaseServer()`/`supabaseServiceRole()`,
`lib/shared/types/foundation.ts` — all used exactly as published, no
modification to any Foundation file.

**Published this session, for Access/Runtime/Risk/Compliance/Experience to
consume once dispatched:** `modules/agent-identity/service.ts` (barrel) and
`lib/shared/types/agent-identity.ts` — see both files' contents for the full
exported surface (`getAgent`, `listAgents`, `getAgentContract`,
`transitionAgentLifecycle`, `getOwnershipIssues`, etc.). No other module has
been dispatched yet, so nothing has consumed this contract in anger; the
critical acceptance test (register FinanceBot, assign ownership, define the
SAP/Snowflake contract, walk it through
`DISCOVERED→REGISTERED→APPROVED→PROVISIONED→ACTIVE` with a complete audited
transition history) is buildable end-to-end today via the API routes above,
but has not been run as a scripted scenario in this session — worth doing
either now or as part of a future QA Agent pass.

---

## 2026-09-14 — IDENTITY-P0-04 (duplicate detection) and IDENTITY-P0-05 (discovery reconciliation)

**Agent:** Identity Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Auto-chained after Foundation Agent's own P0 completion, per the user's
"operate like before, focus on P0 only, continue automatically" instruction.
Picked up the two new P0 stories the 2026-09-14 requirements refresh added.

### IDENTITY-P0-04 — Duplicate Detection & Merge/Review Workflow

New table `agent_duplicate_candidates` (migration `0041`), RLS-treated as
evidentiary/computed data — client SELECT only, all writes via
`supabaseServiceRole()` in the new `modules/agent-identity/duplicates.ts`
(same pattern as `risk_findings`/`certification_decisions`). Deterministic,
no-LLM scoring (`computeDuplicateScore()`, unit-tested — 5 cases): a
`source_system` + `source_object_id` match scores 1.0 (decisive — the same
external system reporting the same object twice); a case-insensitive
`agent_name` match alone scores 0.6 (weaker evidence, since two distinct
agents can share a display name); anything else scores 0.
`DUPLICATE_MATCH_THRESHOLD = 0.6`.

`createAgent()` (`modules/agent-identity/agents.ts`) now runs this check
before ever inserting an `agents` row; the original insert logic was
extracted into `createAgentRow()` so both the normal path and a reviewer's
"confirm distinct" decision share one implementation. On a match, the
pending registration is diverted into a duplicate-candidate record instead
of being inserted — `createAgent()`'s return type changed from `Agent` to a
`CreateAgentResult` discriminated union (`{kind: 'created', agent}` |
`{kind: 'duplicate_candidate', candidate}`); updated both call sites
(`POST /api/v1/agents` — now returns 202 for the duplicate-candidate case,
201 unchanged for the created case; `createAgentAction` — redirects to the
new `/agents/duplicates` review page instead of `/agents/:id`). A reviewer
can merge (mark `merged` — the pending registration is discarded, and since
it was never inserted as a real `agents` row, the existing survivor's own
lifecycle/audit history is untouched by construction rather than by an
explicit two-row merge) or confirm-as-distinct (`confirmDistinctAndRegister()`
completes the deferred registration now). Both actions audited via
`writeAudit()`. New bare page `/agents/duplicates` plus
`/api/v1/agents/duplicates` (GET) and `/api/v1/agents/duplicates/:id`
(PATCH `{decision: 'merge'|'confirm_distinct'}`).

**Verified live** (Supabase MCP, FinanceBot fixture tenants
`aaaaaaaa-5000-.../bbbbbbbb-5000-...`): Tenant A5's user sees only its own
duplicate-candidate row, Tenant B5's user sees zero; a direct client INSERT
is rejected, a direct client UPDATE affects 0 rows (same select-only +
service-role-write proof pattern used throughout this session).

### IDENTITY-P0-05 — Discovery Reconciliation & Orphaned Identity Detection

New `modules/agent-identity/discovery.ts` — `buildDiscoveryInbox(tenantId)`
reads Integration Agent's now-published contract
(`listIntegrations`/`getNormalizedObjects` from
`modules/integrations/service.ts`) for `identity`-typed normalized objects,
and reconciles each one against `agents`/`agent_identities`:
- Already correlated (an `agent_identities` row exists for that external
  reference, source-keyed as `<integrationId>::<externalId>`) → not shown at
  all (fully resolved).
- Not yet correlated, but scores ≥ the same `computeDuplicateScore()`
  threshold against an existing agent → `likely_duplicate`, with the
  matched agent's id.
- Not yet correlated and no score match → `new`.
- An existing `agent_identities` link whose owning agent is retired or
  missing → `orphaned_identity` (a separate pass over `agent_identities`,
  independent of whether any integration is currently configured).

This directly resolves IDENTITY-P0-01.3's long-standing "always returns
empty pending Integration Agent's contract" limitation — that dependency was
real when 01.3 was first built (Integration Agent hadn't been dispatched
yet); it has since published exactly the contract 01.3's own Dependencies
section anticipated ("once Integration publishes normalized identity/account
import data, Identity may correlate an `agent_identities` row to it"), so
implementing 05 on top of it also completes 01.3 rather than leaving a
second, parallel "discovery" concept. `listAgents()`'s original
`filter.status === 'discovered_unregistered'` branch is left returning `[]`
verbatim for any existing caller of that exact shape (no caller exists
today — grepped to confirm), rather than being repointed at a
differently-shaped `DiscoveryInboxEntry[]` under the same filter contract.
New bare page `/agents/discovery` plus `/api/v1/agents/discovery-inbox`
(GET). Correctly returns `[]` when a tenant has zero configured
integrations, per the same "never fabricate data" rule 01.3 already
followed.

**Not verified against a real integration's live data** (no configured,
credentialed integration exists in this session's fixtures) — the
type-checked composition against Integration Agent's published, already-
tested `listIntegrations`/`getNormalizedObjects` functions, plus this
story's own reconciliation logic being a straightforward function of that
already-typed data, was judged sufficient without fabricating a live
integration fixture solely to exercise this one path; flagged rather than
silently assumed.

**Full verification run**: `npm run typecheck`, `npm run lint`, `npm run
build` (new routes present: `/agents/duplicates`, `/agents/discovery`,
`/api/v1/agents/duplicates`, `/api/v1/agents/duplicates/[id]`,
`/api/v1/agents/discovery-inbox`), `npx vitest run` — 90/90 passing (5 new:
`computeDuplicateScore`'s decisive/weak/zero-score/mismatched-source/
missing-source-id cases). `get_advisors(security)` re-checked after
migration `0041` — identical accepted-exception set, `agent_duplicate_candidates`
correctly not flagged (it has a select policy, unlike the intentional
zero-policy tables).

**Dependencies consumed:** Foundation's usual set, plus — for the first time
in this module — Integration Agent's published `listIntegrations()`/
`getNormalizedObjects()` contract (read-only, exactly as published, no
reaching into `integration_objects`/`integrations` directly).
