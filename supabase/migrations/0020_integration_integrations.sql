-- Integration Agent — INTEGRATION-P0-01.2
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.

create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_type_id text not null references integration_types(id),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'configured' check (status in ('configured', 'connected', 'error', 'disabled')),
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create index integrations_tenant_id_idx on integrations (tenant_id);

alter table integrations enable row level security;

-- Ordinary business-data table: RLS enforces tenant scoping only; the
-- integration.create/integration.update permission gate is enforced in the
-- API route via requirePermission(), same pattern as Identity's `agents`.
create policy integrations_select on integrations
  for select
  using (tenant_id in (select current_tenant_ids()));

create policy integrations_insert on integrations
  for insert
  with check (tenant_id in (select current_tenant_ids()));

create policy integrations_update on integrations
  for update
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
