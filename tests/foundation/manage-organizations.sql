-- Foundation — live verification of migration 0161 (owner request
-- 2026-10-13: "Manage organizations"; an owner renames, disables and
-- enables an organization and its environments; a top-level organization
-- of any environment can add environments; environment orders are
-- tenant-isolated). Self-cleaning: one block ending in an exception, so
-- every fixture rolls back. Runs via execute_sql.
do $t$
declare
  u constant uuid := '11111111-1610-0000-0000-000000000001';
  other constant uuid := '11111111-1610-0000-0000-000000000002';
  t uuid;
  o uuid;
  e uuid;
  n int;
  r text := '';
begin
  insert into auth.users (id, email) values (u, 'fx-owner161@example.test'), (other, 'fx-other161@example.test');
  insert into users (id, email) values (u, 'fx-owner161@example.test'), (other, 'fx-other161@example.test') on conflict (id) do nothing;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  t := create_tenant_with_owner('Fixture Org', 'fx-org161', 'development');
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  o := create_tenant_with_owner('Other Org', 'fx-other161', 'production');
  perform set_config('role', 'postgres', true);

  -- A development organization can add environments; not its own kind.
  e := create_tenant_environment(t, 'test');
  r := r || 'env slug=' || (select slug from tenants where id = e) || ' name=' || (select name from tenants where id = e);
  begin perform create_tenant_environment(t, 'development'); r := r || ' | own kind=ALLOWED'; exception when others then r := r || ' | own kind=refused ' || sqlstate; end;
  begin perform create_tenant_environment(e, 'staging'); r := r || ' | env of env=ALLOWED'; exception when others then r := r || ' | env of env=refused ' || sqlstate; end;
  insert into environment_orders (tenant_id, environment, price_id, plan, currency, unit_amount, billing_interval, payment_mode, created_by)
  values (t, 'staging', 'pro_month_usd', 'pro', 'USD', 49900, 'month', 'test', u);

  -- Another organization's owner sees and changes nothing of it.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  r := r || ' | other sees=' || (select count(*) from my_managed_organizations() where tenant_id in (t, e));
  r := r || ' | other owner of t=' || is_organization_owner(t);
  begin perform owner_rename_organization(t, 'Hijack'); r := r || ' | other renames=ALLOWED'; exception when others then r := r || ' | other renames=refused ' || sqlstate; end;
  begin perform owner_set_organization_disabled(e, true); r := r || ' | other disables=ALLOWED'; exception when others then r := r || ' | other disables=refused ' || sqlstate; end;
  r := r || ' | other reads orders=' || (select count(*) from environment_orders where tenant_id = t);
  begin insert into environment_orders (tenant_id, environment, price_id, plan, currency, unit_amount, billing_interval, payment_mode, created_by) values (o, 'test', 'x', 'pro', 'USD', 0, 'month', 'test', other); r := r || ' | client insert=ALLOWED'; exception when others then r := r || ' | client insert=refused ' || sqlstate; end;

  -- The owner.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  r := r || ' | owner sees=' || (select count(*) from my_managed_organizations() where tenant_id in (t, e, o));
  r := r || ' | owner reads orders=' || (select count(*) from environment_orders where tenant_id = t);
  begin perform owner_rename_organization(e, 'Env'); r := r || ' | rename env=ALLOWED'; exception when others then r := r || ' | rename env=refused ' || sqlstate; end;
  begin perform owner_rename_organization(t, 'x'); r := r || ' | short name=ALLOWED'; exception when others then r := r || ' | short name=refused ' || sqlstate; end;
  r := r || ' | renamed from=' || owner_rename_organization(t, '  Fixture Renamed ');
  r := r || ' | env name=' || (select name from tenants where id = e);
  -- (Statuses are read as postgres: RLS hides a disabled organization's row from its own members.)
  select count(*) into n from owner_set_organization_disabled(e, true);
  perform set_config('role', 'postgres', true);
  r := r || ' | env disabled=' || n || ' ' || (select status from tenants where id = e) || ' org=' || (select status from tenants where id = t);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from owner_set_organization_disabled(t, true);
  r := r || ' | org disabled=' || n || ' reachable=' || (select count(*) from current_tenant_ids() c where c in (t, e)) || ' still listed=' || (select count(*) from my_managed_organizations() where tenant_id in (t, e));
  begin perform owner_set_organization_disabled(e, false); r := r || ' | env first=ALLOWED'; exception when others then r := r || ' | env first=refused ' || sqlstate; end;
  select count(*) into n from owner_set_organization_disabled(t, false);
  perform set_config('role', 'postgres', true);
  r := r || ' | org enabled=' || n || ' ' || (select string_agg(status || '/' || disabled_by_owner, ',' order by name) from tenants where id in (t, e));

  -- A platform suspension is not the owner's to lift.
  perform set_config('role', 'postgres', true);
  update tenants set status = 'suspended', disabled_by_owner = false where id = t;
  perform set_config('role', 'authenticated', true);
  begin perform owner_set_organization_disabled(t, false); r := r || ' | lift platform=ALLOWED'; exception when others then r := r || ' | lift platform=refused ' || sqlstate; end;
  perform set_config('role', 'postgres', true);
  raise exception 'RESULTS: %', r;
end $t$;
