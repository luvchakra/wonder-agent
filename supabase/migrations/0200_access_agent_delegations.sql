-- Access Agent — ACCESS-P0-23 part 4: delegation to AI agents, enforced at
-- the Runtime Gateway (owner decisions, 17 Oct 2026):
-- - two directions: a person lets an agent act for them, and an agent lets
--   another agent act for it;
-- - a person→agent delegation takes effect only once an owner of the agent
--   approves it (never the person who asked); agent→agent likewise, by an
--   owner of the agent receiving it;
-- - a gateway request that says it acts on someone's behalf, with no
--   active delegation covering its action, is held for approval
--   (REQUIRE_APPROVAL, DELEGATION_REQUIRED).
--
-- Time-limited (at most 180 days), limited to named actions and optionally
-- named applications. Members see the ones they asked for or that are from
-- them; an access manager sees all. The Access service writes.

create table agent_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  delegator_kind text not null check (delegator_kind in ('user', 'agent')),
  delegator_user_id uuid,
  delegator_agent_id uuid,
  delegate_agent_id uuid not null,
  actions text[] not null check (cardinality(actions) between 1 and 50),
  -- empty: any application the agent's contract approves
  applications text[] not null default '{}' check (cardinality(applications) <= 50),
  reason text not null check (char_length(reason) between 1 and 1000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'revoked')),
  requested_by uuid not null references users(id) on delete restrict,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  revoked_by uuid references users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  foreign key (tenant_id, delegator_user_id) references tenant_memberships (tenant_id, user_id) on delete cascade,
  foreign key (delegator_agent_id, tenant_id) references agents (id, tenant_id) on delete cascade,
  foreign key (delegate_agent_id, tenant_id) references agents (id, tenant_id) on delete cascade,
  check ((delegator_kind = 'user') = (delegator_user_id is not null and delegator_agent_id is null)),
  check ((delegator_kind = 'agent') = (delegator_agent_id is not null and delegator_user_id is null)),
  check (delegator_agent_id is distinct from delegate_agent_id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '180 days'),
  -- nobody approves their own delegation
  check (decided_by is null or decided_by <> requested_by),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index agent_delegations_delegate_idx on agent_delegations (tenant_id, delegate_agent_id, ends_at) where status = 'active';
create index agent_delegations_pending_idx on agent_delegations (tenant_id, delegate_agent_id) where status = 'pending';
create index agent_delegations_delegator_user_idx on agent_delegations (tenant_id, delegator_user_id) where delegator_user_id is not null;
create index agent_delegations_delegator_agent_idx on agent_delegations (delegator_agent_id, tenant_id) where delegator_agent_id is not null;
create index agent_delegations_delegate_fk_idx on agent_delegations (delegate_agent_id, tenant_id);
create index agent_delegations_requested_by_idx on agent_delegations (requested_by);
create index agent_delegations_decided_by_idx on agent_delegations (decided_by) where decided_by is not null;
create index agent_delegations_revoked_by_idx on agent_delegations (revoked_by) where revoked_by is not null;

alter table agent_delegations enable row level security;
create policy agent_delegations_select on agent_delegations for select
  using (
    tenant_id in (select current_tenant_ids())
    and ((select auth.uid()) in (requested_by, delegator_user_id) or has_tenant_permission(tenant_id, 'access.manage'))
  );

-- CLAUDE.md §19.10: record provenance, as migration 0115.
do $$
declare
  t text;
begin
  foreach t in array array['agent_delegations'] loop
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;

-- WID-H06, as for people's delegations (0182): an automation credential
-- never delegates to an agent.
create or replace function agent_delegations_refuse_automation() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.delegator_user_id is not null and exists (
    select 1 from tenant_memberships m where m.tenant_id = new.tenant_id and m.user_id = new.delegator_user_id and m.account_type = 'automation'
  ) then
    raise exception 'An automation credential cannot delegate to an agent' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function agent_delegations_refuse_automation() from public, anon, authenticated;

create trigger agent_delegations_refuse_automation before insert or update on agent_delegations
  for each row execute function agent_delegations_refuse_automation();

-- Covering indexes for 0198's composite foreign keys (performance advisor).
create index if not exists identities_merged_into_tenant_fk_idx on identities (merged_into_identity_id, tenant_id) where merged_into_identity_id is not null;
create index if not exists identity_merges_merged_tenant_fk_idx on identity_merges (merged_identity_id, tenant_id);
create index if not exists identity_merges_survivor_tenant_fk_idx on identity_merges (survivor_identity_id, tenant_id);
