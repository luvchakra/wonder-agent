-- Foundation Agent — hardening follow-up from get_advisors (performance).

create index if not exists platform_admins_granted_by_idx on platform_admins (granted_by);
create index if not exists role_permissions_permission_id_idx on role_permissions (permission_id);
create index if not exists sso_connections_tenant_id_idx on sso_connections (tenant_id);
create index if not exists user_roles_role_id_idx on user_roles (role_id);
create index if not exists user_roles_user_id_idx on user_roles (user_id);

-- Consolidate the two users SELECT policies into one (avoids running two
-- permissive policies per query) and wrap auth.uid() in a `select` so it is
-- evaluated once per statement instead of once per row.
drop policy if exists users_select_self on users;
drop policy if exists users_select_tenant_peers on users;

create policy users_select on users
  for select
  using (
    id = (select auth.uid())
    or id in (
      select tm.user_id
      from tenant_memberships tm
      where tm.tenant_id in (select current_tenant_ids())
        and tm.status = 'active'
    )
  );

drop policy if exists users_update_self on users;
create policy users_update_self on users
  for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
