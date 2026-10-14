-- Access Agent — ACCESS-P0-23 live verification of migration 0176
-- (access_delegations; access_request_approvals.decided_on_behalf_of).
-- Run via the Supabase MCP execute_sql tool as one statement; it ends by
-- raising an exception that carries the results, so every fixture row
-- rolls back with it.
--
-- Proves:
-- - both people are members of the delegation's organization;
-- - never to oneself, never longer than 180 days, and it ends after it starts;
-- - the delegator and the delegate see it; another member does not; another
--   organization does not; nobody writes it directly.
--
-- Migration 0177 (part 2) adds the `requests` scope: a request delegation
-- is stored and seen exactly like an approval one; any other scope is
-- refused.
--
-- Rerun 2026-10-14 after 0177, 10 of 10 as expected: the counts below
-- are 2 for X and Y (one delegation of each scope), and scope 'admin' is
-- refused with 23514.
--
-- Run 2026-10-14 against the dev project, 9 of 9 as expected:
-- - a delegate from another organization: 23503;
-- - to oneself, 181 days, or ending before it starts: 23514 each;
-- - visible to X (delegator) 1, to Y (delegate) 1, to W (another member) 0,
--   to Z (another organization) 0;
-- - inserting one directly as a member: 42501.

do $$
declare
  a constant uuid := 'aaaaaaaa-1760-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1760-0000-0000-000000000002';
  x constant uuid := '11111111-1760-0000-0000-000000000001';
  y constant uuid := '22222222-1760-0000-0000-000000000002';
  w constant uuid := '44444444-1760-0000-0000-000000000004';
  z constant uuid := '33333333-1760-0000-0000-000000000003';
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A176', 'fixture-tenant-a176-test'), (b, 'Fixture Tenant B176', 'fixture-tenant-b176-test');
  insert into auth.users (id, email) values (x, 'fixture-x176@example.test'), (y, 'fixture-y176@example.test'), (w, 'fixture-w176@example.test'), (z, 'fixture-z176@example.test');
  insert into users (id, email) values (x, 'fixture-x176@example.test'), (y, 'fixture-y176@example.test'), (w, 'fixture-w176@example.test'), (z, 'fixture-z176@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (a, y, 'active'), (a, w, 'active'), (b, z, 'active');
  insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, starts_at, ends_at) values (a, x, y, now(), now() + interval '7 days');
  insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, scope, starts_at, ends_at) values (a, x, y, 'requests', now(), now() + interval '7 days');
  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, scope, starts_at, ends_at) values (a, x, y, 'admin', now(), now() + interval '1 day');
    results := results || E'\nscope admin (expect denied): ALLOWED';
  exception when others then results := results || E'\nscope admin (expect denied): denied ' || sqlstate; end;

  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, starts_at, ends_at) values (a, x, z, now(), now() + interval '1 day');
    results := results || E'\ndelegate from another tenant (expect denied): ALLOWED';
  exception when others then results := results || E'\ndelegate from another tenant (expect denied): denied ' || sqlstate; end;
  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, starts_at, ends_at) values (a, x, x, now(), now() + interval '1 day');
    results := results || E'\nto oneself (expect denied): ALLOWED';
  exception when others then results := results || E'\nto oneself (expect denied): denied ' || sqlstate; end;
  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, starts_at, ends_at) values (a, x, w, now(), now() + interval '181 days');
    results := results || E'\n181 days (expect denied): ALLOWED';
  exception when others then results := results || E'\n181 days (expect denied): denied ' || sqlstate; end;
  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, starts_at, ends_at) values (a, x, w, now(), now() - interval '1 day');
    results := results || E'\nending before it starts (expect denied): ALLOWED';
  exception when others then results := results || E'\nending before it starts (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from access_delegations where tenant_id = a; results := results || E'\nX (delegator) sees (expect 2): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  select count(*) into c from access_delegations where tenant_id = a; results := results || E'\nY (delegate) sees (expect 2): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  select count(*) into c from access_delegations where tenant_id = a; results := results || E'\nW (another member) sees (expect 0): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from access_delegations; results := results || E'\nZ (another tenant) sees (expect 0): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, starts_at, ends_at) values (a, x, w, now(), now() + interval '1 day');
    results := results || E'\nX: insert directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX: insert directly (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
