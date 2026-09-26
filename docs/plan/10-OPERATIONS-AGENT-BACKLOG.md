# 10 — Operations Agent Backlog

**Agent name:** `Operations Agent`
**Module:** Audit, Reporting, Notifications & Search
**Branch:** `module/operations`
**Status:** DORMANT — do not start until the user says "Run Operations Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. This
agent is dormant; every story is Not Started until "Run Operations Agent" is
issued.

| Story | Title | Status |
|---|---|---|
| OPERATIONS-P0-01.1 | Audit log viewer | Done |
| OPERATIONS-P0-01.2 | Evidence export | Done |
| OPERATIONS-P0-02.1 | Schema & channels | Done — 2026-09-16: user picked Resend. Both channels real: in-app (unchanged) plus `modules/operations/email.ts`'s `sendNotificationEmail()`, called from `notify()` for every event. Targets the specific `userId` when set, otherwise broadcasts to every active tenant member (same semantics the in-app channel already used), honoring each recipient's `notification_preferences.email_enabled` (defaults to on when no row exists) |
| OPERATIONS-P0-02.2 | `notify(event)` and trigger wiring | Done — 2026-09-19: all 7 event types now wired. The 3 remaining ones each needed a real, user-directed product decision the backlog left open (which this pass made explicitly, not guessed): `certification_due` fires from Identity's existing on-read `ACTIVE -> CERTIFICATION_DUE` transition (no scheduler needed — the transition itself is the one genuine write event); `ownership_missing` fires from `removeOwner()` when it's the removal that takes a required owner type to zero (the "since agent creation" sub-case is intentionally not covered — see audit log); `lifecycle_expiry` fires from a new daily cron sweep (`app/api/cron/access-exception-expiry-reminders`) over expired-but-still-active `policy_exceptions`, deduped via a new `wasRecentlyNotified()` helper — see audit log |
| OPERATIONS-P0-03.1 | Global search (higher bar) | Done — 2026-09-19: all 9 named object types implemented. Identity Agent published `listOwnersForTenant()`/`listIdentitiesForTenant()` and Access Agent published `listEntitlementsForTenant()` (each the tenant-wide counterpart of an already-published per-agent/per-application list), wired into `search()` for the previously-missing identity/owner/entitlement types — see audit log |
| OPERATIONS-P0-03.2 | Search traceability & role-based field masking | Done |
| OPERATIONS-P0-04.1 | P0 report set | Done |
| OPERATIONS-P0-04.2 | Report traceability (linked records + data freshness) | Done |
| OPERATIONS-P0-05.1 | Notification preferences | Partial — schema/CRUD and mandatory-type enforcement done and live-verified; every P0 notification type is mandatory in this build, so there is no actual optional preference to toggle yet (not a bug — documented) |
| OPERATIONS-P0-06.1 | Operational job reporting (connector/sync/job status) | Done — customer-facing `/integrations/jobs` page built, composing `getJobStatusSummary()`, added to the Integrations nav group |
| OPERATIONS-P0-07 | Governance Evidence Pack export (PDF/CSV/JSON delivery) | Done — 2026-09-16: PDF renderer added (`pdf-lib`, user-approved new dependency); `exportGovernanceEvidencePack()` now produces all 3 formats, all sharing the same SHA-256 content hash. The narrower campaign-scoped `exportCampaignEvidencePackage()` (COMPLIANCE-P0-06) intentionally stays JSON/CSV-only — its format parameter type now explicitly excludes "pdf" |
| OPERATIONS-P0-08 | Runtime and approval notifications (master P0-41) | Done — 2026-09-25: enforced DENY → `runtime_alert`, enforced REQUIRE_APPROVAL → `approval_required` (mandatory, throttled per agent); search covers gateway decisions and (with RISK-P0-11) investigations |
| OPERATIONS-P0-09 | Workflow designer and runs | Not Started — 2026-09-26, WonderID |
| OPERATIONS-P0-10 | WonderID insights, reports and identity graph views | Not Started — 2026-09-26, WonderID |

---

## Dependencies

Every domain module's data, consumed read-only via their published contracts.
Foundation's `audit_logs` (read) and `writeAudit()` (Operations writes its own
notification-triggering events the same way every module does — it does not get a
special write path).

