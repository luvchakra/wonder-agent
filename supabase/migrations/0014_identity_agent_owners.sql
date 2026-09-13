-- Identity Agent — IDENTITY-P0-02.2
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.

create table agent_owners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  owner_type text not null check (owner_type in (
    'business_owner', 'technical_owner', 'iam_owner', 'application_owner', 'data_owner'
  )),
  user_id uuid not null references users(id),
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (agent_id, owner_type, user_id)
);

create index agent_owners_agent_id_idx on agent_owners (agent_id);
create index agent_owners_user_id_idx on agent_owners (user_id);

alter table agent_owners enable row level security;

create policy agent_owners_select on agent_owners
  for select
  using (tenant_id in (select current_tenant_ids()));

create policy agent_owners_insert on agent_owners
  for insert
  with check (tenant_id in (select current_tenant_ids()));

create policy agent_owners_update on agent_owners
  for update
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
