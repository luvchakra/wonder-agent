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

---

## 2026-09-14 — Requirements Refresh (round 2, expanded doc) — no new scope found

**Agent:** Identity Agent (documentation/planning pass only — no application
code, migrations or tests touched).

**Task:** the user re-supplied the module 02 requirements document at a new
upload path, described as a newer/expanded version superseding the doc used
for the original 2026-09-14 refresh, and asked for a fresh, thorough
re-check for additional detail, new stories, or refined acceptance criteria
not already reflected in the backlog.

**Performed:** read the full re-supplied document end to end; read the full
current `docs/plan/02-IDENTITY-AGENT-BACKLOG.md` including its Progress
Tracker and existing "Requirements Refresh — 2026-09-14" section; re-read
this audit log's tail; and spot-checked the codebase
(`modules/agent-identity/*`, `supabase/migrations/0012`–`0018` and `0041`)
to sanity-check implementation status rather than trusting the backlog text
alone.

**Finding: no genuinely new requirements, stories, or acceptance criteria.**
The re-supplied document's content (Identity data model summary;
IDENTITY-P0-01 through P0-10; IDENTITY-P1-01 through P1-04; IDENTITY-P2-01
through P2-03; critical acceptance criteria) matches — requirement ID for
requirement ID, and substantively in wording — what the original
2026-09-14 pass already reconciled against. Every requirement ID in the new
upload traces to either:
- an already-`Done` story in this backlog (verified still accurate against
  the current `agents`/`agent_owners`/`agent_identities`/
  `agent_lifecycle_events`/`agent_contracts`/`agent_relationships` schema
  and the corresponding service code), or
- this backlog's own IDENTITY-P0-04 / IDENTITY-P0-05 rows added in the
  first refresh pass (both now `Done`; re-confirmed implemented — duplicate
  detection in `modules/agent-identity/duplicates.ts` +
  `duplicates.test.ts` + migration `0041_identity_duplicate_candidates.sql`,
  discovery reconciliation in `modules/agent-identity/discovery.ts`), or
- an item already carried in the backlog's `## P1` or `## P2` sections.

No Progress Tracker row was added. No existing row's status was changed —
nothing already `Done`/`Partial` was reopened or lowered. A short
"Requirements Refresh — 2026-09-14 (round 2, expanded doc)" section was
added to `docs/plan/02-IDENTITY-AGENT-BACKLOG.md` (immediately before `##
DO NOT IMPLEMENT`) documenting this finding and the requirement-by-
requirement mapping, so a future reconciliation pass doesn't re-derive the
same conclusion from scratch. This entry states the negative result
explicitly, per the task's instruction not to fabricate gaps in order to
appear thorough.

**Open question for the user:** since two consecutive uploads of "the
module 02 requirements doc" (the original 2026-09-14 refresh's source and
this round's re-supplied file) turned out to be content-identical as far as
this module's scope is concerned, it may be worth confirming with the user
whether the re-upload was expected to carry different content, in case the
intended "expanded" document was not the one actually attached at this
path.

---

## 2026-09-15 — Fully Functional Agent Discovery (extension of IDENTITY-P0-05)

**Agent:** Identity Agent.

**Task:** the user supplied a new, large (55-section) requirements
document, "WonderAgent — Fully Functional Agent Discovery," explicitly
framed by its own §0 "Codebase Alignment" section as an *extension* of the
existing `buildDiscoveryInbox()` reconciliation inbox, not a greenfield
rebuild — with an explicit list of forbidden new P0 tables
(`discovery_sources`, `discovery_jobs`, `discovery_records`,
`discovery_evidence`, `agent_discovery_history`, `agent_correlations`) and a
55-item "Codebase-Fit Acceptance Gate." Asked to "implement."

