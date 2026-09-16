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
