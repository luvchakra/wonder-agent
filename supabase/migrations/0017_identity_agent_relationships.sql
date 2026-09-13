-- Identity Agent — IDENTITY-P0-02.3
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.

create table agent_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  related_agent_id uuid references agents(id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'delegates_to', 'depends_on', 'shares_credential_with', 'orchestrates'
  )),
  created_at timestamptz not null default now(),
  check (agent_id <> related_agent_id)
);

create index agent_relationships_agent_id_idx on agent_relationships (agent_id);
create index agent_relationships_related_agent_id_idx on agent_relationships (related_agent_id);

alter table agent_relationships enable row level security;

create policy agent_relationships_select on agent_relationships
  for select
  using (tenant_id in (select current_tenant_ids()));

create policy agent_relationships_insert on agent_relationships
  for insert
  with check (tenant_id in (select current_tenant_ids()));

create policy agent_relationships_delete on agent_relationships
  for delete
  using (tenant_id in (select current_tenant_ids()));
