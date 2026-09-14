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
| OPERATIONS-P0-02.1 | Schema & channels | Partial — in-app channel real and working; email channel not implemented (no transactional email provider wired into this project yet, and the backlog explicitly forbids adding one without asking) |
| OPERATIONS-P0-02.2 | `notify(event)` and trigger wiring | Partial — `notify()` published, working, and live-verified; no producing module (Risk/Compliance/Identity/Integration, all already built) has been updated to call it yet — that is each producing module's own story to pick up, per non-negotiable #18, not something to retrofit here |
| OPERATIONS-P0-03.1 | Global search (higher bar) | Partial — 6 of 9 named object types implemented (agent, application, finding, certification_campaign, policy, integration), each backed by a real tenant-wide list contract; identity/owner/entitlement have no such contract published yet, so building one would mean reaching into another module's internals rather than composing its existing contract |
| OPERATIONS-P0-03.2 | Search traceability & role-based field masking | Done |
| OPERATIONS-P0-04.1 | P0 report set | Done |
| OPERATIONS-P0-04.2 | Report traceability (linked records + data freshness) | Done |
| OPERATIONS-P0-05.1 | Notification preferences | Partial — schema/CRUD and mandatory-type enforcement done and live-verified; every P0 notification type is mandatory in this build, so there is no actual optional preference to toggle yet (not a bug — documented) |
| OPERATIONS-P0-06.1 | Operational job reporting (connector/sync/job status) | Partial — `getJobStatusSummary()` and `GET /api/v1/jobs/status` built; no dedicated customer-facing page this session (scope cut, flagged) |

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

### OPERATIONS-P0-02.2 — `notify(event)` and trigger wiring

`notify(event)` inserts the `notifications` row and, for email-eligible types,
enqueues the email send (do not block the caller's request on email delivery —
fire-and-forget or a lightweight async dispatch, matching the same
"don't put long-running work in the request cycle" rule Integration Agent follows
for sync jobs). Each P0 trigger type is invoked by its owning module at the moment
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

## DO NOT IMPLEMENT

- Any domain business logic — Operations only reads, aggregates and presents.
- A separate search index/table that duplicates source-of-truth data outside RLS.
