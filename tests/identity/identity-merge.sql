-- Identity Agent — IDENTITY-P0-23 live verification of migration 0198
-- (identity_merges, merge_identities(), unmerge_identities()).
-- Run via the Supabase MCP execute_sql tool as one statement; it ends by
-- raising an exception that carries the results, so every fixture row
-- rolls back with it.
--
-- Proves:
-- - a merge copies the chosen attribute, moves the account and the person
--   it manages to the survivor, and sets the merged record inactive;
-- - undo puts exactly those back;
-- - a record of another organization is never merged ("not found");
-- - two records that both sign in are refused;
-- - a member reads their organization's merges, another organization's
--   member reads none, and no member can run the merge or write a merge
--   record directly.
--
-- Run 2026-10-17 against the dev project, 15 of 15 as expected: B record
-- P0002; email, account, report and merged record as expected; X sees 1,
-- Z sees 0; X running unmerge or writing a record 42501 each; after undo
-- all four back; undo twice 22023; both sign in 22023.

do $$
declare
  a constant uuid := 'aaaaaaaa-1980-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1980-0000-0000-000000000002';
  x constant uuid := '11111111-1980-0000-0000-000000000001';
  z constant uuid := '33333333-1980-0000-0000-000000000003';
  s constant uuid := 'a1980000-0000-0000-0000-0000000000a1';
  m constant uuid := 'a1980000-0000-0000-0000-0000000000a2';
  w constant uuid := 'a1980000-0000-0000-0000-0000000000a3';
  o constant uuid := 'b1980000-0000-0000-0000-0000000000b1';
  app constant uuid := 'a1980000-0000-0000-0000-00000000a990';
  acct constant uuid := 'a1980000-0000-0000-0000-00000000acc1';
  merge_id uuid;
  results text := '';
  c integer;
  v text;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A198', 'fixture-tenant-a198-test'), (b, 'Fixture Tenant B198', 'fixture-tenant-b198-test');
  insert into auth.users (id, email) values (x, 'fixture-x198@example.test'), (z, 'fixture-z198@example.test');
  insert into users (id, email) values (x, 'fixture-x198@example.test'), (z, 'fixture-z198@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into identities (id, tenant_id, identity_type, display_name, email) values
    (s, a, 'HUMAN', 'Ada Lovelace', 'ada@old.example'),
    (m, a, 'HUMAN', 'Ada Lovelace (HR)', 'ada@example.test'),
    (o, b, 'HUMAN', 'Ada in B', 'ada@b.example');
  insert into identities (id, tenant_id, identity_type, display_name, manager_identity_id) values (w, a, 'HUMAN', 'Report of Ada', m);
  insert into applications (id, tenant_id, name) values (app, a, 'Fixture App 198');
  insert into accounts (id, tenant_id, application_id, external_account_ref, identity_id) values (acct, a, app, 'ada', m);

  -- Another organization's record is never found.
  begin
    perform merge_identities(a, s, o, '{}', x, null);
    results := results || E'\nmerge with B record (expect not found): ALLOWED';
  exception when others then results := results || E'\nmerge with B record (expect not found): ' || sqlstate; end;

  merge_id := merge_identities(a, s, m, array['email'], x, 'same person');
  select email into v from identities where id = s;
  results := results || E'\nsurvivor email (expect ada@example.test): ' || v;
  select count(*) into c from accounts where id = acct and identity_id = s;
  results := results || E'\naccount moved (expect 1): ' || c;
  select count(*) into c from identities where id = w and manager_identity_id = s;
  results := results || E'\nreport now under survivor (expect 1): ' || c;
  select status || '/' || coalesce(merged_into_identity_id::text, 'none') into v from identities where id = m;
  results := results || E'\nmerged record (expect inactive/' || s || '): ' || v;

  -- A member reads it, another organization's member does not, nobody writes it.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from identity_merges where tenant_id = a;
  results := results || E'\nX sees A merges (expect 1): ' || c;
  begin
    perform unmerge_identities(a, merge_id, x, 'by a member');
    results := results || E'\nX runs unmerge directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX runs unmerge directly (expect denied): ' || sqlstate; end;
  begin
    insert into identity_merges (tenant_id, survivor_identity_id, merged_identity_id, survivor_before, merged_before) values (a, m, s, '{}', '{}');
    results := results || E'\nX writes a merge record (expect denied): ALLOWED';
  exception when others then results := results || E'\nX writes a merge record (expect denied): ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from identity_merges where tenant_id = a;
  results := results || E'\nZ (tenant B) sees A merges (expect 0): ' || c;
  reset role;

  perform unmerge_identities(a, merge_id, x, 'not the same person after all');
  select email into v from identities where id = s;
  results := results || E'\nafter undo, survivor email (expect ada@old.example): ' || v;
  select count(*) into c from accounts where id = acct and identity_id = m;
  results := results || E'\nafter undo, account back (expect 1): ' || c;
  select count(*) into c from identities where id = w and manager_identity_id = m;
  results := results || E'\nafter undo, report back (expect 1): ' || c;
  select status || '/' || coalesce(merged_into_identity_id::text, 'none') into v from identities where id = m;
  results := results || E'\nafter undo, merged record (expect active/none): ' || v;
  begin
    perform unmerge_identities(a, merge_id, x, 'twice');
    results := results || E'\nundo twice (expect refused): ALLOWED';
  exception when others then results := results || E'\nundo twice (expect refused): ' || sqlstate; end;

  -- Two records that both sign in are refused.
  insert into auth.users (id, email) values ('44444444-1980-0000-0000-000000000004', 'fixture-y198@example.test'), ('55555555-1980-0000-0000-000000000005', 'fixture-v198@example.test');
  insert into users (id, email) values ('44444444-1980-0000-0000-000000000004', 'fixture-y198@example.test'), ('55555555-1980-0000-0000-000000000005', 'fixture-v198@example.test') on conflict (id) do nothing;
  update identities set user_id = '44444444-1980-0000-0000-000000000004' where id = s;
  update identities set user_id = '55555555-1980-0000-0000-000000000005' where id = m;
  begin
    perform merge_identities(a, s, m, '{}', x, null);
    results := results || E'\nboth sign in (expect refused): ALLOWED';
  exception when others then results := results || E'\nboth sign in (expect refused): ' || sqlstate; end;

  raise exception 'RESULTS:%', results;
end $$;
