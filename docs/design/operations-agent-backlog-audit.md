# Operations Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — Full P0 backlog (first run, including the 2026-09-14 requirements refresh)

**Agent:** Operations Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Per the user's explicit "continue automatically" instruction, this module
had never been dispatched before this session — every row in its Progress
Tracker was `Not Started`. Built the full P0 backlog in one pass, auto-
chained from Platform Agent.

**Built:**

- **OPERATIONS-P0-01.1 (Audit log viewer)** — `listAuditLogs()`
  (`modules/operations/audit.ts`): keyset-paginated (`created_at` cursor,
  per CLAUDE.md §15) filterable read over Foundation's `audit_logs`, gated
  on a new `audit.read` permission (this codebase had no permission
  gating audit reads before this story — `audit_logs` itself only enforced
  tenant scoping via RLS). Read-only, never writes to `audit_logs` —
  `writeAudit()` remains the sole writer. `GET /api/v1/audit` and a bare
  `/audit` page (filter form + pagination).
- **OPERATIONS-P0-01.2 (Evidence export)** — `exportAuditLogs()`
  (capped at 5,000 rows — a genuinely unbounded/background export is a P1
  concern) plus a minimal CSV serializer (`modules/operations/csv.ts`, no
  new dependency). `GET /api/v1/audit/export?format=csv|json`, gated on
  `report.export` (already existed, Foundation migration `0003`) — same
  permission every other export path in this codebase already uses.
- **OPERATIONS-P0-02.1 (Notifications schema & channels)** — new
  `notifications` table (migration `0048`): `user_id = null` means a
  tenant-wide broadcast, exactly the story's own schema convention;
  client SELECT policy allows a user to see their own targeted rows plus
  every broadcast; UPDATE (mark-read) is scoped to the row's own
  `user_id = auth.uid()`; no client INSERT policy at all — `notify()` is
  the only writer, via the service-role client. **In-app channel**: real
  and fully working (`listNotifications()`, `markNotificationRead()`,
  `GET /api/v1/notifications`, `POST /api/v1/notifications/:id/read`).
  **Email channel**: not implemented. Checked first, not assumed — no
  transactional email provider or send-email utility exists anywhere in
  this project's `lib/*`/`modules/*`, and the backlog's own instruction is
  explicit: "do not add a new email infrastructure dependency without
  asking." Recorded as an open dependency for the user.
