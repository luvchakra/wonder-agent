-- Foundation Agent — FOUNDATION-P0-02.4
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.
--
-- Tenant context is derived ONLY from tenant_memberships rows belonging to the
-- authenticated user (auth.uid()) — never from a client-supplied tenant_id.
-- Tables with no INSERT/UPDATE/DELETE policy below are intentionally
-- mutation-only-via-service-role (server-side, after an explicit
-- requirePermission()/requirePlatformAdmin() check) — Postgres RLS denies a
-- command entirely for a role when no policy exists for it, regardless of
-- table-level grants.

create or replace function current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from tenant_memberships
  where user_id = auth.uid() and status = 'active';
$$;

-- tenants --------------------------------------------------------------
alter table tenants enable row level security;

create policy tenants_select on tenants
  for select
  using (id in (select current_tenant_ids()));

-- tenant_settings --------------------------------------------------------------
alter table tenant_settings enable row level security;

create policy tenant_settings_select on tenant_settings
  for select
  using (tenant_id in (select current_tenant_ids()));

-- users --------------------------------------------------------------
alter table users enable row level security;

create policy users_select_self on users
  for select
  using (id = auth.uid());

-- A user may see the profile (id, email, display_name) of anyone who shares
-- an active tenant membership with them — needed for member lists, owner
-- pickers, etc. Never exposes users with no shared tenant.
create policy users_select_tenant_peers on users
  for select
  using (
    id in (
      select tm.user_id
      from tenant_memberships tm
      where tm.tenant_id in (select current_tenant_ids())
        and tm.status = 'active'
    )
  );

create policy users_update_self on users
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- tenant_memberships --------------------------------------------------------------
alter table tenant_memberships enable row level security;

create policy tenant_memberships_select on tenant_memberships
  for select
  using (tenant_id in (select current_tenant_ids()));

-- roles --------------------------------------------------------------
alter table roles enable row level security;

create policy roles_select on roles
  for select
  using (tenant_id is null or tenant_id in (select current_tenant_ids()));

-- permissions --------------------------------------------------------------
alter table permissions enable row level security;

create policy permissions_select_all on permissions
  for select
  using (true);

-- role_permissions --------------------------------------------------------------
alter table role_permissions enable row level security;

create policy role_permissions_select on role_permissions
  for select
  using (
    role_id in (
      select id from roles
      where tenant_id is null or tenant_id in (select current_tenant_ids())
    )
  );

-- user_roles --------------------------------------------------------------
alter table user_roles enable row level security;

create policy user_roles_select on user_roles
  for select
  using (tenant_id in (select current_tenant_ids()));
