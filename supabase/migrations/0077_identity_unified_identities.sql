-- IDENTITY-P0-15 / IDENTITY-P0-16 (WonderID Phase 1, 2026-09-26) — the
-- unified identity reference model, tenant-defined identity attributes and
-- identity relationships.
--
-- Spec rule R5: one COMMON IDENTITY REFERENCE, not a second source of truth.
-- - An AI agent's identity row is 1:1 with its `agents` row, which stays
--   canonical for every agent field. A trigger keeps the few shared fields
--   (name, type, status, risk, last seen) in step, and deleting the agent
--   deletes its identity row. Nothing about `agents` changes.
-- - A tenant member is a HUMAN identity linked to their Foundation `users`
--   row; a trigger creates it when the membership is created. Humans who
--   never sign in (HR workers before first login, external users) are rows
--   with no `user_id`.
-- - Other machine identities (service accounts, application accounts,
--   workloads, APIs, machines) are first-class rows.
--
-- Additive only. Same-tenant composite foreign keys throughout (0075/0076
-- pattern). RLS: tenant members read and write their tenant's rows; the
-- permission checks (identity.read / identity.manage) live in the service.
-- No delete policy: an identity is disabled or archived, never deleted by
-- a customer user.

create table identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  identity_type text not null check (identity_type in
    ('HUMAN', 'EXTERNAL', 'MACHINE', 'SERVICE_ACCOUNT', 'APPLICATION', 'WORKLOAD', 'API', 'AI_AGENT')),
  subtype text check (subtype is null or char_length(subtype) between 1 and 60),
  display_name text not null check (char_length(display_name) between 1 and 200),
  username text check (username is null or char_length(username) <= 200),
  email text check (email is null or char_length(email) <= 320),
  status text not null default 'active' check (status in ('pending', 'active', 'inactive', 'disabled', 'terminated', 'archived')),
  -- Human lifecycle (IDENTITY-P0-18 drives transitions); null for non-humans.
  lifecycle_state text check (lifecycle_state is null or lifecycle_state in
    ('PRE_JOIN', 'ACTIVE', 'LEAVE_PENDING', 'DISABLED', 'TERMINATED', 'ARCHIVED')),
  user_id uuid references users(id) on delete set null,
  agent_id uuid,
  source_system text check (source_system is null or char_length(source_system) <= 100),
  source_native_id text check (source_native_id is null or char_length(source_native_id) <= 300),
  correlation_key text check (correlation_key is null or char_length(correlation_key) <= 300),
  owner_identity_id uuid,
  sponsor_identity_id uuid,
  manager_identity_id uuid,
  department text check (department is null or char_length(department) <= 200),
  title text check (title is null or char_length(title) <= 200),
  business_unit text check (business_unit is null or char_length(business_unit) <= 200),
  location text check (location is null or char_length(location) <= 200),
  employment_type text check (employment_type is null or char_length(employment_type) <= 60),
  organization text check (organization is null or char_length(organization) <= 200),
  purpose text check (purpose is null or char_length(purpose) <= 2000),
  start_date date,
  end_date date,
  risk_score numeric,
  privileged boolean not null default false,
  external boolean not null default false,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_by uuid references users(id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  check (identity_type <> 'AI_AGENT' or agent_id is not null),
  check (agent_id is null or identity_type = 'AI_AGENT'),
  check (end_date is null or start_date is null or end_date >= start_date),
  foreign key (agent_id, tenant_id) references agents (id, tenant_id) on delete cascade,
  foreign key (owner_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (owner_identity_id),
  foreign key (sponsor_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (sponsor_identity_id),
  foreign key (manager_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (manager_identity_id)
);

comment on table identities is
  'WonderID common identity reference (IDENTITY-P0-15). AI_AGENT rows mirror agents 1:1 (agents is canonical); HUMAN rows may link to users. Tenant-scoped, RLS.';

create unique index identities_tenant_agent_key on identities (tenant_id, agent_id) where agent_id is not null;
create unique index identities_tenant_user_key on identities (tenant_id, user_id) where user_id is not null;
-- Agents carry no uniqueness on their source reference, so an AI agent's
-- mirror row is left out: the mirror must never make an agent insert fail.
create unique index identities_tenant_source_key on identities (tenant_id, source_system, source_native_id)
  where source_system is not null and source_native_id is not null and agent_id is null;
create index identities_tenant_type_idx on identities (tenant_id, identity_type, display_name);
create index identities_tenant_name_idx on identities (tenant_id, lower(display_name));
create index identities_tenant_email_idx on identities (tenant_id, lower(email)) where email is not null;
create index identities_tenant_correlation_idx on identities (tenant_id, correlation_key) where correlation_key is not null;
create index identities_owner_idx on identities (owner_identity_id) where owner_identity_id is not null;
create index identities_sponsor_idx on identities (sponsor_identity_id) where sponsor_identity_id is not null;
create index identities_manager_idx on identities (manager_identity_id) where manager_identity_id is not null;
create index identities_user_idx on identities (user_id) where user_id is not null;

alter table identities enable row level security;
create policy identities_select on identities
  for select using (tenant_id in (select current_tenant_ids()));
create policy identities_insert on identities
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy identities_update on identities
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- ---------------------------------------------------------------- attributes (IDENTITY-P0-16)

create table identity_attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Null: applies to every identity type.
  identity_type text check (identity_type is null or identity_type in
    ('HUMAN', 'EXTERNAL', 'MACHINE', 'SERVICE_ACCOUNT', 'APPLICATION', 'WORKLOAD', 'API', 'AI_AGENT')),
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,62}$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  data_type text not null check (data_type in ('string', 'number', 'boolean', 'date', 'enum')),
  required boolean not null default false,
  sensitive boolean not null default false,
  searchable boolean not null default false,
  unique_value boolean not null default false,
  allowed_values text[] not null default '{}',
  validation_regex text check (validation_regex is null or char_length(validation_regex) <= 300),
  source_mapping text check (source_mapping is null or char_length(source_mapping) <= 200),
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (data_type <> 'enum' or cardinality(allowed_values) > 0)
);
create unique index identity_attribute_definitions_key
  on identity_attribute_definitions (tenant_id, coalesce(identity_type, '*'), name);

alter table identity_attribute_definitions enable row level security;
create policy identity_attribute_definitions_select on identity_attribute_definitions
  for select using (tenant_id in (select current_tenant_ids()));
create policy identity_attribute_definitions_insert on identity_attribute_definitions
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy identity_attribute_definitions_update on identity_attribute_definitions
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- ---------------------------------------------------------------- relationships (IDENTITY-P0-16)

create table identity_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_identity_id uuid not null,
  target_identity_id uuid not null,
  relationship_type text not null check (relationship_type in
    ('manager_of', 'owns', 'sponsors', 'delegates_to', 'service_account_for', 'workload_runs_for', 'member_of')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  source text not null default 'manual' check (char_length(source) between 1 and 100),
  confidence text not null default 'confirmed' check (confidence in ('unverified', 'probable', 'confirmed')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_identity_id <> target_identity_id),
  check (valid_to is null or valid_to >= valid_from),
  foreign key (source_identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  foreign key (target_identity_id, tenant_id) references identities (id, tenant_id) on delete cascade
);
-- One current edge of a type between two identities.
create unique index identity_relationships_current_key
  on identity_relationships (tenant_id, source_identity_id, target_identity_id, relationship_type) where valid_to is null;
create index identity_relationships_source_idx on identity_relationships (tenant_id, source_identity_id);
create index identity_relationships_target_idx on identity_relationships (tenant_id, target_identity_id);

alter table identity_relationships enable row level security;
create policy identity_relationships_select on identity_relationships
  for select using (tenant_id in (select current_tenant_ids()));
create policy identity_relationships_insert on identity_relationships
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy identity_relationships_update on identity_relationships
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- ---------------------------------------------------------------- AI agents: 1:1 mirror

-- An agent's lifecycle, as the shared identity status.
create function identity_status_for_agent(lifecycle text) returns text
language sql immutable set search_path = '' as $$
  select case
    when lifecycle in ('ACTIVE', 'CERTIFICATION_DUE', 'RESTRICTED') then 'active'
    when lifecycle = 'SUSPENDED' then 'disabled'
    when lifecycle = 'RETIRED' then 'archived'
    else 'pending'
  end
$$;

-- SECURITY DEFINER so the mirror is written whoever creates the agent
-- (a member under RLS, or the service role for imports). It only ever
-- writes the row for NEW.id in NEW.tenant_id.
create function identity_sync_agent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into identities (tenant_id, identity_type, subtype, display_name, agent_id, status, source_system,
                            source_native_id, purpose, risk_score, last_seen_at, created_at)
    values (new.tenant_id, 'AI_AGENT', new.agent_type, coalesce(nullif(new.display_name, ''), new.agent_name), new.id,
            identity_status_for_agent(new.lifecycle_state), new.source_system, new.source_object_id, new.purpose,
            new.risk_score, new.last_seen_at, coalesce(new.created_at, now()))
    on conflict (tenant_id, agent_id) where agent_id is not null do nothing;
  else
    update identities
       set subtype = new.agent_type,
           display_name = coalesce(nullif(new.display_name, ''), new.agent_name),
           status = identity_status_for_agent(new.lifecycle_state),
           purpose = new.purpose,
           risk_score = new.risk_score,
           last_seen_at = new.last_seen_at,
           updated_at = now()
     where tenant_id = new.tenant_id and agent_id = new.id;
  end if;
  return new;
end
$$;
revoke all on function identity_sync_agent() from public;

create trigger agents_identity_sync
  after insert or update of agent_name, display_name, agent_type, lifecycle_state, purpose, risk_score, last_seen_at
  on agents for each row execute function identity_sync_agent();

-- ---------------------------------------------------------------- members: HUMAN identities

create function identity_sync_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u record;
begin
  select id, email, display_name into u from users where id = new.user_id;
  if u.id is null then
    return new;
  end if;
  insert into identities (tenant_id, identity_type, subtype, display_name, email, username, user_id, status,
                          lifecycle_state, source_system)
  values (new.tenant_id, 'HUMAN', 'employee', coalesce(nullif(u.display_name, ''), u.email), u.email, u.email, u.id,
          case when new.status = 'active' then 'active' else 'inactive' end,
          case when new.status = 'active' then 'ACTIVE' else 'DISABLED' end, 'wonderid')
  on conflict (tenant_id, user_id) where user_id is not null do nothing;
  return new;
end
$$;
revoke all on function identity_sync_membership() from public;

create trigger tenant_memberships_identity_sync
  after insert on tenant_memberships for each row execute function identity_sync_membership();

-- A membership suspended, removed or deleted makes the member's identity
-- here inactive; reinstated, it is active again. The identity row is kept
-- (its history and relationships matter after someone leaves). Only rows
-- the membership created (source 'wonderid') follow it.
create function identity_sync_membership_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  active boolean := tg_op = 'UPDATE' and new.status = 'active';
  m tenant_memberships := case when tg_op = 'DELETE' then old else new end;
begin
  update identities
     set status = case when active then 'active' else 'inactive' end,
         lifecycle_state = case when active then 'ACTIVE' else 'DISABLED' end,
         updated_at = now()
   where tenant_id = m.tenant_id and user_id = m.user_id and source_system = 'wonderid';
  return null;
end
$$;
revoke all on function identity_sync_membership_status() from public;

create trigger tenant_memberships_identity_status_sync
  after update of status on tenant_memberships for each row
  when (old.status is distinct from new.status)
  execute function identity_sync_membership_status();

create trigger tenant_memberships_identity_removed_sync
  after delete on tenant_memberships for each row
  execute function identity_sync_membership_status();

-- ---------------------------------------------------------------- backfill

insert into identities (tenant_id, identity_type, subtype, display_name, agent_id, status, source_system,
                        source_native_id, purpose, risk_score, last_seen_at, created_at)
select a.tenant_id, 'AI_AGENT', a.agent_type, coalesce(nullif(a.display_name, ''), a.agent_name), a.id,
       identity_status_for_agent(a.lifecycle_state), a.source_system, a.source_object_id, a.purpose, a.risk_score,
       a.last_seen_at, a.created_at
from agents a
on conflict (tenant_id, agent_id) where agent_id is not null do nothing;

insert into identities (tenant_id, identity_type, subtype, display_name, email, username, user_id, status,
                        lifecycle_state, source_system, created_at)
select m.tenant_id, 'HUMAN', 'employee', coalesce(nullif(u.display_name, ''), u.email), u.email, u.email, u.id,
       case when m.status = 'active' then 'active' else 'inactive' end,
       case when m.status = 'active' then 'ACTIVE' else 'DISABLED' end, 'wonderid', m.created_at
from tenant_memberships m join users u on u.id = m.user_id
on conflict (tenant_id, user_id) where user_id is not null do nothing;

-- ---------------------------------------------------------------- permissions

insert into permissions (key, description) values
  ('identity.read', 'View identities of every type, their attributes and relationships'),
  ('identity.manage', 'Create and update identities, attribute definitions and relationships')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('TENANT_SUPER_ADMIN', 'IAM_ADMIN') and p.key in ('identity.read', 'identity.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null
  and r.name in ('IAM_ARCHITECT', 'SECURITY_ADMIN', 'READ_ONLY', 'AUDITOR', 'CERTIFICATION_MANAGER',
                 'APPLICATION_OWNER', 'BUSINESS_OWNER', 'TECHNICAL_OWNER')
  and p.key = 'identity.read'
on conflict do nothing;
