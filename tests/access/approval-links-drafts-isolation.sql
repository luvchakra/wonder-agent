-- Access Agent — ACCESS-P0-38 part 2 live verification of migration 0175
-- (access_approval_links, access_request_drafts). Run via the Supabase MCP
-- execute_sql tool as one statement; it ends by raising an exception that
-- carries the results, so every fixture row rolls back with it.
--
-- Proves:
-- - a link names a request of its own organization;
-- - a token hash is unique and 64 characters;
-- - a member reads only their own links and drafts, never another
--   member's or another organization's, and can write neither table.
--
-- Run 2026-10-14 against the dev project, 7 of 7 as expected:
-- - a link to another organization's request: 23503;
-- - a reused token hash: 23505; a short one: 23514;
-- - as member X: own links 1, Y's 0, B's 0; own drafts 1, Y's 0, B's 0;
--   changing a draft directly 0 rows; inserting a link 42501.

do $$
declare
  a constant uuid := 'aaaaaaaa-1750-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1750-0000-0000-000000000002';
  x constant uuid := '11111111-1750-0000-0000-000000000001';
  y constant uuid := '22222222-1750-0000-0000-000000000002';
  z constant uuid := '33333333-1750-0000-0000-000000000003';
  ra constant uuid := 'a1750000-0000-0000-0000-0000000000a1';
  rb constant uuid := 'b1750000-0000-0000-0000-0000000000b1';
  ida constant uuid := 'a1750000-0000-0000-0000-0000000000d1';
  idb constant uuid := 'b1750000-0000-0000-0000-0000000000d2';
  results text := '';
  n integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A175', 'fixture-tenant-a175-test'), (b, 'Fixture Tenant B175', 'fixture-tenant-b175-test');
  insert into auth.users (id, email) values (x, 'fixture-x175@example.test'), (y, 'fixture-y175@example.test'), (z, 'fixture-z175@example.test');
  insert into users (id, email) values (x, 'fixture-x175@example.test'), (y, 'fixture-y175@example.test'), (z, 'fixture-z175@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (a, y, 'active'), (b, z, 'active');
  insert into identities (id, tenant_id, identity_type, display_name) values (ida, a, 'HUMAN', 'Subject A175'), (idb, b, 'HUMAN', 'Subject B175');
  insert into applications (id, tenant_id, name) values (ida, a, 'App A175'), (idb, b, 'App B175');
  insert into access_requests (id, tenant_id, subject_identity_id, application_id, requested_by, justification) values (ra, a, ida, ida, x, 'fixture'), (rb, b, idb, idb, z, 'fixture');
  insert into access_approval_links (tenant_id, request_id, user_id, token_hash, expires_at) values
    (a, ra, x, repeat('a', 64), now() + interval '1 day'),
    (a, ra, y, repeat('b', 64), now() + interval '1 day'),
    (b, rb, z, repeat('c', 64), now() + interval '1 day');
  insert into access_request_drafts (tenant_id, user_id, name, payload) values (a, x, 'Mine', '{}'), (a, y, 'Theirs', '{}'), (b, z, 'Other org', '{}');

  begin
    insert into access_approval_links (tenant_id, request_id, user_id, token_hash, expires_at) values (a, rb, x, repeat('d', 64), now());
    results := results || E'\nlink to another tenant''s request (expect denied): ALLOWED';
  exception when others then results := results || E'\nlink to another tenant''s request (expect denied): denied ' || sqlstate; end;
  begin
    insert into access_approval_links (tenant_id, request_id, user_id, token_hash, expires_at) values (a, ra, x, repeat('a', 64), now());
    results := results || E'\nreused token hash (expect denied): ALLOWED';
  exception when others then results := results || E'\nreused token hash (expect denied): denied ' || sqlstate; end;
  begin
    insert into access_approval_links (tenant_id, request_id, user_id, token_hash, expires_at) values (a, ra, x, 'short', now());
    results := results || E'\nshort token hash (expect denied): ALLOWED';
  exception when others then results := results || E'\nshort token hash (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  results := results || E'\nX: own links / Y links / B links (expect 1/0/0): '
    || (select count(*) from access_approval_links where user_id = x) || '/' || (select count(*) from access_approval_links where user_id = y) || '/' || (select count(*) from access_approval_links where tenant_id = b);
  results := results || E'\nX: own drafts / Y drafts / B drafts (expect 1/0/0): '
    || (select count(*) from access_request_drafts where user_id = x) || '/' || (select count(*) from access_request_drafts where user_id = y) || '/' || (select count(*) from access_request_drafts where tenant_id = b);
  update access_request_drafts set name = 'forged' where tenant_id = a;
  get diagnostics n = row_count;
  results := results || E'\nX: change a draft directly (expect 0): ' || n;
  begin
    insert into access_approval_links (tenant_id, request_id, user_id, token_hash, expires_at) values (a, ra, x, repeat('e', 64), now());
    results := results || E'\nX: insert a link directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX: insert a link directly (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