## Owned entities

`notifications`, `reports`.

## Consumed entities

`audit_logs` (Foundation, read), and every module's list/read contract for search
and reporting (Identity's agents, Access's entitlements/policies, Risk's findings,
Compliance's certifications, Integration's integrations).

## Published contracts

- `lib/shared/types/operations.ts`: `Notification`, `ReportDefinition`,
  `SearchResult`.
- `modules/operations/service.ts`: `search(query, tenantId)`,
  `notify(event)` (called by domain modules on P0-listed trigger events — e.g. Risk
  Agent calls `notify()` when it creates a `critical` finding).

---

## Higher-bar stories

OPERATIONS-P0-03.1 (search) is higher bar — a cross-tenant leak through search would
violate non-negotiable #4 directly.

---

## Epic OPERATIONS-P0-01 — Audit Trail Presentation

### OPERATIONS-P0-01.1 — Audit log viewer

`GET /api/v1/audit?objectType=&action=&from=&to=&actorId=` — tenant-scoped (via
Foundation's RLS + `getTenantContext`), paginated, filterable read view over
`audit_logs`. Does not duplicate the write path (Foundation's `writeAudit()` is the
only writer, per FOUNDATION-P0-05.1) — this story is read/query/presentation only.

Cover, at minimum, the audit-worthy actions named in the PRD: login/SSO login, agent
created/modified, owner changed, access changed, policy changed, certification
decision, finding created/resolved, remediation initiated, integration changed, API
token created, role changed, user added/removed. If a given module hasn't been
built yet and therefore isn't emitting one of these action types, the viewer simply
shows none of that type yet — it does not need special-case handling per action
type.

### OPERATIONS-P0-01.2 — Evidence export

`GET /api/v1/audit/export?...` producing a downloadable (CSV or JSON) evidence
bundle for a given filter — used by Compliance Agent's evidence needs and by
auditors directly. Respect the same tenant scoping and permission checks
(`report.export`) as every other export path.

---

## Epic OPERATIONS-P0-02 — Notifications

### OPERATIONS-P0-02.1 — Schema & channels

```sql
create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid,                 -- null = broadcast to all users with the relevant permission
  type text not null check (type in (
    'certification_due','certification_overdue','critical_finding','rogue_agent',
    'ownership_missing','integration_failure','lifecycle_expiry'
  )),
  title text not null,
  body text not null,
  reference_type text,
  reference_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
```

P0 channels: **email** (via Supabase's built-in email sending or a standard
transactional email provider already available to the project — do not add a new
email infrastructure dependency without asking) and **in-app** (the `notifications`
table itself, read via `GET /api/v1/notifications`). Slack/Teams/webhook channels
are explicitly P1.

**Resolved 2026-09-16** (user picked Resend): `modules/operations/email.ts`'s
`sendNotificationEmail()`. Calls Resend's REST API directly via `fetch()` (no new
npm dependency). Deliberately NOT wrapped in `next/server`'s `after()` (unlike
Integration Agent's sync-job dispatch) — `notify()` is called from deep inside
service-layer call chains (e.g. `evaluateAgentRisk() → createOrUpdateFinding() →
notifyForFinding() → notify()`), not only from an API route handler, and `after()`
throws when called outside an active request scope. `sendNotificationEmail()` is
awaited inline instead; it never throws (matching `notify()`'s and `writeAudit()`'s
own discipline) and a single Resend call is fast enough (typically well under a
second, and broadcast recipients are sent in parallel via `Promise.all()`) that the
added latency on the triggering write was judged an acceptable, safer trade-off
than risking a genuinely fire-and-forget promise getting cut off mid-flight in a
serverless invocation before the email actually sends.

### OPERATIONS-P0-02.2 — `notify(event)` and trigger wiring

