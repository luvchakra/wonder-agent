-- Access Agent — ACCESS-P0-35 live verification of migration 0179
-- (governance_changes, governance_object_versions). Run via the Supabase
-- MCP execute_sql tool as one statement; it ends by raising an exception
-- that carries the results, so every fixture row rolls back with it.
--
-- Run 2026-10-14 against the dev project, 10 of 10 as expected: a second
-- waiting change 23505; decided by its proposer 23514; X sees 1 change and
-- 1 version; W and Z see 0 of each; direct insert 42501; direct update 0 rows.
--
-- Proves:
-- - one waiting change per object; nobody decides their own;
-- - a member who manages access sees the organization's changes and
--   versions; a member who does not sees none; another organization sees
--   none; nobody writes either table directly.

do $$
declare
  a constant uuid := 'aaaaaaaa-1790-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1790-0000-0000-000000000002';
  x constant uuid := '11111111-1790-0000-0000-000000000001';
  w constant uuid := '44444444-1790-0000-0000-000000000004';
  z constant uuid := '33333333-1790-0000-0000-000000000003';
  iam uuid;
  ch uuid;
  results text := '';
  c integer;
begin
  select id into iam from roles where tenant_id is null and name = 'IAM_ADMIN';
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A179', 'fixture-tenant-a179-test'), (b, 'Fixture Tenant B179', 'fixture-tenant-b179-test');
  insert into auth.users (id, email) values (x, 'fixture-x179@example.test'), (w, 'fixture-w179@example.test'), (z, 'fixture-z179@example.test');
  insert into users (id, email) values (x, 'fixture-x179@example.test'), (w, 'fixture-w179@example.test'), (z, 'fixture-z179@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (a, w, 'active'), (b, z, 'active');
  insert into user_roles (tenant_id, user_id, role_id) values (a, x, iam), (b, z, iam);
  insert into governance_changes (tenant_id, object_type, object_key, proposed, requested_by) values (a, 'request_policy', '{"applicationId":null,"entitlementId":null}', '{"auto_approve":true}', x) returning id into ch;
  insert into governance_object_versions (tenant_id, object_type, object_id, version, snapshot, change_id) values (a, 'request_policy', gen_random_uuid(), 1, '{}', ch);

  begin
    insert into governance_changes (tenant_id, object_type, object_key, proposed, requested_by) values (a, 'request_policy', '{"entitlementId":null,"applicationId":null}', '{}', w);
    results := results || E'\nsecond waiting change for the same object (expect denied): ALLOWED';
  exception when others then results := results || E'\nsecond waiting change for the same object (expect denied): denied ' || sqlstate; end;
  begin
    update governance_changes set status = 'approved', decided_by = x, decided_at = now() where id = ch;
    results := results || E'\ndecided by its proposer (expect denied): ALLOWED';
  exception when others then results := results || E'\ndecided by its proposer (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from governance_changes where tenant_id = a; results := results || E'\nX (manages access) sees changes (expect 1): ' || c;
  select count(*) into c from governance_object_versions where tenant_id = a; results := results || E'\nX sees versions (expect 1): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  select count(*) into c from governance_changes where tenant_id = a; results := results || E'\nW (member, no access.manage) sees changes (expect 0): ' || c;
  select count(*) into c from governance_object_versions where tenant_id = a; results := results || E'\nW sees versions (expect 0): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from governance_changes; results := results || E'\nZ (another organization) sees changes (expect 0): ' || c;
  select count(*) into c from governance_object_versions; results := results || E'\nZ sees versions (expect 0): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  begin
    insert into governance_changes (tenant_id, object_type, object_key, proposed, requested_by) values (a, 'request_policy', '{"applicationId":"x"}', '{}', x);
    results := results || E'\nX: insert a change directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX: insert a change directly (expect denied): denied ' || sqlstate; end;
  begin
    update governance_changes set decision_note = 'x' where id = ch;
    get diagnostics c = row_count;
    results := results || E'\nX: update a change directly (expect 0 rows): ' || c;
  exception when others then results := results || E'\nX: update a change directly (expect 0 rows): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
