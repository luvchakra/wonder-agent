-- ACCESS-P0-17 (WonderID Phase 3, 2026-09-26) — account inventory:
-- accounts belong to identities (people, external, machine and AI agents),
-- not only agents; orphan, ambiguous and dormant accounts; reconciliation
-- of an application's accounts against its connector.
--
-- Backward compatible (#13):
-- - `accounts.agent_id` becomes nullable. Every existing reader filters by
--   agent_id, so an account of a person simply never appears in an agent's
--   effective access. A grant to an account without an agent is refused by
--   the service until human access governance (ACCESS-P0-20).
-- - Existing rows are all agent accounts: identity_id is backfilled from
--   the agent's mirrored identity and they are "correlated".
-- - A trigger keeps identity_id in step for agent accounts written without
--   it (the seed script, older callers), and keeps `correlation`
--   consistent with identity_id, including when the identity is deleted.
--
-- RLS: accounts keep their existing member policies. Reconciliation runs
-- are read-only for members and written by the service (service role,
-- tenant-filtered), like other run records.

alter table accounts alter column agent_id drop not null;

alter table accounts
  add column identity_id uuid,
  add column correlation text not null default 'orphan' check (correlation in ('correlated', 'manual', 'orphan', 'ambiguous')),
  add column account_name text check (account_name is null or char_length(account_name) <= 300),
  add column account_type text not null default 'standard' check (account_type in ('standard', 'privileged', 'service', 'shared')),
  add column last_used_at timestamptz,
  add column last_seen_at timestamptz,
  -- Set when a reconciliation no longer finds an account it imported;
  -- cleared when it is seen again. The account itself is never deleted.
  add column missing_from_source_at timestamptz,
  add column source text not null default 'manual' check (source in ('manual', 'reconciliation')),
  add column source_integration_id uuid,
  add column updated_at timestamptz not null default now();

alter table accounts
  add constraint accounts_identity_fkey foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete set null (identity_id),
  add constraint accounts_source_integration_fkey foreign key (source_integration_id, tenant_id) references integrations (id, tenant_id) on delete set null (source_integration_id),
  add constraint accounts_app_ref_key unique (tenant_id, application_id, external_account_ref);

create index accounts_identity_fk_idx on accounts (identity_id, tenant_id);
create index accounts_source_integration_fk_idx on accounts (source_integration_id, tenant_id);
create index accounts_tenant_correlation_idx on accounts (tenant_id, correlation);
create index accounts_tenant_last_used_idx on accounts (tenant_id, last_used_at);

-- Backfill: every existing account is an agent's.
update accounts a
set identity_id = i.id, correlation = 'correlated', account_name = coalesce(a.account_name, a.external_account_ref)
from identities i
where i.agent_id = a.agent_id and i.tenant_id = a.tenant_id and a.identity_id is null;

create or replace function accounts_identity_consistency() returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- An agent's account belongs to the agent's identity.
  if new.agent_id is not null and new.identity_id is null then
    select id into new.identity_id from identities where agent_id = new.agent_id and tenant_id = new.tenant_id;
  end if;
  if new.identity_id is null and new.correlation in ('correlated', 'manual') then
    new.correlation := 'orphan';
  elsif new.identity_id is not null and new.correlation in ('orphan', 'ambiguous') then
    new.correlation := 'correlated';
  end if;
  return new;
end;
$$;
revoke execute on function accounts_identity_consistency() from public, anon, authenticated;

create trigger accounts_identity_consistency
  before insert or update of agent_id, identity_id, correlation on accounts
  for each row execute function accounts_identity_consistency();

create table account_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid not null,
  integration_id uuid,
  config_hash text,
  status text not null check (status in ('succeeded', 'failed')),
  source_accounts integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  correlated integer not null default 0,
  orphan integer not null default 0,
  ambiguous integer not null default 0,
  missing_identifier integer not null default 0,
  not_in_source integer not null default 0,
  error text check (error is null or char_length(error) <= 1000),
  triggered_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, tenant_id),
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  foreign key (integration_id, tenant_id) references integrations (id, tenant_id) on delete set null (integration_id)
);
create index account_reconciliation_runs_app_idx on account_reconciliation_runs (application_id, tenant_id, started_at desc);
create index account_reconciliation_runs_integration_idx on account_reconciliation_runs (integration_id, tenant_id);
create index account_reconciliation_runs_tenant_idx on account_reconciliation_runs (tenant_id, started_at desc);
create index account_reconciliation_runs_triggered_by_idx on account_reconciliation_runs (triggered_by);

alter table account_reconciliation_runs enable row level security;
create policy account_reconciliation_runs_select on account_reconciliation_runs
  for select using (tenant_id in (select current_tenant_ids()));
