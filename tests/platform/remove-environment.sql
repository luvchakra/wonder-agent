-- Platform — live verification of migration 0160 (owner request 2026-10-13:
-- remove an environment of an organization). Self-cleaning (rolls back).
-- Proves: removal decommissions the environment, frees its address (slug and
-- subdomain move to `<slug>-removed-…`) and its slot (unlinked), so the same
-- environment can be added again; production cannot be removed; a member
-- cannot call it (42501).
do $t$
declare
  p constant uuid := 'aaaaaaaa-1600-0000-0000-000000000001';
  a constant uuid := '11111111-1600-0000-0000-000000000001';
  role_id uuid; dev uuid; dev2 uuid; r text := '';
begin
  insert into tenants (id, name, slug, status) values (p, 'Fixture Remove Org', 'fixture-rm160', 'active');
  insert into auth.users (id, email) values (a, 'fx-rm160@example.test');
  insert into users (id, email) values (a, 'fx-rm160@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (p, a, 'active');
  select id into role_id from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
  insert into user_roles (tenant_id, user_id, role_id) values (p, a, role_id);
  dev := create_tenant_environment(p, 'development');
  r := 'removed=' || remove_tenant_environment(dev);
  r := r || ' | slug now=' || (select slug from tenants where id = dev) || ' | status=' || (select status from tenants where id = dev);
  r := r || ' | parent=' || coalesce((select parent_tenant_id::text from platform_tenants where tenant_id = dev), 'null');
  r := r || ' | old address resolves=' || (select count(*) from tenant_domains where hostname = 'fixture-rm160-dev');
  dev2 := create_tenant_environment(p, 'development');
  r := r || ' | re-added slug=' || (select slug from tenants where id = dev2);
  begin perform remove_tenant_environment(p); r := r || ' | remove production=ALLOWED'; exception when others then r := r || ' | remove production=refused ' || sqlstate; end;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin perform remove_tenant_environment(dev2); r := r || ' | member removes=ALLOWED'; exception when others then r := r || ' | member removes=refused ' || sqlstate; end;
  perform set_config('role', 'postgres', true);
  raise exception 'RESULTS: %', r;
end $t$;
