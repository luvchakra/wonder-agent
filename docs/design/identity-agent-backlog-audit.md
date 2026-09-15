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
