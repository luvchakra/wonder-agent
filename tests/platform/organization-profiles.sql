-- Platform — live verification of migrations 0162 and 0164 (owner requests
-- 2026-10-13: organization details in the console; rename from the console;
-- environment addresses without stacked suffixes). Self-cleaning: one block
-- ending in an exception, so every fixture rolls back. Runs via execute_sql.
do $t$
declare
  u constant uuid := '11111111-1620-0000-0000-000000000001';
  t uuid;
  e uuid;
  r text := '';
begin
  insert into auth.users (id, email) values (u, 'fx-profile162@example.test');
  insert into users (id, email) values (u, 'fx-profile162@example.test') on conflict (id) do nothing;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  t := create_tenant_with_owner('Fixture Profile', 'fx-prof162-dev', 'development');
  perform set_config('role', 'postgres', true);

  insert into platform_organization_profiles (tenant_id, contact_name, contact_email, industry) values (t, 'Ava', 'ava@example.test', 'Banking');
  begin update platform_organization_profiles set contact_email = 'not-an-email' where tenant_id = t; r := r || 'bad email=ALLOWED'; exception when others then r := r || 'bad email=refused ' || sqlstate; end;
  begin update platform_organization_profiles set user_base_size = 'lots' where tenant_id = t; r := r || ' | bad size=ALLOWED'; exception when others then r := r || ' | bad size=refused ' || sqlstate; end;

  e := create_tenant_environment(t, 'staging');
  r := r || ' | env slug=' || (select slug from tenants where id = e);
  r := r || ' | renamed from=' || platform_rename_organization(t, 'Fixture Renamed');
  r := r || ' | env name=' || (select name from tenants where id = e);
  begin perform platform_rename_organization(e, 'Env'); r := r || ' | rename env=ALLOWED'; exception when others then r := r || ' | rename env=refused ' || sqlstate; end;

  -- A member of the organization reads none of the vendor-side details, and cannot call the rename.
  perform set_config('role', 'authenticated', true);
  begin r := r || ' | member reads=' || (select count(*) from platform_organization_profiles); exception when others then r := r || ' | member reads=refused ' || sqlstate; end;
  begin perform platform_rename_organization(t, 'Hijack'); r := r || ' | member renames=ALLOWED'; exception when others then r := r || ' | member renames=refused ' || sqlstate; end;
  perform set_config('role', 'postgres', true);
  raise exception 'RESULTS: %', r;
end $t$;
