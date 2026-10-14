-- Access Agent — live verification of migration 0190 (request numbers). Run
-- via the Supabase MCP execute_sql tool as one statement; it ends by raising
-- an exception that carries the results, so every fixture row rolls back.
--
-- Run 2026-10-14 against the dev project, 7 of 7 as expected: REQ000000001,
-- REQ000000002 (a supplied number ignored), another organization REQ000000001;
-- changing a number 23514; a member sees 1 counter, another organization 0,
-- and a direct counter write changes 0 rows.
--
-- Proves:
-- - each request is numbered REQ and nine digits, per organization, in order;
-- - a number supplied by the caller is replaced; a number never changes;
-- - a member sees only their own organization's counter.

do $$
declare
  a constant uuid := 'aaaaaaaa-1900-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1900-0000-0000-000000000002';
  x constant uuid := '11111111-1900-0000-0000-000000000001';
  z constant uuid := '33333333-1900-0000-0000-000000000003';
  ag uuid;
  bg uuid;
  app uuid;
  bapp uuid;
  r1 uuid;
  n1 text;
  n2 text;
  n3 text;
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A190', 'fixture-tenant-a190-test'), (b, 'Fixture Tenant B190', 'fixture-tenant-b190-test');
  insert into auth.users (id, email) values (x, 'fixture-x190@example.test'), (z, 'fixture-z190@example.test');
  insert into users (id, email) values (x, 'fixture-x190@example.test'), (z, 'fixture-z190@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into agents (tenant_id, agent_name, agent_type) values (a, 'Fixture agent A', 'assistant') returning id into ag;
  insert into agents (tenant_id, agent_name, agent_type) values (b, 'Fixture agent B', 'assistant') returning id into bg;
  insert into applications (tenant_id, name) values (a, 'Fixture app A') returning id into app;
  insert into applications (tenant_id, name) values (b, 'Fixture app B') returning id into bapp;

  insert into access_requests (tenant_id, agent_id, requested_by, application_id, justification) values (a, ag, x, app, 'first') returning id, request_number into r1, n1;
  insert into access_requests (tenant_id, agent_id, requested_by, application_id, justification, request_number) values (a, ag, x, app, 'second, with a number of its own', 'REQ999999999') returning request_number into n2;
  insert into access_requests (tenant_id, agent_id, requested_by, application_id, justification) values (b, bg, z, bapp, 'other organization') returning request_number into n3;
  results := results || E'\nfirst (expect REQ000000001): ' || n1;
  results := results || E'\nsecond, supplied number ignored (expect REQ000000002): ' || n2;
  results := results || E'\nanother organization starts its own count (expect REQ000000001): ' || n3;
  begin
    update access_requests set request_number = 'REQ000000077' where id = r1;
    results := results || E'\nchange a number (expect denied): ALLOWED';
  exception when others then results := results || E'\nchange a number (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from access_request_counters where tenant_id in (a, b); results := results || E'\nX sees counters (expect 1): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from access_request_counters where tenant_id = a; results := results || E'\nZ sees A''s counter (expect 0): ' || c;
  begin
    update access_request_counters set last_number = 0 where tenant_id = b;
    get diagnostics c = row_count; results := results || E'\nZ writes its own counter (expect 0 rows): ' || c;
  exception when others then results := results || E'\nZ writes its own counter (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