`notify(event)` inserts the `notifications` row and sends the email (see
OPERATIONS-P0-02.1's resolution note above for why this is awaited inline rather
than fire-and-forget/`after()`-dispatched). Each P0 trigger type is invoked by its owning module at the moment
the underlying event occurs (e.g. Risk Agent calls `notify({type:
'critical_finding', ...})` right after inserting a `critical` `risk_findings` row) —
Operations Agent does not poll for these conditions itself; it only provides the
`notify()` entry point and consumes it is left to each producing module to call
(record this hand-off explicitly in this module's audit log so producing modules
know the contract exists once they're built).

---

## Epic OPERATIONS-P0-03 — Search (higher bar)

### OPERATIONS-P0-03.1 — Global search

`search(query, tenantId)` fans out to each domain module's own search/lookup
function (do not build a separate denormalized search index/table that could drift
out of sync with RLS-protected source data — query through each module's existing
tenant-scoped read contract so the same RLS/permission boundaries automatically
apply). Cover: agent, identity, application, entitlement, owner, finding,
certification, policy, integration. Each result carries its object type and a link;
results the calling user lacks permission to see (per Foundation's RBAC) must not
appear at all — verify this specifically, since a naive implementation might filter
in the UI rather than at the query layer.

**Acceptance criteria:** as a user with only `agent.read` (no `finding.read`), a
search query matching both an agent name and a finding title returns only the agent
result.

---

## Epic OPERATIONS-P0-04 — Reports

### OPERATIONS-P0-04.1 — P0 report set

Implement, each as a tenant-scoped, permission-gated (`report.read`) query + export
(`report.export`) over the relevant module's contract: AI Agent Inventory, Ownership
Report, Access Certification Report, Rogue Agent Report, Access Violation Report,
Risk Report, Audit Evidence Report, Policy Compliance Report.

`reports` table stores saved/scheduled report *definitions* (filter + format), not
generated output:

```sql
create table reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  report_type text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
```

Generated report output is computed on demand from the live, tenant-scoped source
data at export time — never cached in a way that could serve stale or cross-tenant
data to a later requester.

---

## Critical acceptance test

Search and reports return only the current tenant's permitted data (verified against
a fixture with two tenants and a user with restricted permissions in one of them),
while audit views show who/what/when/result for sensitive actions across agent,
access, policy, certification and remediation workflows once those modules exist.

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`10_AUDIT_REPORTING_OPERATIONS.md`) that expands this module's P0/P1/P2 scope
beyond what was already tracked above. This module has not been implemented
yet (everything in the Progress Tracker is `Not Started`), so this is a
scope-reconciliation pass, not a re-audit of completed work. Reconciled
against the existing Progress Tracker; the following are genuinely new
stories added to the tracker:

### OPERATIONS-P0-03.2 — Search traceability & role-based field masking

