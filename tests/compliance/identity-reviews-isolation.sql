-- Compliance Agent — COMPLIANCE-P0-10 live verification of migrations 0180
-- and 0181 (people's-access review items). Run via the Supabase MCP
-- execute_sql tool as one statement; it ends by raising an exception that
-- carries the results, so every fixture row rolls back with it.
--
-- Run 2026-10-14 against the dev project, 5 of 5 as expected: another
-- organization's identity 23503; an item about nobody 23514; X sees 1;
-- Z sees 0; Z cannot insert (42501).
--
-- Proves:
-- - an item is about exactly one agent or one identity;
-- - its identity belongs to the item's own organization;
-- - a member of the organization sees its items; another organization
--   sees none and cannot write one.

do $$
declare
  a constant uuid := 'aaaaaaaa-1800-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1800-0000-0000-000000000002';
  x constant uuid := '11111111-1800-0000-0000-000000000001';
  z constant uuid := '33333333-1800-0000-0000-000000000003';
  ia uuid;
  ib uuid;
  ca uuid;
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A180', 'fixture-tenant-a180-test'), (b, 'Fixture Tenant B180', 'fixture-tenant-b180-test');
  insert into auth.users (id, email) values (x, 'fixture-x180@example.test'), (z, 'fixture-z180@example.test');
  insert into users (id, email) values (x, 'fixture-x180@example.test'), (z, 'fixture-z180@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into identities (tenant_id, identity_type, display_name) values (a, 'HUMAN', 'Fixture Ana') returning id into ia;
  insert into identities (tenant_id, identity_type, display_name) values (b, 'HUMAN', 'Fixture Zed') returning id into ib;
  insert into certification_campaigns (tenant_id, name, scope_type, cadence, created_by) values (a, 'Fixture review', 'identity_access', 'one_time', x) returning id into ca;
  insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id) values (a, ca, ia, x);

  begin
    insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id) values (a, ca, ib, x);
    results := results || E'\nitem naming another organization''s identity (expect denied): ALLOWED';
  exception when others then results := results || E'\nitem naming another organization''s identity (expect denied): denied ' || sqlstate; end;
  begin
    insert into certification_items (tenant_id, campaign_id, reviewer_id) values (a, ca, x);
    results := results || E'\nitem about nobody (expect denied): ALLOWED';
  exception when others then results := results || E'\nitem about nobody (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_items where tenant_id = a; results := results || E'\nX (member) sees items (expect 1): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_items where campaign_id = ca; results := results || E'\nZ (another organization) sees items (expect 0): ' || c;
  begin
    insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id) values (a, ca, ia, z);
    results := results || E'\nZ: insert an item directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nZ: insert an item directly (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
