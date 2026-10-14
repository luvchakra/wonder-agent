-- Foundation Agent — FOUNDATION-P0-34 live verification of migration 0192
-- (short number keys for URLs). Run via the Supabase MCP execute_sql tool as
-- one statement; it ends by raising an exception that carries the results,
-- so every fixture row rolls back with it.
--
-- Run 2026-10-14 against the dev project after the owner ran 0192, 10 of 10
-- as expected: 1, 2 (a supplied number ignored), another organization 1, a
-- new organization numbered, a custom role 17 after 16 built-in roles,
-- changing a number 23514; X sees 4 of A's counters and 0 of B's, finds
-- nothing of B's by number, and a counter write changes 0 rows.
--
-- Proves:
-- - numbers count per organization from 1; a supplied number is replaced;
-- - an organization's own role is numbered after the built-in roles;
-- - a new organization gets a number; a number never changes;
-- - a member reads only their organization's counters, cannot write one,
--   and cannot reach another organization's object by its number.

do $$
declare
  a constant uuid := 'aaaaaaaa-1920-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1920-0000-0000-000000000002';
  x constant uuid := '11111111-1920-0000-0000-000000000001';
  z constant uuid := '33333333-1920-0000-0000-000000000003';
  i1 uuid; r1 bigint; r2 bigint; rb bigint; rr bigint; builtin bigint; tr bigint;
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A192', 'fixture-tenant-a192-test'), (b, 'Fixture Tenant B192', 'fixture-tenant-b192-test');
  select ref into tr from tenants where id = b;
  insert into auth.users (id, email) values (x, 'fixture-x192@example.test'), (z, 'fixture-z192@example.test');
  insert into users (id, email) values (x, 'fixture-x192@example.test'), (z, 'fixture-z192@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into applications (tenant_id, name) values (a, 'App A1') returning id, ref into i1, r1;
  insert into applications (tenant_id, name, ref) values (a, 'App A2', 999) returning ref into r2;
  insert into applications (tenant_id, name) values (b, 'App B1') returning ref into rb;
  results := results || E'\nfirst app (expect 1): ' || r1 || E'\nsecond, supplied ref ignored (expect 2): ' || r2 || E'\nother org starts at 1: ' || rb || E'\nnew organization has a number (expect true): ' || (tr is not null);
  select coalesce(max(ref), 0) into builtin from roles where tenant_id is null;
  insert into roles (tenant_id, name, display_name) values (a, 'FIXTURE_ROLE_192', 'Fixture role') returning ref into rr;
  results := results || E'\ncustom role after built-ins (expect ' || (builtin + 1) || '): ' || rr;
  begin
    update applications set ref = 77 where id = i1;
    results := results || E'\nchange a number (expect denied): ALLOWED';
  exception when others then results := results || E'\nchange a number (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from object_ref_counters where tenant_id = a; results := results || E'\nX sees A''s counters (expect > 0): ' || c;
  select count(*) into c from object_ref_counters where tenant_id = b; results := results || E'\nX sees B''s counters (expect 0): ' || c;
  select count(*) into c from applications where tenant_id = b and ref = 1; results := results || E'\nX finds B''s app 1 by number (expect 0): ' || c;
  update object_ref_counters set last_ref = 0 where tenant_id = a;
  get diagnostics c = row_count; results := results || E'\nX writes a counter (expect 0 rows): ' || c;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
