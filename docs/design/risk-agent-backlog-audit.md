# Risk Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — RISK-P0-01 through P0-03 (full P0 backlog in one pass)

**Agent:** Risk Agent · **Branch:** `claude/wonderagent-setup-lasmly` (same
environment-pinned-branch deviation every prior module recorded).

**Built:**

- **RISK-P0-01.1** — `risk_findings`/`risk_evidence` (migration `0034`,
  `risk.read`/`risk.manage` permission-catalog rows), plus follow-up
  FK-index hardening (migration `0035`, same pattern as Access/Runtime's
  `0031`/`0033`). Same evidentiary lockdown as every other findings-style
  table in this build: client SELECT only, no client INSERT/UPDATE at all —
  verified live (below). `risk_evidence` has no `tenant_id` of its own (per
  the backlog's own schema sketch); isolation is enforced via a join to
  `risk_findings.tenant_id`, the same pattern Access Agent used for
  `policy_rules`/`policy_exceptions`. Two columns were added beyond the
  backlog's literal DDL sketch — `risk_score integer` and
  `reasons jsonb` — since RISK-P0-02.1 explicitly requires storing "the
  score and the specific contributing factors on the finding" and the
  sketch had no column for either; flagged here rather than silently
  assumed, since it's an additive, backward-compatible schema decision
  completing what the story itself asks for.
- **RISK-P0-01.2** — `evaluateAgentRisk()` (`modules/risk/rules.ts`): all
  eight detection categories from the backlog's table, each a pure
  deterministic function over Identity/Access/Runtime's published
  contracts (`getAgentContract`, `getOwnershipIssues`, `listAgentIdentities`,
  `listLifecycleEvents` from Identity; `listPolicyEvaluations` from Access;
  `compareShouldCanDid`, `getDid`, `listRuntimeEvents` from Runtime) — no
  copy of ownership checks, policy evaluation, or SHOULD/CAN/DID logic was
  reimplemented, per the backlog's explicit instruction. Dedup logic
  (`modules/risk/findings.ts`'s `createOrUpdateFinding`) checks for an
  existing `open`/`assigned`/`remediation_in_progress` finding of the same
  agent+category before creating a new one, appending only genuinely new
  evidence rows (by `reference_id`) to the existing finding instead.
- **RISK-P0-01.3** — Explanations/recommendations/titles are built from
  plain deterministic template strings interpolating the actual evidence
  (agent name, applications, entitlements, classifications, timestamps) —
  no LLM call anywhere in this module, per non-negotiable #9.
- **RISK-P0-02.1** — `computeSeverity()`/`applyProhibitedDataOverride()`
  (`modules/risk/scoring.ts`): the exact weighted factor table and bands
  from the backlog, plus the explicit override the backlog itself asks for
  ("any `sensitive_data_violation` finding where the data classification is
  explicitly `prohibited_data` on the contract is always at least
  critical"), implemented as a separate, auditable function rather than
  tuned weights. **Flagged, not silently assumed**: two factors have no
  real source yet and always contribute 0 — "external communication
  capability" (no module models this concept anywhere in the codebase) and
  "certification overdue" (Compliance Agent, the source of certification
  decisions, doesn't exist in the run order yet) — exactly the situation
  the backlog's own factor table anticipates ("if not modeled yet, treat as
  0 and note the gap"). Factors are computed once per `evaluateAgentRisk()`
  call from that pass's full evidence and applied to every finding created/
  updated in the pass (a design decision, not stated explicitly either way
  in the backlog, since the factor table is agent-level context rather than
  naturally per-category) — documented in `scoring.ts`/`rules.ts` rather
  than left implicit.
  **Not persisted**: `agents.risk_score` — the backlog says "Persist via
  Identity's published update path... if Identity hasn't published a
  `updateAgentRiskScore()` function yet, record this dependency and stop
  rather than writing to Identity's table directly." Identity's
  `modules/agent-identity/service.ts` publishes no such function as of this
  session (checked). Per non-negotiable #14/#18, this module does not write
  to `agents` directly and does not add the function to Identity's module
  itself (that would be modifying another module's implementation to make
  this module's story pass, which #18 explicitly forbids). The score is
  still fully computed and returned on every `risk_findings` row
  (`risk_score` column) — only the denormalized copy on `agents` is
  deferred, pending Identity publishing that function.
- **RISK-P0-03.1** — `assignFinding()`.
- **RISK-P0-03.2** — `POST /api/v1/findings/:id/remediate`
  (`remediateFinding()`). **Flagged, not silently assumed**: Access
  Agent's published contract (`modules/access-governance/service.ts`,
  checked this session) exports no remediation-initiation function. Per
  the backlog's own explicit instruction for this exact situation, this
  endpoint records the request via `writeAudit` (outcome: `failure`,
  reason noted) and returns `wired: false` rather than flipping the
  finding to `remediation_in_progress` on a fabricated hand-off. The UI
  (bare page) still exposes the "Request remediation" action so the button
  exists end-to-end; it accurately reports there is no automated hand-off
  yet.
- **RISK-P0-03.3** — `resolveFinding()` plus
  `POST /api/v1/findings/:id/resolve`: `verified_fixed` re-runs the full
  detection engine (`evaluateAgentRisk`, itself idempotent/dedup-safe) and
  checks whether the finding's category is still among the freshly
  produced results — only if it is not does the finding move to
  `resolved`. `accepted_risk` requires a non-empty `reason` and skips the
  re-check by design, per the backlog.
- **Auto-restriction, flagged as a reasoned decision rather than an
  implicit side effect**: the backlog's own Dependencies section states
  Risk Agent calls `transitionAgentLifecycle` "to move an agent to
  RESTRICTED on a CRITICAL finding, per Identity's transition table" — read
  as an intended behavior, not merely an available API. `evaluateAgentRisk`
  calls it (actor `{actorType: 'system'}`) whenever any finding from that
  pass is `critical` and the agent is currently `ACTIVE` (the only
  structurally allowed source state for `RESTRICTED`, per Identity's own
  `NORMAL_TRANSITIONS` table); failures (already restricted, precondition
  not met) are caught and audited rather than allowed to fail the whole
  evaluation — this is a best-effort protective action, not the primary
  deliverable of the evaluation call.

**Verification run:**
- `npm run lint`, `npm run typecheck`, `npm run build` — all clean.
- `npm run test` — 47/47 passing across 11 files (new: `scoring.test.ts`
  for the severity bands and the prohibited-data override in isolation;
  `rules.test.ts` for the full central FinanceBot/CustomerDB scenario with
  every dependency mocked — asserting the exact set of categories that
  fire, the computed severity/score/reasons, and the auto-restriction
  call — plus a fully-healthy case proving no restriction occurs absent a
  critical finding).
- Live smoke test against a locally started production server:
  unauthenticated hits to `/risk/agents/:id`, `GET /api/v1/findings`, and
  `POST /api/v1/risk/agents/:id/evaluate` all correctly return a
  307-to-`/sign-in` or 401 (checked proactively, consistent with every
  module since Integration Agent's bug).
- **The module's critical acceptance test, executed live against the dev
  Supabase project** (Supabase MCP `execute_sql`): reused the exact
  FinanceBot fixture Runtime Agent's own test already established (same
  dev project, Tenant A5, `facebeef-5000-...`, the CustomerDB
  `access_grants` and `runtime_events` rows) rather than re-creating it,
  and inserted a `risk_findings`/`risk_evidence` row shaped exactly as
  `createOrUpdateFinding()` would produce for that data (category
  `sensitive_data_violation`, severity `critical`, score 80, evidence
  referencing the real grant and event row ids) — proving the schema/RLS
  layer a unit test cannot reach, since `evaluateAgentRisk`'s own
  deterministic logic is already exhaustively covered by `rules.test.ts`
  against the same scenario. Proved: the finding and its two evidence rows
  are readable to Tenant A5's user; Tenant B5's user sees zero findings and
  zero evidence rows (tenant isolation, both directions); a same-tenant
  client `INSERT` into `risk_findings` and into `risk_evidence` were both
  rejected by RLS (no client write policy on either table). Fixture data
  intentionally left in place (same convention as every prior module's
  script); script committed at
  `tests/risk/central-scenario-and-tenant-isolation.sql`. `get_advisors`
  (security and performance) clean beyond the same previously-reviewed
  exceptions every prior module already accepted.

**Not started this session / open items:**
- `agents.risk_score` denormalized persistence — blocked on Identity
  publishing `updateAgentRiskScore()` (see RISK-P0-02.1 above). Not a
  blocker for anything downstream: every finding already carries its own
  `risk_score`/`severity`/`reasons`.
- RISK-P0-03.2's remediation hand-off is not wired end-to-end — blocked on
  Access Agent publishing a remediation-initiation contract. The endpoint
  and UI action exist and behave honestly (`wired: false`) rather than
  faking success.
- Both gaps are pre-existing dependency gaps in modules that have already
  shipped, not omissions within this module's own scope — recording them
  here rather than silently reaching into Identity's or Access's files to
  "fix" it myself, per non-negotiable #18.

**Dependencies consumed:** Foundation's `requirePermission()`,
`writeAudit()`, `supabaseServer()`/`supabaseServiceRole()`; Identity's
`getAgent()`, `getAgentContract()`, `getOwnershipIssues()`,
`listAgentIdentities()`, `listLifecycleEvents()`, `transitionAgentLifecycle()`;
Access's `listPolicyEvaluations()`; Runtime's `compareShouldCanDid()`,
`getDid()`, `listRuntimeEvents()` — all used exactly as published, no
modification to any Foundation, Identity, Access, or Runtime file.

**Published this session, for Compliance/Experience/Operations to consume
once dispatched:** `modules/risk/service.ts` (barrel) and
`lib/shared/types/risk.ts`. Most relevant to Compliance Agent (next in run
order per Wave 4): `getFindings()`/`getFinding()` are the evidence
certification review surfaces read; `resolveFinding()`'s re-evaluation
pattern is the "close the loop" mechanic the PRD's central scenario
describes.

---

## 2026-09-14 — RISK-P0-01.4, RISK-P0-02.2, RISK-P0-03.4, RISK-P0-03.5 (2026-09-14 requirements refresh)

**Agent:** Risk Agent · **Branch:** `claude/wonderagent-setup-lasmly`. Per
the user's explicit "continue automatically" instruction, picked up the
four Not Started rows the requirements-refresh pass added to this
backlog's Progress Tracker.

**Built:**

- **RISK-P0-01.4** — `evaluator_version` column on `risk_findings`
  (migration `0044`, `not null default 1` so existing rows backfill to the
  documented baseline without a data migration). `modules/risk/rules.ts`
  now exports `EVALUATOR_VERSION = 1` and passes it through to both the
  create and update paths of `createOrUpdateFinding()`
  (`modules/risk/findings.ts`) — a re-triggered finding's `evaluator_version`
  is refreshed to whatever version produced the latest evidence, not frozen
  at first-creation.
- **RISK-P0-02.2** — `info` added as a severity tier below `low`
  (`RiskSeverity`, `computeSeverity()`'s bands: `<10` info, `10-24` low,
  `25-49` medium, `50-74` high, `75+` critical — additive to the existing
  check constraint, migration `0044`). The per-factor weight table moved
  out of `scoring.ts`'s literals into `DEFAULT_SEVERITY_WEIGHTS` (still the
  product-wide default) plus a new `risk_severity_weights` table
  (tenant_id, factor_name, weight, updated_by/at — evidentiary-config RLS:
  client SELECT + INSERT/UPDATE, same division of labor as Access Agent's
  `policies`/`policy_versions` — RLS enforces tenant isolation only,
  `requirePermission('risk.manage')` enforces the admin-only authorization
  at the app layer). `modules/risk/config.ts`'s `getSeverityWeights()`
  merges a tenant's override rows onto the defaults;
  `resolveWeight(factorName, overrides)` (`scoring.ts`) is what
  `rules.ts`'s factor-building now calls instead of inlining a literal
  weight. `setSeverityWeight()` writes an audited
  `risk.severity_weight_changed` event on every change. Never delegated to
  an LLM, per non-negotiable #9 — a weight change is a deterministic,
  audited, admin-gated config write.
- **RISK-P0-03.4** — `FindingStatus` extended with `acknowledged`,
  `investigating`, `mitigated`, `exception` (additive check constraint,
  migration `0044`); `remediation_in_progress` kept its existing column
  value unchanged (it already maps onto the new doc's
  `REMEDIATION_PENDING` in meaning — not renamed, avoiding an unnecessary
  breaking change to an already-`Done` contract, per the story's own
  instruction). New `transitionFindingStatus()`
  (`modules/risk/findings.ts`) moves a finding into one of those four
  states, writes an audited `risk.finding_status_changed` event
  (`fromStatus`/`toStatus` in metadata), and explicitly refuses to move a
  finding already in a terminal disposition (`resolved`/`false_positive`)
  — reopening a false positive is `createOrUpdateFinding()`'s job via its
  expiry check, not this generic transition. Exposed via
  `POST /api/v1/findings/:id/status` and the bare page's new "Update
  status" form.
- **RISK-P0-03.5** — `resolveFinding()` gained a `false_positive`
  resolution `type`: requires a non-empty `reason` (same check already
  applied to `accepted_risk`), accepts an optional `expiresAt` (validated
  as a real future timestamp, stored on the new `false_positive_expires_at`
  column), and sets `status = 'false_positive'` rather than `'resolved'` so
  the two dispositions stay distinguishable. `risk_evidence` rows are never
  touched by this path — `resolveFinding()` only ever updates the
  `risk_findings` row itself, so original evidence is preserved exactly as
  the story requires. Reopening reuses the RISK-P0-03.3 re-evaluation
  machinery rather than a second scheduler this codebase has no job-runner
  for: `createOrUpdateFinding()`'s existing-finding lookup now also matches
  a `false_positive` finding whose `false_positive_expires_at` has passed,
  and when it does, the next detection pass that re-triggers that
  category clears the disposition back to `open` and writes an audited
  `risk.finding_reopened_after_false_positive_expiry` event. A
  `false_positive` with no expiry (or a still-future one) is never
  reopened automatically — confirmed by live SQL below, not just inferred
  from reading the query.
- Migration `0045` — a follow-up caught by live verification, not by
  reading the code: `risk_findings_resolution_type_check` (defined
  alongside `resolution_type` back in the original RISK-P0-03.3 migration,
  before this session) only allowed `verified_fixed`/`accepted_risk` and
  rejected the new `false_positive` value migration `0044` didn't touch.
  Additive fix, applied immediately after being caught, per CLAUDE.md §13.
- **Cross-module mechanical fix, not scope creep**: `RiskSeverity` gaining
  `info` broke `modules/certification-compliance/campaigns.ts`'s
  `SEVERITY_RANK: Record<RiskSeverity, number>` (a `tsc` compile error, not
  a design choice) — added `info: -1`, ranked below `low`, so every
  already-`Done` `computeRecommendation()` outcome for
  low/medium/high/critical is provably unchanged (backward compatibility
  requirement, non-negotiable #13); no other line in that file was
  touched, per non-negotiable #18.

**Verification run:**
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean (the
  `campaigns.ts` fix above was required to get a clean typecheck and is
  the only other module's file touched this story).
- `npx vitest run` — 119/119 passing across 19 files. New:
  `scoring.test.ts` gained an `info`-tier boundary case and three
  `resolveWeight()` cases (default fallback, tenant override precedence,
  unknown-factor-resolves-to-0). `rules.test.ts` needed a new
  `vi.mock("./config", ...)` (returning `{}`, i.e. "no overrides" — so its
  existing assertions about specific scores stay valid) since
  `evaluateAgentRisk` now calls `getSeverityWeights()`, which itself calls
  `supabaseServer()` and fails outside a request scope when unmocked — a
  real fixture gap the new config call exposed, not a regression.
- Live-verified against the dev Supabase project (Supabase MCP,
  project `ekgyjwoenteadaaqakmd`), after applying migrations `0044` and
  `0045`: `risk_severity_weights` tenant isolation both directions
  (Tenant A5 reads its own override; Tenant B5's authenticated session
  sees 0 rows for A5's tenant; a same-tenant-mismatched client `UPDATE`
  affects 0 rows; a forged client `INSERT` into A5's tenant is rejected)
  against the FinanceBot fixture tenants (A5
  `aaaaaaaa-5000-0000-0000-000000000001` /
  B5 `bbbbbbbb-5000-0000-0000-000000000002`). Separately inserted and
  cleaned up throwaway `risk_findings` rows to prove: every new check
  constraint value (`info` severity; `acknowledged`/`investigating`/
  `mitigated`/`exception`/`false_positive` status; `false_positive`
  resolution_type) is accepted by the schema; the exact `.or(...)`
  reopen-eligibility filter `createOrUpdateFinding()` uses matches a
  `false_positive` row whose `false_positive_expires_at` is in the past
  (1 row) and does not match one whose expiry is still in the future or
  null (0 rows in both cases); a `risk_evidence` row attached to a finding
  survives a `false_positive` disposition update untouched. `get_advisors`
  (security) re-checked after both migrations — no new findings beyond the
  same pre-existing accepted set every prior module already reviewed.

**Not started this session / still open (unchanged from the prior entry):**
- `agents.risk_score` denormalized persistence — still blocked on Identity
  publishing `updateAgentRiskScore()`.
- RISK-P0-03.2's remediation hand-off — still blocked on Access Agent
  publishing a remediation-initiation contract.
- The "external communication capability" and "certification overdue"
  severity factors still always contribute 0 (no module models the former;
  Compliance Agent, source of the latter, is chained next but hadn't run
  yet when this story was built) — now configurable in weight via
  `risk_severity_weights` like every other factor, but still structurally
  unable to ever trigger until those sources exist. Not a new gap, just
  now visible in the weights table rather than only in `scoring.ts`.

**Dependencies consumed:** unchanged from the prior entry, plus
`modules/certification-compliance/campaigns.ts`'s `RiskSeverity` usage
(read-only type reference, fixed for compile-compatibility as described
above — Risk Agent does not own or otherwise modify Compliance's module).

**Published this session:** `transitionFindingStatus()` and the
`false_positive`/`expiresAt` extension to `resolveFinding()`
(`modules/risk/service.ts`); `RiskFinding.evaluatorVersion` and
`.falsePositiveExpiresAt`; `risk_severity_weights` (not yet exposed as a
published read/write contract beyond `modules/risk/config.ts` itself — no
other module needs tenant severity-weight overrides today).

---

## 2026-09-14 — Requirements re-check, round 2 (re-uploaded expanded doc), documentation-only

**Agent:** Risk Agent. Documentation-only pass, per the user's explicit
request: no application code, migrations, or tests touched. Re-checked
the module against a re-uploaded copy of the requirements doc
(`06_RISK_ROGUE_DETECTION.md`), described as a newer/expanded version of
the doc already reconciled in the `2026-09-14 requirements refresh` entry
above.

**Method:** read the full re-uploaded doc end to end; read the full
current `docs/plan/06-RISK-AGENT-BACKLOG.md` (Progress Tracker, all
Epics, the existing round-1 Requirements Refresh section, `## P1`/`## P2`
lists); skimmed this audit log's prior entries; and — before treating
anything as missing — checked it against the actual implementation
(`modules/risk/scoring.ts`, `modules/risk/rules.ts`,
`modules/risk/findings.ts`, `lib/shared/types/risk.ts`, and migrations
`0034`/`0044`/`0045`) rather than trusting the backlog's prose alone.
Confirmed, for example, that migration `0044`'s `risk_findings` status
check constraint genuinely carries the expanded lifecycle states
(`acknowledged`/`investigating`/`mitigated`/`exception`/`false_positive`)
the round-1 refresh claims as `Done` — the prior pass's "Done" markings
hold up.

**Finding: the re-uploaded doc is, story-ID-for-story-ID, the same
document already reconciled in round 1** — its "Expanded Requirements —
Risk & Rogue Detection P0/P1/P2" section lists exactly
`RISK-P0-01`..`RISK-P0-10`, `RISK-P1-01`..`RISK-P1-04`,
`RISK-P2-01`..`RISK-P2-03`, with no new or renumbered items and no
different wording under any of those headings versus what round 1 already
worked through line by line (its "Already covered" list, plus the four
stories it added: `RISK-P0-01.4`, `RISK-P0-02.2`, `RISK-P0-03.4`,
`RISK-P0-03.5`). None of that is reopened, downgraded, or re-added here —
per the task's constraint, and because doing so would misrepresent
already-verified `Done` work.

**One genuine gap did survive round 1**, not because the doc changed but
because round 1's reconciliation matched `RISK-P0-01` to `RISK-P0-02.1`
at the story-ID level without diffing the doc's separate, more detailed
"# 15. Risk Engine" narrative section (part of the doc's raw PRD quote,
not the numbered `RISK-P0-XX` list) against the actual factor table in
`scoring.ts`. That narrative section names 13 risk-score factors;
`DEFAULT_SEVERITY_WEIGHTS` in `modules/risk/scoring.ts` implements 8.
Confirmed via `grep` across `modules/risk/` and
`lib/shared/types/risk.ts` that **privilege level, destructive
capability, credential status, and attack path** never appear anywhere in
the implementation, in the backlog's own factor table, or in any prior
audit entry (including the "still open" list of known factor gaps in the
entry directly above, which only calls out `external communication
capability` and `certification overdue` as always-zero — not these four,
which are entirely absent from the model rather than present-but-zeroed).

**Added:** `RISK-P1-05 — Additional Deterministic Risk Factors` to the
Progress Tracker (`Not Started`) and to the backlog's `## P1` list, plus a
new `## Requirements Refresh — 2026-09-14 (round 2, expanded doc)` section
in `docs/plan/06-RISK-AGENT-BACKLOG.md` explaining the gap, listing the
four missing factors with their distinctions from existing categories
(e.g. credential status vs. `identity_anomaly`; attack path vs.
`RISK-P2-02` graph propagation), and giving its acceptance criteria.
Classified **P1**, not P0: the central FinanceBot acceptance scenario
already reaches `critical` on the existing 8 factors plus the explicit
prohibited-data override without any of the four, so per CLAUDE.md §3
("when genuinely unsure, prefer P1/P2 over P0") this is enterprise-
readiness factor coverage, not an MVP release blocker. Not flagged as
ML/LLM-based per non-negotiable #9 — all four are deterministic,
rule-evaluable facts (entitlement metadata, credential record state,
graph position), not statistical/ML predictions; nothing else in the
re-uploaded doc resembles ML/LLM-based anomaly detection either (its
"LLMs may explain findings but MUST NOT be the sole authority" line
matches the backlog's existing AI usage boundary verbatim).

**Everything else in the re-uploaded doc was already reflected** in the
current backlog at matching or finer granularity — rogue categories,
evidence-pack shape (including evaluator version), explainability,
deduplication, false-positive handling with reason/expiry, the expanded
finding-lifecycle states, the recommendation engine, re-evaluation, and
the `RISK-P1-01`..`RISK-P2-03` list (including the still-open
`RISK-P1-03` ownership-map flag and the still-open process-model note
from round 1, neither of which changed in this pass). No other rows were
added, no existing row's status was changed, and no other module's
backlog or the ownership map was touched.

**Not started / open questions:** none newly introduced this pass beyond
`RISK-P1-05` itself, which is `Not Started` and — per its own acceptance
notes — depends on Access Agent eventually exposing entitlement-level
destructive-verb and graph-position data before two of its four factors
can trigger on anything other than 0; that dependency should be recorded
at pickup time rather than assumed now.

## 2026-09-16 — RISK-P0-04: Governance Drift detection, implemented

**Agent:** Risk Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Second item in the P0-ordered sweep the user authorized ("pick up P0
items in order, no need to ask before picking the next story"), following
the 2026-09-15 governance reconciliation's resolved decision
("Governance Drift → Risk Agent").

**Design:** a new deterministic `governance_drift` finding category,
built the same way every other category in this module already is —
diff current state against a reference point already tracked by another
module, no new snapshot mechanism. The reference point chosen is the
agent's most recent `APPROVED` lifecycle transition (via Identity's
already-published `listLifecycleEvents()`) — the last point governance
affirmed a baseline, matching the doc's own "material *post-approval*
changes" framing exactly. An agent never approved has no reference point
and is correctly skipped (returns `null`, no finding), not defaulted to
some fabricated baseline.

**Sub-signals covered**, all derived from already-published contracts,
no new table:
- Purpose changed, autonomy level increased (never decreased — a lowered
  autonomy level is a tightening, not drift), new `allowedTools` entry,
  new `approvedActions` entry — all via a single mechanism: diffing the
  contract version active at-or-before the approval timestamp
  (`listContractVersions()`) against the current active contract.
- Owner added since approval (`listOwners()`, `assignedAt >`
  referenceTime) — owners assigned before approval correctly excluded.
- New IAM identity linked since approval (`listAgentIdentities()`,
  already fetched by the caller, `createdAt >` referenceTime).
- Access expanded since approval — `getEffectiveAccessAsOf(tenantId,
  agentId, referenceTime)` (Access Agent's point-in-time contract, built
  this same session for `RUNTIME-P0-13`) vs. current `getEffectiveAccess()`;
  new grant IDs present now that weren't present as-of approval.

**Deliberately not covered, documented not silently skipped:**
- "New tool/data source" beyond what's captured by `allowedTools` — no
  other module publishes a "first seen since timestamp" contract for
  tools/resources (`runtime_tools`/`runtime_resources` are Runtime
  Agent's own tables; querying them directly here would violate
  non-negotiable #6, and Runtime Agent hasn't published a suitable
  query — not something Risk Agent should invent unilaterally per
  non-negotiable #18).
- "Runtime behavior changed" as its own drift sub-signal — would
  duplicate the already-existing `behavioral_deviation` category rather
  than add new detection value; no module may invent a second concept
  for the same thing.

**Schema:** migration `0054_risk_governance_drift.sql` — additive-only,
widens `risk_findings.category`'s check constraint (`governance_drift`)
and `risk_evidence.evidence_type`'s (`governance_baseline`, a new generic
evidence type covering contract-baseline-diff facts — purpose/autonomy/
tools/actions/owner/identity changes — since none of the five existing
evidence types fit; access-expansion evidence reuses the existing
`access_grant` type, no new type needed there). Applied live via the
Supabase MCP `apply_migration` tool against project `ekgyjwoenteadaaqakmd`;
`get_advisors(security)` re-run clean afterward, same three
already-accepted exceptions as every prior pass.

**Deliberately excluded from the "rogue agent" partition:** `ROGUE_AGENT_
CATEGORIES`/`ROGUE_CATEGORIES` (`modules/operations/reports.ts`,
`app/(customer)/risk/rogue/*.tsx`) were NOT updated to include
`governance_drift` — those are Operations'/Experience's own files
(non-negotiable #18), and more fundamentally, a drifted-but-approved
change is a different concept from rogue/anomalous behavior; the
requirements doc itself frames Governance Drift as distinct from rogue
detection, not a ninth rogue category.

**Verified:** 7 new unit tests (`modules/risk/governanceDrift.test.ts`) —
no-approval-event returns null without calling any dependency; no-change
returns null; purpose-change detected; autonomy-increase detected,
autonomy-decrease correctly NOT flagged; new-owner-since-approval
detected, pre-approval owner correctly excluded; access-expansion
detected via the exact point-in-time call; reference-version selection
picks the most recent version at-or-before approval time, not the
oldest. Existing `modules/risk/rules.test.ts` (2 tests, FinanceBot
scenario) re-run and still passing unmodified — its fixture's
`listLifecycleEvents` mock returns `[]`, so the new code path correctly
short-circuits to `null` without needing new mocks. Full pipeline: `npm
run typecheck`, `npm run lint`, `npx vitest run` (165/165, up from 158),
`npm run build` with `.next` deleted first, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` (no match) — all green.

RISK-P0-04 moves from `Not Started` to `Done`.

---

## 2026-09-16 — Unblock check: RISK-P0-02.1 and RISK-P0-03.2

**Agent:** Risk Agent. Picked up per the user's standing authorization to
continue working the pending backlog in order; this was originally queued
as "check Risk unblocks" after several other modules published new
contracts this session (Identity's `IDENTITY-P0-07` autonomy fields,
Access's broadened `policy_exceptions`, etc.).

**RISK-P0-02.1 (agent risk-score persistence) — still blocked, re-verified
not silently done.** Checked `modules/agent-identity/service.ts`'s exports
again: still only `createAgent, getAgent, listAgents` plus the
contract/lifecycle/owner/identity functions — no `updateAgentRiskScore()`
or any other generic agent-mutation function that could carry a risk score
onto `agents.risk_score`. This remains exactly the dependency the backlog
itself names, and per non-negotiable #14, Risk Agent does not write to
`agents` directly. No change made; row stays `Partial` with its existing,
still-accurate note.

**RISK-P0-03.2 (human-initiated remediation) — unblocked, now `Done`.**
Re-read the story's own wording: it names Access Agent publishing "a
remediation-initiation contract (once published — e.g.
`requestRemediation(findingId, recommendedAction)`)" as the blocker, giving
that function name only as an *example*, not a required exact signature.
Checked what Access Agent has actually published since this dependency was
first recorded: `revokeAccessGrant(tenantId, actorId, grantId)` — already
existed even before this session, just never previously connected to this
endpoint. This is a better fit than the example name suggests:
`createAccessRequest()` (Access's other candidate) models *requesting new
access*, the wrong direction for remediating excessive/unauthorized access;
`revokeAccessGrant()` is exactly "the corrective action" a rogue-access
finding calls for.

**Design.** `remediateFinding()` (`modules/risk/findings.ts`) now:
1. Loads the finding's own `risk_evidence` rows.
2. Collects every distinct `reference_id` where `evidence_type =
   'access_grant'` — the exact evidence shape the detection rules in
   `rules.ts` already attach for `excessive_access`/`unauthorized_resource`/
   `sensitive_data_violation`/etc. (no schema change needed; this evidence
   already existed, just wasn't being read back for remediation).
3. Calls `revokeAccessGrant(tenantId, actorId, grantId)` for each — a
   *synchronous* hand-off, not merely creating a pending `access_requests`
   row, because the human who clicked "Request remediation" already gave
   the explicit approval non-negotiable #15 requires; revoking is itself
   the corrective action, not a request that still needs a second
   approval step.
4. A grant that fails to revoke (e.g. already removed) doesn't fail the
   whole call — it's skipped, logged, and simply doesn't count toward
   `revokedGrantIds`.
5. `wired` is `true` only if at least one grant was actually revoked.
   Finding categories with no `access_grant` evidence at all (ownership_
   violation, lifecycle_violation, governance_drift, identity_anomaly)
   correctly report `wired: false` with an honest reason in the audit
   event — this function still never fabricates a remediation action for
   a category that has none.
6. On a wired outcome, the finding's `status` is set to
   `remediation_in_progress` — the status transition the story's own spec
   always called for but the old blocked implementation never actually
   performed (it wrote the audit event but left `status` untouched even
   in its own code, regardless of the `wired` value — a small pre-existing
   gap between the docstring and the code, closed here).

**Not changed:** the API route's permission gate (`risk.manage`,
unchanged), `resolveFinding()`'s separate re-evaluation requirement
(`RISK-P0-03.3`, untouched), and Access Agent's own file
(`modules/access-governance/grants.ts`) — `revokeAccessGrant()` is
consumed exactly as already published, no modification to it or any other
Access Agent file (non-negotiable #18).

**Verification:**
- `modules/risk/findings.test.ts` (new) — 5 tests: 404 on a missing
  finding; honestly `wired: false` with no `access_grant` evidence; every
  named grant revoked + status transitioned + audit success; still
  `wired: true` when one of two grants fails (already removed) but the
  other succeeds; `wired: false` with an audit failure reason when every
  named grant fails.
- `npm run typecheck` / `npm run lint` — clean.
- `npx vitest run` — 202/202 passing (up from 197).
- `npm run build` (with `.next` deleted first) — clean.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:** no new exports — `remediateFinding()`'s return
shape gained one additive field (`revokedGrantIds: string[]`), and
`POST /api/v1/findings/:id/remediate`'s response now also includes it.
Existing callers (`app/actions/risk.ts`'s `remediateFindingAction`, which
doesn't destructure the return value) are unaffected.

---

## 2026-09-16 — notify() wiring (OPERATIONS-P0-02.2, from Operations Agent's pass)

**Agent:** Operations Agent (recorded here too since the actual code
change lives in this module's own file — `modules/risk/findings.ts`; full
rationale in Operations' own audit log entry of the same date).

`createOrUpdateFinding()` now calls a new, exported `notifyForFinding()`
helper on both its create and reopen-from-false-positive paths:
`notify({type: 'critical_finding', ...})` when severity is `critical`,
`notify({type: 'rogue_agent', ...})` when the category is one of
`behavioral_deviation`/`identity_anomaly`/`ownership_violation`/
`lifecycle_violation`. Not fired on a routine re-evaluation refresh of an
already-open finding. `modules/risk/findings.test.ts` gained 4 tests for
`notifyForFinding()`'s own decision logic. No Progress Tracker row change
— this doesn't correspond to a new Risk Agent story, it's Risk's own file
being the implementation site for `OPERATIONS-P0-02.2`.

---

## 2026-09-16 — RISK-P0-02.1 unblocked: agents.risk_score now persisted

Previously flagged `Partial`: the score was fully computed and stored on
every `risk_findings` row but never rolled up onto `agents.risk_score`,
since that column belongs to Identity's `agents` table and Risk had no
published write path onto it. Identity published
`updateAgentRiskScore(tenantId, agentId, riskScore)` today (see Identity's
own audit log entry of the same date for the implementation detail).
`evaluateAgentRisk()` (`modules/risk/rules.ts`) now calls it once per
evaluation run, right after computing `base` (the deterministic agent-level
score every trigger in that run shares) — including when zero categories
trigger, so a clean agent's real score (e.g. `0`) is recorded rather than
left stale/null.

**Verification:** `modules/risk/rules.test.ts` updated — both existing
scenarios now assert the exact call: `("tenant-a", "financebot", 80)` for
the FinanceBot CRITICAL scenario (Production 20 + sensitive-data 25 +
policy-violation 15 + anomaly 10 + criticality-high 10 = 80), and
`("tenant-a", "a2", 0)` for the clean-agent scenario. Full pipeline:
`npm run typecheck` clean, `npm run lint` clean, `npx vitest run` 217/217
(unchanged count — existing tests extended, no new test files), `npm run
build` (with `.next` deleted first) clean, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` no match. No migration needed —
`agents.risk_score` already existed (migration `0012`), this was purely a
missing write path.

Progress Tracker: RISK-P0-02.1 moves from `Partial` to `Done`.

---

## 2026-09-16 — pagination pass (QA-P0-04.3 follow-up): getFindings() flagged, deliberately left uncapped

QA's original `list*()`-only grep missed `findings.ts`'s `getFindings()`
(a real, unbounded `risk_findings` scan named `get`, not `list`). Found it
during the cross-module pagination pass and evaluated it the same way as
Compliance's `listCampaignItems()`/`listControlMappings()`: it feeds
`certification-compliance/evidencePack.ts`, `campaigns.ts` (campaign
population), and `snapshot.ts`, plus `operations/reports.ts` — all
compliance-evidence contexts where a silent truncation would be a
correctness/compliance-integrity bug, not just a performance one.
Deliberately left uncapped with an inline comment rather than applying the
new shared `DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`) blindly. The
unfiltered case is real risk exposure worth tracking — flagged for a
follow-up with real keyset pagination scoped to the Risk index *page's*
own table (a separate concern from this function's aggregate-computation
callers), not a flat cap.

No Progress Tracker row change — this doesn't correspond to a new Risk
Agent story, it's a finding recorded against the same file RISK-P0-02.1's
2026-09-16 entry already touched.

---

## 2026-09-16 — RUNTIME-P0-13 unblocked: getFindingAsOfDetection()

Previously flagged in Runtime's own row: `compareShouldCanDid(tenantId,
agentId, asOf?)` could resolve CAN as of a point in time (built and
unit-tested 2026-09-14 once Access published `getEffectiveAccessAsOf()`),
but nothing called it with a real timestamp — explicitly left as "Risk
Agent's own judgment call to adopt." Picked up as part of the user's "any
P0 item open to work?" pass.

**Design decision (Risk's own scope, not asked of the user — a
non-speculative, directly-grounded choice):** rather than changing
`evaluateAgentRisk()`'s own detection-loop semantics (which correctly
scores *current* state for ongoing monitoring — changing that would be
a much larger, riskier behavior change), added a separate, read-only
investigation function: `getFindingAsOfDetection(tenantId, findingId)`
(`modules/risk/findings.ts`). Uses the finding's own `created_at` as the
`asOf` timestamp — it's set once on insert and never touched by
`createOrUpdateFinding()`'s update branch, so it's a stable "when was
this first detected" anchor, directly satisfying the story's acceptance
criteria wording: reconstructing what CAN looked like when a finding was
raised, so a genuine historical `excessive_access` finding's evidence
stays explicable even after the entitlement has since been revoked
(re-evaluating against *today's* CAN would otherwise make it look
unjustified — the exact distortion risk the story named).

**Built:**
- `getFindingAsOfDetection()`, exported via `modules/risk/service.ts`.
- `GET /api/v1/findings/[id]/historical-context` — read-only, gated by
  `risk.read` (same permission as the finding itself).
- A small addition to Experience's `FindingEvidenceDrawer.tsx`: a
  collapsed-by-default "Show access as of detection time" panel (fetched
  on demand, not on every drawer open, to avoid an extra request per
  finding view) — see Experience's own audit log for that half.

**Verification:** new `modules/risk/getFindingAsOfDetection.test.ts` (2
tests: returns `null` for a missing/foreign-tenant finding without calling
`compareShouldCanDid` at all; resolves CAN using the finding's exact
`created_at`, not "now"). Full pipeline: `npm run typecheck` clean, `npm
run lint` clean (caught and fixed a real `react-hooks/set-state-in-effect`
issue in the first drawer implementation — replaced a reset-effect with a
`forFindingId` guard matching the existing `showDetail` pattern), `npx
vitest run` 236/236 (up from 234), `npm run build` clean, no
service-role-key leakage.

## 2026-09-19 — RISK-P1-05: additional deterministic risk factors

Picked up as the next tracked story after Risk's full P0 backlog was
already `Done` (CLAUDE.md §3 — building P1 scope now is not "ahead of"
this module's own P0 work, since none remains).

**Built** the four factors the master requirements doc's "# 15. Risk
Engine" section names beyond the existing eight (RISK-P0-02.1/02.2):
Privilege level, Destructive capability, Credential status, Attack path.
Each gets its own named weight in `DEFAULT_SEVERITY_WEIGHTS`
(`modules/risk/scoring.ts`) — no new config mechanism, reusing
`RISK-P0-02.2`'s existing tenant-override machinery
(`risk_severity_weights`) exactly as the story's acceptance criterion
requires.

**Only one of the four has a real, already-published data source right
now: Privilege level.** `getEffectiveAccess()` — already one of this
module's own declared dependencies — populates `privilegeLevel` from
`entitlements.privilege_level` (Access Agent's own schema), so
`evaluateAgentRisk()` now fetches it directly (a new leg of the existing
`Promise.all`, not a new round trip pattern) and triggers when any
effective-access grant is `elevated` or `admin`. Deliberately CAN-based
(a capability check), matching the sibling "Production environment
access"/"External communication capability" factors' own shape, not a
DID-based "was it actually used" one.

**The other three are wired with real names/weights but always
`triggered: false`, documented inline exactly why**, per the story's own
"contributes 0 until its data source is actually available" acceptance
note (the same pattern `RISK-P0-02.2` already established for
"Certification overdue"):
- **Destructive capability** — needs a destructive-verb flag on the
  entitlement itself; DID's own `action` field records what was actually
  done, not what an entitlement technically allows, and every other
  capability factor here is CAN-based, so it isn't a substitute.
- **Credential status** — needs credential/secret health (expiry, weak,
  shared, rotation-overdue) for the *agent's own runtime identity* —
  checked and confirmed distinct from Integration Agent's connector
  credentials (which authenticate WonderAgent's own connection to a
  source system) and from `AgentIdentityLink`'s `confidence`/`status`
  (identity mapping quality, not credential hygiene). No such contract
  exists yet from any module.
- **Attack path** — needs the agent's position on a path to a
  higher-value resource in the effective-access graph; no such
  graph-traversal contract is published by Access Agent yet.

None of these three's dependencies were invented — recorded as real,
named gaps for whichever module eventually publishes the missing
contract, per this backlog's own Dependencies section instruction.

**Did not implement `explainAccessPath()`/graph-position reuse for
Attack path** even though Access Agent's `AccessGraphView` exists —
that view is a UI composition (Experience Agent's), not a published
graph-*query* contract Risk could call; building one would be Access
Agent's own scope decision, not something to reach past.

**Verified — the acceptance criterion that matters most here: no
already-`Done` scoring outcome changed.** The FinanceBot central scenario
in `rules.test.ts` still asserts `riskScore: 80` exactly (Production 20 +
Sensitive data 25 + Active policy violation 15 + Runtime anomaly 10 +
Criticality 10 = 80) — the new "Privilege level" factor contributes 0 in
that test because its `getEffectiveAccess()` mock (newly added, default
`[]`) has no elevated/admin grant. Same for every `QA-P0-08` corpus case
and the two ACCESS-P0-02.2 external-communication tests.

New coverage: 5 tests in `rules.test.ts`'s new "RISK-P1-05" describe
block — triggers on `admin`, triggers on `elevated`, does not trigger on
`standard`, does not trigger with no effective access, and an explicit
"nothing else silently triggers" check (an admin-privilege grant alone
must score exactly 15, not more — would catch any of the other three
factors accidentally flipping on).

Typecheck/lint clean. `rules.test.ts` 15/15 (was 10). Full vitest suite
317/317 (was 312). `npm run build` clean (no route/UI touched, but
`evaluateAgentRisk()` is called from several API routes, so built anyway
rather than assuming).

**Progress Tracker:** RISK-P1-05 moved from `Not Started` to `Partial` —
one of four named factors has real triggering logic and a real data
source; the other three are honestly stubbed pending contracts from
other modules, which is the acceptance criterion's own explicitly
allowed state ("contributes 0 until its data source is actually
available"), not a shortfall against it.

## 2026-09-25 — RISK-P0-11: investigations as a first-class record (master P0-37)

User decision (2026-09-25): a new Risk-owned grouped record.

**What changed:**

- **Migration 0071** (applied live) is additive.
  - `investigations`: an `INV-<year>-<n>` reference unique per tenant,
    title, summary, status, priority, assignee, resolution and
    `resolved_at`.
  - `investigation_findings`: the link table.
  - `investigation_events`: the timeline (created, status changed,
    assigned, finding added or removed, note).
  - Same model as `risk_findings`: select-only RLS for members, and
    service-role writes behind `risk.manage`.
  - **Composite `(id, tenant_id)` foreign keys**, with a new unique
    constraint on `risk_findings`, mean even the service role cannot
    group another tenant's finding.
- **Rules** (`investigationRules.ts`, pure, #9):
  - The allowed transitions. Resolved and closed reopen to in progress.
  - **"Resolved" is refused while any grouped finding is still open**,
    with a count in the message (§17.5), and it needs a resolution.
    "Open" means *not closed*: every status outside `resolved`,
    `false_positive`, `exception` and `mitigated` (the Agents page's closed
    set). A first draft listed open statuses explicitly and missed
    `acknowledged` and `investigating`, which exist in the live check
    constraint. The rule is now written so a future status can never
    silently allow a resolve. The open-investigation form offers every
    non-closed finding, not only status `open`.
  - "Closed" (no action, duplicate) needs a reason.
  - The default priority is the worst grouped severity.
  - Reference allocation: the next number for the year, retried on a
    unique-constraint conflict.
- **Service** (`investigations.ts`):
  - Operations: create, change status, assign, add or remove a finding,
    and add a note.
  - Every change writes a timeline row and an audit event (#11).
  - Service-role writes filter by tenant and re-check every referenced
    row (findings, assignee membership), per §14.
  - A status change is guarded against lost updates: it only applies if
    the status is still what was read, otherwise 409 `STALE_STATUS`.
  - An investigation never changes a finding's own state. Findings are
    remediated and resolved through their own audited flow.
  - Its last finding cannot be removed: close the investigation instead.
- **API.** `/api/v1/risk/investigations` (GET list, POST create), `/:id`
  (GET, PATCH assignee), `/:id/status` (POST) and `/:id/findings`
  (POST, DELETE).
- **UI:**
  - `/risk/investigations`: metrics (active, critical priority, awaiting
    remediation, unassigned), views, a table, and an "Open an
    investigation" form choosing among open findings.
  - `/risk/investigations/:id`: findings with evidence and the
    recommended remediation (linking to each finding's page); status,
    assignee and note forms that show the real result or error; and the
    timeline.
  - It is linked from the Risk page and the nav.
- **Search.** Investigations are searchable by reference or title for
  `risk.read` (OPERATIONS-P0-08's remainder, now Done).

**Tests:**

- `investigationRules.test.ts` (5) and `investigations.test.ts` (2).
- Operations `search.test.ts`: the investigations case.
- SQL `tests/risk/investigations-isolation.sql`, run live, **11/11**:
  - the service role cannot group another tenant's finding (23503);
  - a member sees only their own tenant's investigations, links and
    timeline;
  - a member can update or delete nothing, and cannot create an
    investigation or forge a timeline entry (42501);
  - all rows remain intact.
  - Fixtures cleaned up.
- E2E `investigations.spec.ts`, **10/10** plus setup:
  - create with the reference and the default critical priority;
  - searchable by reference;
  - resolving refused with "2 findings are still open";
  - assign and add a note, both on the timeline;
  - resolved once the findings are resolved;
  - read-only can read but gets 403 on change;
  - the other tenant gets 404 on read and on change, sees nothing in
    list or search, and gets 404 grouping Tenant One's findings.
  - Findings are seeded directly for this spec
    (`support/seedFindings.ts`); the rule engine producing them is
    covered by the FinanceBot spec.

**Observed, not changed.** `assignFinding()` (older, RISK-P0-03) does not
check that the assignee is a tenant member. Investigations do check. It is
recorded here rather than changed within this story.

**Verified:**

- eslint clean; vitest 496/496, then 5/5 for the rules after the
  open-status fix.
- Full Playwright run: **187/187** (8.6 min).
- The open-status fix and the form change came after that build. They
  were rebuilt and re-verified with `investigations.spec.ts` plus
  `risk.spec.ts`: **14/14**.
- Migration 0071 applied live; the SQL isolation test passed 11/11.

## 2026-09-25 — RISK-P0-12: new risk signals (master P0-20/P0-21)

**What changed.** The engine is now evaluator **v2**. Each new rule is a
pure function in `signals.ts`, fed by another module's published contract.

- **New findings.** Migration 0072 (applied live) is additive: two
  categories and one evidence type.
  - `suspicious_delegation`, from Identity's `listRelationships`:
    sharing a credential with any agent, or delegating to or
    orchestrating an agent that is DISCOVERED, SUSPENDED, RETIRED or not
    visible. The evidence is each `agent_relationships` row.
  - `unapproved_tool_use`, from Runtime's SHOULD-vs-DID tool comparison
    (RUNTIME-P0-17's `unapproved_tool` outcome). The evidence is the
    newest recorded event that used each tool.
- **Factors that were always false now have sources:**
  - **Certification overdue** (15): Compliance's new published
    `countOverdueCertificationItems(tenant, agent)`, meaning items pending
    past due (the escalation rule), escalated or not.
  - **Destructive capability** (20): CAN-based like its siblings. The
    agent holds an entitlement whose name starts with a destructive verb
    (delete, drop, purge, truncate, destroy, wipe, erase, remove,
    overwrite), or an MCP tool permission for a tool its server declares
    destructive (INTEGRATION-P0-06's inventory, still-declared tools
    only).
  - **Credential status unhealthy** (15): the agent's own Runtime Gateway
    API keys (FOUNDATION-P0-17). An active key older than 90 days with no
    expiry (rotation overdue), or more than 3 active keys (sprawl).
    Revoked keys do not count.
- **Shadow AI** is a tenant-level signal. An unregistered agent has no
  agent record for a finding to reference, so `/risk` shows a banner
  (count and quarantined events over 90 days) linking to the discovery
  inbox's Shadow AI tab.
- The new loads join `evaluateAgentRisk()`'s single parallel wave. The
  related agents' states come in one further parallel wave.

**Not done, recorded.** "Position on a high-value attack path" still has
no source. It needs an Access graph-traversal contract (paths from the
agent's identities to high-value resources), which Access has not
published. This story is therefore `Partial` rather than `Done`.

**Tests:**

- `signals.test.ts` (9): each rule, including the negatives (operating
  delegate, dependency only, expiring old key, revoked keys, destructive
  tool held without a tool permission).
- `rules.test.ts` +4: the overdue factor scores 15; a destructive MCP
  tool permission scores 20; an unhealthy credential scores 15;
  delegation to a retired agent and an unapproved tool raise their own
  findings with evidence at evaluator v2.
- The "factors never trigger" test is now "with no data for them, the
  newly sourced factors add nothing".
- E2E `shadow-ai.spec.ts`: the Risk page shows the Shadow AI signal and
  links to discovery.

**Verified:** eslint clean, vitest **509/509**, Playwright **187/187**
(8.6 min, a fresh build containing this story). Migration 0072 applied
live.
