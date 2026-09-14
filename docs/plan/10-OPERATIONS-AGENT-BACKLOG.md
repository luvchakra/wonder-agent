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
| OPERATIONS-P0-01.1 | Audit log viewer | Not Started |
| OPERATIONS-P0-01.2 | Evidence export | Not Started |
| OPERATIONS-P0-02.1 | Schema & channels | Not Started |
| OPERATIONS-P0-02.2 | `notify(event)` and trigger wiring | Not Started |
| OPERATIONS-P0-03.1 | Global search (higher bar) | Not Started |
| OPERATIONS-P0-04.1 | P0 report set | Not Started |

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

## P1

Slack, Microsoft Teams, ServiceNow, webhook notification channels. Scheduled
PDF/executive reports. Custom report builder. SIEM export.

## DO NOT IMPLEMENT

- Any domain business logic — Operations only reads, aggregates and presents.
- A separate search index/table that duplicates source-of-truth data outside RLS.