New scope beyond OPERATIONS-P0-03.1's object-type coverage: each search
result must additionally surface key status/risk indicators and a
data-freshness signal, and any sensitive field within a result must be
masked according to the requesting user's role/permissions (not simply
omitted at the UI layer — the masking decision must be made at the same
query layer that already enforces per-object-type visibility in 03.1).
**Acceptance criteria:** a user without `risk.read` sees a finding-adjacent
search result (if visible at all under 03.1's permission rules) with its
risk/severity fields masked rather than populated; a freshness timestamp is
present on every result. **Not started.**

### OPERATIONS-P0-04.2 — Report traceability

New scope beyond OPERATIONS-P0-04.1's report set: every metric shown in a
generated report must link through to the underlying filtered record set
that produced it (not just a summary number), and every report output must
show its generation timestamp and a data-freshness indicator so a consumer
knows how current the figures are. Since OPERATIONS-P0-04.1 already computes
reports on demand from live data (never cached), this story is mostly about
surfacing that already-live computation's timestamp and wiring the
drill-through links — it does not change the underlying computation model.
**Not started.**

### OPERATIONS-P0-05.1 — Notification preferences

New epic: role-appropriate per-user notification preferences (e.g. which
P0 notification types a user sees in-app vs. by email), while structurally
preventing users from suppressing mandatory security/audit notification
types (the P0 list in OPERATIONS-P0-02.1: certification due/overdue,
critical finding, rogue agent, ownership missing, integration failure,
lifecycle expiry all remain mandatory regardless of preference). This likely
needs a new `notification_preferences` table (tenant-scoped, per user) —
that table does not yet appear in `docs/design/ownership-map.md`; since it
is a direct extension of the `notifications` domain already owned by
Operations Agent there, it is not expected to be controversial, but per this
task's constraints it is **flagged here for the user to add to the
ownership map** rather than editing that file directly. **Not started.**

### OPERATIONS-P0-06.1 — Operational job reporting

New epic: expose connector/sync/job status, failure counts, retry state and
last successful execution to tenant users. This is a read/presentation
story only — the underlying `integration_sync_jobs` table (status, counts,
errors, correlation id) is already owned by Integration Agent per the
ownership map, so this story consumes that module's existing read contract
the same way OPERATIONS-P0-03.1 (search) and OPERATIONS-P0-04.1 (reports)
already consume other modules' contracts; it does not introduce a new table
owned by Operations. **Not started.**

### Already covered, no new row needed

- **OPS-P0-01 (Unified Audit Event)** and **OPS-P0-02 (Immutable Evidence
  Semantics)** — already represented by OPERATIONS-P0-01.1 (read-only,
  query/presentation view over Foundation's `audit_logs`, no edit/delete
  path — see the module's joint `audit_logs` ownership entry in
  `docs/design/ownership-map.md`) and by the append-oriented/tamper-resistant
  requirement already stated in this file's Original Master PRD section
  above. The new doc's "safe change summary" field is a candidate addition
  to the `audit_logs` schema itself, which Operations does not own (Foundation
  does) — noted here as a cross-module dependency to raise with Foundation
  Agent if/when it is implemented, not an Operations scope change.
- **OPS-P0-03 (Notifications)** and **OPS-P0-04's P0 trigger list** — the
  seven P0 notification types in the new doc match OPERATIONS-P0-02.1's
  schema `check` constraint exactly (certification_due, certification_overdue,
  critical_finding, rogue_agent, ownership_missing, integration_failure,
  lifecycle_expiry). No change.
- **OPS-P0-05 (Reports)** — the eight P0 reports in the new doc (AI Agent
  Inventory, Ownership, Certification, Rogue Agents, Access Violations, Risk,
  Audit Evidence, Policy/Control status) match OPERATIONS-P0-04.1's report
  list exactly (naming "Access Certification Report" vs. "Certification" and
  "Policy Compliance Report" vs. "Policy/Control status" — same reports).
- **OPS-P0-07 (Evidence Export)** — already covered jointly by
  OPERATIONS-P0-01.2 (audit evidence export, CSV/JSON, `report.export`) and
  OPERATIONS-P0-04.1's per-report export path (also gated on
  `report.export`).
- **OPS-P0-08 (Search)** — already covered by OPERATIONS-P0-03.1's object-type
  list (agent, identity, application, entitlement, owner, finding,
  certification, policy, integration). One nuance: the new doc's list
  substitutes "runtime events" for "policy" — runtime events are not
  currently in 03.1's scope. Flagged here as a scope note for whoever
  implements 03.1: add runtime events (owned by Runtime Agent) as a
  searchable object type alongside the existing nine, consuming Runtime
  Agent's read contract the same way the other object types consume their
  owning module's contract. Not treated as a separate row since it is an
  addition to an existing story's object-type list, not a new capability.
