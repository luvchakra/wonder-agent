-- Compliance Agent — COMPLIANCE-P0-14 live verification of migration 0185
-- (campaign templates). Run via the Supabase MCP execute_sql tool as one
-- statement; it ends by raising an exception that carries the results, so
-- every fixture row rolls back with it.
--
-- Proves:
-- - a member sees their organization's templates; another organization
--   sees none and cannot write, change or archive one (no client write path);
-- - names are unique per organization among templates still in use;
-- - the provenance trigger fills created_at/updated_at.

do $$
declare
  a constant uuid := 'aaaaaaaa-1850-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1850-0000-0000-000000000002';
  x constant uuid := '11111111-1850-0000-0000-000000000001';
  z constant uuid := '33333333-1850-0000-0000-000000000003';
  t uuid;
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A185', 'fixture-tenant-a185-test'), (b, 'Fixture Tenant B185', 'fixture-tenant-b185-test');
  insert into auth.users (id, email) values (x, 'fixture-x185@example.test'), (z, 'fixture-z185@example.test');
  insert into users (id, email) values (x, 'fixture-x185@example.test'), (z, 'fixture-z185@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into certification_campaign_templates (tenant_id, name, scope_type) values (a, 'Quarterly admins', 'role_assignments') returning id into t;

  begin
    insert into certification_campaign_templates (tenant_id, name, scope_type) values (a, 'QUARTERLY ADMINS', 'agent');
    results := results || E'\nsame name twice in one organization (expect denied): ALLOWED';
  exception when others then results := results || E'\nsame name twice in one organization (expect denied): denied ' || sqlstate; end;
  begin
    insert into certification_campaign_templates (tenant_id, name, scope_type) values (b, 'Quarterly admins', 'agent');
    results := results || E'\nsame name in another organization (expect allowed): allowed';
  exception when others then results := results || E'\nsame name in another organization (expect allowed): DENIED ' || sqlstate; end;
  select count(*) into c from certification_campaign_templates where id = t and created_at is not null and updated_at is not null;
  results := results || E'\nprovenance filled (expect 1): ' || c;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_campaign_templates where tenant_id = a; results := results || E'\nX (member) sees templates (expect 1): ' || c;
  begin
    insert into certification_campaign_templates (tenant_id, name, scope_type) values (a, 'From the browser', 'agent');
    results := results || E'\nX: insert directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX: insert directly (expect denied): denied ' || sqlstate; end;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_campaign_templates where tenant_id = a; results := results || E'\nZ (another organization) sees templates (expect 0): ' || c;
  update certification_campaign_templates set archived_at = now() where id = t;
  get diagnostics c = row_count; results := results || E'\nZ: archive another organization''s template (expect 0 rows): ' || c;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