**Built:**
- `modules/agent-identity/detection.ts` (+`detection.test.ts`, 6 cases) — a
  deterministic, rule-based, fully explainable AI-agent detection/confidence
  scorer (never an LLM/ML call — non-negotiable #9 and the spec's own "no
  new fuzzy/ML correlation engine in P0" gate item). Scores named signals
  (AI-runtime/MCP source category, AI-platform identifier fields, AI
  platform metadata fields, naming pattern, service-identity type, metadata
  tags/description, tool/relationship association) against the object's
  `normalized`/`raw` payload already published through Integration Agent's
  contract, and returns `DetectionClassification`
  (`CONFIRMED_AGENT`/`PROBABLE_AGENT`/`POSSIBLE_AGENT`/`NON_AGENT`/`UNKNOWN`)
  + a 0-100 confidence score/level + the full evidence list.
- `lib/shared/types/agent-identity.ts` — added `DetectionClassification`,
  `ConfidenceLevel`, `EvidenceStrength`, `DetectionSignal`,
  `DiscoveryChangeType` (`NEW`/`STALE` — see the honest scope note below),
  `DiscoveryCandidateStatus`, `DiscoveryDecisionType`; extended
  `DiscoveryInboxEntry` with all of the above plus `integrationName`,
  `identityType`, `owner`, `application`, `duplicateMatchScore`,
  `duplicateMatchedKeys`, `candidateStatus`, `linkedAgentId`, `lastSeenAt`.
  The three original categories (`new`/`likely_duplicate`/
  `orphaned_identity`) are unchanged.
- `supabase/migrations/0051_identity_discovery_candidate_decisions.sql` —
  extends the *existing* `agent_duplicate_candidates` table (built for
  IDENTITY-P0-04) rather than adding a new table: `matched_agent_id` is now
  nullable (an "ignore" decision has none), plus new `source_system` /
  `source_object_id` / `decision_type` columns and a widened `status` check
  (`+ 'ignored', 'linked'`). This is the mechanism the spec's own gate item
  "existing duplicate-candidate workflow is reused for P0 review" calls
  for. Applied directly to the live Supabase project via the Supabase MCP
  tool (`apply_migration`) and confirmed with `get_advisors(security)` —
  identical accepted-exception set as before, no new findings.
- `modules/agent-identity/duplicates.ts` — added `recordDiscoveryDecision()`
  (ignore/link, service-role write with the same manual-tenant-check
  pattern as the rest of this file; "link" also calls the existing
  `linkAgentIdentity()` — the real correlation, not a second concept) and
  `listDiscoveryDecisions()` (batch lookup keyed by
  `sourceSystem::sourceObjectId` for `buildDiscoveryInbox()`).
- `modules/agent-identity/discovery.ts` — `buildDiscoveryInbox()` rewritten
  to enrich every entry with the detection/confidence/evidence above, plus:
  - **Change/removal safety (spec §27/§28)**: a `changeType` of `STALE`
    when the source object's `importedAt` predates the integration's most
    recent *completed* sync job (`listSyncJobs()`), i.e. it wasn't returned
    by the latest discovery run — derived entirely from Integration
    Agent's own `integration_sync_jobs` history, no new table. A failed
    sync never marks anything removed (nothing here infers removal from a
    `failed` job — only from a `succeeded`/`partial` one that legitimately
    didn't return the object).
  - **Candidate status**: `open`/`ignored`/`linked`, from
    `listDiscoveryDecisions()`.
  - Still consumes Integration Agent's contract only
    (`listIntegrations`/`listIntegrationTypes`/`getNormalizedObjects`/
    `listSyncJobs`) — never queries `integration_objects` directly.
  - Added `getDiscoveryCandidate(tenantId, integrationId, externalId)` —
    calls `buildDiscoveryInbox()` itself rather than a second query path,
    so the detail page can never disagree with the inbox list.
- `app/actions/agents.ts` — `registerDiscoveryCandidateAction()`,
  `ignoreDiscoveryCandidateAction()`, `linkDiscoveryCandidateAction()`.
  Registration reuses the *existing* pipeline end to end: `createAgent()`
  (whose own IDENTITY-P0-04 duplicate check still applies — a discovery
  registration that collides with an already-registered agent is diverted
  to `/agents/duplicates` exactly like a manual one), `linkAgentIdentity()`
  for source evidence, `assignOwner()` for business/technical owners, then
  the *existing* `DISCOVERED -> REGISTERED` transition
  (`transitionAgentLifecycle`) whose prerequisites (purpose, source_system,
  active business_owner + technical_owner —
  `lifecycle.ts`'s `validateTransition()`) were already exactly what the
  spec asks for; no second registration state machine was written. If an
  owner wasn't supplied, the transition's `PRECONDITION_FAILED` is caught
  and swallowed — the agent stays `DISCOVERED` and the existing
  `getOwnershipIssues()` surfacing on the agent detail page makes the
  missing owner visible (AC-007), rather than failing registration outright
  or inventing a second "missing owner" UI.
- `app/api/v1/agents/discovery/decision/route.ts` — POST endpoint wrapping
  `recordDiscoveryDecision()` for the one client component that needs a
  `fetch()` round trip (the Ignore confirm dialog); every other write goes
  through a server action, matching this codebase's established split.
- UI: `app/(customer)/agents/discovery/page.tsx` rebuilt into an
  operational inbox (spec §17-19) — metric cards (New/High Confidence/Needs
  Review/Potential Duplicates/Recently Changed/Discovery Errors, all
  query-string-linkable), query-string-driven tabs
  (All/New/Needs Review/Potential Duplicates/Recently Changed/Ignored), a
  Sources panel listing configured integrations with a real "Discover Now"
  button per source (`triggerSyncAction` — the *existing* Integration sync
  job endpoint, `POST /api/v1/integrations/:id/sync` → `after()` → real
  connector work; not a second discovery job system), and the candidate
  list via `DiscoveryCandidatesTable.tsx` (built on the shared
  `SimpleDataTable` primitive — search/sort/pagination/responsive
  card-transform for free, same pattern `AgentsTable`/`IntegrationsTable`
  already establish). Candidate Review at
  `app/(customer)/agents/discovery/[integrationId]/[externalId]/page.tsx`
  (spec §21-22, §41-42): Identity, Detection Evidence (every signal with
  source/observed value/strength/score), Source Evidence (raw payload,
  collapsible), Correlation (for `likely_duplicate` entries — reuses
  `computeDuplicateScore`'s existing output, no new scoring), a "Link to
  existing agent" form, a Register form (name/type/purpose/environment/
  identity type/business+technical owner, with the spec's exact "does not
  grant or revoke IAM access" notice), and `IgnoreCandidateButton.tsx`
  (the established `ConfirmActionDialog` + fetch pattern from
  `MergeDuplicateButton`).

**Deliberately scoped down / deferred (flagged, not silently dropped):**
- **Field-level change detection** (`UPDATED`/`OWNER_CHANGED`/
  `IDENTITY_CHANGED` from spec §26) needs a prior-snapshot/fingerprint
  history per source object, which neither Identity nor Integration
  persists today (`integration_objects` is upserted in place with no
  history retained). Adding that would mean either a new Identity-owned
  history table (the spec's own forbidden-table list rules out the closest
  fit, `agent_discovery_history`, for this exact purpose) or an Integration
  Agent schema/behavior change (crosses module ownership — rule #18: record
  and stop, don't silently modify another module's table). Neither was
  done; `DiscoveryChangeType` is honestly scoped to `NEW`/`STALE` only,
  where `STALE` *is* genuinely derivable today (see above). Flagging this
  as the one open cross-module question from the spec's §55 gate item "Any
  required cross-module contract change is documented and explicitly
  approved" — a real fix needs either Identity Agent's own new table (user
  approval to add one despite the spec's list) or Integration Agent
  publishing a change-history contract.
- **Bulk operations** (spec §39, P0: bulk ignore / bulk owner assignment):
  not built this pass — every action here is single-candidate. Flagged as
  a follow-up within this same extension, not a new story.
- **Event-driven discovery, cloud AI platform discovery, owner
  suggestions, agent-to-agent relationship discovery** — all explicitly P1
  in the spec's own §3 scope split; correctly not built.
- **MCP/runtime cross-source signal fusion** (spec §9's "runtime signals":
  tool invocation counts, resource access) is not scanned as a distinct
  detection input beyond "is this integration's category `mcp`/
  `ai_runtime`" — richer fusion (e.g. reading `activity` objects for a
  given identity) is a natural next increment, not started.
- **Registration Dialog's owner/business fields use a raw user-id text
  input**, matching the exact idiom already established by
  `assignOwnerAction`'s own form on the agent detail page (no user-picker
  component exists anywhere in this codebase yet) — not a new gap
  introduced here.

**Verified:** `npx tsc --noEmit` clean; `npx eslint .` clean (fixed one
`react/no-unescaped-entities` and one now-real `no-unused-vars` — the
latter fixed by adding an explicit `tenant_id` filter to
`listDiscoveryDecisions()`, belt-and-suspenders alongside RLS, matching
`listIntegrations()`'s own documented pattern, rather than suppressing the
warning); `npx vitest run` — 147/147 passing (6 new:
`classifyAgentSignal`'s NON_AGENT/UNKNOWN/weak-service-account/
strong-confirmed/medium-probable/score-cap cases); `npm run build` succeeds
and lists every new route (`/agents/discovery/[integrationId]/[externalId]`,
`/api/v1/agents/discovery/decision`) alongside the unchanged existing ones.
Migration applied to the live dev Supabase project; `get_advisors(security)`
re-checked — no new findings, same accepted-exception set as before.

**Codebase-Fit Acceptance Gate (spec §55) — self-check:** no
`discovery_jobs`/`discovery_sources` table introduced; no direct
`integration_objects` query from Identity; integration data consumed only
through `modules/integrations/service.ts`; discovery runs use the existing
`integration_sync_jobs`/`triggerSyncAction`/`runSyncJob` path; `/agents/
discovery` remains functional and its `buildDiscoveryInbox()` categories
are preserved, not replaced; `agents`/`agent_identities` remain canonical;
the existing duplicate-candidate workflow (`agent_duplicate_candidates`) is
reused, not duplicated; no ML/fuzzy correlation engine added; registration
uses the existing `createAgent`/`linkAgentIdentity`/`assignOwner`/
`transitionAgentLifecycle` services; ownership prerequisites are the
pre-existing ones in `lifecycle.ts`; audit uses `writeAudit()` throughout;
tenant/RBAC checks reuse `requirePermission()` (`agent.read`/`agent.create`)
and RLS; integration credentials were never touched by any new code path;
no other module's implementation was modified (Integration Agent's files
are unchanged) — the one documented cross-module gap is the change-history
question above, recorded rather than silently worked around.

---

## 2026-09-15 — Governance Requirements Reconciliation (documentation/planning pass only)

**Agent:** Identity Agent (documentation/planning pass only — no
application code, migrations or tests touched).

**Task:** the user supplied a new "Updated P0/P1 Governance Requirements"
document spanning all 11 modules and, via `AskUserQuestion`, chose to
reconcile it into the backlogs before any implementation rather than build
against it directly. Full cross-module mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`.

**Finding:** one genuine, unambiguous, Identity-owned gap, found by direct
inspection of `lifecycle.ts` rather than backlog text: `SUSPENDED` only
transitions to `RETIRED` — there is no restoration path, so the new doc's
"support controlled restoration" (P0-20) requirement cannot be met today.
Added as new Progress Tracker row **IDENTITY-P0-06** (Not Started) with a
full objective/acceptance note in the backlog's own new "Requirements
Refresh — 2026-09-15" section. One minor additive schema gap
(`AgentOwnerType` has no `escalation_owner`) noted but not given its own
row. Two cross-cutting items (contract-schema autonomy/tools/approval
fields; Governance Attestation's P0-vs-P1 tier and possible Compliance
ownership) depend on open decisions recorded centrally and were
deliberately not built or re-tiered unilaterally.

---

## 2026-09-15 — IDENTITY-P0-06: Suspension Restoration Path (built)

**Agent:** Identity Agent.

**Task:** the user said "start on p0 items" after the governance
reconciliation pass above. `IDENTITY-P0-06` was the one concrete,
unambiguous, no-decision-required item from that pass, so it was built
first while the larger cross-cutting items stay open pending the user's
architecture calls.

**Built:** `modules/agent-identity/lifecycle.ts`'s `NORMAL_TRANSITIONS`
gained `RESTRICTED: ["SUSPENDED", "ACTIVE"]` and
`SUSPENDED: ["RESTRICTED", "RETIRED"]` — a staged restoration path
(`SUSPENDED → RESTRICTED → ACTIVE`) rather than a direct
`SUSPENDED → ACTIVE` shortcut, mirroring the path an agent takes *into*
suspension (`ACTIVE → RESTRICTED → SUSPENDED`). This was a judgment call
(the backlog's own refresh entry flagged "pending the user's preference on
whether restoration must pass back through a restricted state first") —
made explicitly rather than left blocking, since it's a reversible,
easily-changed implementation detail, not an architecture decision in
CLAUDE.md's sense. `validateTransition()` gates both new legs behind the
same `RESTRICTED_TO_SUSPENDED_ROLES` (`SECURITY_ADMIN`/`IAM_ADMIN`/
`TENANT_SUPER_ADMIN`) already used for `RESTRICTED → SUSPENDED`, on the
reasoning that reversing a suspension/restriction is at least as sensitive
as imposing one. No new code path: both transitions run through the
existing `transitionAgentLifecycle()` (mandatory reason, `writeAudit()`,
`agent_lifecycle_events` row) exactly like every other transition. No UI
change needed — `app/(customer)/agents/[id]/page.tsx`'s lifecycle-
transition form already lists every `AgentLifecycleState` as a selectable
destination.

**Verified:** `npx tsc --noEmit` clean; `npx eslint .` clean; `npx vitest
run` — 148/148 passing (2 new cases in `lifecycle.test.ts`: the new
transitions are structurally allowed, and `SUSPENDED → ACTIVE` directly is
still correctly rejected); `npm run build` succeeds. No migration needed —
`agents.lifecycle_state`'s CHECK constraint already permits every state
this touches.

---

## 2026-09-15 — IDENTITY-P0-07: Contract Autonomy & Oversight Fields (built)

**Agent:** Identity Agent.

**Task:** continuing "start on p0 items" now that the user resolved the
autonomy-model ownership question (Identity + Access) via `AskUserQuestion`.

**Built:** migration `0052_identity_contract_autonomy_oversight.sql` adds
`autonomy_level` (int, 0-4, CHECK-constrained), `allowed_tools` (text[]),
`actions_requiring_approval` (text[]), `required_monitoring` (text,
nullable), `required_compliance_controls` (text[]) to `agent_contracts`.
Every new column defaults to the most conservative value (autonomy 0, empty
tool/approval/control lists) so every pre-existing contract row stays
conservative until a human explicitly widens it via a new version —
consistent with this module's existing "never silently unrestricted"
posture. `lib/shared/types/agent-identity.ts` gained `AutonomyLevel` (a
literal `0|1|2|3|4` union, not a bare `number`) and the five new
`AgentContract` fields; `AgentOwnerType` gained `escalation_owner`
(governance doc's P0-05, previously a noted-but-unscoped gap).
`contracts.ts`'s `createContractVersion()` validates `autonomyLevel` is in
range (400 `INVALID_INPUT` otherwise) and persists all five fields with the
same conservative defaults as the migration. `mappers.ts`'s
`toAgentContract()` updated. UI: the agent detail page's contract display
and "Publish new contract version" form both gained the five new
fields/inputs (autonomy-level select with the five governance-doc labels,
three comma-separated list inputs, one free-text field), and `OWNER_TYPES`
gained `escalation_owner` in the owner-assignment form — same idiom as
every other field on that page, no new UI pattern introduced.

**Deliberately not built here:** enforcement of the 4-state action model
(allowed/allowed-with-approval/restricted/prohibited) against these new
fields is Access Agent's `ACCESS-P0-06`, not this story — Identity only
publishes the SHOULD-side data.

**Verified:** `npx tsc --noEmit` clean; `npx eslint .` clean; `npx vitest
run` — 148/148 passing (unchanged — no new pure-function surface to unit
test; `createContractVersion()` is a DB-touching function without an
existing mock-Supabase test pattern in this module, matching every other
service-role write function here); `npm run build` succeeds. Migration
applied to the live dev Supabase project via the Supabase MCP tool;
`get_advisors(security)` re-checked — no new findings, same accepted-
exception set as before.

---

## 2026-09-16 — published `updateAgentRiskScore()` (unblocks RISK-P0-02.1)

Small, paired addition — the story is tracked under Risk Agent's own
backlog as `RISK-P0-02.1`; full account in that module's audit log.
`modules/agent-identity/agents.ts` gained `updateAgentRiskScore(tenantId,
agentId, riskScore)`: service-role client (this is a system-triggered side
effect of risk evaluation, not a user editing the agent through
`agent.update`), with the tenant_id filter visible in the call per
CLAUDE.md §14. No separate audit event for a routine score refresh — same
discipline `createOrUpdateFinding()` already uses (only a genuinely new
state change is audited, not every re-evaluation refresh). Exported from
`modules/agent-identity/service.ts`. No schema change — `agents.risk_score`
already existed (migration `0012`).

**Verification:** full pipeline (typecheck/lint/`npx vitest run` 217/217/
build/secret-leak check) run as part of Risk's own pass — see that
module's audit log entry for the complete record. No dedicated unit test
added for this thin sink directly (matching the existing pattern for
service-role write functions like `transitionAgentLifecycle`, which also
has no direct mocked-Supabase test) — behavior is covered end-to-end by
`modules/risk/rules.test.ts`'s assertions on the exact values passed to it.

---

## 2026-09-16 — pagination pass (QA-P0-04.3 follow-up, user-prioritized "what's left before launch")

Capped 3 previously-unbounded `list*()` queries with the new shared
`DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`, 200): `agents.ts`'s
`listAgents()`, `duplicates.ts`'s `listDuplicateCandidates()`,
`lifecycle.ts`'s `listLifecycleEvents()`. `duplicates.ts`'s
`listDiscoveryDecisions()` was deliberately left uncapped — it builds a
completeness-dependent lookup map `buildDiscoveryInbox()` depends on;
truncating it would make an already-decided discovery candidate reappear
as new (a correctness bug, not a performance one) — see its own inline
comment. `contracts.ts`/`identities.ts`/`owners.ts`/`relationships.ts`'s
per-agent child-record lookups were judged genuinely bounded by real-world
cardinality (an agent cannot realistically have hundreds of owners/
identities/relationships/contract versions) and intentionally left
untouched, avoiding an unnecessary change with correctness risk for
near-zero real benefit.

Verification covered as part of the full cross-module pass — see
`INTEGRATION_STATUS.md` §5's update note for the shared pipeline run.

---

## 2026-09-16 — Egress caveat in this log is obsolete; isolation re-proven with a real client

This log's tenant-isolation entry records that the proof was run through the
Supabase MCP with a server-side simulated JWT "because this sandbox's network
egress cannot reach Supabase directly." That restriction has lifted for HTTPS.
The deferred half has now been done once, centrally, rather than re-run
per module: `tests/live-client-tenant-isolation.mjs` drives two genuinely
authenticated Supabase JS client sessions over HTTPS across **all 44
tenant-scoped tables** — this module's included — in both directions, plus
cross-tenant read/update/delete/insert attempts and an unauthenticated anon
sweep. Every check passed, and the live result agrees with this module's
earlier simulated proof.

No code in this module changed. See
`docs/design/foundation-agent-backlog-audit.md` and
`docs/design/qa-agent-backlog-audit.md` (both dated 2026-09-16) for the full
account, including what remains blocked (raw Postgres; a complete Playwright
E2E run, which needs credentials this environment does not have).

## 2026-09-19 — Two tenant-wide read functions published for Operations' global search

Picked up as a cross-module dependency for OPERATIONS-P0-03.1 (Global
search): Operations' `search()` names "identity" and "owner" as two of the
nine object types it needs to cover, but every existing read on
`agent_owners`/`agent_identities` in this module was agent-scoped only
(`listOwners(tenantId, agentId)`, `listAgentIdentities(tenantId, agentId)`
— the agent detail page's own need). Rather than leave the dependency
recorded-and-blocked, published the tenant-wide counterparts this
module's own data can support:

- **`listOwnersForTenant(tenantId)`** (`modules/agent-identity/owners.ts`)
  — same RLS-protected `agent_owners` table, no `agent_id` filter. Embeds
  `users(display_name, email)` and `agents(agent_name)` via their real FKs
  (migration 0014) so a search result has a human-readable title/subtitle
  without Operations reaching into `users`/`agents` itself
  (non-negotiable #6) — the returned `OwnerWithContext` type is `AgentOwner`
  plus exactly those three extra fields, nothing else changed about the
  existing shape.
- **`listIdentitiesForTenant(tenantId)`** (`modules/agent-identity/identities.ts`)
  — same shape, embeds `agents(agent_name)` via `agent_identities.agent_id`.

Both exported from `modules/agent-identity/service.ts` alongside the
existing agent-scoped functions, which are unchanged and still the right
choice for their own callers.

**Verified:** typecheck, lint clean (fixed two `@typescript-eslint/
no-explicit-any` lint errors from the initial draft — narrowed the raw-row
parameter type instead of using `any`, since these two files aren't
`mappers.ts` and don't carry that file's blanket disable). No unit test of
their own added (this module's existing pattern for thin Supabase-query
wrappers like `listOwners`/`listAgentIdentities` is RLS/live verification,
not client-mocked unit tests) — real coverage is
`modules/operations/search.test.ts`'s new tests, which exercise both
functions' actual consumer. `npm run build` clean. No schema/migration
change — same tables, same RLS, a different filter.

## 2026-09-19 (later) — OPERATIONS-P0-02.2: certification_due and ownership_missing wired

Picked up, at the user's explicit direction, two of Operations' three
previously-unwired notification triggers — the backlog had left them
unwired because each needed a real product decision it didn't specify
("genuinely ambiguous trigger points"); the user asked for reasonable
defaults, clearly documented, rather than leaving them unbuilt.

**`certification_due`** — wired directly into `maybeMarkCertificationDue()`
(`modules/agent-identity/lifecycle.ts`), which already existed
(IDENTITY-P0-02.1) to compute the on-read `ACTIVE -> CERTIFICATION_DUE`
lifecycle transition. This needed **no new scheduler at all**: the
transition table only allows `ACTIVE -> CERTIFICATION_DUE`, so the
function's own existing guard (`lifecycleState !== "ACTIVE"`) already
makes the transition — and now the `notify()` call right after it —
fire at most once per due cycle, whichever request happens to read the
agent first after `next_review_at` elapses. That is a real, single write
event (an `agent_lifecycle_events` insert + `agents.lifecycle_state`
update), resolving the backlog's own "no single unambiguous write event"
concern for this trigger specifically. Targeted at the agent's business
owner (`listOwners()`, matching `escalateOverdueItems()`'s own
escalation-target reasoning); broadcasts (`userId: null`) when there
isn't one.

**`ownership_missing`** — wired into `removeOwner()`
(`modules/agent-identity/owners.ts`). Ownership issues are otherwise
purely derived (`getOwnershipIssues()` computes them on read with no
write of its own), so this hooks the one genuine write event that can
*create* a gap: a removal is snapshotted against the owner list
beforehand, and `notify()` fires only when this specific removal is what
takes a required owner type (`business_owner`/`technical_owner`) to
zero — not merely "a gap happens to exist" (which could be pre-existing
and unrelated to this call). No owner remains to target, so it
broadcasts to the tenant.

**A real gap left deliberately, not silently:** an agent that has never
had a required owner assigned since creation (rather than one removed
later) produces no notification under this design — there is no
discrete write event marking "ownership was never set," and firing on
every single agent creation (which routinely happens without an owner,
as a separate onboarding step) would be close to unconditional noise,
not a meaningful signal. Recorded here rather than guessed at with an
invented grace-period threshold.

**Verified:** typecheck, lint clean. New `modules/agent-identity/
lifecycle.test.ts` coverage (5 cases: notifies the business owner,
broadcasts with none, and three "does nothing" guards — not ACTIVE, not
yet due, no `next_review_at` set) and new `modules/agent-identity/
owners.test.ts` (4 cases: notifies on a gap-creating removal, does not
notify when another owner of the same type remains, does not notify for
a non-required type, still performs the removal/audit either way). Full
vitest suite 342/342 (was 325 before this and the matching Access Agent
change — see `docs/design/access-agent-backlog-audit.md` and
`docs/design/operations-agent-backlog-audit.md` for the third trigger
and the shared dedup helper). `npm run build` (fresh `.next`) clean.

Circular import note: `lifecycle.ts`/`owners.ts` now import `notify`
from `@/modules/operations/service`, which itself imports
`listAgents`/`listOwnersForTenant`/`listIdentitiesForTenant` back from
this module's own `service.ts` (via `search.ts`) — a cycle. This exact
shape already existed before this change (Compliance's
`escalation.ts` -> Operations -> Compliance, via the same `search.ts`
composition) and resolves cleanly because nothing here reads another
module's export at top-level module-initialization time, only inside
async function bodies called later — confirmed empirically (typecheck,
build, and the full test suite all pass) rather than assumed safe.

---

## 2026-09-25 — Fix: `listAgents()` returned every tenant the user belongs to

Found during the light-console rebuild (codebase-map D10).

- **Bug.** `listAgents()` filtered by RLS alone. RLS admits every tenant in
  `current_tenant_ids()`, which is *all* of the user's active memberships.
  A member of two organizations therefore saw both organizations' agents
  in the list, and in every dashboard count built on it, whichever
  organization was selected. It is not a leak to a stranger, but it breaks
  §14 (application-level tenant filtering as defense in depth) and shows
  wrong data.
- **Fix.** An explicit `.eq("tenant_id", tenantId)`.
- **Verified.** Typecheck, lint, the unit suite (352/352) and the full
  Playwright suite (140/141; the one failure is the unrelated sign-up
  provider check, see the Experience entry).
- **Handed to QA Agent.** Sweep the other service reads that take a
  `tenantId` but rely on RLS alone.
- **Also recorded, not fixed** (codebase-map §5):
  - D3: `linkAgentIdentity()` writes no audit event.
  - D4: lifecycle state ASSESSED is unreachable.

---

## 2026-09-25 — New published contract: `getAgentRuntimeProfile()`

This was added for the Runtime Gateway decision (ACCESS-P0-11 and
RUNTIME-P0-15), under the user's ownership decision of 2026-09-25. It is a
contract addition only; no existing export changed.

- **Why.** A gateway call carries an agent API key, not a user session, so
  `getAgent()` and `getAgentContract()` would see nothing under RLS.
- **What it returns.** The agent's lifecycle, environment, criticality and
  risk score; its active contract; and its non-removed identity ids.
- **How it reads.** Through the service role. Every query filters by
  `tenant_id` and every row is re-checked (§14). The tenant and agent must
  come from a verified agent API key.
- **Verified** through `runtimeDecisionLoader.test.ts` (tenant filters and
  unknown-agent handling) and the full suite, 405/405.

## 2026-09-25 — New published contract: `getAgentDisplayName()`

This is additive, in `modules/agent-identity/runtimeProfile.ts`, and
exported from `service.ts`.

- **Why.** The Runtime Gateway's notifications (OPERATIONS-P0-08) are
  raised with no user session, so the RLS-scoped `getAgent()` cannot be
  used.
- **How.** It reads `agent_name` with the service role, filters by
  `tenant_id`, and re-checks the returned row's tenant (§14). It returns
  null for an agent outside the tenant.
- **Compatibility.** No existing contract changed.

## 2026-09-25 — IDENTITY-P0-11 (NHI inventory) and IDENTITY-P0-12 (Shadow AI)

### IDENTITY-P0-11 — non-human identity inventory (master P0-08)

`buildNhiInventory()` (`modules/agent-identity/nhi.ts`, exported from
`service.ts`) and the page `/agents/identities`, listed under Discover in
the nav. It is a read over what Identity already owns, not a parallel
registry:

- **Linked NHIs.** `agent_identities` rows (not removed), with their
  agent. A link whose agent is retired or gone is **orphaned**.
- **Unlinked NHIs.** Integration's normalized identity objects that
  discovery has not correlated (`buildDiscoveryInbox()`), with
  discovery's deterministic classification.
  - The page never implies an NHI is an agent. Each unlinked row shows
    its classification ("Not an agent", "Probable agent", …), and a
    "Likely AI agents" view filters to confirmed or probable ones.
  - An ignore decision shows as **ignored**.
- **Human delegates are excluded.** They are people's accounts, not
  non-human identities.
- **Linking** goes through the existing candidate page: each unlinked row
  links to `/agents/discovery/<source>/<id>`. The inventory itself has
  no write path.
- **Paging.** The page pages at 50 rows, URL-driven. The builder reads up
  to 2,000 links plus the inbox, which is the same cost the discovery
  page already pays.

### IDENTITY-P0-12 — Shadow AI from runtime telemetry (master P0-09)

- **Resolution.** `resolveAgentReference()` is a new published contract,
  service-role and tenant-checked.
  - A runtime event may name its agent by WonderAgent id or by
    `agentRef`, meaning a linked identity's external reference.
  - It resolves by authoritative identifier only (§17.6): exact agent id,
    or exact external reference. It returns
    `unique | none | ambiguous` and never picks the closest match.
- **Unresolved events.** Runtime quarantines an event whose agent
  resolves to *none* as `UNREGISTERED_AGENT`, and one whose agent is
  *ambiguous* as `AMBIGUOUS_AGENT`. The event is never recorded as DID
  and never dropped. See the Runtime audit log for migration 0067 and
  the gates.
- **Inbox entries.** `buildDiscoveryInbox()` adds one `shadow_ai` entry
  per unregistered reference, from Runtime's published
  `listUnregisteredAgentActivity()` (90 days). This happens even when
  the tenant has no integration.
  - The entry carries source, evidence (event count, sources, tools,
    applications, first and last seen), a deterministic classification
    (`shadowAi.ts`, pure), and its register, link or ignore status.
  - Owner is never guessed.
- **Registering.** This reuses the existing candidate flow. The reference
  becomes the new agent's linked identity (source `runtime`), so its
  next event resolves and is recorded. A reference linked by any route
  resolves the inbox entry.
- **UI.** The discovery page has a "Shadow AI" tab and metric, and the
  candidate page explains that the evidence is quarantined, not
  recorded.

**Deliberately left out:**

- A risk score on the Shadow AI entry. That is Risk's to compute
  (RISK-P0-12 names shadow AI as a risk signal).
- The MCP bridge (INTEGRATION-P0-07). Once MCP events reach the event
  route with an `agentRef`, they feed Shadow AI with no further change
  here.

**Performance fix (§15), found while testing this story.**
`buildDiscoveryInbox()` ran two sequential queries per integration
(`getNormalizedObjects` + `listSyncJobs`). E2E Tenant One has 25
integrations, so the discovery page took ~9 s, and under two test workers
the new Shadow AI spec timed out at 30 s. The inbox now makes one parallel
wave over Integration's new tenant-wide reads
(`getNormalizedObjectsForTenant`, `listLatestCompletedSyncStarts`): a
fixed number of queries whatever the integration count. The discovery
page went from **~9.0 s to ~1.45 s**, and `/agents/identities` from
~8.8 s to ~1.47 s (warm, same build).

**Observed, not changed.** A signed-in user with no organization, such as
the platform admin, who opens a customer page is redirected to
/onboarding by the layout. The page's own server component still runs in
parallel and logs a `QUERY_FAILED` (a tenant id of `null`) before the
redirect wins. Nothing is shown or leaked, but the log noise predates
this work. An early `if (!ctx.tenantId) redirect(...)` in each page would
silence it; that is Experience's call.

**Verified (IDENTITY-P0-11/12, with INTEGRATION-P0-07 in the same run):**

- Unit tests:
  - `shadowAi.test.ts` (3)
  - `nhi.test.ts` (4)
  - `runtimeProfile.test.ts` (4: resolution by id and by reference; the
    other tenant's never; ambiguous; removed; every query
    tenant-filtered)
  - Runtime `unregistered.test.ts` (8)
- E2E `shadow-ai.spec.ts`, 4/4:
  - refusal and quarantine;
  - shape validation;
  - the Shadow AI tab for its own tenant only;
  - registration, after which the next event is recorded and the entry
    is gone;
  - the NHI inventory shows it linked, for its own tenant only.
- `/agents/identities` was added to the design-review sweep (every named
  width, both themes, and the column-priority fit check).
- Full pipeline: eslint clean, vitest **476/476**, Playwright **175/175**
  (7.9 min).
- Migrations 0067 (Runtime) and 0068 (Integration index) applied live.

## 2026-09-25 — IDENTITY-P0-14: defects D3 and D4 from the codebase map

### D3 — identity links were unaudited and always "confirmed"

- **Before.** `linkAgentIdentity()` hard-coded `confidence: "confirmed"`
  and wrote no audit event (#11).
- **Now.** Every caller states the confidence and the basis for it, and
  each link writes `agent.identity_linked`. The event records the actor,
  agent, type, source, reference, confidence and basis. The basis lives in
  the audit trail, so no schema change was needed.
- **The callers:**
  - Registering a discovery candidate, or recording a "linked" discovery
    decision, is `confirmed`: a person reviewed the candidate's evidence.
    This includes Shadow AI registration.
  - The manual form on the agent page has a new "Confidence" select
    (default Unverified). The person linking says how sure they are.
  - `POST /api/v1/agents/:id/identities` accepts `confidence` and `basis`.
    **The default is now `unverified`**, where it used to be an implicit
    `confirmed`: a reference asserted through the API with no
    verification is not confirmed.
  - This matters to Compliance's governance posture, which counts only
    `confirmed` or `probable` links as verified. An API caller that has
    verified a link should say so.
- An unknown confidence is rejected (400) before anything is written.

### D4 — ASSESSED was unreachable

- The transition table now has REGISTERED → ASSESSED → APPROVED, the
  master lifecycle's assessment step. The direct REGISTERED → APPROVED
  path is **kept**, so no existing flow changes.
- Entering ASSESSED needs what approval needs: an active contract (the
  SHOULD being assessed), and an approver role or one of the agent's
  owners. Both checks moved into one helper, `assertContractAndApprover()`,
  shared by REGISTERED/ASSESSED → APPROVED; the approval error text is
  unchanged.
- ASSESSED cannot be entered from DISCOVERED, cannot jump to ACTIVE, and
  cannot go back. Emergency suspension from it still works.

**Tests:**

- `identities.test.ts` (new, 2): the stated confidence is stored and
  audited with its basis; an unknown confidence is refused before any
  write.
- `lifecycle.test.ts` +2: the new transitions, and the ones that stay
  forbidden.
- Identity unit tests 41/41.
- Full pipeline: eslint clean, vitest **513/513**, Playwright **187/187**
  (8.7 min, a fresh build).

## 2026-09-25 — IDENTITY-P0-13: contract and ownership completeness (master P0-03/04/06)

**Ownership:**

- **Two new owner types** (migration 0073):
  - `delegated_owner`. A delegated owner acts for someone else for a
    bounded time. The person assigning it is recorded as `delegated_by`,
    and an expiry is required: in the future, at most a year out. The
    service checks both, and so does a database check.
  - `escalation_owner`. The UI already offered it, but the database check
    rejected it, so choosing it failed. That was a live defect.
- **An owner must be an active member of this organization.** Before this,
  any user id was accepted, including another tenant's user.
- **Expired delegations** are a new ownership issue,
  `delegation_expired`. The agent page describes it in words.
- **Ownership review.** New `reviewOwnership()`, with a "Confirm
  ownership" button on the agent page and
  `POST /api/v1/agents/:id/owners/review`.
  - It is refused (412), saying why, while a required owner (business or
    technical) is missing or a delegation has expired.
  - Otherwise it stamps `last_reviewed_at` and `last_reviewed_by` on every
    active owner, and audits `agent.ownership_reviewed`.
  - If RLS lets nothing be updated, it reports 403 rather than a success.
- **The owners list** now shows names instead of ids, "Delegated until …"
  or "Delegation expired …", and "Confirmed …" or "Not yet confirmed".

**Contract:**

- New fields: approved users, approved delegators, allowed environments
  (production, staging, development; none means any), and an expiry. The
  form and the contract display have all four.
- Publishing a contract now sets `agents.next_review_at`. It is the
  certification frequency after publication (monthly 1, quarterly 3,
  semiannual 6, annual 12 months), and never later than the contract's
  expiry. Before this, `next_review_at` was never written.

**Lifecycle:**

- Approving, assessing and going live (PROVISIONED → ACTIVE) all need an
  active contract that has not expired and allows the agent's
  environment. Each refusal is a 412 that says which.
- **Production agents:** approval needs an approver role (IAM_ADMIN or
  TENANT_SUPER_ADMIN). An agent's own owner can still approve a staging
  or development agent, as before. Every agent already reaches ACTIVE
  only through APPROVED, so a production agent is now always approved by
  an approver before it goes live.

### Incident: 0073 broke the owner listing for about 5 minutes (production and local)

- **Cause.** 0073 as first applied gave `agent_owners.delegated_by` and
  `last_reviewed_by` foreign keys to `users`. `agent_owners` then had
  three relationships to `users`, so PostgREST could not resolve the
  unqualified `users(display_name, email)` embed in
  `listOwnersForTenant()`. That call backs the Agents list, Agent 360
  owner names, and search, and it failed in production and locally.
- **Fix.**
  - Migration 0074 drops those two foreign keys. The columns stay; the
    actor is also in the audit event.
  - The embed now names its key, `users!agent_owners_user_id_fkey(...)`,
    so a future foreign key cannot break it again.
  - Verified: `/agents` and search return 200 locally. Production runs the
    old unqualified embed, which is unambiguous again after 0074.
- **Effect on testing.** Four `agents.spec` tests failed in the
  ACCESS-P0-12 full suite that ran through that window. All four passed on
  rerun.
- **Lesson,** applied in 0075 below: never add a second foreign key to a
  table that is embedded unqualified. Replace the key under the same
  name, or name the key in every embed.

### Cross-tenant references to agents closed (migration 0075)

- **Found while writing the isolation test.** `agent_owners`,
  `agent_identities` and `agent_relationships` (both `agent_id` and
  `related_agent_id`) referenced `agents(id)` alone. Their RLS insert
  checks look only at the row's own `tenant_id`.
- **The hole.** A tenant-B member could write a tenant-B row that points
  at tenant A's agent (non-negotiable #4). The unique key on
  `agent_owners` would also have let them probe whether an agent id
  exists.
- **Live data.** No such rows existed; checked before applying.
- **The fix.**
  - `agents` gains `unique (id, tenant_id)`.
  - Each foreign key is replaced by a composite `(agent_id, tenant_id)`
    key under the **same constraint name**, still ON DELETE CASCADE. So
    there is still one relationship per column pair, and every embed is
    unchanged.
- **Verified live** with `tests/identity/same-tenant-agent-refs.sql`,
  running as an authenticated tenant-B member:
  - owner, identity and relationship rows pointing at tenant A's agent are
    all refused (23503);
  - the same writes on B's own agents succeed (1 and 1);
  - no row references A's agent (0);
  - fixtures cleaned up.
- **After 0075,** the agents, navigation and search specs pass (40/40).
- **Still open:** Access's own tables with client insert policies
  (`accounts`, `access_requests`, `policy_exceptions`) have the same
  single-column `agent_id` key. They are recorded for the QA-P0-17 RLS
  sweep, not changed here (#18).

**Tests:**

- `contracts.test.ts` (new, 2): `nextReviewAt` for every frequency, capped
  by the contract's expiry.
- `lifecycleContract.test.ts` (new, 5):
  - an owner cannot approve a production agent but can approve a staging
    one;
  - an expired contract blocks approval;
  - a contract that does not allow the agent's environment blocks going
    live;
  - no contract blocks going live;
  - nothing is written on any refusal.
- `owners.test.ts` +2:
  - a delegated owner with no, past, over-a-year or unparseable expiry is
    refused before any write;
  - the review is refused while a required owner is missing, and nothing
    is audited.
- Identity unit tests 50/50.
- E2E `ownership-contract.spec.ts` (new), on a production agent:
  - a delegated owner without expiry is 400 through the API; a
    non-member owner is 400;
  - through the UI, a delegated owner shows "Delegated until …";
  - "Confirm ownership" is refused, naming the missing owners, then
    confirmed for 3 owners once they are assigned, with "Confirmed
    <today>";
  - a contract with approved users and delegators, staging only and an
    expiry is shown, and approving the production agent is then a 412
    naming the environment;
  - another organization can neither assign owners to the agent nor review
    it.
- `agents.spec` now looks for owners by their readable labels.
- Full pipeline: `tsc` and `eslint` clean, vitest **536/536**, Playwright
  **194/194** (9.3 min, on a fresh build with 0075 applied live).

---

## 2026-09-25 — Tenant filters and same-tenant keys (with QA-P0-17)

QA-P0-17's sweep changed this module's code and schema. It added
explicit `tenant_id` filters to reads that relied on RLS alone, required
`tenantId` on by-id reads that lacked it, and checked parents on by-id
writes. Migration 0076 (or 0075 for Identity) gave this module's
agent/parent references `(col, tenant_id)` foreign keys under their
existing names. For a member of two organizations, RLS alone admitted
both. The full list, tests and live SQL verification are in the QA audit
log's QA-P0-17 entry.

---

## 2026-09-26 — IDENTITY-P0-15/16 (Done), IDENTITY-P0-17 (Partial): the WonderID identity directory

WonderID Phase 1 (`docs/plan/WONDERID-ROADMAP.md`). This is one common
identity reference for every identity type, following spec rule R5 and
roadmap decision 1: a reference model, not a second source of truth.

### Schema (migrations 0077, 0078, 0079; applied live)

- **`identities`**:
  - One tenant-scoped row per identity. The types are HUMAN, EXTERNAL,
    MACHINE, SERVICE_ACCOUNT, APPLICATION, WORKLOAD, API and AI_AGENT.
  - Columns: status, human lifecycle state, source and correlation
    references, owner/sponsor/manager, HR fields, privileged/external flags,
    typed `attributes` jsonb.
  - Owner, sponsor, manager and agent are same-tenant composite foreign
    keys (the 0075/0076 pattern).
  - RLS on select, insert and update. There is no delete policy: an
    identity is disabled or archived, never deleted.
- **AI agents stay canonical in `agents`.** A SECURITY DEFINER trigger
  mirrors each agent 1:1:
  - it copies name, type, lifecycle as status, purpose, risk and last seen
    on insert or update;
  - deleting the agent cascades to its identity row.
  - The mirror row is kept out of the source-reference unique index,
    because `agents` has no uniqueness there and the mirror must never
    make an agent insert fail.
  - Nothing about `agents` changed.
- **Members are HUMAN identities.** A trigger on `tenant_memberships` (a
  Foundation table; read only here, nothing about it changed) does the
  following:
  - creates the member's identity on insert;
  - on a status change or delete, makes the identity inactive or active
    again;
  - keeps the row after the membership ends, because history and
    relationships matter after someone leaves.
  - Only rows it created (`source_system = 'wonderid'`) follow the
    membership.
- **Backfill:** 43/43 agents and 17/17 memberships got their identity rows.
- **`identity_attribute_definitions`**:
  - typed (string/number/boolean/date/enum), with required, sensitive,
    searchable and unique flags, allowed values and a format rule;
  - scoped to one identity type or all;
  - retired rather than deleted.
- **`identity_relationships`**:
  - manager_of, owns, sponsors, delegates_to, service_account_for,
    workload_runs_for and member_of;
  - valid_from/valid_to, source and confidence;
  - one current edge per (source, target, type).
- **Permissions:**
  - `identity.read` for TENANT_SUPER_ADMIN, IAM_ADMIN, IAM_ARCHITECT,
    SECURITY_ADMIN, READ_ONLY, AUDITOR, CERTIFICATION_MANAGER and the
    owner roles;
  - `identity.manage` for TENANT_SUPER_ADMIN and IAM_ADMIN.
  - REQUESTER gets neither.
- **0078** revokes EXECUTE on the three trigger functions from
  anon/authenticated. The security advisor had listed them as RPC-callable
  (0077's `revoke ... from public` does not remove Supabase's default
  grants). Postgres refuses to run a trigger function outside a trigger,
  so this was exposure, not exploitability. Re-checked with
  `has_function_privilege`: anon and authenticated now have no EXECUTE on
  any of the three. The triggers still fire for member writes (the SQL
  test below ran after 0078).
- **0079** adds covering `(col, tenant_id)` indexes for every new
  composite foreign key, replacing single-column and tenant-first ones,
  plus `created_by` indexes. The performance advisor had listed them
  (§15). Re-checked with a catalog query: 0 foreign keys on the three
  tables lack a covering index.

### Rules (`modules/agent-identity/identityRules.ts`, pure, #9)

- AI agents are not created in the directory; they are registered under
  AI Agents.
- An external identity needs a sponsor, an organization and a future end
  date.
- Every machine identity type needs an owner.
- Owner, sponsor and manager must be active people in this organization,
  never the identity itself (checked in the service; the foreign keys hold
  the tenant rule).
- On update:
  - the type never changes;
  - an AI agent's identity accepts only owner, sponsor and attributes,
    because everything else comes from the agent;
  - a member's name and email come from their sign-in account;
  - an expired external identity can still be disabled, but not re-dated
    into the past.
- Attributes:
  - unknown keys are refused;
  - values are coerced to their type;
  - choice lists and format rules are enforced;
  - required ones must be present;
  - unique ones are checked against the tenant.

### Service, API and UI

- **Service:** `modules/agent-identity/directory.ts`, published through
  `service.ts`.
  - Every read and write filters on the request's tenant as well as RLS
    (the QA-P0-17 rule for two-organization members).
  - List and count are paged at the database, and counts run in parallel
    (§15).
  - 23503 maps to 404, 23505 to 409 and 23514 to 400.
  - Audit events: `identity.created`, `identity.updated`,
    `identity.status_changed`, `identity.relationship_added`,
    `identity.relationship_ended`, `identity.attribute_defined`,
    `identity.attribute_retired` and `identity.attribute_restored`. They
    carry field names only, never values (#10, §17.7).
- **API:** `/api/v1/identities` (GET, POST), `/:id` (GET, PATCH),
  `/:id/relationships` (GET, POST), `/relationships/:id` (DELETE, which
  ends the edge), `/attributes` (GET, POST) and `/attributes/:id` (PATCH
  `active`). A body `tenantId` is ignored.
- **UI:**
  - `/identities` overview: counts by type, plus the "needs attention"
    gaps (machines without an owner, external access ending in 30 days or
    already past its end date).
  - Lists: `/identities/all`, `/humans`, `/external` and `/machines`, with
    search, status filter and database paging.
  - `/identities/new`, whose fields follow the chosen type.
  - `/identities/[id]` with Overview, Relationships, Attributes and Edit
    tabs. An AI agent's identity links to the agent.
  - `/identities/attributes` (Administration → Identity Attributes).
  - Sensitive attribute values are hidden from viewers without
    `identity.manage`.
  - Navigation: the Identities section now lists Overview, All, People,
    External, Machine and Non-human Identities.

### Deliberately left out (IDENTITY-P0-17 stays Partial)

- **Groups:** there is no group model yet; that is Phase 2/4 data.
- **Detail tabs Access, Risk and Activity** for non-agent identities: they
  need the account/access correlation of ACCESS-P0-17/24.
- **Identity search** beyond the list's name/email/account search.
- **Provenance** beyond source and audit.
- **Deferred to IDENTITY-P0-18:** the "past end date" count is shown but
  not acted on; lifecycle transitions (joiner/mover/leaver) belong to that
  story.

### Verified

- `tsc` and `eslint` clean.
- Unit tests: `identityRules.test.ts` 20/20. vitest total **556/556**; `eslint .` clean.
- Live SQL (`tests/identity/unified-identities-isolation.sql`), 18/18:
  - the negative cases: a tenant-A member sees 0 tenant-B identities and
    definitions, and inserts into B are denied (42501);
  - updates of B rows affect 0 rows, and deletes affect 0 rows;
  - cross-tenant owner and relationship references are 23503;
  - an AI_AGENT row with no agent is 23514, and a duplicate current edge
    is 23505;
  - the mirror and the membership sync work for a member write.
- E2E `identities.spec.ts`, 16/16:
  - the type rules through the API;
  - a machine cannot be owned by a machine;
  - the AI agent mirror (not renameable here, owner settable);
  - attribute enforcement;
  - relationships (add, 409 on a duplicate, 400 on a self-edge, end, 404
    on a second end);
  - UI create;
  - overview links;
  - another organization: 404 on read, update and reference, absent from
    the list, "not found" page;
  - read-only can browse but cannot create (403), and REQUESTER gets 403.
- design-review (5 new routes at 8 widths and both themes) and
  navigation-smoke: 51/51.
- Full Playwright suite (§17.8: migrations, RLS and the shell changed):
  **212/212 passed** (10.5 min, fresh build, with 0077–0079 live).
- Screenshots checked: overview (light), machines (dark), detail edit
  (light), new-external and all-identities at 390 px. One fix came from
  them: the search box got a visible label so it lines up with the status
  filter.

---

## 2026-09-26 — Sourced identity writes and field provenance (for INTEGRATION-P0-09)

Identity sources (Integration module) need to change identities. This
module keeps sole ownership of those writes (#5, #6) and publishes the
write path. The full pipeline is in the Integration audit (same date).

- **Migration 0080:** `identities.field_provenance` jsonb. It records which
  source set each field, at what precedence and when. It is checked to be
  an object and applied live.
- **`sourcedMerge.ts` (pure):**
  - a source's authoritative field is written unless a higher-precedence
    source set it last;
  - other fields only fill blanks;
  - ties go to the incoming source, so it can correct its own value.
  - A manual edit leaves provenance alone, so the owning source's next
    import restores its value (#7: the source stays the system of record).
- **`sourcedIdentities.ts`** (published through `service.ts`):
  - `listIdentitiesForCorrelation()`;
  - `applySourcedIdentities(tenantId, authority, ops)` with `create`,
    `update` and `leaver` ops. It uses the service role (runs execute after
    the request); every statement is tenant-filtered, and every target row
    is re-read inside the tenant first.
  - Each op succeeds or fails on its own and reports why.
  - Person lifecycle follows the sourced status: pending or future start →
    PRE_JOIN; inactive → DISABLED; terminated → TERMINATED. A leaver
    becomes inactive with LEAVE_PENDING.
  - AI agents are never created by a source.
  - Audit: `identity.created`, `identity.updated`,
    `identity.status_changed` and `identity.leaver_detected`, with actor
    type `integration` and the run id as correlation. Field names only.
- **Tests:** precedence unit tests are in
  `modules/integrations/identitySourceRules.test.ts`. E2E coverage is in
  `identity-sources.spec.ts`: an authoritative field is set; a
  lower-precedence source cannot overwrite it; managers resolve; leavers go
  to LEAVE_PENDING.

---

## 2026-09-26 — IDENTITY-P0-18 (Partial): human lifecycle, joiner to leaver, with governed work

WonderID Phase 2. Lifecycle events are recorded and each opens governed
tasks. They come from identity sources (INTEGRATION-P0-09) or from a
person's transition. Following spec "Human lifecycle", nothing is granted
or revoked by itself (#15).

### Schema (migration 0084; applied live)

- **`identity_lifecycle_events`**:
  - event types: joiner, mover, leaver, rehire, conversion,
    manager_change, leaver_cancelled, disabled, terminated, archived and
    hire_cancelled;
  - from/to state, changed fields;
  - origin (source or manual), plus the source and run ids;
  - actor and note.
- **`identity_lifecycle_tasks`**:
  - task types: request_baseline_access, review_access,
    transfer_ownership, revoke_access and disable_sign_in;
  - status open, done or skipped;
  - an assignee (the person's manager for access work);
  - a resolution note, required when skipped (a check constraint), and
    completion by and at.
- Same-tenant composite FKs throughout. RLS: members read, and insert and
  update through the service. There is no delete policy: lifecycle history
  is evidence.

### Rules (`humanLifecycle.ts`, pure, 8 unit tests)

- A first manager is an assignment, not a `manager_change`. A joiner's
  manager is resolved in the run's second pass, so when a person gets
  their first manager, their open, unassigned access tasks go to that
  manager, who is then told. The E2E run found this.

- **Transitions:**
  - PRE_JOIN → ACTIVE (join) or ARCHIVED (hire cancelled);
  - ACTIVE → LEAVE_PENDING (leaver) or DISABLED;
  - LEAVE_PENDING → ACTIVE (departure cancelled) or DISABLED;
  - DISABLED → TERMINATED or ACTIVE (rehire);
  - TERMINATED → ARCHIVED or ACTIVE (rehire);
  - ARCHIVED → ACTIVE (rehire).
- **Status follows state.** LEAVE_PENDING keeps the current status:
  someone serving notice still works.
- **Detection from a sourced change:**
  - new person → joiner;
  - start date reached → joiner;
  - department, title, business unit or location → mover;
  - manager only → manager_change;
  - employment type or subtype → conversion;
  - gone → leaver;
  - back → rehire.
  - Someone who has gone does not "move".
- **Tasks:**
  - joiner → request baseline access;
  - mover or conversion → review access;
  - rehire → both;
  - leaver → transfer ownership, revoke access, and disable sign-in (only
    for people who can sign in).

### Service (`humanLifecycleService.ts`)

- **Sourced changes** are recorded by `applySourcedIdentities()` after the
  identity change itself. A recording failure is reported on the result,
  never hidden and never undoing the change.
- **Manual transitions:**
  - they need `identity.manage` and must be an allowed transition;
  - leaver, disable, terminate and cancel-hire need a reason;
  - optimistic concurrency: the change applies only if the state is still
    what it was, else 409.
- **Closing a task** needs a note to skip. "Done" on an ownership transfer
  is refused while the person still owns anything.
- **Ownership transfer** moves everything to an active person, then closes
  the task:
  - identities owned, sponsored and managed;
  - current owns/sponsors/manager_of relationships (history kept);
  - AI agents owned, through `assignOwner`/`removeOwner`, which requires a
    receiving person who can sign in. Delegated ownership is left to
    expire.
- **The manager is told** through the new `lifecycle_task` notification
  (Operations migration 0085).
- **Audit:** `identity.lifecycle_event`, `identity.lifecycle_task_closed`
  and `identity.ownership_transferred`.

### API and UI

- **API:**
  - `/api/v1/identities/:id/lifecycle` (GET history and tasks; POST
    transition);
  - `/api/v1/identities/lifecycle-tasks` (GET, open by default);
  - `/lifecycle-tasks/:id` (POST transfer, done or skipped).
- **UI:**
  - a **Lifecycle** tab on people (state, next step with a reason, open
    work with transfer/done/not-needed, history), reachable as
    `?tab=lifecycle`;
  - **Identities → Lifecycle Work**, the organization's queue;
  - the overview's "needs attention" counts open lifecycle work.

### Deliberately left out (story stays Partial)

- **No automatic birthright grants or deprovisioning.** Access packages
  are ACCESS-P0-20 and the provisioning pipeline is INTEGRATION-P0-13.
  Until then, "request baseline access" and "revoke access" are tracked
  tasks a person closes.
- **Disable sign-in** points to membership suspension (Foundation). It
  does not suspend by itself.
- Legal and retention holds: not implemented.

### Verified

- `tsc` and `eslint .` clean.
- vitest **582/582**, including `humanLifecycle.test.ts` 8/8.
- Live SQL (`tests/identity/human-lifecycle-isolation.sql`), 9/9:
  - a tenant-A member sees 0 of B's events and tasks;
  - their writes into B are denied (42501), and closing a B task affects
    0 rows;
  - cross-tenant events and tasks are 23503;
  - a skip without a note, and a close without a completion time, are
    23514.
  - Fixtures were cleaned up.
- E2E `human-lifecycle.spec.ts`, 13/13 (with setup):
  - a source joiner, with the task assigned to the manager, who was
    resolved in the same run;
  - a source mover gets an access review;
  - a source leaver gets ownership and access tasks, and no sign-in task
    for someone who cannot sign in;
  - the ownership transfer:
    - "done" is refused while the person still owns things;
    - the leaver cannot be the new owner;
    - the service account moves;
    - a second attempt is 409;
  - skipping needs a note;
  - manual transitions: an invalid step is 409, a missing reason is 400,
    and disable → rehire opens tasks;
  - a machine identity has no lifecycle;
  - the Lifecycle tab closes a task, and the queue lists it;
  - another organization gets 404 and sees nothing;
  - read-only gets 403.
- Screenshots checked (Lifecycle tab at desktop, and at 390 px dark; the
  queue). Fixes that came from them:
  - "lifecycleState" noise removed from the history;
  - an empty-ownership message;
  - the queue says when it shows only the latest 200.
- Full Playwright suite (§17.8): **229/229 passed** (12.6 min, 0084/0085
  live).

## 2026-09-26 — `getIdentityForUser` (published for ACCESS-P0-18, additive)

- `getIdentityForUser(tenantId, userId)` returns the tenant's HUMAN identity
  linked to that signed-in user, or null. It reads as the user, with the
  tenant filtered. It is exported from `modules/agent-identity/service.ts`.
- Access uses it to know who "me" is when a person requests access for
  themselves.
- No existing caller changed. Verified by `request-catalog.spec` (requests
  for yourself resolve the requester's identity).
