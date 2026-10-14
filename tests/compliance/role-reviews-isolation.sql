-- Compliance Agent — COMPLIANCE-P0-11 live verification of migration 0183
-- (reviews of WonderID role assignments). Run via the Supabase MCP
-- execute_sql tool as one statement; it ends by raising an exception that
-- carries the results, so every fixture row rolls back with it.
--
-- Run 2026-10-14 against the dev project, 5 of 5 as expected: another
-- organization's group 23503; an unknown source 23514; member sees 1;
-- another organization sees 0 and cannot insert (42501).
--
-- Proves:
-- - an item's group belongs to the item's own organization;
-- - an unknown role source is refused;
-- - a member of the organization sees its items; another organization
--   sees none and cannot write one.

do $$
declare
  a constant uuid := 'aaaaaaaa-1830-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1830-0000-0000-000000000002';
  x constant uuid := '11111111-1830-0000-0000-000000000001';
  z constant uuid := '33333333-1830-0000-0000-000000000003';
  ia uuid;
  ga uuid;
  gb uuid;
  ca uuid;
  r uuid;
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A183', 'fixture-tenant-a183-test'), (b, 'Fixture Tenant B183', 'fixture-tenant-b183-test');
  insert into auth.users (id, email) values (x, 'fixture-x183@example.test'), (z, 'fixture-z183@example.test');
  insert into users (id, email) values (x, 'fixture-x183@example.test'), (z, 'fixture-z183@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  select id into ia from identities where tenant_id = a and user_id = x;
  if ia is null then
    insert into identities (tenant_id, identity_type, display_name, user_id) values (a, 'HUMAN', 'Fixture X', x) returning id into ia;
  end if;
  insert into groups (tenant_id, name) values (a, 'Fixture group A') returning id into ga;
  insert into groups (tenant_id, name) values (b, 'Fixture group B') returning id into gb;
  select id into r from roles where tenant_id is null order by name limit 1;
  insert into certification_campaigns (tenant_id, name, scope_type, cadence, created_by) values (a, 'Fixture role review', 'role_assignments', 'one_time', x) returning id into ca;
  insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id, role_id, role_source, group_id) values (a, ca, ia, x, r, 'group', ga);

  begin
    insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id, role_id, role_source, group_id) values (a, ca, ia, x, r, 'group', gb);
    results := results || E'\nitem naming another organization''s group (expect denied): ALLOWED';
  exception when others then results := results || E'\nitem naming another organization''s group (expect denied): denied ' || sqlstate; end;
  begin
    insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id, role_id, role_source) values (a, ca, ia, x, r, 'inherited');
    results := results || E'\nunknown role source (expect denied): ALLOWED';
  exception when others then results := results || E'\nunknown role source (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_items where campaign_id = ca; results := results || E'\nX (member) sees items (expect 1): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_items where campaign_id = ca; results := results || E'\nZ (another organization) sees items (expect 0): ' || c;
  begin
    insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id, role_id, role_source) values (a, ca, ia, z, r, 'direct');
    results := results || E'\nZ: insert an item directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nZ: insert an item directly (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