- **OPERATIONS-P0-02.2 (`notify(event)` and trigger wiring)** —
  `notify()` (`modules/operations/notifications.ts`) is the published
  entry point: writes the notification row via the service-role client,
  never throws (same never-fails-the-caller discipline as
  `writeAudit()`). **Not wired**: this module does not poll for trigger
  conditions itself (per the story's own instruction) — each producing
  module is expected to call `notify()` at the moment its own event
  occurs (e.g. Risk Agent calling `notify({type: 'critical_finding', ...})`
  right after inserting a `critical` finding). Unlike a not-yet-built
  module, Risk/Compliance/Identity/Integration are all *already* built
  this session — none of them currently calls `notify()`. Recorded here,
  explicitly, per the story's own instruction to record this hand-off "so
  producing modules know the contract exists" — wiring each module's own
  trigger point is that module's story to pick up, per non-negotiable
  #18 (Operations Agent does not reach into Risk Agent's `rules.ts` or any
  other module's file to add the call itself).
- **OPERATIONS-P0-03.1/03.2 (Global search, higher bar)** —
  `search(tenantId, permissions, query)` (`modules/operations/search.ts`)
  fans out to each domain module's own tenant-scoped list contract
  (`listAgents`, `listApplications`, `getFindings`, `listCampaigns`,
  `listPolicies`, `listIntegrations`) — never a separate denormalized
  index. **Permission-gated at the query layer, not the UI**: each object
  type is only queried (and can therefore only ever appear in results) if
  `permissions.includes()` the object type's own real read permission —
  verified live below against the story's own literal acceptance test.
  **Traceability/masking (03.2)**: every result carries a `freshness`
  timestamp; `agent`- and `finding`-type results carry a `riskSeverity` +
  `riskMasked` pair — `riskMasked: true` (with `riskSeverity: null`) when
  the caller lacks `risk.read`, distinct from a caller who *can* see it
  simply having no open finding — via a pure, unit-tested
  `maskRiskField()`. **Scope, flagged rather than silently assumed**: the
  backlog's object-type list also names "identity," "owner" and
  "entitlement" — none of Identity's or Access's published contracts
  expose a tenant-wide (as opposed to per-agent/per-application) list for
  these, so implementing them here would mean reaching into their
  internal schema rather than composing an existing contract
  (non-negotiable #6); 6 of 9 named types are implemented, each backed by
  a real contract. A bare `/search` page exists as this module's own
  directly-reachable surface, independent of Experience Agent's shell
  search entry point (`ShellGlobalSearch`, currently a placeholder pending
  this module — now that this module exists, wiring that shell button to
  the real `search()` contract is Experience Agent's to do next time it
  runs; this module does not touch `app/(customer)/layout.tsx`'s
  Experience-owned search component itself).
- **OPERATIONS-P0-04.1/04.2 (P0 report set + traceability)** — all eight
  named reports (`modules/operations/reports.ts`): AI Agent Inventory,
  Ownership, Access Certification, Rogue Agent, Access Violation, Risk,
  Audit Evidence, Policy Compliance — each computed live at request time
  from the owning module's existing contract, never cached (so a later
  requester can never see stale or cross-tenant data). Rogue Agent vs.
  Access Violation is an explicit, documented partition of Risk's eight
  `RogueCategory` values (behavioral_deviation/identity_anomaly/
  ownership_violation/lifecycle_violation vs. excessive_access/
  unauthorized_resource/unauthorized_action/sensitive_data_violation) —
  not a Risk Agent contract change. Every report carries `generatedAt`
  and every row a drill-through `href` to the underlying record
  (04.2's traceability requirement — this did not change the underlying
  live-computation model, exactly as the story anticipates). New
  `reports` table (migration `0048`) stores saved report *definitions*
  only (filter/format), never generated output. `GET /api/v1/reports/:type`
  (live), `GET /api/v1/reports/:type/export` (CSV/JSON, `report.export`),
  `GET`/`POST /api/v1/reports` (saved definitions, `report.read`). Bare
  `/reports` and `/reports/:type` pages, replacing the earlier
  `NotYetAvailable` placeholder Experience Agent had pre-built for this
  exact route.
- **OPERATIONS-P0-05.1 (Notification preferences)** — new
  `notification_preferences` table (migration `0048`, tenant+user-scoped,
  RLS restricted to `user_id = auth.uid()`) — added to the ownership map
  directly (it was previously listed there as "Planned"), same as every
  other module's own-owned table this session; not treated as requiring a
  separate user sign-off cycle since it duplicates no other module's
  concept, per the established precedent every other module this session
  followed for its own new tables. `setNotificationPreference()` rejects
  outright (`400 MANDATORY_NOTIFICATION_TYPE`) any attempt to set
  `inAppEnabled`/`emailEnabled` to `false` for one of the seven P0
  notification types — all seven are mandatory per `OPERATIONS-P0-02.1`'s
  own schema, so there is currently no notification type an optional
  preference could actually apply to; the enforcement mechanism is real
  and live-verified, the bare `/settings/notifications` page shows every
  P0 type as locked-on rather than a togglable control (an honest
  reflection of "nothing optional exists yet," not a missing feature).
- **OPERATIONS-P0-06.1 (Operational job reporting)** —
  `getJobStatusSummary(tenantId)` (`modules/operations/jobs.ts`) fans out
  per integration over Integration Agent's existing `listSyncJobs()`
  (owned by Integration Agent; this module never queries
  `integration_sync_jobs` directly) to compute last-successful-run,
  last-run status, 30-day failure count and total retries per
  integration. `GET /api/v1/jobs/status`. **Not built**: a dedicated
  customer-facing page — published and API-reachable, but no page this
  session (an explicit scope cut given this module's already large P0
  surface, not an oversight).
- New permission `audit.read` (gates the audit viewer; granted to
  `TENANT_SUPER_ADMIN`/`IAM_ADMIN`/`IAM_ARCHITECT`/`SECURITY_ADMIN`/
  `AUDITOR`/`CERTIFICATION_MANAGER`, mirroring the read-only-role pattern
  every other module's own `*.read` permission already uses) and
  `notification.manage` (gates the preferences/in-app-notifications
  surface; granted broadly since it gates a personal-settings feature,
  not a privilege tier). `report.read`/`report.export` already existed
  (Foundation migration `0003`) and were reused as-is, not duplicated.

**Verification run:**
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean on the
  first pass. Every new route confirmed present in the build output:
  `/api/v1/audit`, `/api/v1/audit/export`, `/api/v1/notifications`,
  `/api/v1/notifications/:id/read`, `/api/v1/notification-preferences`,
  `/api/v1/search`, `/api/v1/reports`, `/api/v1/reports/:type`,
  `/api/v1/reports/:type/export`, `/api/v1/jobs/status`, `/audit`,
  `/reports`, `/reports/:type`, `/search`, `/settings/notifications`.
- `npx vitest run` — 139/139 passing across 23 files. New:
  `search.test.ts` (`maskRiskField()` — masked vs. visible-but-empty are
  provably distinct outcomes) and `csv.test.ts` (`toCsv()` — empty input,
  header+rows, comma/quote/newline escaping, null/undefined rendering).
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match.
- Live-verified against the dev Supabase project (Supabase MCP, project
  `ekgyjwoenteadaaqakmd`), after applying migration `0048`: the
  `audit.read`/`notification.manage` role grants match the intended role
  list exactly. `notifications`: a broadcast (`user_id: null`) and a
  targeted row were both visible to Tenant A5's fixture user (2 rows)
  and invisible to Tenant B5's fixture user (0 rows, tenant isolation); a
  same-tenant client `INSERT` was rejected (no INSERT policy — `notify()`
  must go through the service-role client); a cross-tenant/wrong-user
  `UPDATE` (mark-read) affected 0 rows while the actual targeted user's
  own `UPDATE` affected 1. `notification_preferences`: A5's user could
  upsert their own row; B5's user saw 0 rows and a forged insert
  impersonating A5's user was rejected. `reports`: A5's user could insert
  their own saved-definition row; B5's user saw 0 rows. All throwaway
  rows cleaned up. `get_advisors` (security) re-checked after the
  migration — no new findings beyond the same pre-existing accepted set
  every prior module already reviewed (the three new tables' own RLS
  policies mean they don't even appear in the `rls_enabled_no_policy`
  INFO list, unlike the intentionally-policy-less `platform_*` tables).
- **Not done**: authenticated, interactive real-browser verification of
  the new pages (filtering the audit viewer, running a search, viewing a
  report) — this sandbox has no seeded authenticated session/credentials
  to drive a real login, the same constraint already recorded against
  Experience Agent's own UI stories this session.

**Not started this session / still open:**
- Email notification delivery — no transactional email provider is wired
  into this project; flagged for the user, not guessed at.
- No producing module (Risk, Compliance, Identity, Integration) calls
  `notify()` yet, even though all four already exist — each is a
  follow-up story for that module's own agent to pick up, not something
  Operations Agent retrofits into another module's files.
- Search's identity/owner/entitlement object types — no tenant-wide
  read contract exists yet in Identity's or Access's published service;
  would need those modules to publish one first.
- A dedicated `/jobs` or job-status customer page — the service function
  and API route exist; no page this session.
- Experience Agent's shell search entry point (`ShellGlobalSearch`) still
  shows its placeholder — wiring it to this module's real `search()` is
  Experience Agent's own next-dispatch task, not something this module
  reaches into `app/(customer)/layout.tsx`/`modules/ui/*` to do itself.

**Dependencies consumed:** Foundation's `requirePermission()`,
`getTenantContext()`, `supabaseServer()`/`supabaseServiceRole()`,
`audit_logs`(read)/`writeAudit()`(for `reports.ts`'s own save-definition
audit event); Identity's `listAgents()`, `listOwners()`; Access's
`listApplications()`, `listPolicies()`; Risk's `getFindings()`;
Compliance's `listCampaigns()`, `listCampaignItems()`,
`listControlFrameworks()`, `listControls()`, `listControlMappings()`;
Integration's `listIntegrations()`, `listSyncJobs()` — all used exactly as
published, no modification to any other module's file.

**Published this session:** `modules/operations/service.ts` (barrel) and
`lib/shared/types/operations.ts`. Most relevant to near-term dependents:
`notify(event)` for every P0-trigger-producing module (Risk, Compliance,
Identity, Integration) to call once picked up; `search()` and
`getActiveAnnouncements()`-style composition for Experience Agent's shell
search/notifications entry points.

---

## 2026-09-14 — Round 2 requirements re-check against re-uploaded expanded doc

**Agent:** Operations Agent (documentation-only pass — no code, migrations
or tests touched). The user re-uploaded the module requirements document
(`10_AUDIT_REPORTING_OPERATIONS.md`, at
`/root/.claude/uploads/7af02f4f-be08-5f91-b0d5-fc0907e4645c/3964c18a-10_AUDIT_REPORTING_OPERATIONS.md`)
and asked for a fresh, thorough re-check against this newer/expanded copy,
in case it contained stories or acceptance criteria the prior
"Requirements Refresh — 2026-09-14" pass (recorded above) missed.

**Finding: nothing new.** Read the uploaded document in full (260 lines)
and compared it section-by-section against the current
`docs/plan/10-OPERATIONS-AGENT-BACKLOG.md` (Progress Tracker, epics, and
both the original and prior-round Requirements Refresh sections) and this
audit log. Every item in the doc's "Expanded Requirements" list
(`OPS-P0-01` through `OPS-P0-10`, `OPS-P1-01` through `OPS-P1-05`,
`OPS-P2-01` through `OPS-P2-03`) was already represented — either by name
in the existing "Already covered, no new row needed" list, or by an
existing tracked row (`OPS-P0-04`→`OPERATIONS-P0-05.1`,
`OPS-P0-06`→`OPERATIONS-P0-04.2`, `OPS-P0-09`→`OPERATIONS-P0-03.2`,
`OPS-P0-10`→`OPERATIONS-P0-06.1`, all four already in the Progress
Tracker from the prior pass) or by the existing `## P1`/`## P2` sections
(Scheduled Reports, SIEM/ITSM Notifications, Alert Routing, Advanced
Search, Operational Dashboards, Analytics Store, Advanced Retention,
Executive Reporting Automation). The Original Master PRD sections (§29-32)
and the Claude Code Execution Plan/critical-acceptance-test text in the
uploaded doc are unchanged from what this file's backlog already reflects.

The one piece of doc text not previously quoted verbatim — the closing
"Notification safety" note (never place credentials/tokens/raw sensitive
payloads in notification text; link to authorized evidence views instead)
— is a constraint on the already-tracked `OPERATIONS-P0-02.2`, not a new
capability. It is already covered in substance by `CLAUDE.md`
non-negotiable #10 and this module's own "never expose secrets... to the
browser" engineering rule. Spot-checked
`modules/operations/notifications.ts`: no credential/token/secret field is
referenced when constructing a notification's `title`/`body`, consistent
with the safety note. Recorded as a standing constraint on
`OPERATIONS-P0-02.2` in the backlog's new round-2 refresh section rather
than as a new Progress Tracker row (same treatment the first-pass refresh
gave the "runtime events" search-object-type addition on
`OPERATIONS-P0-03.1`).

Also skimmed `modules/operations/*.ts` and `supabase/migrations/0048_*`
(this module's only migration) to sanity-check that nothing the doc
describes was quietly already built without the backlog reflecting it —
found nothing inconsistent with what the Progress Tracker and this log
already state.

**Added to the backlog:** one new section, "## Requirements Refresh —
2026-09-14 (round 2, expanded doc)", at the bottom of
`docs/plan/10-OPERATIONS-AGENT-BACKLOG.md`, documenting this reconciliation
and its "no new stories" conclusion with the item-by-item mapping above.

**Not added:** any Progress Tracker rows. No row's status was changed.
The four known partial gaps this task was told not to re-add (email
channel not wired, `notify()` not yet called by producing modules, search
covering 6 of 9 object types, no dedicated job-status customer page)
remain exactly as already tracked and were not restated as new findings.

**Open question for the user:** none raised by this pass. The
already-open items from the first pass (email provider selection,
producing-module `notify()` wiring, and Identity/Access publishing
tenant-wide list contracts for identity/owner/entitlement search) remain
open exactly as recorded above and are unaffected by this round's
re-check. Note: `docs/design/ownership-map.md` already lists
`notification_preferences` (OA, `OPERATIONS-P0-05.1`, migration `0048`) —
the first-pass refresh's own note flagging that table "for the user to
add" reads as stale against the current ownership map and this log's own
"Built" section, which both confirm it was already added; not re-flagged
here.
---

## 2026-09-16 — OPERATIONS-P0-07 — Governance Evidence Pack export (JSON/CSV; PDF deferred)

**Agent:** Operations Agent, paired with Compliance Agent's
`COMPLIANCE-P0-09` in the same pass, per the user's standing authorization
to work the pending P0 backlog in order. Implements the 2026-09-15
decision: "Compliance assembles, Operations exports."

**Design.** `exportGovernanceEvidencePack(actorId, pack, format)`
(`modules/operations/evidencePackExport.ts`) takes Compliance's already-
assembled `GovernanceEvidencePack` (this module never reaches into
Compliance's or any other module's tables directly — non-negotiable #6)
and turns it into a downloadable file:
- **JSON** — the pack's canonical JSON, verbatim.
- **CSV** — flattened via `flattenEvidencePack()` into one row per
  underlying record (`{section, id, details}`, `details` a JSON blob of
  the record) across every section — identity/owners/identities/lifecycle
  events, access grants/policy evaluations/exceptions, the SHOULD-CAN-DID
  comparison's outcomes, risk findings, certification decisions,
  attestations, control mappings, access requests, audit events, and
  posture dimensions/status — reusing `toCsv()`
  (`modules/operations/csv.ts`, `OPERATIONS-P0-01.2`'s existing serializer)
  rather than building a second one.
- **PDF** — confirmed, not assumed, that no PDF renderer exists anywhere
  in this codebase (`grep -i pdf package.json` — no match) before deciding
  not to build one; adding a PDF library is a real new dependency decision,
  not something to introduce silently inside an unrelated story. Left
  explicitly deferred; `EvidencePackFormat` is typed as `"json" | "csv"`
  only, so a `"pdf"` request is a compile-time error for any future caller
  rather than a silent no-op.

Every export writes exactly one `operations.evidence_pack_exported` audit
event (actor, tenant from the pack, agent as object, format, content hash)
via `writeAudit()` — same tamper-evidence pattern as
`COMPLIANCE-P0-06`'s `exportCampaignEvidence()`: a SHA-256 over the pack's
canonical JSON, computed once regardless of output format so a JSON and a
CSV export of the same pack share the same hash (verified by a test).

**API:** `POST /api/v1/compliance/agents/[id]/evidence-pack?format=json|csv`
lives under Compliance's existing route family (it calls
`assembleGovernanceEvidencePack()` then this module's
`exportGovernanceEvidencePack()`) rather than a new Operations-owned route
— the route itself is Compliance's to own since it's agent-scoped and the
assembly step is Compliance's; this module's contribution is the exported
service function it calls, matching how `OPERATIONS-P0-04.1`'s report
export already works the other direction (an Operations-owned route
calling into other modules' read contracts).

**Verification:**
- `modules/operations/evidencePackExport.test.ts` — 3 tests: JSON content
  matches the pack and audits correctly, CSV flattens every section into
  the expected row count, and JSON/CSV exports of the same pack share one
  content hash.
- `npm run typecheck` / `npm run lint` — clean.
- `npx vitest run` — 188/188 passing.
- `npm run build` (with `.next` deleted first) — clean; confirmed
  `.next/server/app/api/v1/compliance/agents/[id]/evidence-pack/route.js`
  exists.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:** `exportGovernanceEvidencePack()`
(`modules/operations/service.ts`); `EvidencePackFormat`,
`EvidencePackExportResult` (`lib/shared/types/operations.ts`).

**Marked Partial, not Done:** PDF delivery is named in the story title
("PDF/CSV/JSON delivery") and is genuinely not built — see above. JSON/CSV
are fully functional and audited.

---

## 2026-09-16 — exportCampaignEvidencePackage() (unblocks Compliance's COMPLIANCE-P0-06)

**Agent:** Operations Agent (small, paired addition — the actual story
this closes is tracked under Compliance's own backlog as
`COMPLIANCE-P0-06`; see that module's audit log for the full account).

`modules/operations/campaignExport.ts` — `exportCampaignEvidencePackage(
pkg, format)` turns Compliance's already-assembled, already-hashed
`EvidenceExportPackage` (campaign + items + decisions) into a JSON or
flattened CSV file, reusing `toCsv()` — the same serialization
responsibility this module already performs for
`OPERATIONS-P0-07`'s governance evidence pack, applied to campaign
evidence too. Deliberately does **not** compute a content hash or write
an audit event itself: `exportCampaignEvidence()`
(`modules/certification-compliance/export.ts`, unchanged) already does
both at assembly time, and a second audit event for the same export
action would misrepresent one export as two.

**Verification:** `modules/operations/campaignExport.test.ts` — 2 tests.
Full pipeline (typecheck/lint/`npx vitest run` 204/204/build/secret-leak
check) run as part of Compliance's own pass — see that module's audit log
entry for the complete verification record; not re-run separately here to
avoid a redundant, identical second pipeline execution for the same
commit.

**Published this session:** `exportCampaignEvidencePackage()`
(`modules/operations/service.ts`).

---

## 2026-09-16 — notify() wiring (OPERATIONS-P0-02.2) + customer-facing job-status page (OPERATIONS-P0-06.1)

**Agent:** Operations Agent, per the user's standing authorization to
wire `notify()`, build the job-status page, and re-check search unblocks.

**notify() wiring — 3 of 7 event types, across 3 producing modules.**
`OPERATIONS-P0-02.2`'s own docstring names the exact worked example this
pass followed: "Risk Agent calls `notify({type: 'critical_finding', ...})`
right after inserting a `critical` `risk_findings` row." Each call was
added inside the producing module's own file, at its own single
create/write event, not invented from outside:
- **Risk** (`modules/risk/findings.ts`) — `createOrUpdateFinding()`'s two
  write paths (fresh creation, and reopening a `false_positive`-resolved
  finding whose expiry passed) both now call a new local
  `notifyForFinding()` helper: `critical_finding` when `severity ===
  'critical'`, `rogue_agent` when the category is one of the four
  behavioral/identity/ownership/lifecycle categories (same local-constant
  pattern this session's `RISK-P0-04` entry already documented as an
  accepted, non-canonical convention in this codebase — Risk Agent has no
  exported "rogue categories" constant of its own either). Deliberately
  **not** fired on a routine re-evaluation refresh of an already-open
  finding (same status, just refreshed evidence) — only on a genuinely
  new alert-worthy state change, so `evaluateAgentRisk()` running
  repeatedly doesn't re-notify on every pass.
- **Integration** (`modules/integrations/syncJobs.ts`) —
  `runSyncJob()`'s two failure paths (a completed run whose `finalStatus`
  resolves to `'failed'`, and the outer `catch` for an unhandled
  exception) both call `notify({type: 'integration_failure', ...})`.
  Deliberately **not** fired for `'partial'` (some records still
  imported) — that's visible on the new job-status page without an
  alert-level interrupt.
- **Compliance** (`modules/certification-compliance/escalation.ts`) —
  `escalateOverdueItems()` calls `notify({type: 'certification_overdue',
  ...})` per escalated item, targeted at the specific `escalatedTo` user
  (not a tenant-wide broadcast) since that's exactly who the event is
  actionable for.

**Deliberately left unwired** — `certification_due`, `ownership_missing`,
`lifecycle_expiry`. Checked each for an unambiguous single write-event
trigger point before deciding not to guess:
- `certification_due` fires structurally inside Identity's
  `maybeMarkCertificationDue()`, which is called from read paths
  (`getAgent()`/`listAgents()`) rather than a discrete user- or
  system-initiated write event — wiring a notification into a function
  invoked on every read would misrepresent "someone viewed this agent" as
  "an event occurred."
- `ownership_missing` is a *detected condition*
  (`getOwnershipIssues()`), not a discrete event with one clear moment it
  "happens" — it could fire on agent registration, on every owner
  removal, or periodically, and this codebase has no scheduler to run a
  periodic check with (the same gap `COMPLIANCE-P0-05` already
  documents).
- `lifecycle_expiry` has no single field it unambiguously means —
  candidate sources (`nextReviewAt`, `retirementDate`) overlap
  conceptually with `certification_due`/`certification_overdue` without a
  specified distinction.

Per non-negotiable #18/CLAUDE.md §3 ("if unsure whether something is a
required extension point or genuine scope creep, treat it as scope
creep"), inventing a specific trigger design for these three on Identity's
behalf would be guessing at that module's own architecture. Recorded here
as the concrete remaining gap rather than silently left unexplained.

**OPERATIONS-P0-06.1 — job-status page, now Done.**
`app/(customer)/integrations/jobs/page.tsx` composes the already-published
`getJobStatusSummary()` into a real table (integration name, last run
status/time, last successful run, 30-day failure count, total retries),
added to the Integrations nav group as "Job Status." No new data logic —
pure composition, per Experience Agent's own ownership boundary, built
here since it was this story's own explicitly-flagged scope cut.

**OPERATIONS-P0-03.1 — search unblock re-checked, still genuinely
blocked.** Re-read `modules/agent-identity/identities.ts` and `owners.ts`:
`listAgentIdentities()`/`listOwners()` remain agent-scoped only (require
an `agentId`), same as when this was first documented — no tenant-wide
"list all identities/owners across every agent" contract has been
published. `modules/access-governance/entitlements.ts` similarly only
exposes `listEntitlementsForApplication()` (application-scoped), not
tenant-wide. Building any of these three would mean querying another
module's tables directly, which this module doesn't do. Left `Partial`,
unchanged.

**Verification:**
- `modules/risk/findings.test.ts` — 4 new tests for `notifyForFinding()`
  (exported for direct testability): critical-only, rogue-only, both when
  a finding is both critical and rogue, neither for an unremarkable
  finding.
- `modules/certification-compliance/escalation.test.ts` (new) — 3 tests:
  notifies the escalated-to user, falls back to the campaign creator when
  there's no business owner, notifies nothing when there's nothing
  overdue.
- `npm run typecheck` / `npm run lint` — clean, including across the two
  new Risk→Operations and Integration→Operations circular module
  references (both already-established patterns this session, per the
  `COMPLIANCE-P0-09` audit entry's precedent).
- `npx vitest run` — 214/214 passing (up from 207).
- `npm run build` (with `.next` deleted first) — clean; confirmed
  `/integrations/jobs` compiled.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:** none new from Operations itself — `notify()`
was already published; the new call sites live in the producing modules'
own files. `notifyForFinding()` is a newly-exported (for testability)
helper in `modules/risk/findings.ts`.

---

## 2026-09-16 — pagination pass (QA-P0-04.3 follow-up, user-prioritized "what's left before launch")

Capped 1 previously-unbounded query with the new shared
`DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`, 200): `savedReports.ts`'s
`listSavedReportDefinitions()`. `audit.ts`'s `listAuditLogs()` and
`notifications.ts`'s `listNotifications()`/its own `.limit(100)` were
already real/bounded before this pass (QA's original finding excluded
them) and were the precedent this pass's shared constant follows.

---

## 2026-09-16 — OPERATIONS-P0-02.1 email channel resolved (Resend)

Previously `Partial`: the backlog explicitly forbade adding a new email
infrastructure dependency without asking. User picked Resend as part of
the same "what's left before launch" prioritization pass (after the
pagination pass, §above).

**Built:**
- `lib/db/env.ts` — `getResendApiKey()`/`getResendFromEmail()`, both
  deliberately optional (same shape as `getPlatformOpenAiApiKey()`): a
  deployment with neither set stays in-app-only, no crash, no error.
- `modules/operations/email.ts` — `sendNotificationEmail(event)`,
  internal-only (never exported via `service.ts`; `notify()` is the only
  caller). Calls Resend's REST API directly via `fetch()` (no new npm
  dependency, matching this codebase's minimal-dependency ethos — same
  choice already made for OpenAI/Gemini). Never throws (mirrors
  `writeAudit()`/`notify()`'s own discipline). Recipient resolution:
  `event.userId` set → that one user; unset → every active
  `tenant_memberships` row for the tenant (the same broadcast semantics
  the in-app channel already uses), each filtered by their
  `notification_preferences.email_enabled` (defaults to on when no row
  exists, per OPERATIONS-P0-05.1's own documented default). Since every
  P0 notification type is mandatory in this build, `email_enabled` can
  never actually be set to `false` via `setNotificationPreference()`
  today — so in practice every recipient always gets the email — but the
  real preference row is still read rather than hard-coded, so this stays
  correct once a non-mandatory (P1) type exists.
- `notifications.ts`'s `notify()` now calls `sendNotificationEmail(event)`
  after the in-app insert. Deliberately NOT wrapped in `next/server`'s
  `after()` — `notify()`'s call graph includes deep service-layer chains
  outside any request scope (e.g. `evaluateAgentRisk() →
  createOrUpdateFinding() → notifyForFinding() → notify()`), and `after()`
  throws when called outside an active request. Awaited inline instead;
  the added latency (a single Resend call, or `Promise.all()`'d for a
  broadcast) was judged an acceptable trade-off against the real risk of
  a genuinely fire-and-forget promise getting cut off mid-flight in a
  serverless invocation before delivery completes.
- `.env.local.example` documents `RESEND_API_KEY`/`RESEND_FROM_EMAIL`.
- `/settings/notifications`'s existing copy ("Email: On (mandatory)")
  already accurately described this intended behavior — updated its code
  comment only, no UI change needed.

**Verification:**
- New `modules/operations/email.test.ts` (6 tests): silent no-op when
  unconfigured; targeted-user send with the exact Resend request body
  asserted; tenant-wide broadcast to every active member; a recipient
  with `email_enabled: false` excluded; a non-OK Resend response and a
  rejected `fetch()` both resolve without throwing.
- `npm run typecheck` clean, `npm run lint` clean, `npx vitest run`
  232/232 (up from 226), `npm run build` (with `.next` deleted first)
  clean, `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` no match.

Progress Tracker: OPERATIONS-P0-02.1 moves from `Partial` to `Done`.
OPERATIONS-P0-02.2's own text updated to point at this resolution rather
than the old "enqueue" language.

## 2026-09-16 — OPERATIONS-P0-07: real PDF renderer for the Governance Evidence Pack

**User decision (bucket B, "continue uninterrupted" pass):** "Add pdf-lib
(Recommended)" — a new npm dependency, explicitly approved rather than
building a hand-rolled PDF writer or continuing to defer the format.

**Built:**
- `pdf-lib` added to `package.json`/`package-lock.json` (5 packages
  total including its own small dependency tree — `@pdf-lib/standard-
  fonts`, `@pdf-lib/upng`, `pako`, etc.).
- `modules/operations/evidencePackPdf.ts` (new) — `renderEvidencePackPdf(pack):
  Promise<Uint8Array>`. Renders one section per `GovernanceEvidencePack`
  category (identity, effective access & policy, SHOULD/CAN/DID, risk
  findings, certification decisions, attestations, control mappings,
  remediation, posture) as a human-readable summary line per record —
  deliberately not a raw-field dump (the JSON export already serves that
  need); paginates automatically via a small `PageWriter` helper when a
  page fills up, and strips characters outside `StandardFonts.Helvetica`'s
  WinAnsi range (free-text justification/reason fields could otherwise
  throw and abort the whole export).
- `modules/operations/evidencePackExport.ts` — `exportGovernanceEvidencePack()`
  gains a `"pdf"` branch (`contentType: "application/pdf"`), calling the
  new renderer. `contentHash` is still computed once, over the pack's
  canonical JSON, regardless of output format — a JSON, CSV and PDF
  export of the same pack now all share the same hash, extending the
  existing JSON/CSV invariant to the new format rather than special-casing
  it.
- `lib/shared/types/operations.ts` — `EvidencePackFormat` gains `"pdf"`;
  `EvidencePackExportResult.content` widened to `string | Uint8Array`
  (PDF bytes vs. JSON/CSV text).
- `modules/operations/campaignExport.ts` — `exportCampaignEvidencePackage()`'s
  (COMPLIANCE-P0-06, a distinct campaign-scoped export, not this story's
  agent-scoped pack) `format` parameter narrowed to `Exclude<EvidencePackFormat,
  "pdf">`, since widening `EvidencePackFormat` would otherwise let a
  future caller silently pass `"pdf"` into a function with no PDF branch
  — it would fall through to the JSON branch while still claiming a
  `.pdf` filename and the JSON content type. No renderer built for that
  shape in this pass; out of this story's scope.
- `app/api/v1/compliance/agents/[id]/evidence-pack/route.ts` — accepts
  `?format=pdf`, returns the PDF bytes as the response body (`Buffer.from()`
  wrapping the `Uint8Array` for `NextResponse`'s `BodyInit` typing) with
  `Content-Type: application/pdf` and a `Content-Disposition: attachment`
  header, same pattern the existing `csv` branch already used.
- `app/api/v1/compliance/campaigns/[id]/export/route.ts` — untouched
  behaviorally; its `"csv" as EvidencePackFormat` cast was replaced with
  a direct `"csv"` literal (now narrower-typed) and its `NextResponse`
  body cast updated for the widened `EvidencePackExportResult.content`
  type, no functional change.

**No UI wiring in this pass:** no page in the repository calls the
evidence-pack export route yet (confirmed via search) — it has been
API-level-only since COMPLIANCE-P0-09/OPERATIONS-P0-07 were built, and
stays that way here; Experience Agent's composition pass is where a
"download PDF/CSV/JSON" control would be added.

**Verification:** `modules/operations/evidencePackExport.test.ts`
extended with 2 new tests (PDF output starts with the `%PDF-` signature
and shares its content hash with the JSON export of the same pack; a
pack with every section empty still renders without throwing). Existing
JSON/CSV tests updated only for the now-widened `content` type (`as
string` casts where the test already knew the format was text).
`modules/operations/campaignExport.test.ts` similarly updated for the
widened type, no behavioral change. Full pipeline: `npm run typecheck`
clean, `npm run lint` clean, `npx vitest run` 260/260 (up from 258), `npm
run build` (with `.next` deleted first) clean, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` no match. No schema/migration
change.

## 2026-09-19 — OPERATIONS-P0-03.1: the last three search object types

Closed the gap this row had carried since it was first built: "identity"
and "owner" and "entitlement" were three of the nine named search object
types with no tenant-wide list contract to compose. Rather than leave it
recorded-and-blocked indefinitely, published the missing contracts in
their owning modules (`docs/design/identity-agent-backlog-audit.md` and
`docs/design/access-agent-backlog-audit.md`, both dated today) and wired
them in here:

- **`identity`** — `listIdentitiesForTenant()`. Matches on the identity's
  `externalReference` (the service-account email/client ID an
  administrator would actually search for); titled by it, subtitled by
  the owning agent's name, linked to `/agents/{agentId}`.
- **`owner`** — `listOwnersForTenant()`. Matches on the owner's display
  name OR email; titled by display name (falling back to email when unset
  — not every `users` row has one), subtitled by `"{owner type} of {agent
  name}"`, linked to `/agents/{agentId}`.
- **`entitlement`** — `listEntitlementsForTenant()`. Matches on the
  entitlement's own name; titled by it, subtitled by its application,
  linked to `/access` (same as the existing `application` result — no
  entitlement-detail route exists to link to more specifically).

`lib/shared/types/operations.ts`'s `SearchObjectType` gained the three new
literals. No UI change needed at all: `ShellSearchAndNotifications.tsx`
already renders `objectType` generically (`r.objectType.replace(/_/g, "
")` as a badge label), so the three new types render correctly with zero
Experience Agent involvement.

**Verified:** typecheck, lint clean. New `modules/operations/search.test.ts`
coverage (this file previously tested only the pure `maskRiskField()`
helper, never `search()` itself) — 11 tests: empty-query short-circuit,
each new type matches on its intended field (identity by external
reference, owner by name and separately by email, entitlement by name),
owner's email fallback when no display name is set, permission-gating
proven both ways for the two new permission-gated groups (`agent.read`
withholds identity/owner and the dependency isn't even called;
`access.read` withholds entitlement the same way — the story's own
"never enters the returned array, and don't even fetch it" bar), and one
full sweep asserting all nine named object types are returned together.
Full vitest suite 325/325 (was 317). `npm run build` (fresh `.next`)
clean. No schema/migration change.

**Progress Tracker:** OPERATIONS-P0-03.1 moved from `Partial` to `Done` —
all nine named object types are now implemented, each backed by a real
tenant-wide list function.

## 2026-09-19 (later) — OPERATIONS-P0-02.2: the last 3 trigger types wired

All 7 P0 notification types are now wired. The last three
(`certification_due`, `ownership_missing`, `lifecycle_expiry`) were left
unwired at this module's own original pass specifically because each
needed a real product decision the backlog didn't specify — not a code
gap, a decision gap. At the user's explicit direction ("pick reasonable
defaults, document them clearly"), this pass made those three decisions
and wired all three: `certification_due` and `ownership_missing` in
Identity Agent's own files (`modules/agent-identity/lifecycle.ts`/
`owners.ts` — see that module's audit log), `lifecycle_expiry` in Access
Agent's (`modules/access-governance/policies.ts` — see that module's
audit log).

**This module's own contribution: `wasRecentlyNotified()`**
(`modules/operations/notifications.ts`), a small dedup guard for
exactly one of the three — `lifecycle_expiry`, the only one of the
three whose trigger condition is a passively-true state discovered by a
periodic sweep rather than a discrete write event. Reuses the
`notifications` table itself as the "was this already sent" record
(`type` + `referenceId` already uniquely identifies "this condition, for
this row") rather than adding a bespoke dedup column to Access Agent's
own schema for one caller. The other two triggers are wired at genuine
write events and are naturally idempotent without it (see Identity's
audit log) — this helper is available for a future producing module
that finds itself in the same "sweep, not event" shape, not a general
requirement on every `notify()` caller.

**Verified:** typecheck, lint clean. Full vitest suite 342/342 (was
325 before this whole pass — the increase is split across
`modules/agent-identity/lifecycle.test.ts` (+5), `modules/agent-identity/
owners.test.ts` (new, 4), and `modules/access-governance/policies.test.ts`
(new, 8) — this module's own `notifications.ts` change has no dedicated
new test file since `wasRecentlyNotified()` is exercised through its one
real caller's tests, matching this module's existing pattern for thin
query helpers). `npm run build` (fresh `.next`) clean.

**Progress Tracker:** OPERATIONS-P0-02.2 moved from `Partial` to `Done`.

## 2026-09-25 — OPERATIONS-P0-08: runtime and approval notifications (master P0-41)

**What changed.**

- Two new mandatory notification types, `runtime_alert` and
  `approval_required` (`lib/shared/types/operations.ts`), with migration
  `0066_operations_runtime_notification_types.sql`. The migration is
  additive: it widens the type check constraints on `notifications` and
  `notification_preferences` from 0048, removes nothing, and leaves RLS and
  policies unchanged. It also adds the index
  `(tenant_id, type, reference_id, created_at desc)` for the throttle
  lookup. It was applied to the live project.
- The trigger is Runtime Agent's, per this module's rule that producing
  modules call `notify()` at their own event. See
  `modules/runtime-assurance/decisionNotifications.ts` and the Runtime
  audit log. The rules:
  - Only a decision that actually stopped the agent notifies: DENY or
    REQUIRE_APPROVAL *as enforced*.
  - An observe-only decision told the agent to proceed. Notifying on it
    would imply something was blocked or is waiting on a person when
    nothing is (§17.5), so it stays on the Runtime page only.
  - One notification per agent and type per 15 minutes, via the existing
    `wasRecentlyNotified()`. It is called with a fraction of a day; no
    signature change was needed.
- Search now covers Runtime Gateway decisions (`runtime_decision`, only for
  callers with `runtime.read`):
  - Operations' `search()` goes through Runtime's published
    `listRuntimeDecisions(tenantId, { query })`, never the table directly
    (#6).
  - The match runs in the database under RLS against request id, action,
    tool, application, resource and decision code, newest 25.
  - Before it reaches the PostgREST `or()` filter, the term is reduced to
    `[A-Za-z0-9_.:/@-]`, so it cannot change the filter's structure.
    `searchTerm()` has a unit test for this.
- The notification settings page lists the two new types as locked-on,
  with no code change: it renders `MANDATORY_NOTIFICATION_TYPES`.

**Deliberately left out.**

- "Search covers investigations": the investigations record does not exist
  yet (RISK-P0-12, Risk-owned). It will be added to `search()` in that
  story.
- Approval-required notifications go to the whole tenant, like every other
  P0 type. There is no approval queue behind REQUIRE_APPROVAL yet, so the
  notification points to the Runtime page. Routing to approvers only
  belongs with that queue (P1, per master P1 approvals).
- The throttle check and the insert are not atomic. Two denials for the
  same agent in the same instant can both notify. That is a duplicate
  alert, never a missed one, so it was accepted.

**Verified:**

- `decisionNotifications.test.ts` (new): 7 cases, covering the three
  outcome rules, the throttle, no lookups when nothing is raised, never
  throwing, and the unknown-agent fallback.
- `gateway.test.ts`: the notifier is called once per new decision and
  never on a replay; `searchTerm()` sanitising.
- `search.test.ts`: decisions only with `runtime.read`, through Runtime's
  contract.
- E2E `gateway-enforcement.spec.ts`, 4/4 plus setup:
  - With ENFORCE on for E2E Tenant Two only, its DENY raised exactly one
    `runtime_alert`, visible to Tenant Two and not Tenant One.
  - Tenant One's observe-only decision raised none.
  - The enforced decision is found by request id in Tenant Two's search
    and not in Tenant One's.
- Live check: the stored row is `runtime_alert`, broadcast (`user_id`
  null), `reference_type` agent, and holds no key material.
- Full pipeline (§17.8: notifications and a migration): eslint clean,
  vitest 450/450, Playwright **166/166** (7.9 min).

**Progress Tracker:** `Partial`. Search over investigations is waiting on
RISK-P0-11, where the record is created.

**2026-09-25 follow-up:** search now also covers investigations
(RISK-P0-11), through Risk's `listInvestigations({ query })`, matched in
the database by reference or title and only for `risk.read`.
OPERATIONS-P0-08 is `Done`.

---

## 2026-09-25 — Evidence pack PDF wording (with EXPERIENCE-P0-17)

The evidence pack PDF's comparison section now uses the product's
wording: its heading is "Approved (SHOULD) vs Effective Access (CAN) vs
Observed (DID)", and each line leads with its label. It is a text change
only. The pack's data and structure are unchanged, and the operations
unit tests pass. Recorded in full in the Experience audit.
