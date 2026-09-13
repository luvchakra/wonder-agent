-- Identity Agent — IDENTITY-P0-01.1
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.

create table agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_name text not null,
  display_name text,
  description text,
  purpose text,
  agent_type text not null,
  agent_framework text,
  model_provider text,
  model_name text,
  model_version text,
  runtime text,
  environment text not null default 'production' check (environment in ('production', 'staging', 'development')),
  criticality text not null default 'medium' check (criticality in ('low', 'medium', 'high', 'critical')),
  data_classification text,
  status text not null default 'discovered',
  lifecycle_state text not null default 'DISCOVERED' check (lifecycle_state in (
    'DISCOVERED', 'REGISTERED', 'ASSESSED', 'APPROVED', 'PROVISIONED',
    'ACTIVE', 'CERTIFICATION_DUE', 'RESTRICTED', 'SUSPENDED', 'RETIRED'
  )),
  source_system text,
  source_object_id text,
  enterprise_identity_id text,
  service_account_id text,
  credential_reference text,
  risk_score numeric,
  posture_score numeric,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  last_seen_at timestamptz,
  next_review_at timestamptz,
  retirement_date timestamptz
);

create index agents_tenant_id_idx on agents (tenant_id);

alter table agents enable row level security;

-- Ordinary business-data table (unlike agent_lifecycle_events/agent_contracts
-- below): RLS enforces tenant scoping only; the finer-grained agent.create /
-- agent.update permission gate is enforced in the API route via
-- requirePermission(), per docs/plan/02-IDENTITY-AGENT-BACKLOG.md
-- IDENTITY-P0-01.1. No DELETE policy — retirement is a lifecycle transition
-- (RETIRED), never a row deletion, so agent history is never lost.
create policy agents_select on agents
  for select
  using (tenant_id in (select current_tenant_ids()));

create policy agents_insert on agents
  for insert
  with check (tenant_id in (select current_tenant_ids()));

create policy agents_update on agents
  for update
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
