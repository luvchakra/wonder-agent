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
