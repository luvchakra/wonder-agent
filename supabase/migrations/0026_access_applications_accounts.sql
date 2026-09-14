-- Access Agent — ACCESS-P0-01.1
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.

create table applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text,
  source_integration_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  external_account_ref text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create index applications_tenant_id_idx on applications (tenant_id);
create index accounts_tenant_id_idx on accounts (tenant_id);
create index accounts_agent_id_idx on accounts (agent_id);
create index accounts_application_id_idx on accounts (application_id);

alter table applications enable row level security;
alter table accounts enable row level security;

-- Ordinary business-data tables (like Identity's `agents`): RLS enforces
-- tenant scoping only; access.manage is checked in the API route.
create policy applications_select on applications
  for select using (tenant_id in (select current_tenant_ids()));
create policy applications_insert on applications
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy applications_update on applications
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

create policy accounts_select on accounts
  for select using (tenant_id in (select current_tenant_ids()));
create policy accounts_insert on accounts
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy accounts_update on accounts
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
