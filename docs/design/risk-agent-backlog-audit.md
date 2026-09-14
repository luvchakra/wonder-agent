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
