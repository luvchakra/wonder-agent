-- Platform — live verification of migration 0165 (owner approval
-- 2026-10-13: production is addable to an organization set up as another
-- environment, at the organization's bare prefix). Self-cleaning: one block
-- ending in an exception, so every fixture rolls back. Runs via execute_sql.
-- Expected: prod slug=fx-prod165 name=Fixture Prod (Production)
-- env=production linked=true owner member=1 | twice=refused 23505 |
-- prod org adds prod=refused 23505 | prod org adds dev=fx-plain165-dev |
-- prod order=ok
do $t$
declare
  u constant uuid := '11111111-1650-0000-0000-000000000001';
  t uuid; p uuid; o uuid; d uuid;
  r text := '';
begin
  insert into auth.users (id, email) values (u, 'fx-prod165@example.test');
  insert into users (id, email) values (u, 'fx-prod165@example.test') on conflict (id) do nothing;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  t := create_tenant_with_owner('Fixture Prod', 'fx-prod165-dev', 'development');
  o := create_tenant_with_owner('Fixture Plain', 'fx-plain165', 'production');
  perform set_config('role', 'postgres', true);
  p := create_tenant_environment(t, 'production');
  r := r || 'prod slug=' || (select slug from tenants where id = p) || ' name=' || (select name from tenants where id = p)
        || ' env=' || (select environment from platform_tenants where tenant_id = p) || ' linked=' || ((select parent_tenant_id from platform_tenants where tenant_id = p) = t)
        || ' owner member=' || (select count(*) from tenant_memberships where tenant_id = p and user_id = u);
  begin perform create_tenant_environment(t, 'production'); r := r || ' | twice=ALLOWED'; exception when others then r := r || ' | twice=refused ' || sqlstate; end;
  begin perform create_tenant_environment(o, 'production'); r := r || ' | prod org adds prod=ALLOWED'; exception when others then r := r || ' | prod org adds prod=refused ' || sqlstate; end;
  d := create_tenant_environment(o, 'development');
  r := r || ' | prod org adds dev=' || (select slug from tenants where id = d);
  begin insert into environment_orders (tenant_id, environment, price_id, plan, currency, unit_amount, billing_interval, payment_mode, created_by) values (t, 'production', 'pro_month_usd', 'pro', 'USD', 49900, 'month', 'test', u); r := r || ' | prod order=ok'; exception when others then r := r || ' | prod order=refused ' || sqlstate; end;
  raise exception 'RESULTS: %', r;
end $t$;
