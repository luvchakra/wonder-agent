-- Access Agent — ACCESS-P0-34 live verification of migration 0171
-- (application_onboarding_templates; application_onboardings.template_id
-- and answers). Run via the Supabase MCP execute_sql tool as one
-- statement. It ends by raising an exception that carries the results, so
-- every fixture row rolls back with it.
--
-- Proves:
-- - one template name per organization, ignoring case;
-- - a template names only a real connection type;
-- - an onboarding cannot start from another organization's template, and a
--   template in use cannot be deleted;
-- - a member reads only their own organization's templates and cannot
--   write any.
--
-- Run 2026-10-14 against the dev project, 8 of 8 as expected:
-- - duplicate name in another case: 23505;
-- - unknown connection type: 23503;
-- - another organization's template on an onboarding: 23503;
-- - deleting a template in use: 23503;
-- - as a member: own templates 1, B's 0; changing one directly 0 rows;
--   inserting one 42501.

do $$
declare
  a constant uuid := 'aaaaaaaa-1710-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1710-0000-0000-000000000002';
  x constant uuid := '11111111-1710-0000-0000-000000000001';
  ta constant uuid := 'a1710000-0000-0000-0000-0000000000a1';
  tb constant uuid := 'b1710000-0000-0000-0000-0000000000b1';
  app constant uuid := 'a1710000-0000-0000-0000-0000000000c1';
  results text := '';
  n integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A171', 'fixture-tenant-a171-test'), (b, 'Fixture Tenant B171', 'fixture-tenant-b171-test');
  insert into auth.users (id, email) values (x, 'fixture-x171@example.test');
  insert into users (id, email) values (x, 'fixture-x171@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active');
  insert into application_onboarding_templates (id, tenant_id, name) values (ta, a, 'SaaS apps'), (tb, b, 'B template');
  insert into applications (id, tenant_id, name) values (app, a, 'App A171');

  begin
    insert into application_onboarding_templates (tenant_id, name) values (a, 'SAAS APPS');
    results := results || E'\nduplicate name, other case (expect denied): ALLOWED';
  exception when others then results := results || E'\nduplicate name, other case (expect denied): denied ' || sqlstate; end;
  begin
    insert into application_onboarding_templates (tenant_id, name, integration_type_id) values (a, 'Typed', 'no_such_type');
    results := results || E'\nunknown connection type (expect denied): ALLOWED';
  exception when others then results := results || E'\nunknown connection type (expect denied): denied ' || sqlstate; end;
  begin
    insert into application_onboardings (tenant_id, application_id, config_hash, template_id) values (a, app, repeat('0', 64), tb);
    results := results || E'\nanother tenant''s template on an onboarding (expect denied): ALLOWED';
  exception when others then results := results || E'\nanother tenant''s template on an onboarding (expect denied): denied ' || sqlstate; end;
  insert into application_onboardings (tenant_id, application_id, config_hash, template_id) values (a, app, repeat('0', 64), ta);
  begin
    delete from application_onboarding_templates where id = ta;
    results := results || E'\ndelete a template in use (expect denied): ALLOWED';
  exception when others then results := results || E'\ndelete a template in use (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  results := results || E'\nX: own templates / B templates (expect 1/0): '
    || (select count(*) from application_onboarding_templates where tenant_id = a) || '/' || (select count(*) from application_onboarding_templates where tenant_id = b);
  update application_onboarding_templates set name = 'forged' where tenant_id = a;
  get diagnostics n = row_count;
  results := results || E'\nX: change a template directly (expect 0): ' || n;
  begin
    insert into application_onboarding_templates (tenant_id, name) values (a, 'forged');
    results := results || E'\nX: insert a template directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX: insert a template directly (expect denied): denied ' || sqlstate; end;
  update application_onboardings set answers = '{"x": "y"}' where tenant_id = a;
  get diagnostics n = row_count;
  results := results || E'\nX: change answers directly (expect 0): ' || n;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
