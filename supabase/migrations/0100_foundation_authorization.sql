-- FOUNDATION-P0-19 (WonderID Phase 4b, 2026-09-26) — scoped role
-- assignments and explicit authorization policies
-- (docs/requirements/WonderID_Tenant_User_Permissioning_Model.md §18–22,
-- 33; lib/rbac/authorizeCore.ts is the evaluator).
--
-- 1. Every role assignment, direct (user_roles) or through a group
--    (group_roles), carries:
--    - a scope: the whole tenant (the default, and what every existing
--      assignment keeps), environments, applications or agents;
--    - a validity window (starts_at, expires_at);
--    - a condition: requires_mfa (an aal2 session).
--    Its source follows from the table: DIRECT or GROUP. Who assigned it
--    is granted_by (0096, 0099).
-- 2. A scope's applications and agents must be the tenant's own, and a
--    Tenant Administrator assignment stays unconditional (trigger).
-- 3. authorization_policies: the tenant's explicit deny and
--    require-approval rules, with exempt roles (break glass). Read by the
--    tenant's members (the engine runs as the member); written by the
--    service. A policy can never cover tenant.security.manage, the
--    permission that manages policies — nobody can lock the tenant out of
--    undoing one.
--
-- Additive: defaults keep every existing assignment exactly as it was.

alter table user_roles
  add column scope_type text not null default 'tenant',
  add column scope_values text[] not null default '{}',
  add column starts_at timestamptz,
  add column expires_at timestamptz,
  add column requires_mfa boolean not null default false,
  add constraint user_roles_scope_type_check check (scope_type in ('tenant', 'environment', 'application', 'agent')),
  add constraint user_roles_scope_values_check check (
    (scope_type = 'tenant') = (cardinality(scope_values) = 0)
    and cardinality(scope_values) <= 50
    and (scope_type <> 'environment' or scope_values <@ array['production', 'staging', 'development'])
  ),
  add constraint user_roles_window_check check (starts_at is null or expires_at is null or starts_at < expires_at);

alter table group_roles
  add column scope_type text not null default 'tenant',
  add column scope_values text[] not null default '{}',
  add column starts_at timestamptz,
  add column expires_at timestamptz,
  add column requires_mfa boolean not null default false,
  add constraint group_roles_scope_type_check check (scope_type in ('tenant', 'environment', 'application', 'agent')),
  add constraint group_roles_scope_values_check check (
    (scope_type = 'tenant') = (cardinality(scope_values) = 0)
    and cardinality(scope_values) <= 50
    and (scope_type <> 'environment' or scope_values <@ array['production', 'staging', 'development'])
  ),
  add constraint group_roles_window_check check (starts_at is null or expires_at is null or starts_at < expires_at);

-- A scope's applications and agents belong to the assignment's tenant.
create function role_assignment_scope_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v text;
begin
  -- A Tenant Administrator assignment is unconditional: scoping, timing or
  -- conditioning it could leave the organization with nobody who can
  -- administer it (the last-administrator guard of 0096 counts rows).
  -- (Nested so NEW.role_id is read only on the assignment tables; policies share this function.)
  if tg_table_name in ('user_roles', 'group_roles') then
    if (new.scope_type <> 'tenant' or new.starts_at is not null or new.expires_at is not null or new.requires_mfa)
       and exists (select 1 from roles r where r.id = new.role_id and r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN') then
      raise exception 'ADMIN_ASSIGNMENT_UNCONDITIONAL: the Tenant Administrator role is always organization-wide, permanent and unconditional' using errcode = '23514';
    end if;
  end if;
  if new.scope_type in ('application', 'agent') then
    foreach v in array new.scope_values loop
      if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'SCOPE_NOT_IN_TENANT: % is not an id', v using errcode = '23514';
      end if;
      if new.scope_type = 'application' and not exists (select 1 from applications a where a.id = v::uuid and a.tenant_id = new.tenant_id) then
        raise exception 'SCOPE_NOT_IN_TENANT: no such application in this organization' using errcode = '23514';
      end if;
      if new.scope_type = 'agent' and not exists (select 1 from agents a where a.id = v::uuid and a.tenant_id = new.tenant_id) then
        raise exception 'SCOPE_NOT_IN_TENANT: no such agent in this organization' using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end
$$;
revoke execute on function role_assignment_scope_guard() from public, anon, authenticated;
create trigger user_roles_scope_guard before insert or update on user_roles
  for each row execute function role_assignment_scope_guard();
create trigger group_roles_scope_guard before insert or update on group_roles
  for each row execute function role_assignment_scope_guard();

-- ------------------------------------------------ authorization policies

create table authorization_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  effect text not null check (effect in ('DENY', 'REQUIRE_APPROVAL')),
  permissions text[] not null check (cardinality(permissions) between 1 and 50),
  scope_type text not null default 'tenant' check (scope_type in ('tenant', 'environment', 'application', 'agent')),
  scope_values text[] not null default '{}',
  exempt_role_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authorization_policies_scope_values_check check (
    (scope_type = 'tenant') = (cardinality(scope_values) = 0)
    and cardinality(scope_values) <= 50
    and (scope_type <> 'environment' or scope_values <@ array['production', 'staging', 'development'])
  ),
  -- Never a policy over everything, nor over the permission that manages policies.
  constraint authorization_policies_no_lockout check (
    not ('*' = any (permissions)) and not ('tenant.*' = any (permissions)) and not ('tenant.security.*' = any (permissions))
    and not ('tenant.security.manage' = any (permissions))
  )
);
create unique index authorization_policies_tenant_name_key on authorization_policies (tenant_id, lower(name));
create index authorization_policies_tenant_status_idx on authorization_policies (tenant_id, status);

alter table authorization_policies enable row level security;
create policy authorization_policies_select on authorization_policies for select using (tenant_id in (select current_tenant_ids()));

create function authorization_policies_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if exists (select 1 from unnest(new.exempt_role_ids) r where not exists (
    select 1 from roles x where x.id = r and (x.tenant_id is null or x.tenant_id = new.tenant_id))) then
    raise exception 'ROLE_NOT_IN_TENANT: an exempt role belongs to another organization' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function authorization_policies_guard() from public, anon, authenticated;
create trigger authorization_policies_guard before insert or update on authorization_policies
  for each row execute function authorization_policies_guard();
-- Applications and agents in a policy's scope are the tenant's own (same rule as assignments).
create trigger authorization_policies_scope_guard before insert or update on authorization_policies
  for each row execute function role_assignment_scope_guard();

-- Permission keys for the policies screen: viewing is part of seeing who
-- can do what (permissions.view); changing them is tenant security
-- configuration (tenant.security.manage). No new keys.
