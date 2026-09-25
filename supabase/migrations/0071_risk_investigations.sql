-- RISK-P0-11 (master stories P0-37) — investigations as a first-class
-- record. User decision 2026-09-25: a new Risk-owned investigation
-- (e.g. INV-2026-001) that groups one or more findings, with status,
-- priority, assignee, a timeline, and the findings' evidence and
-- remediation.
--
-- Same model as risk_findings (0034): evidentiary, so members read
-- through RLS and only the service role writes, behind risk.manage in the
-- service. Every change is also a row in investigation_events (the
-- timeline) and an audit event (#11). Nothing is deleted: an
-- investigation is closed, and a finding removed from one leaves a
-- timeline entry.
--
-- Same-tenant references are enforced by composite foreign keys, as in
-- 0070: an investigation can only group its own tenant's findings.

alter table risk_findings add constraint risk_findings_id_tenant_key unique (id, tenant_id);

create table investigations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Human reference, unique per tenant: INV-<year>-<3+ digit sequence>.
  reference text not null check (reference ~ '^INV-[0-9]{4}-[0-9]{3,}$'),
  title text not null check (char_length(title) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'awaiting_remediation', 'resolved', 'closed')),
  priority text not null check (priority in ('critical', 'high', 'medium', 'low')),
  assignee_id uuid references users(id),
  created_by uuid references users(id),
  resolution text check (resolution is null or char_length(resolution) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (tenant_id, reference),
  unique (id, tenant_id)
);

create index investigations_tenant_status_idx on investigations (tenant_id, status, created_at desc);
create index investigations_assignee_idx on investigations (assignee_id);

create table investigation_findings (
  investigation_id uuid not null,
  finding_id uuid not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (investigation_id, finding_id),
  foreign key (investigation_id, tenant_id) references investigations (id, tenant_id) on delete cascade,
  foreign key (finding_id, tenant_id) references risk_findings (id, tenant_id) on delete cascade
);

create index investigation_findings_finding_idx on investigation_findings (finding_id);
create index investigation_findings_tenant_idx on investigation_findings (tenant_id);

create table investigation_events (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'status_changed', 'priority_changed', 'assigned', 'finding_added', 'finding_removed', 'note')),
  actor_id uuid references users(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (investigation_id, tenant_id) references investigations (id, tenant_id) on delete cascade
);

create index investigation_events_investigation_idx on investigation_events (investigation_id, created_at);
create index investigation_events_tenant_idx on investigation_events (tenant_id);

alter table investigations enable row level security;
alter table investigation_findings enable row level security;
alter table investigation_events enable row level security;

create policy investigations_select on investigations
  for select using (tenant_id in (select current_tenant_ids()));
create policy investigation_findings_select on investigation_findings
  for select using (tenant_id in (select current_tenant_ids()));
create policy investigation_events_select on investigation_events
  for select using (tenant_id in (select current_tenant_ids()));
