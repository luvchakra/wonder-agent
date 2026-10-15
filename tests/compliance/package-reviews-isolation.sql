-- Compliance Agent — COMPLIANCE-P0-10 part 3 live verification of migration
-- 0193 (owner reviews of access packages). Run via the Supabase MCP
-- execute_sql tool as one statement; it ends by raising an exception that
-- carries the results, so every fixture row rolls back with it.
--
-- Run 2026-10-15 against the dev project, 7 of 7 as expected: both scopes
-- allowed; another organization's package 23503; a package item naming an
-- agent 23514; member sees 1; another organization sees 0 and cannot insert
-- (42501).
--
-- Proves:
-- - a campaign and a template may have scope 'package_contents';
-- - an item's package belongs to the item's own organization;
-- - a package item names no agent or identity;
-- - a member of the organization sees its items; another organization
--   sees none and cannot write one.

do $$
declare
  a constant uuid := 'aaaaaaaa-1930-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1930-0000-0000-000000000002';
  x constant uuid := '11111111-1930-0000-0000-000000000001';
  z constant uuid := '33333333-1930-0000-0000-000000000003';
  pa uuid;
  pb uuid;
  ca uuid;
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A193', 'fixture-tenant-a193-test'), (b, 'Fixture Tenant B193', 'fixture-tenant-b193-test');
  insert into auth.users (id, email) values (x, 'fixture-x193@example.test'), (z, 'fixture-z193@example.test');
  insert into users (id, email) values (x, 'fixture-x193@example.test'), (z, 'fixture-z193@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into access_packages (tenant_id, name) values (a, 'Fixture package A') returning id into pa;
  insert into access_packages (tenant_id, name) values (b, 'Fixture package B') returning id into pb;
  insert into certification_campaigns (tenant_id, name, scope_type, cadence, created_by) values (a, 'Fixture package review', 'package_contents', 'one_time', x) returning id into ca;
  results := results || E'\ncampaign of scope package_contents (expect allowed): allowed';
  begin
    insert into certification_campaign_templates (tenant_id, name, scope_type, created_by) values (a, 'Fixture package template', 'package_contents', x);
    results := results || E'\ntemplate of scope package_contents (expect allowed): allowed';
  exception when others then results := results || E'\ntemplate of scope package_contents (expect allowed): DENIED ' || sqlstate || ' ' || sqlerrm; end;
  insert into certification_items (tenant_id, campaign_id, reviewer_id, package_id, package_resource_id) values (a, ca, x, pa, gen_random_uuid());

  begin
    insert into certification_items (tenant_id, campaign_id, reviewer_id, package_id, package_resource_id) values (a, ca, x, pb, gen_random_uuid());
    results := results || E'\nitem naming another organization''s package (expect denied): ALLOWED';
  exception when others then results := results || E'\nitem naming another organization''s package (expect denied): denied ' || sqlstate; end;
  begin
    insert into certification_items (tenant_id, campaign_id, reviewer_id, package_id, package_resource_id, agent_id) values (a, ca, x, pa, gen_random_uuid(), gen_random_uuid());
    results := results || E'\npackage item that also names an agent (expect denied): ALLOWED';
  exception when others then results := results || E'\npackage item that also names an agent (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_items where campaign_id = ca; results := results || E'\nX (member) sees items (expect 1): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_items where campaign_id = ca; results := results || E'\nZ (another organization) sees items (expect 0): ' || c;
  begin
    insert into certification_items (tenant_id, campaign_id, reviewer_id, package_id, package_resource_id) values (a, ca, z, pa, gen_random_uuid());
    results := results || E'\nZ: insert an item directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nZ: insert an item directly (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
