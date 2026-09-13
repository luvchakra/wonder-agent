-- Identity Agent — IDENTITY-P0-01.2
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.

create table agent_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  identity_type text not null check (identity_type in (
    'service_account', 'human_delegate', 'oauth_client', 'workload_identity', 'api_key', 'mcp_server'
  )),
  external_reference text not null,
  source_system text not null,
  confidence text not null default 'unverified' check (confidence in ('unverified', 'probable', 'confirmed')),
  status text not null default 'active' check (status in ('active', 'stale', 'removed')),
  created_at timestamptz not null default now()
);

create index agent_identities_agent_id_idx on agent_identities (agent_id);

alter table agent_identities enable row level security;

create policy agent_identities_select on agent_identities
  for select
  using (tenant_id in (select current_tenant_ids()));

create policy agent_identities_insert on agent_identities
  for insert
  with check (tenant_id in (select current_tenant_ids()));

create policy agent_identities_update on agent_identities
  for update
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