- **OPS-P1-01 (Scheduled Reports)** and **OPS-P1-02 (SIEM/ITSM
  Notifications)** — already listed in this file's `## P1` section below
  ("Scheduled PDF/executive reports" and "Slack, Microsoft Teams,
  ServiceNow, webhook notification channels" / "SIEM export").

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## P1

Slack, Microsoft Teams, ServiceNow, webhook notification channels. Scheduled
PDF/executive reports. Custom report builder. SIEM export.

New from the requirements refresh above:

- Scheduled reports should prefer secure, authenticated links over emailing
  raw sensitive attachments where the destination supports it (OPS-P1-01).
- Alert routing: route critical findings by tenant, owner, business unit,
  integration and severity, with escalation rules (OPS-P1-03).
- Advanced search: faceted search, saved searches, fuzzy matching and
  cross-object investigation (OPS-P1-04).
- Operational dashboards: connector reliability, event ingestion health,
  certification SLA, finding aging and remediation effectiveness (OPS-P1-05).

## P2

From the requirements refresh above — strategic, after P0/P1 proven:

- **Analytics store (OPS-P2-01):** optional analytical store/warehouse for
  high-volume historical analytics, without changing the transactional
  source-of-truth models any other module owns.
- **Advanced retention (OPS-P2-02):** tiered storage and configurable
  archival for runtime/audit data while preserving evidentiary integrity —
  coordinates with Foundation's tenant-configurable data retention item
  (FOUNDATION-P1-04) rather than duplicating it.
- **Executive reporting automation (OPS-P2-03):** recurring executive
  posture reports with trend analysis, linking to authoritative evidence
  rather than restating it.

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. No new
Operations-owned story added. One open, undecided item names Operations as
a candidate owner: **Governance Evidence Pack** (P0-19) escalates, not
duplicates, the already-open Compliance-vs-Operations evidence-export
ownership question (`ownership-map.md`) — the new doc's per-agent scope is
broader than this module's current `OPERATIONS-P0-01.2` evidence export
and explicitly asks for a PDF format alongside CSV/JSON, not yet confirmed
as built. Not scoped as a story until the ownership question is answered.

### OPERATIONS-P0-07 — Governance Evidence Pack export (decision resolved 2026-09-15, later same day)

The user answered via `AskUserQuestion`: **Compliance assembles, Operations
exports.** Compliance Agent's `COMPLIANCE-P0-09` produces the assembled,
structured per-agent evidence bundle (identity/access/SHOULD-CAN-DID/risk/
certification/attestation/exception/control-mapping/runtime/remediation/
audit); this module's job is turning that structured bundle into a
downloadable PDF/CSV/JSON file, reusing `OPERATIONS-P0-01.2`'s existing
evidence-export mechanism/pattern rather than building a second exporter.
Compliance calls this module's export function with its assembled bundle —
Operations never reaches into Compliance's (or any other module's) tables
directly (non-negotiable #6). Confirm whether a PDF renderer already
exists anywhere in this codebase before assuming one does (currently
believed not to — no PDF library appears in any module's dependencies).
**Not started.**

---

## Requirements Refresh — 2026-09-25 (master P0/P1/P2 implementation stories)

Source: the user-supplied *WonderAgent Master P0/P1/P2 Implementation Stories* (MCP folded into the five pillars DISCOVER → UNDERSTAND → GOVERN → PROTECT → ASSURE), mapped story by story in [`docs/implementation/codebase-map.md`](../implementation/codebase-map.md). Ownership and architecture choices were decided by the user on 2026-09-25 (see `docs/design/ownership-map.md`, "Master stories decisions"). Nothing already `Done` is reopened; the rows below are added to this module's Progress Tracker as `Not Started`.

### OPERATIONS-P0-08 — Runtime and approval notifications (master P0-41)

Runtime alerts and approval-required notifications from the gateway's decisions (REQUIRE_APPROVAL, DENY in enforce mode), reusing `notify()`; search covers investigations and decisions.


---

## DO NOT IMPLEMENT

- Any domain business logic — Operations only reads, aggregates and presents.
- A separate search index/table that duplicates source-of-truth data outside RLS.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded the Operations module requirements document
(`10_AUDIT_REPORTING_OPERATIONS.md`) at
`/root/.claude/uploads/7af02f4f-be08-5f91-b0d5-fc0907e4645c/3964c18a-10_AUDIT_REPORTING_OPERATIONS.md`,
asking for a fresh, thorough re-check against this newer/expanded copy in
case it contains detail the first refresh (the "Requirements Refresh —
2026-09-14" section above) missed.

**Result: no new stories added.** The uploaded document was read in full
(all 260 lines — "# 29. Audit Trail" through the closing "Notification
safety" note) and compared section-by-section against both the module's
Original Master PRD text and the existing Requirements Refresh above.
Every numbered item in the doc's "Expanded Requirements" section
(`OPS-P0-01` through `OPS-P0-10`, `OPS-P1-01` through `OPS-P1-05`,
`OPS-P2-01` through `OPS-P2-03`) is already accounted for by name in the
first-pass refresh or by an existing Progress Tracker row:

- `OPS-P0-01` Unified Audit Event, `OPS-P0-02` Immutable Evidence
  Semantics, `OPS-P0-03` Notifications, `OPS-P0-05` Reports, `OPS-P0-07`
  Evidence Export, `OPS-P0-08` Search — already reconciled under "Already
  covered, no new row needed" in the first-pass refresh above.
- `OPS-P0-04` Notification Preferences → `OPERATIONS-P0-05.1` (already a
  tracked row, Partial).
- `OPS-P0-06` Report Traceability → `OPERATIONS-P0-04.2` (already a
  tracked row, Done).
- `OPS-P0-09` Search Traceability → `OPERATIONS-P0-03.2` (already a
  tracked row, Done).
- `OPS-P0-10` Operational Job Reporting → `OPERATIONS-P0-06.1` (already a
  tracked row, Partial).
- `OPS-P1-01` through `OPS-P1-05` and `OPS-P2-01` through `OPS-P2-03` —
  every one already appears, by name and description, in this file's `##
  P1` and `## P2` sections above (Scheduled Reports, SIEM/ITSM
  Notifications, Alert Routing, Advanced Search, Operational Dashboards,
  Analytics Store, Advanced Retention, Executive Reporting Automation).

The document's closing **"Notification safety"** note ("Never place
credentials, access tokens or raw sensitive payloads into notification
text. Notifications should link to authorized evidence views.") is not a
new capability or story — it is a constraint on the already-tracked
`OPERATIONS-P0-02.2` (`notify(event)` and trigger wiring), and it is
already covered in substance by `CLAUDE.md` non-negotiable #10 (secrets
must never be exposed to logs, browser code or source control) and this
module's own "Engineering rules for every module" #6 ("Never expose
secrets, service-role keys or connector credentials to the browser").
Spot-checked `modules/operations/notifications.ts` (no reference to any
credential/token/secret field when constructing a notification's `title`/
`body`) — nothing in the current implementation violates this, and future
producing modules calling `notify()` should keep notification bodies to
human-readable summaries with links (matching `OPERATIONS-P0-04.2`/
`03.2`'s existing drill-through-link pattern) rather than embedding raw
sensitive payloads. No new Progress Tracker row added for it — it is
recorded here as a standing constraint on `OPERATIONS-P0-02.2`, the same
way the first-pass refresh recorded the "runtime events" search object
type as a scope note on `OPERATIONS-P0-03.1` rather than a new row.

The Original Master PRD sections (`# 29` through `# 32`) and the "Claude
Code Execution Plan" / critical-acceptance-test text in the uploaded doc
are byte-for-byte the same requirements already reflected in this file's
own "Original Master PRD Requirements" and "Critical acceptance test"
sections — no drift found.

**No Progress Tracker rows were added, changed, or reordered in this
pass.** The four known, already-tracked partial gaps named in this task's
instructions (email channel not wired, `notify()` not yet called by
producing modules, search covering 6 of 9 object types, no dedicated
job-status customer page) remain exactly as recorded in the existing
tracker rows and are not restated as new items.

---

## WonderID (2026-09-26)

Adopted by explicit user decision; see `CLAUDE.md` and `docs/plan/WONDERID-ROADMAP.md`.
These stories extend this module's own tables, services and routes.

### OPERATIONS-P0-09 — Workflow designer and runs

Declarative workflow definitions (start, condition, fetch, evaluate policy, SoD, risk, approvals, provision, revoke, notify, task, wait, timer, retry, escalate, end) executed as idempotent runs with history, failures and retries; policy evaluation is delegated to Access.

### OPERATIONS-P0-10 — WonderID insights, reports and identity graph views

Identity, access, application, certification, agent and operational dashboards (spec §28), pre-built and scheduled reports, and graph explorer over the existing access graph read model.

## WonderID branding hand-offs (2026-09-26, P1)

From `docs/requirements/WonderID_Branding_Application_Wide_Implementation_Requirements.md`
(see `docs/plan/WONDERID-ROADMAP.md` § Phase 4c). Both read the brand from
`wonderIdBrand` (`modules/ui/brand.ts`) and never define their own:

- **BRAND-010 — branded system e-mail (P1):** logo, Deep Navy and Electric
  Blue, an "Open WonderID" call to action whose link is the tenant's own
  address (FOUNDATION-P0-22's `urlForTenant`), and the tagline footer.
- **BRAND-011 — branded reports and evidence (P1):** logo, report title,
  tenant, generated date, page numbers and a "Generated by WonderID"
  footer on PDF reports and evidence packages, without obscuring the
  evidence.

