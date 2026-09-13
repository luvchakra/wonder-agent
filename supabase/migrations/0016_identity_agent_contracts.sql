-- Identity Agent — IDENTITY-P0-03.1
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.

create table agent_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  purpose text not null,
  owner_summary text,
  approved_applications text[] not null default '{}',
  approved_data text[] not null default '{}',
  prohibited_data text[] not null default '{}',
  approved_actions text[] not null default '{}',
  prohibited_actions text[] not null default '{}',
  certification_frequency text not null default 'quarterly' check (certification_frequency in (
    'monthly', 'quarterly', 'semiannual', 'annual'
  )),
  maximum_risk text not null default 'medium' check (maximum_risk in ('low', 'medium', 'high')),
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (agent_id, version)
);

create index agent_contracts_agent_id_idx on agent_contracts (agent_id);

-- Enforce "at most one active contract per agent" at the database level, not
-- only in application code — a partial unique index on (agent_id) where
-- status = 'active'.
create unique index agent_contracts_one_active_per_agent
  on agent_contracts (agent_id)
  where status = 'active';

alter table agent_contracts enable row level security;

-- No client INSERT/UPDATE policy, for the same reason as
-- agent_lifecycle_events: this table is the source of SHOULD for the whole
-- product (docs/plan/02-IDENTITY-AGENT-BACKLOG.md IDENTITY-P0-03.1). Its
-- versioning invariant (exactly one active version, monotonically
-- incrementing) is enforced by createContractVersion()
-- (modules/agent-identity/service.ts) plus the partial unique index above,
-- not by RLS. Writes go through the service-role client only, after
-- requirePermission('agent.update').
create policy agent_contracts_select on agent_contracts
  for select
  using (tenant_id in (select current_tenant_ids()));
