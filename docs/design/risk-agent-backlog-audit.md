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
