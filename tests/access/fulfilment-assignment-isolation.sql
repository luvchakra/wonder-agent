-- Access Agent — ACCESS-P0-42 live verification of migration 0173
-- (application_fulfilment_assignments; access_fulfilment_tasks group
-- assignee). Run via the Supabase MCP execute_sql tool as one statement.
-- It ends by raising an exception that carries the results, so every
-- fixture row rolls back with it.
--
-- Proves:
-- - an application's tasks go to a person or a group of the same
--   organization, never another organization's, never both or neither;
-- - one row for the application and one per entitlement type, ignoring
--   case;
-- - a member reads only their own organization's rows and cannot write.
--
-- Run 2026-10-14 against the dev project, 9 of 9 as expected:
-- - another organization's group or person: 23503 each;
-- - both a person and a group, or neither: 23514 each;
-- - a second default row, or the same type in another case: 23505 each;
-- - as a member: own rows 2, B's 0; changing one directly 0 rows;
--   inserting one 42501.

do $$
declare
  a constant uuid := 'aaaaaaaa-1730-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1730-0000-0000-000000000002';
  x constant uuid := '11111111-1730-0000-0000-000000000001';
  app constant uuid := 'a1730000-0000-0000-0000-0000000000a1';
  appb constant uuid := 'b1730000-0000-0000-0000-0000000000b1';
  ia constant uuid := 'a1730000-0000-0000-0000-0000000000d1';
  ib constant uuid := 'b1730000-0000-0000-0000-0000000000d2';
  ga constant uuid := 'a1730000-0000-0000-0000-0000000000e1';
  gb constant uuid := 'b1730000-0000-0000-0000-0000000000e2';
  results text := '';
  n integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A173', 'fixture-tenant-a173-test'), (b, 'Fixture Tenant B173', 'fixture-tenant-b173-test');
  insert into auth.users (id, email) values (x, 'fixture-x173@example.test');
  insert into users (id, email) values (x, 'fixture-x173@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active');
  insert into applications (id, tenant_id, name) values (app, a, 'App A173'), (appb, b, 'App B173');
  insert into identities (id, tenant_id, identity_type, display_name) values (ia, a, 'HUMAN', 'Person A173'), (ib, b, 'HUMAN', 'Person B173');
  insert into groups (id, tenant_id, name) values (ga, a, 'Fulfilers A173'), (gb, b, 'Fulfilers B173');
  insert into application_fulfilment_assignments (tenant_id, application_id, assignee_group_id) values (a, app, ga);
  insert into application_fulfilment_assignments (tenant_id, application_id, entitlement_type, assignee_identity_id) values (a, app, 'License', ia);
  insert into application_fulfilment_assignments (tenant_id, application_id, assignee_group_id) values (b, appb, gb);

  begin
    insert into application_fulfilment_assignments (tenant_id, application_id, entitlement_type, assignee_group_id) values (a, app, 'role', gb);
    results := results || E'\nanother tenant''s group (expect denied): ALLOWED';
  exception when others then results := results || E'\nanother tenant''s group (expect denied): denied ' || sqlstate; end;
  begin
    insert into application_fulfilment_assignments (tenant_id, application_id, entitlement_type, assignee_identity_id) values (a, app, 'role', ib);
    results := results || E'\nanother tenant''s person (expect denied): ALLOWED';
  exception when others then results := results || E'\nanother tenant''s person (expect denied): denied ' || sqlstate; end;
  begin
    insert into application_fulfilment_assignments (tenant_id, application_id, entitlement_type, assignee_identity_id, assignee_group_id) values (a, app, 'role', ia, ga);
    results := results || E'\nboth a person and a group (expect denied): ALLOWED';
  exception when others then results := results || E'\nboth a person and a group (expect denied): denied ' || sqlstate; end;
  begin
    insert into application_fulfilment_assignments (tenant_id, application_id, entitlement_type) values (a, app, 'role');
    results := results || E'\nneither a person nor a group (expect denied): ALLOWED';
  exception when others then results := results || E'\nneither a person nor a group (expect denied): denied ' || sqlstate; end;
  begin
    insert into application_fulfilment_assignments (tenant_id, application_id, assignee_identity_id) values (a, app, ia);
    results := results || E'\na second default row (expect denied): ALLOWED';
  exception when others then results := results || E'\na second default row (expect denied): denied ' || sqlstate; end;
  begin
    insert into application_fulfilment_assignments (tenant_id, application_id, entitlement_type, assignee_group_id) values (a, app, 'LICENSE', ga);
    results := results || E'\nsame type in another case (expect denied): ALLOWED';
  exception when others then results := results || E'\nsame type in another case (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  results := results || E'\nX: own rows / B rows (expect 2/0): '
    || (select count(*) from application_fulfilment_assignments where tenant_id = a) || '/' || (select count(*) from application_fulfilment_assignments where tenant_id = b);
  update application_fulfilment_assignments set assignee_group_id = null, assignee_identity_id = ia where tenant_id = a and entitlement_type is null;
  get diagnostics n = row_count;
  results := results || E'\nX: change a row directly (expect 0): ' || n;
  begin
    insert into application_fulfilment_assignments (tenant_id, application_id, entitlement_type, assignee_group_id) values (a, app, 'forged', ga);
    results := results || E'\nX: insert a row directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX: insert a row directly (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
