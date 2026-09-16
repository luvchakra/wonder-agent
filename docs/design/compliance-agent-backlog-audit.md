# Compliance Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — COMPLIANCE-P0-01 through P0-02 (full P0 backlog in one pass)

**Agent:** Compliance Agent · **Branch:** `claude/wonderagent-setup-lasmly`
(same environment-pinned-branch deviation every prior module recorded).

**Built:**

- **COMPLIANCE-P0-01.1** — `certification_campaigns`/`certification_items`/
  `certification_decisions` (migration `0036`), plus
  `compliance.read`/`compliance.manage` permission-catalog rows and
  follow-up FK-index hardening (migration `0037`). `certification_campaigns`
  gets ordinary tenant-scoped client RLS (admin-configured business data,
  same treatment as Access Agent's `policies`); `certification_items`
  (computed snapshot fields) and `certification_decisions` (immutable audit
  trail) get the same evidentiary lockdown as every other findings/evidence
  table in this build — client SELECT only, no client-facing INSERT/UPDATE
  at all, verified live (see below). `certification_decisions` deliberately
  has no UPDATE policy for anyone, not even the deciding user — a
  correction is a new decision row, never an edit, per non-negotiable #11.
- **COMPLIANCE-P0-01.2** — `launchCampaign()`
  (`modules/certification-compliance/campaigns.ts`): for `scope_type:
  'agent'` with a `criticality` array in `scope`, creates one
  `certification_items` row per matching agent per entitlement in its
  effective access (via Access's `getEffectiveAccess`), pre-filled with
  `risk_at_review` (the worst open finding's severity, via Risk's
  `getFindings`) and `usage_at_review` (via Runtime's `getDid`), and a
  computed `recommendation` reproducing the backlog's exact rule. **Flagged,
  not silently assumed**: the other four `scope_type` values
  (application/entitlement/privileged_access/high_risk_agent) are accepted
  by the schema's check constraint but have no population logic yet — the
  backlog's only worked example is the criticality-scoped agent case, and
  building the other four's semantics without a concrete spec would be
  guessing.
- **COMPLIANCE-P0-01.3** — `recordDecision()`
  (`modules/certification-compliance/decisions.ts`). `approve` closes the
  item with no side effect; `delegate` reassigns `reviewer_id` and leaves
  `status = 'pending'`; `request_information` leaves the item `pending`
  and writes an audit event for a future Operations Agent to turn into a
  notification (Operations Agent doesn't exist yet). **`revoke` is a real,
  working hand-off, not a stub**: `certification_items.access_grant_id` is
  a real column pointing at Access Agent's own `access_grants.id`, so
  `revoke` calls Access's already-published `revokeAccessGrant()` directly
  — verified live (below) that this actually sets `revoked_at` on the real
  grant row. **`modify`, flagged rather than silently assumed**: the
  backlog says this "creates an `access_requests` row of type modify," but
  Access Agent's `access_requests` schema has no type discriminator between
  a new-access request and a modify request (migration `0028`) —
  repurposing it without one would misrepresent a modify decision as a
  plain new-access request to any other consumer of that table (e.g.
  Access Agent's own SoD checker). The modify intent is instead fully
  captured in the decision's own required, immutable `justification`; no
  `access_requests` row is created until Access Agent publishes a distinct
  type — recorded as a dependency gap, not fabricated.
- **COMPLIANCE-P0-01.4** — `getCertificationItemDetail()`: item plus its
  full decision history. Everything else the PRD's side panel needs
  (agent identity/owner via Identity, access path via Access's
  `explainAccessPath`, usage via Runtime, risk via Risk) is already
  available through those modules' own published contracts directly —
  Experience Agent composes the panel from all of them; this module's
  contract adds only what it uniquely owns (the item and its decisions).
- **COMPLIANCE-P0-02.1 (higher bar)** — `control_frameworks`/`controls`
  (global catalog data, no `tenant_id`, same treatment as Integration
  Agent's `integration_types`: readable by any authenticated user, no
  client-facing mutation) seeded with all six named frameworks (iso27001,
  iso42001, nist_ai_rmf, nist_csf, soc2, cis) and a representative 3-4
  controls each (20 total) — full control libraries are explicitly P1 per
  the backlog. `control_mappings`/`control_evidence` (tenant-scoped,
  computed `status`) get the same evidentiary lockdown as
  `certification_items`.
- **COMPLIANCE-P0-02.2 (higher bar)** — `addControlEvidence()` recomputes
  `status` from evidence alone, never a bare human-typed flip. **Flagged,
  not silently assumed**: the backlog's status rule also references "no
  open non_compliant-implying finding on the mapped policy," but neither
  Access Agent nor Risk Agent publishes a policy-scoped (as opposed to
  agent-scoped) findings/violation query — `listPolicyEvaluations` and
  `getFindings` are both keyed by `agentId`. Adding that cross-cutting
  query is those modules' contract to publish, not this module's to invent
  by reaching into their tables (non-negotiable #6/#14/#18). This module's
  automatic computation therefore only considers evidence recency (a fixed
  90-day default cadence, since the schema has no per-control cadence
  column — same kind of documented default Runtime Agent used for its own
  "no cadence source yet" gap): fresh evidence -> `compliant`, stale ->
  `partial`, no evidence -> `no_evidence`. `non_compliant`/`not_applicable`
  are reachable only via an explicit `manual_attestation` evidence row
  naming that status, never inferred — this satisfies the higher-bar
  wording rule (never claim compliance the evidence doesn't support) by
  construction, not by trusting a human-typed status field. Every
  user-facing label this module returns is scoped to one control
  (`status: "compliant"` as an internal enum value only) — no code path
  anywhere produces a tenant-wide "compliant" claim, per non-negotiable
  and product-boundary #10.

**Verification run:**
- `npm run lint`, `npm run typecheck`, `npm run build` — all clean.
- `npm run test` — 53/53 passing across 12 files (new:
  `campaigns.test.ts` for `computeRecommendation()` reproducing the PRD's
  exact three-row worked table plus the boundary cases).
- Live smoke test against a locally started production server:
  unauthenticated hits to `/compliance/campaigns`,
  `POST /api/v1/compliance/campaigns`, `GET /api/v1/compliance/controls`,
  and `POST /api/v1/compliance/items/:id/decisions` all correctly return a
  307-to-`/sign-in` or 401 (checked proactively, consistent with every
  module since Integration Agent's bug).
- **The module's critical acceptance test, executed live against the dev
  Supabase project** (Supabase MCP `execute_sql`): extended the existing
  FinanceBot fixture (Tenant A5, from Runtime/Risk Agent's own tests) with
  the two additional applications/entitlements/grants the PRD's worked
  table needs (SAP, S3), then launched a campaign and populated three
  `certification_items` rows exactly reproducing the PRD's worked table
  (Snowflake/High/Used/Review, SAP/Low/Used/Keep, S3/Medium/Never/Remove),
  captured an `approve` and a `revoke` decision, and proved: (1) the
  `revoke` decision's real effect — the S3 grant's `revoked_at` was
  actually set, via the same `revokeAccessGrant()` path
  `recordDecision()` calls; (2) tenant isolation — Tenant B5's user sees
  zero items and zero decisions; (3) forgery rejection — same-tenant
  client `INSERT`s into `certification_items` and `certification_decisions`
  were both rejected by RLS; (4) immutability — a same-tenant client
  `UPDATE` against an existing decision affected zero rows (verified via
  `GET DIAGNOSTICS row_count`, not by expecting a thrown exception, since
  RLS silently filters rather than erroring on a no-policy `UPDATE` — an
  imprecise first version of this check that only looked for an exception
  wrongly read as "unexpectedly succeeded" until the actual row content was
  checked and found unchanged; the script was corrected to check row count
  properly). Fixture data intentionally left in place (same convention as
  every prior module's script); script committed at
  `tests/compliance/central-scenario-and-tenant-isolation.sql`.
  `get_advisors` (security and performance) clean beyond the same
  previously-reviewed exceptions every prior module already accepted.

**Not started this session / open items:**
- Only `scope_type: 'agent'` (criticality-filtered) has real campaign
  population logic — the other four scope types are accepted by the schema
  but not yet implemented, pending a concrete spec.
- `modify` decisions don't create an `access_requests` row — blocked on
  Access Agent publishing a distinct request type for "modify" versus
  "new access."
- `control_mappings.status`'s automatic computation doesn't check live
  policy-violation state — blocked on Access/Risk publishing a
  policy-scoped (not agent-scoped) violation query.
- These are pre-existing dependency gaps in modules that have already
  shipped, or explicitly-scoped-P1 backlog items, not omissions within this
  module's own scope — recorded here rather than reaching into another
  module's files to "fix" it myself, per non-negotiable #18.

**Dependencies consumed:** Foundation's `requirePermission()`,
`writeAudit()`, `supabaseServer()`/`supabaseServiceRole()`; Identity's
`listAgents()`; Access's `getEffectiveAccess()`, `explainAccessPath()`,
`revokeAccessGrant()`; Risk's `getFindings()`; Runtime's `getDid()` — all
used exactly as published, no modification to any Foundation, Identity,
Access, Risk, or Runtime file.

**Published this session, for Experience/Operations to consume once
dispatched:** `modules/certification-compliance/service.ts` (barrel) and
`lib/shared/types/compliance.ts`. Most relevant to near-term dependents:
`getCertificationHistory(agentId)` is the "last certified" fact Identity/
Risk's own worked examples reference; `getCertificationItemDetail()` is the
side-panel data contract Experience Agent composes its UI from.

---

## 2026-09-14 — COMPLIANCE-P0-03, COMPLIANCE-P0-04, COMPLIANCE-P0-05, COMPLIANCE-P0-06 (2026-09-14 requirements refresh)

**Agent:** Compliance Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Per the user's explicit "continue automatically" instruction, picked up the
four Not Started rows the requirements-refresh pass added to this
backlog's Progress Tracker, auto-chained from Risk Agent.

**Built:**

- **COMPLIANCE-P0-03** — a `snapshot jsonb` column added to both
  `certification_items` and `certification_decisions` (migration `0046`,
  no RLS-policy change needed — both tables already grant client SELECT
  only, same evidentiary lockdown extends to the new column). New
  `modules/certification-compliance/snapshot.ts`: `shapeCertificationSnapshot()`
  (pure — captures agent contract id/version, the specific access grant,
  every policy evaluation's `policyId`/`policyVersion`, and risk/usage) plus
  two extracted pure helpers, `computeWorstSeverity()` and
  `computeUsageForApplication()`. `launchCampaign()` (`campaigns.ts`) now
  calls these at item-population time — refactored from its previous
  inline duplicate logic to reuse the same functions, verified behavior-
  identical (same three-way usage outcome, same worst-severity reduction;
  `computeRecommendation()` itself, already `Done` and tested, was not
  touched). `recordDecision()` (`decisions.ts`) now calls a new
  `buildFreshSnapshot()` (fetches contract/effective-access/policy-
  evaluations/findings/DID fresh, right before writing the decision) so a
  decision's snapshot reflects what was true at the moment the reviewer
  acted, not the item's stale population-time values — satisfying the
  story's "reproducible even if the live agent contract or policy has
  since changed" acceptance criterion. Existing rows have `snapshot: null`,
  per this being an additive column, not a backfill story.
- **COMPLIANCE-P0-04** — `recordDecision()` now rejects (`403
  NOT_ASSIGNED_REVIEWER`, audited as `compliance.decision_rejected_not_reviewer`)
  any caller whose id doesn't match the item's current `reviewer_id`
  (delegation already covered: the `delegate` decision reassigns
  `reviewer_id`, so this same check is what "or an explicitly delegated
  reviewer" resolves to — no separate delegation table needed). Separately,
  Segregation of Duties: an `approve` decision is blocked (`409
  SOD_CONFLICT`, audited as `compliance.sod_conflict_blocked`) when the
  caller is among the agent's owners (Identity's `listOwners()`) unless the
  caller explicitly passes `overrideSoD: true`, in which case the decision
  proceeds and a separate `compliance.sod_override_used` event is audited —
  satisfying the story's "reject, or require an explicit override with its
  own audit trail" acceptance criterion. Scoped to `approve` only (the
  decision that actually certifies access as correct); revoke/modify/
  delegate/request_information don't carry the same self-serving-bias risk
  the story is guarding against.
- **COMPLIANCE-P0-05** — two additive columns on `certification_items`
  (`escalated_at`, `escalated_to`, migration `0046`). New
  `modules/certification-compliance/escalation.ts`'s
  `escalateOverdueItems(tenantId, actorId)`: finds every `pending` item
  past its `due_date` with `escalated_at is null`, escalates to the
  agent's `business_owner` (Identity's `listOwners()`), falling back to
  the campaign's `created_by` (then the item's own `reviewer_id`) if the
  agent has no business owner — writes `escalated_at`/`escalated_to` via
  the service-role client (the table has no client-facing UPDATE policy,
  same as every other write to this table) and an audited
  `compliance.item_escalated` event per item. No scheduler exists in this
  codebase yet (the same documented gap Integration Agent's sync jobs and
  this module's own `recomputeStaleControlMappings()` already flagged), so
  it's exposed via `POST /api/v1/compliance/campaigns/escalate-overdue`
  for an operator (or a future job runner) to trigger, not wired to a cron
  — recorded as the story's Partial reason. `getCampaignMetrics()`
  (`campaigns.ts`) reports `totalItems`/`pendingItems`/`decidedItems`/
  `overdueItems`/`escalatedItems` for a campaign, exposed via
  `GET /api/v1/compliance/campaigns/:id/metrics` and shown on the bare
  campaign-items page.
- **COMPLIANCE-P0-06** — new `modules/certification-compliance/export.ts`'s
  `exportCampaignEvidence(tenantId, actorId, campaignId)`: assembles the
  campaign plus every item plus every item's decisions (reviewer identity
  via `decidedBy`, justification, snapshot), computes a SHA-256 hash over
  the canonical JSON of that content (deliberately excluding the export
  event's own metadata — `exportedAt`/`exportedBy` — from what's hashed,
  so re-exporting unchanged evidence produces a comparable hash), and
  writes an audited `compliance.evidence_exported` event carrying the
  hash. Exposed via `POST /api/v1/compliance/campaigns/:id/export`. Per
  this story's own ownership-map flag (unresolved, not decided here): this
  module owns assembling the compliance-specific evidence content; the
  actual export file/delivery mechanism might belong to Operations Agent's
  existing export machinery instead — not built here, recorded as the
  story's Partial reason rather than guessed.

**Verification run:**
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean. New
  routes confirmed present in the build output: `/api/v1/compliance/
  campaigns/[id]/metrics`, `/api/v1/compliance/campaigns/[id]/export`,
  `/api/v1/compliance/campaigns/escalate-overdue`.
- `npx vitest run` — 128/128 passing across 20 files. New:
  `snapshot.test.ts` covers `computeWorstSeverity()` (empty/single/several
  findings, `info` ranking below every real severity),
  `computeUsageForApplication()` (all three outcomes including the
  `unknown` vs `never` distinction), and `shapeCertificationSnapshot()`
  (full shape, and the null-contract/null-grant case). `recordDecision()`'s
  reviewer-authorization/SoD/snapshot logic and `escalateOverdueItems()`
  were not given their own mocked unit tests (this module's decisions/
  campaigns files have never carried DB-mock-heavy unit tests — the
  established pattern here, same as every prior module's `findings.ts`-
  style files, is live verification instead, below) — a gap consistent
  with the rest of this module, not a new one.
- Live-verified against the dev Supabase project (Supabase MCP, project
  `ekgyjwoenteadaaqakmd`), after applying migration `0046`: a throwaway
  overdue `certification_items` row (FinanceBot's Tenant A5, `due_date`
  one day in the past) proved `escalateOverdueItems()`'s exact filter (`
  status = 'pending' and escalated_at is null and due_date < now()`,
  joined to `certification_campaigns` for the `created_by` fallback) finds
  exactly the right row and resolves the fallback owner correctly (no
  `business_owner` exists for FinanceBot in the fixture, so it fell back
  to the campaign's `created_by`, as designed); a same-tenant client
  `UPDATE` of `escalated_at` was rejected (0 rows — no client-facing UPDATE
  policy on `certification_items`, confirming the escalation write must
  go through the service-role client, which it does); after a service-
  role-equivalent write, Tenant A5's authenticated session read the
  escalated item and Tenant B5's session saw zero rows for it (tenant
  isolation). Separately proved the `snapshot` column round-trips a full
  JSON shape on both `certification_items` and `certification_decisions`,
  and that `certification_decisions.snapshot` is readable to Tenant A5 and
  invisible to Tenant B5 (tenant isolation via the existing join-to-item
  policy, unchanged by this story). All throwaway rows cleaned up.
  `get_advisors` (security) re-checked after the migration — no new
  findings beyond the same pre-existing accepted set every prior module
  already reviewed.

**Not started this session / still open:**
- COMPLIANCE-P0-05's escalation has no automatic trigger (no scheduler in
  this codebase) — an operator or future job runner must call the new
  endpoint/function.
- COMPLIANCE-P0-06's export has no file/delivery mechanism — returns the
  assembled package/hash as JSON; whether that belongs here or in
  Operations Agent's export machinery is still an open ownership-map
  question for the user, not decided by this entry.
- All items carried over unchanged from the prior entry (agent-scope-only
  campaign population, `modify` decisions not wired to `access_requests`,
  `control_mappings.status` not checking live policy-violation state).

**Dependencies consumed:** everything from the prior entry, plus Identity's
`listOwners()` and Access's `listPolicyEvaluations()` (both already
published contracts, used exactly as published, no modification to any
other module's file).

**Published this session:** `getCampaignMetrics()`, `escalateOverdueItems()`,
`exportCampaignEvidence()` (`modules/certification-compliance/service.ts`);
`CertificationSnapshot`, `CampaignMetrics`, `EvidenceExportPackage`, and the
`snapshot`/`escalatedAt`/`escalatedTo` fields on `CertificationItem`/
`CertificationDecision` (`lib/shared/types/compliance.ts`).

---

## 2026-09-14 — Requirements refresh, round 2 (documentation-only reconciliation, no stories added)

**Agent:** Compliance Agent (documentation/planning task, no application code
touched). The user re-uploaded the Certification & Compliance requirements
document a second time (`07_CERTIFICATION_COMPLIANCE.md`, described as a
newer/expanded version) and asked for a fresh reconciliation pass against
this module's backlog, independent of the round-one pass recorded above.

**Finding: nothing new to add.** Read the full re-uploaded document
(243 lines) and compared it section-by-section against
`docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md` (its Progress Tracker, its
original "Original Master PRD Requirements" section, and its existing
"Requirements Refresh — 2026-09-14" section from round one). The re-upload
is **content-identical** to the document already reconciled in round one —
same master-PRD `# 16`/`# 17`/`# 20` sections, same "Claude Code Execution
Plan," same `CERT-P0-01` through `CERT-P0-09`, `CERT-P1-01` through
`CERT-P1-05`, `CERT-P2-01` through `CERT-P2-03` items with matching wording,
same critical acceptance test. Every item in it was already either (a) a
tracked Progress Tracker row (`COMPLIANCE-P0-01.1` through
`COMPLIANCE-P0-06`), (b) explicitly listed in round one's "Already covered,
no new tracker row needed" bullets, or (c) already present in the backlog's
`## P1` / `## P2` sections. No genuinely new requirement, story, or
acceptance criterion was found.

Before concluding this, sanity-checked the actual codebase rather than
trusting the backlog text alone: `ls modules/certification-compliance/`
confirms `campaigns.ts`, `decisions.ts`, `escalation.ts`, `export.ts`,
`snapshot.ts`, `controls.ts`, `mappers.ts`, `service.ts` all exist, backed
by migrations `0036_compliance_certification.sql`,
`0037_compliance_indexes.sql`, and
`0046_compliance_evidence_snapshot_sod_escalation.sql` — consistent with
what the Progress Tracker and the two 2026-09-14 entries above already
record as `Done`/`Partial`. This is not fabricated thoroughness: the doc
really does appear to be the same upload as round one, not an expanded
version, so there is no gap to report beyond documenting that the check was
done and came back empty.

**Changed:** added a "## Requirements Refresh — 2026-09-14 (round 2,
expanded doc)" section to `docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md`
recording this finding. No Progress Tracker rows added or modified; no
existing row's status changed; no application code, migration, or test
touched.

**Open items carried forward unchanged from round one** (not re-decided
here): the evidence-export file/delivery ownership question
(Compliance vs. Operations Agent) and the `CERT-P2-03` Auditor Workspace
authorization-boundary question both remain open for the user.

---

## 2026-09-16 — COMPLIANCE-P0-07 — Governance Posture

**Agent:** Compliance Agent. Picked up per the user's standing authorization
to work through the pending P0 backlog from the 2026-09-15 governance
requirements reconciliation in order, without stopping to ask before each
story (`docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md`'s "Requirements Refresh —
2026-09-15" section, `COMPLIANCE-P0-07`).

**Design.** The story's own spec (in the backlog) already resolved the main
ambiguity: "a read-model computed from existing published contracts... no
new table duplicating another module's data; deterministic and explainable,
with a documented reason per dimension, not a single opaque number." Built
exactly that — `getGovernancePosture(tenantId, agentId)`
(`modules/certification-compliance/posture.ts`) computes, on every call,
twelve independent dimension checks (Identity, Ownership, Purpose, Access,
Action authority, Certification, Runtime monitoring, Human oversight,
Policy compliance, Lifecycle, Compliance controls, Evidence completeness),
each returning `{ dimension, status: "governed"|"gap"|"not_applicable",
reason }`, then derives one of five composite statuses (`GOVERNED`,
`PARTIALLY_GOVERNED`, `NON_COMPLIANT`, `EXCEPTION_APPROVED`, `SUSPENDED`)
deterministically from those results (non-negotiable #9) — never a single
score, and never conflated with Risk Agent's risk score (they answer
different questions: risk measures threat/impact of observed behavior,
posture measures whether the agent's governance scaffolding itself —
identity, ownership, contract, access, certification, oversight — is
intact).

**Every dimension is sourced from another module's already-published read
contract** (non-negotiable #6 — no direct table reads across module
boundaries):
- Identity/Ownership/Purpose/Lifecycle — `getAgent()`, `getAgentContract()`,
  `listAgentIdentities()`, `getOwnershipIssues()` (Identity Agent).
- Access — `compareAccessToContract()` (Access Agent's SHOULD-vs-CAN diff);
  gap iff any `excessive` row.
- Action authority — `getDid()` (Runtime Agent) to find distinct observed
  actions, then `classifyActionsForAgent()` (Access Agent's 4-state
  ACCESS-P0-06 model) on those *actually observed* actions specifically
  (not the contract's own declared-action list, which would be trivially
  self-consistent) — gap iff any observed action classifies `prohibited`
  or `restricted`.
- Runtime monitoring — same `getDid()` call, reused; applicable only when
  `contract.requiredMonitoring` is set (the explicit SHOULD signal
  IDENTITY-P0-07 published); gap iff zero observed events despite a
  declared monitoring requirement.
- Human oversight — pure contract-field check: autonomy level ≥3 (high
  autonomy) with an empty `actionsRequiringApproval` list is a gap (a
  documented, deliberately simple rule — verifying that a declared approval
  requirement was actually *followed* at runtime is a distinct, harder
  question left to Risk Agent's existing categories, not duplicated here).
- Policy compliance — `listPolicyEvaluations()` (Access Agent), gap iff the
  *latest* evaluation of any policy is `violation`.
- Compliance controls — applicable only when
  `contract.requiredComplianceControls` is non-empty; matches each
  free-text control ref against `listControlFrameworks()` +
  `listControls()` (this module's own control catalog) by `controlRef`,
  then checks the matched control's `listControlMappings()` status is
  `compliant` or `not_applicable`; gap iff unmapped or any other status.
  This is a genuinely new correlation this module didn't have before —
  `requiredComplianceControls` (a free-text list on the contract) and
  `control_mappings` (keyed by `control_id`, not by agent or by ref) had no
  prior link; posture.ts is the first place they're joined, in-memory, by
  `controlRef` string match — documented here since it's not obvious from
  either schema alone.
- Certification — this module's own `getCertificationHistory()`; gap if the
  agent's lifecycle state is `CERTIFICATION_DUE`, or if it has never been
  certified.
- Evidence completeness — same certification history; gap unless at least
  one decision carries a non-null `snapshot` (COMPLIANCE-P0-03).

**Composite status derivation:** `SUSPENDED` overrides everything when
`agent.lifecycleState === "SUSPENDED"` (an explicit terminal governance
state, not merely "a dimension with a gap"). Otherwise: zero gaps →
`GOVERNED`; any gap but at least one *active* governance exception scoped to
the agent (`listGovernanceExceptions()`, ACCESS-P0-07's broadened model) →
`EXCEPTION_APPROVED` (a human already approved a compensating control for
this agent's gap — this is exactly what that model exists for); any gap in
a "core" dimension (`identity`, `ownership`, `purpose`, `lifecycle` — the
foundational governance scaffolding, without which nothing else is
meaningful) → `NON_COMPLIANT`; any other gap → `PARTIALLY_GOVERNED`.
`RETIRED` lifecycle state is deliberately not special-cased into its own
composite bucket (the five allowed statuses don't include one) — it falls
through to `NON_COMPLIANT` via the `lifecycle` dimension's own gap, which is
an honest characterization, not a workaround.

**Not implemented / deliberately excluded:**
- No new column or table stores the computed posture — every call
  recomputes it fresh from live data, per the story's own instruction. The
  existing `agents.posture_score` numeric column (migration `0012`, a
  currently-unused Identity-owned column) is left untouched — writing to it
  would be modifying another module's table (non-negotiable #6/#18), and a
  single numeric column can't carry the12-dimension explainability this
  story requires; if a cached/stored posture is wanted later, that's an
  Identity-owned schema decision, not this module's to make unilaterally.
- No UI — Experience Agent composes the panel from this read contract.

**Verification:**
- `modules/certification-compliance/posture.test.ts` — 10 tests, fully
  mocking every consumed module's service (Identity, Access, Runtime, and
  this module's own sibling `./decisions`/`./controls`), covering: agent-
  not-found (404), all-governed happy path, `SUSPENDED` override,
  `NON_COMPLIANT` via a core-dimension gap, `PARTIALLY_GOVERNED` via a
  non-core gap, `EXCEPTION_APPROVED` when an active exception covers a gap,
  `action_authority` gap from a prohibited observed action,
  `human_oversight` gap from high autonomy with no approval list, every
  contract-dependent dimension correctly `not_applicable` with no contract,
  and `compliance_controls` gap from an unmapped required control.
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npx vitest run` — 175/175 passing (up from 165 before this story).
- `npm run build` (with `.next` deleted first) — clean; new route
  `GET /api/v1/compliance/agents/[id]/posture` compiled as a dynamic
  function alongside the rest of `/api/v1/compliance/*`.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:**
`getGovernancePosture(tenantId, agentId)`
(`modules/certification-compliance/service.ts`); `GovernancePostureStatus`,
`GovernanceDimension`, `GovernanceDimensionResult`, `GovernancePosture`
(`lib/shared/types/compliance.ts`); `GET /api/v1/compliance/agents/[id]/posture`
(`compliance.read` permission, matching this module's existing route
conventions).

**Dependencies consumed:** Identity's `getAgent()`, `getAgentContract()`,
`listAgentIdentities()`, `getOwnershipIssues()`; Access's
`compareAccessToContract()`, `classifyActionsForAgent()`,
`listPolicyEvaluations()`, `listGovernanceExceptions()`; Runtime's
`getDid()` — all already-published contracts, used exactly as published, no
modification to any other module's file.

---

## 2026-09-16 — COMPLIANCE-P0-08 — Governance Attestation (broad)

**Agent:** Compliance Agent, continuing directly from `COMPLIANCE-P0-07`
per the user's standing authorization to work through the pending P0
backlog in order without stopping to ask between stories.

**Design.** Per the backlog's own resolved spec: fields "agent,
policy/requirements, checklist, approver, approval timestamp, validity,
decision, comments, evidence references," a new Compliance-owned table
(`governance_attestations`, tenant-scoped, RLS), `writeAudit()` on every
decision. Deliberately distinct from Identity's own narrower, still-P1,
unbuilt self-attestation concept referenced in
`docs/plan/02-IDENTITY-AGENT-BACKLOG.md`'s P1 list (`IDENTITY-P1-02`) — no
naming or table collision, confirmed that module hasn't created its table
yet.

**Schema** (`supabase/migrations/0055_compliance_governance_attestation.sql`,
applied live): `governance_attestations(id, tenant_id, agent_id,
policy_requirement, checklist jsonb, approver_id, decision, comments,
evidence_references jsonb, valid_from, valid_until, decided_at,
created_at)`. `decision` is `attested | rejected | needs_more_info`. Same
evidentiary lockdown pattern as `certification_decisions`
(migration 0036): client `SELECT` policy only, no client-facing `INSERT`
or `UPDATE` policy at all — a decision is recorded once, server-mediated,
through `recordAttestation()`, and a correction is a new row, never an
edit (non-negotiable #11).

**Service** (`modules/certification-compliance/attestations.ts`):
`recordAttestation(tenantId, approverId, agentId, input)` uses
`supabaseServiceRole()` (required — no client INSERT policy exists) and,
per CLAUDE.md §14's service-role guardrail, manually verifies the target
agent belongs to `tenantId` before writing (visible in the function body,
not buried) — this is the standing pattern this module already established
in `decisions.ts`. Writes exactly one audit event
(`compliance.attestation_recorded`) per call, never silently swallowed.
`listAttestationsForAgent()` and `getLatestAttestation()` (optionally
filtered to one `policyRequirement`, since one agent can be attested
against several independent policy requirements over time) are plain
tenant-scoped reads through the RLS-respecting `supabaseServer()` client.

**API:** `GET/POST /api/v1/compliance/agents/[id]/attestations`
(`compliance.read` for GET, `compliance.manage` for POST — same permission
keys this module already has, no new RBAC surface needed).

**Not implemented / deliberately excluded:**
- No SoD/self-attestation check analogous to `COMPLIANCE-P0-04`'s
  reviewer-vs-owner rule — the story's own field list doesn't call for one,
  and adding it here would be inventing scope the backlog didn't ask for
  (`CLAUDE.md` §3: "if unsure whether something is a required extension
  point or genuine scope creep, treat it as scope creep and stop").
- No UI — Experience Agent composes it from this read/write contract.
- No wiring into `getGovernancePosture()` (COMPLIANCE-P0-07, built
  immediately prior) — that story's "Human oversight"/"Policy compliance"
  dimensions were deliberately scoped to what was already published *at
  the time it was built*; retrofitting it to also read attestations is a
  reasonable future enhancement but out of scope for *this* story, which
  is `getLatestAttestation()`'s stated design purpose ("used by
  COMPLIANCE-P0-09's evidence pack assembly") — not silently expanded here.

**Verification:**
- `modules/certification-compliance/attestations.test.ts` — 6 tests
  (mocking `@/lib/db/supabaseServer` and `@/lib/audit/writeAudit`, the same
  DB-client-mocking pattern Integration Agent's `credentials.test.ts`
  established): empty-`policyRequirement` rejection, agent-not-in-tenant
  404, successful insert + audit-event shape, row-to-type mapping, and
  `getLatestAttestation`'s policy-requirement filter (including the
  no-match-returns-null case).
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npx vitest run` — 181/181 passing (up from 175 before this story).
- Migration applied live to the dev Supabase project (`ekgyjwoenteadaaqakmd`)
  via `apply_migration`; `get_advisors(security)` re-checked afterward —
  the 3 findings returned are all pre-existing (Platform Agent's tables and
  2 already-known security-definer functions), nothing new from this
  migration.
- `npm run build` (with `.next` deleted first) — clean; new route compiles
  alongside the rest of `/api/v1/compliance/*`.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:** `recordAttestation()`,
`listAttestationsForAgent()`, `getLatestAttestation()`
(`modules/certification-compliance/service.ts`);
`GovernanceAttestation`, `AttestationChecklistItem`,
`AttestationEvidenceReference`, `AttestationDecision`
(`lib/shared/types/compliance.ts`);
`GET/POST /api/v1/compliance/agents/[id]/attestations`.
`docs/design/ownership-map.md` updated with the new
`governance_attestations` table row.

---

## 2026-09-16 — COMPLIANCE-P0-09 — Governance Evidence Pack assembly

**Agent:** Compliance Agent, continuing from `COMPLIANCE-P0-08` per the
user's standing authorization. Paired with Operations Agent's
`OPERATIONS-P0-07` in the same session pass (the 2026-09-15 decision:
"Compliance assembles, Operations exports").

**Design.** `assembleGovernanceEvidencePack(tenantId, agentId)`
(`modules/certification-compliance/evidencePack.ts`) fetches every section
the governance requirements doc's per-agent bundle calls for — identity,
owners, purpose/lifecycle, IAM identity, effective access, SHOULD/CAN/DID,
policies, risk findings, certifications, attestations, exceptions, control
mappings, runtime evidence (via SHOULD/CAN/DID), remediation, audit
events — in a single `Promise.all()`, each call going through the owning
module's already-published read contract (non-negotiable #6):
- Identity: `getAgent()`, `getAgentContract()`, `listOwners()`,
  `listAgentIdentities()`, `listLifecycleEvents()`.
- Access: `getEffectiveAccess()` (CAN), `listPolicyEvaluations()`,
  `listGovernanceExceptions()`, `listAccessRequests()` (remediation).
- Runtime: `compareShouldCanDid()` — reused whole rather than re-deriving
  SHOULD/CAN/DID separately, since Runtime Agent already publishes exactly
  this three-way comparison.
- Risk: `getFindings()`.
- This module's own: `getCertificationHistory()`, `listAttestationsForAgent()`
  (COMPLIANCE-P0-08, built immediately prior), and `getGovernancePosture()`
  (COMPLIANCE-P0-07) included as a summary section.
- Control mappings: reuses the exact controlRef-to-control_mappings
  correlation COMPLIANCE-P0-07's `compliance_controls` dimension already
  performs, rather than inventing a second version of it.
- **New cross-module dependency direction:** Operations' `listAuditLogs()`
  (`@/modules/operations/service`). Every prior dependency in this module
  flowed from earlier-numbered modules (Identity/Access/Runtime/Risk); this
  is the first time Compliance consumes a *later*-numbered module's
  contract. This is correct per `docs/design/ownership-map.md`, which
  already designates Operations as `audit_logs`'s read/presentation owner
  regardless of module numbering — module numbers are a build-order
  convention, not a dependency-direction constraint, and the ownership map
  is what non-negotiable #6 actually binds to. Verified the resulting
  Compliance↔Operations circular module reference (Operations' `reports.ts`
  already imports from Compliance's service) causes no runtime issue: both
  sides only call the other's functions inside async function bodies, never
  at module top-level/import time, so `npm run build` compiles cleanly (a
  live check, not an assumption).

**Audit events scoping (documented limitation, not a silent gap):** the
bundle includes only audit events whose direct object is the agent itself
(`objectType: "agent"`, `objectId === agentId`) — not every audit event
*related to* the agent (e.g. a certification decision's own audit event
carries that decision's id as its object, not the agent's). Operations'
published `AuditLogFilter` has no "related agent" filter to widen this
without inventing one on Operations' behalf, which this module has no
standing to do unilaterally.

**Not implemented / deliberately excluded:**
- No new table — the pack is computed fresh on every call, same
  no-persistence principle as `COMPLIANCE-P0-07`.
- File generation/delivery is explicitly out of scope here — that's
  `OPERATIONS-P0-07`, recorded separately in Operations' own audit log.

**Verification:**
- `modules/certification-compliance/evidencePack.test.ts` — 4 tests
  (agent-not-found, full assembly from mocked dependencies, audit-event
  objectId filtering, control-mapping correlation).
- `npm run typecheck` — clean (including across the new
  Compliance↔Operations circular type reference).
- `npm run lint` — clean.
- `npx vitest run` — 188/188 passing (up from 181 before this pair of
  stories).
- `npm run build` (with `.next` deleted first) — clean; confirmed the new
  route compiled by checking `.next/server/app/api/v1/compliance/agents/
  [id]/evidence-pack/route.js` exists.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:** `assembleGovernanceEvidencePack()`
(`modules/certification-compliance/service.ts`); `GovernanceEvidencePack`
(`lib/shared/types/compliance.ts`);
`POST /api/v1/compliance/agents/[id]/evidence-pack?format=json|csv`
(`compliance.manage`, matching the `COMPLIANCE-P0-06` campaign-export
precedent's permission gate and POST-not-GET convention for an audited
export action).

---

## 2026-09-16 — Partial-item sweep: unblocked COMPLIANCE-P0-06; four others confirmed still genuinely blocked

**Agent:** Compliance Agent, per the user's standing authorization to pick
up buildable `Partial` items. Checked all five `Partial` rows
(`COMPLIANCE-P0-01.2`, `01.3`, `02.2`, `05`, `06`) for a real unblock
before touching anything.

**COMPLIANCE-P0-06 — unblocked, now `Done`.** Its own row named the
blocker precisely: "the actual export file/delivery mechanism is
intentionally not built, per this story's own ownership-map flag...
Operations Agent overlap, undecided." That question was resolved earlier
this session by `COMPLIANCE-P0-09`/`OPERATIONS-P0-07`'s 2026-09-15
decision ("Compliance assembles, Operations exports"). Extended the same
pattern to campaign evidence: `modules/operations/campaignExport.ts`
(`exportCampaignEvidencePackage()`) turns the already-assembled,
already-hashed `EvidenceExportPackage` (`exportCampaignEvidence()`,
unchanged) into a JSON or flattened CSV file. Unlike the governance
evidence pack, this function does **not** recompute a content hash or
write a second audit event — `exportCampaignEvidence()` already does both
at assembly time (`compliance.evidence_exported`), and duplicating either
would misrepresent one export action as two. `app/api/v1/compliance/
campaigns/[id]/export/route.ts` gained `?format=csv` (JSON stays the
unchanged default response shape — fully backward compatible).

**COMPLIANCE-P0-01.2 — re-checked, still genuinely blocked, not touched.**
The other four `scope_type`s (`application`, `entitlement`,
`privileged_access`, `high_risk_agent`) are blocked on "a concrete spec,"
not a missing cross-module contract — no amount of checking other
modules' published functions resolves an undefined product decision about
what each scope type's item-population rule should actually be. Left
exactly as documented.

**COMPLIANCE-P0-01.3 — re-checked, still genuinely blocked, not touched.**
Re-read `supabase/migrations/0028_access_requests.sql`: `access_requests`
still has no `type`/modify-scoped column or concept — Access Agent has not
published a distinct request type for "modify" decisions since this
dependency was first recorded. Confirmed by reading the actual migration,
not just trusting the backlog text.

**COMPLIANCE-P0-02.2 — re-checked, still genuinely blocked, not touched.**
`modules/access-governance/evaluate.ts` still exports only
`listPolicyEvaluations(tenantId, agentId)` (agent-scoped) and
`evaluatePolicies()` — no policy-scoped ("does policy X currently have any
active violation, across any agent") query exists. Confirmed by reading
the file's actual exports, not just the backlog text.

**COMPLIANCE-P0-05 — re-checked, still genuinely blocked, not touched.**
This one isn't blocked on another *module's* contract at all — it's
blocked on this codebase having no scheduler/cron infrastructure
whatsoever (confirmed: no cron job runner, no scheduled-task table,
nothing resembling one anywhere in `lib/`/`modules/`). Building generic
scheduling infrastructure is not this story's or this module's scope; the
escalation logic itself remains fully implemented and exposed as an
operator/API-triggered sweep, exactly as already documented.

**Verification (COMPLIANCE-P0-06 unblock):**
- `modules/operations/campaignExport.test.ts` — 2 tests: JSON content
  matches the package and reuses its existing content hash; CSV flattens
  campaign + item + decision into the expected row count.
- `npm run typecheck` / `npm run lint` — clean.
- `npx vitest run` — 204/204 passing (up from 202).
- `npm run build` (with `.next` deleted first) — clean.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:** none from this module (the new function is
Operations-owned); `app/api/v1/compliance/campaigns/[id]/export/route.ts`
gained a `?format=csv` branch, response shape for the default JSON path
unchanged.

---

## 2026-09-16 — notify() wiring (OPERATIONS-P0-02.2, from Operations Agent's pass)

**Agent:** Operations Agent (recorded here too since the actual code
change lives in this module's own file —
`modules/certification-compliance/escalation.ts`; full rationale in
Operations' own audit log entry of the same date).

`escalateOverdueItems()` now calls `notify({type: 'certification_overdue',
...})` per escalated item, targeted at the specific `escalatedTo` user
(business owner, falling back to the campaign creator). New
`modules/certification-compliance/escalation.test.ts` (this module's
first test file for `escalation.ts`) — 3 tests. No Progress Tracker row
change — this doesn't correspond to a new Compliance Agent story.

---

## 2026-09-16 — pagination pass (QA-P0-04.3 follow-up, user-prioritized "what's left before launch")

Capped 1 previously-unbounded query with the new shared
`DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`, 200): `campaigns.ts`'s
`listCampaigns()`. Two related functions were deliberately left uncapped,
each with its own inline comment:
- `campaigns.ts`'s `listCampaignItems()` — `getCampaignMetrics()` (totals/
  pending/overdue/escalated counts) and `export.ts`'s evidence export both
  need every item to be correct; a silent truncation would produce a wrong
  metric or an incomplete compliance evidence artifact, not just a slower
  query.
- `controls.ts`'s `listControlMappings()` — `posture.ts`'s governance
  posture score and `evidencePack.ts`/`operations/reports.ts`'s compliance
  reports all depend on seeing every mapping for correct coverage.

`controls.ts`'s `listControlEvidence()` (per-mapping) and `decisions.ts`'s
`listDecisionsForItem()` (per-item, normally exactly one row) were judged
genuinely bounded and left untouched.

Verification covered as part of the full cross-module pass — see
`INTEGRATION_STATUS.md` §5's update note for the shared pipeline run.

---

## 2026-09-16 — COMPLIANCE-P0-01.3 fully resolved: modify creates a real access_requests row

Previously `Partial`: `recordDecision()`'s `modify` branch only wrote an
audit event (`compliance.modify_not_wired`) because Access's
`access_requests` table had no discriminator between a plain new-access
request and a reviewer-initiated modify request — repurposing it without
one would have misrepresented the row to any other consumer (e.g. Access's
own SoD checker). Resolved as part of the user's "any P0 item open to
work?" pass, picked up as a self-contained cross-module fix (matching the
RISK-P0-02.1/updateAgentRiskScore precedent from earlier this session).

**Built (Access Agent's half — see that module's own audit log entry
for the full detail):**
- `access_requests.request_type` (migration `0060`, `'grant'`/`'modify'`,
  default `'grant'` — every existing row and every caller that doesn't
  pass a type keeps today's exact behavior).
- `getAccessGrant(tenantId, grantId)` and `getEntitlement(tenantId,
  entitlementId)` — new published lookups so a caller outside Access's own
  module can resolve which application/entitlement a grant belongs to
  without querying Access's tables directly (non-negotiable #6).
- `createAccessRequest()` gained an optional `requestType` parameter
  (default `'grant'`, fully backward compatible).

**Built (Compliance's half):** `decisions.ts`'s `modify` branch now: (1)
resolves `item.accessGrantId → getAccessGrant() → getEntitlement()` to
find the application/entitlement being modified; (2) calls
`createAccessRequest(tenantId, actorId, item.agentId,
entitlement.applicationId, entitlement.id, justification, "modify")`; (3)
sets the decision's `remediationId` to the new request's id — same
pattern `revoke` already used for `access_grants`. Two failure paths
stay audit-only (no request created), matching `revoke`'s own existing
"no specific grant" precedent: no `accessGrantId` on the item at all, or
the grant/entitlement can't be resolved (e.g. already deleted).

**Verification:** new `modules/certification-compliance/decisions.test.ts`
(3 tests: successful resolution creates the request with the exact
arguments and sets `remediationId`; no `accessGrantId` → audit-only,
`createAccessRequest` never called; unresolvable grant → audit-only,
`createAccessRequest` never called). Full pipeline: `npm run typecheck`
clean, `npm run lint` clean, `npx vitest run` 239/239 (up from 236), `npm
run build` clean, no service-role-key leakage. Migration applied live to
the dev Supabase project.

---

## 2026-09-16 — COMPLIANCE-P0-02.2 fully resolved: live policy-violation status

Previously `Partial`: `addControlEvidence()`'s status computation only
considered evidence recency, not live policy-violation state, because
neither Access nor Risk published a policy-scoped (as opposed to
agent-scoped) violation query. Resolved as part of the user's "any P0 item
open to work?" pass, same self-contained cross-module pattern as
COMPLIANCE-P0-01.3 above.

**Built (Access Agent's half — see that module's own audit log entry):**
`hasOpenPolicyViolation(tenantId, policyId)` (`modules/access-governance/
evaluate.ts`) — queries `policy_evaluations` for the given policy, keeps
only each evaluated agent's most recent row (ordered `evaluated_at desc`,
first-seen-per-agent), and returns true if any of those latest results is
`'violation'`. Deliberately NOT capped by `DEFAULT_LIST_LIMIT` — a flat
cap could let one frequently-re-evaluated agent's rows crowd another
agent's out of the window, silently hiding a real violation; same
correctness-first exception class as `getFindings()`/`listCampaignItems()`/
`listControlMappings()`.

**Built (Compliance's half):** `addControlEvidence()` now computes
`non_compliant` when the mapping's `policyId` currently has an open
violation, unless the caller supplies an explicit `manual_attestation`
(which still always wins — a human call overrides the automated signal).
`not_applicable` remains manual-attestation-only, since there's still no
automated "this control doesn't apply here" signal.

**Also resolved in the same pass** (same underlying data source,
`applications.is_external`, from `ACCESS-P0-02.2`): `evaluate.ts`'s
`agentFacts["agent.external_communication"]` — previously always
`undefined` — is now real, computed from whether the agent's effective
access includes any application marked external. This is Access's
deterministic policy-rule-evaluation engine's own fact (a policy rule can
condition on it), a different use of the same underlying flag from Risk's
scoring factor.

**Verification:** new `modules/access-governance/evaluate.test.ts` (5
tests covering the "most recent per agent" dedup logic, including the
stale-violation-superseded-by-a-pass case) and new
`modules/certification-compliance/controls.test.ts` (4 tests: violation
→ `non_compliant`; no violation → `compliant`; no `policyId` → live check
skipped entirely; manual attestation always wins). Full pipeline: `npm
run typecheck` clean, `npm run lint` clean, `npx vitest run` 248/248 (up
from 239), `npm run build` clean, no service-role-key leakage. No schema
change needed.

## 2026-09-16 — COMPLIANCE-P0-01.2: real population logic for all 4 remaining scope types

**User decision (bucket B, "continue uninterrupted" pass):** "Build all 4
(Recommended)" — real population logic for `application`, `entitlement`,
`privileged_access`, `high_risk_agent`, not a stub/deferred spec.

**Built:** `modules/certification-compliance/campaigns.ts` — extracted the
`agent`-scope population loop (previously inlined) into a shared
`populateCertificationItems(tenantId, campaignId, agents, input,
grantFilter?)` helper, then gave each of the 4 previously-unimplemented
scope types a real branch in `launchCampaign()`:

- `application` — every agent, grants filtered to
  `grant.applicationId === scope.applicationId`.
- `entitlement` — every agent, grants filtered to
  `grant.entitlementId === scope.entitlementId`.
- `privileged_access` — every agent, grants filtered to
  `grant.privilegeLevel === "elevated" || "admin"`.
- `high_risk_agent` — agents filtered by `agents.risk_score >= threshold`
  (no grant filter — every grant for a qualifying agent is certified).
  `threshold` defaults to `50`, deliberately reusing Risk Agent's own
  `scoring.ts` "high" severity band lower bound rather than inventing a
  new number, overridable via `scope.minRiskScore`.

`application`/`entitlement` scope input is now validated (via Access
Agent's `getApplication()`/`getEntitlement()`) **before** the
`certification_campaigns` row is inserted — a correctness improvement over
the prior insert-first ordering, so invalid scope input never leaves
behind an empty, orphaned campaign.

**Consumed (Access Agent's newly-extended contract — see that module's own
audit log entry):** `AccessGrant.applicationId` and `AccessGrant.privilegeLevel`
— both denormalized fields Access Agent's `getEffectiveAccess()`/
`getAccessGrant()` now populate at read time (joined from `entitlements`),
alongside the pre-existing `application`/`entitlementName`/
`dataClassification` fields. No schema change on Compliance's own tables.

**UI scope, deliberate:** `app/(customer)/compliance/campaigns/page.tsx`
(the bare functional campaign-launch page) is left exposing only
`scope_type` and a `criticality` text field for this pass. Adding form
inputs for `applicationId`/`entitlementId`/`minRiskScore` is UI polish
belonging to Experience Agent's composition pass per CLAUDE.md §13's "bare
functional page" allowance — this story's acceptance criteria is the real
population *logic*, reachable today via the service/API layer for all 5
scope types, not the customer-facing form.

**Verification:** new `modules/certification-compliance/launchCampaign.test.ts`
(7 tests: `application`/`entitlement` scope validation-before-insert
rejections, correct per-scope grant filtering for all 4 new scope types,
`high_risk_agent`'s default and custom `minRiskScore` threshold behavior).
Existing `campaigns.test.ts` (4 tests, pure `computeRecommendation` cases)
unaffected. Full pipeline: `npm run typecheck` clean, `npm run lint`
clean, `npx vitest run` 255/255 (up from 248), `npm run build` (with
`.next` deleted first) clean, `grep -rl SUPABASE_SERVICE_ROLE_KEY
.next/static` — no match. No schema change.

## 2026-09-16 — COMPLIANCE-P0-05: real Vercel Cron scheduler for escalateOverdueItems()

**User decision (bucket B, "continue uninterrupted" pass):** "Add pdf-lib
(Recommended)" was for OPERATIONS-P0-07 (separate task); for this story,
the standing "any P0 item open to work?" sweep flagged the previously
missing scheduler as pure-code fixable now (no product decision needed) —
Vercel Cron is already the platform's own hosting choice (CLAUDE.md's
Locked Architecture, §2), so wiring `vercel.json`'s native `crons` config
was the natural, non-speculative choice, not a new infrastructure
dependency.

**Built:**
- `modules/certification-compliance/escalation.ts` — new
  `escalateOverdueItemsForAllTenants(): Promise<EscalationSweepResult[]>`.
  Reads `tenants` (Foundation's canonical schema; a plain unfiltered id
  read, not a Platform-Administration operation, so queried directly
  rather than duplicating another module's service) for every
  `status = 'active'` tenant, then calls the existing per-tenant
  `escalateOverdueItems(tenantId, null)` for each (actorId null →
  `writeAudit`'s existing `actorType: "system"` branch, unchanged).
  Each tenant's escalation is isolated in its own try/catch — one
  tenant's failure is recorded in its own result row (`error` set)
  rather than aborting the sweep for every other tenant, so a bug or
  transient failure scoped to one tenant can never silently suppress
  escalation for the rest.
- `app/api/cron/compliance-escalate-overdue/route.ts` (new) — `GET`
  handler (Vercel Cron always sends `GET`), deliberately outside both
  `/api/v1/*` (customer-facing, resolves tenant from a user session —
  there is no session here) and `/api/platform/v1/*` (vendor-admin
  session). Authorization is a `CRON_SECRET` bearer token compared with
  `node:crypto`'s `timingSafeEqual` (same reasoning Integration Agent's
  webhook HMAC check already established in
  `modules/integrations/webhooks.ts` — a length-checked, constant-time
  comparison rather than `===`). A missing/unset `CRON_SECRET` refuses
  every request (401) rather than silently allowing unauthenticated
  cross-tenant escalation.
- `vercel.json` (new) — `crons: [{ path: "/api/cron/compliance-escalate-
  overdue", schedule: "0 6 * * *" }]` (daily, 06:00 UTC).
- `.env.local.example` — documents `CRON_SECRET` alongside the project's
  other server-only secrets.
- `app/api/v1/compliance/campaigns/escalate-overdue/route.ts` — doc
  comment updated; the operator/API-triggered per-tenant sweep is kept
  as-is (still useful for an admin who wants on-demand escalation
  without waiting for the daily cron), now cross-referencing the new
  automatic path.

**Verification:** `modules/certification-compliance/escalation.test.ts`
extended with 3 new tests for `escalateOverdueItemsForAllTenants()`
(sums counts across multiple active tenants; isolates and reports one
tenant's query failure while still sweeping the rest; empty-tenant-list
sweep returns `[]`) — the existing 3 `escalateOverdueItems()` tests
unaffected. No route-level test added: consistent with this codebase's
established pattern of testing only at the module/service layer, never
`route.ts` handlers directly (verified no other route in the repo has a
`route.test.ts`). Full pipeline: `npm run typecheck` clean, `npm run
lint` clean, `npx vitest run` 258/258 (up from 255), `npm run build`
(with `.next` deleted first) clean — confirmed the new
`/api/cron/compliance-escalate-overdue` route appears in the build
output — `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` and `grep -rl
CRON_SECRET .next/static` both no-match. No schema/migration change.
