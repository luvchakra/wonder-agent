-- Platform Agent — live verification of migration 0156 (organization
-- environments, owner request 2026-10-13). Self-cleaning: one block ending in
-- an exception, so every fixture rolls back. Runs through execute_sql.
--
-- Proves: create_tenant_environment() makes `<slug>-dev` with its own
-- tenant, settings, platform record (development, parent) and platform
-- subdomain; copies only the parent's active administrators (not ordinary
-- members, not suspended admins); refuses a second dev, an environment of an
-- environment and an unknown kind; an authenticated member cannot call it;
-- the new organization's rows are invisible to a member of the parent who was
-- not copied (isolation).
do $t$
declare
  p constant uuid := 'aaaaaaaa-1560-0000-0000-000000000001';
  admin_u constant uuid := '11111111-1560-0000-0000-000000000001';
  member_u constant uuid := '11111111-1560-0000-0000-000000000002';
  suspended_u constant uuid := '11111111-1560-0000-0000-000000000003';
  admin_role uuid;
  dev uuid;
  r text := '';
begin
  insert into tenants (id, name, slug, status) values (p, 'Fixture Env Org', 'fixture-env156', 'active');
  insert into tenant_settings (tenant_id) values (p) on conflict do nothing;
  insert into auth.users (id, email) values (admin_u, 'fx-admin156@example.test'), (member_u, 'fx-member156@example.test'), (suspended_u, 'fx-susp156@example.test');
  insert into users (id, email) values (admin_u, 'fx-admin156@example.test'), (member_u, 'fx-member156@example.test'), (suspended_u, 'fx-susp156@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (p, admin_u, 'active'), (p, member_u, 'active'), (p, suspended_u, 'active');
  select id into admin_role from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
  insert into user_roles (tenant_id, user_id, role_id) values (p, admin_u, admin_role), (p, suspended_u, admin_role);
  update tenant_memberships set status = 'suspended' where tenant_id = p and user_id = suspended_u;

  dev := create_tenant_environment(p, 'development');
  r := r || 'slug=' || (select slug from tenants where id = dev);
  r := r || ' | name=' || (select name from tenants where id = dev);
  r := r || ' | platform=' || (select environment || '/' || (parent_tenant_id = p)::text from platform_tenants where tenant_id = dev);
  r := r || ' | domain=' || coalesce((select string_agg(hostname, ',') from tenant_domains where tenant_id = dev), 'none');
  r := r || ' | members(expect 1 admin)=' || (select count(*) from tenant_memberships where tenant_id = dev) || '/' || (select count(*) from user_roles where tenant_id = dev and role_id = admin_role and user_id = admin_u);
  begin perform create_tenant_environment(p, 'development'); r := r || ' | second dev=ALLOWED'; exception when others then r := r || ' | second dev=refused ' || sqlstate; end;
  begin perform create_tenant_environment(dev, 'test'); r := r || ' | env of env=ALLOWED'; exception when others then r := r || ' | env of env=refused ' || sqlstate; end;
  begin perform create_tenant_environment(p, 'qa'); r := r || ' | unknown=ALLOWED'; exception when others then r := r || ' | unknown=refused ' || sqlstate; end;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_u, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin perform create_tenant_environment(p, 'test'); r := r || ' | member calls=ALLOWED'; exception when others then r := r || ' | member calls=refused ' || sqlstate; end;
  r := r || ' | member sees dev tenant(expect 0)=' || (select count(*) from tenants where id = dev);
  perform set_config('role', 'postgres', true);
  raise exception 'RESULTS: %', r;
end $t$;
