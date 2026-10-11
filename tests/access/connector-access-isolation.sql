-- Access Agent — live verification of migration 0119 (ACCESS-P0-27:
-- entitlements and access from connectors).
--
-- Proves: a member reads only their own organization's access
-- reconciliation runs and can write none; an entitlement can name only its
-- own organization's connection as its source (same-tenant foreign key);
-- one connection's id for an entitlement is unique per application; a
-- member cannot mark a grant missing from the source (access_grants has no
-- client write policy); another organization's entitlements, grants and
-- runs stay invisible.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1190-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1190-0000-0000-000000000002';
  ia constant uuid := 'aaaaaaaa-1190-0000-0000-0000000000c1';
  ib constant uuid := 'bbbbbbbb-1190-0000-0000-0000000000c1';
  appa constant uuid := 'aaaaaaaa-1190-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1190-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1190-0000-0000-0000000000d1';
  enta constant uuid := 'aaaaaaaa-1190-0000-0000-0000000000e1';
  ga constant uuid := 'aaaaaaaa-1190-0000-0000-0000000000f1';
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A119', 'fixture-tenant-a119-test'),
  (tb, 'Fixture Tenant B119', 'fixture-tenant-b119-test');
insert into auth.users (id, email) values
  ('11111111-1190-0000-0000-000000000001', 'fixture-a119@example.test'),
  ('11111111-1190-0000-0000-000000000002', 'fixture-b119@example.test');
insert into users (id, email) values
  ('11111111-1190-0000-0000-000000000001', 'fixture-a119@example.test'),
  ('11111111-1190-0000-0000-000000000002', 'fixture-b119@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  (ta, '11111111-1190-0000-0000-000000000001', 'active'),
  (tb, '11111111-1190-0000-0000-000000000002', 'active');
insert into integrations (id, tenant_id, integration_type_id, name) values
  (ia, ta, 'connector', 'Fixture A LDAP'),
  (ib, tb, 'connector', 'Fixture B LDAP');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A'), (appb, tb, 'Fixture App B');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acca, ta, appa, 'alice');
insert into entitlements (id, tenant_id, application_id, name, source_integration_id, external_ref) values (enta, ta, appa, 'Finance', ia, 'cn=finance');
insert into access_grants (id, tenant_id, account_id, entitlement_id, grant_type, source_integration_id) values (ga, ta, acca, enta, 'group', ia);
insert into access_reconciliation_runs (tenant_id, application_id, integration_id, mode, status) values (ta, appa, ia, 'full', 'succeeded'), (tb, appb, ib, 'full', 'succeeded');

create temporary table check_results (check_name text, result text);

begin
  insert into entitlements (tenant_id, application_id, name, source_integration_id, external_ref) values (ta, appa, 'Finance copy', ia, 'cn=finance');
  insert into check_results values ('same connector id twice in one application (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('same connector id twice in one application (expect denied 23505)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1190-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A runs (expect 1)', count(*)::text from access_reconciliation_runs;
begin
  insert into access_reconciliation_runs (tenant_id, application_id, mode, status) values (ta, appa, 'full', 'succeeded');
  insert into check_results values ('member writes a run (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member writes a run (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into entitlements (tenant_id, application_id, name, source_integration_id, external_ref) values (ta, appa, 'Borrowed', ib, 'cn=x');
  insert into check_results values ('entitlement naming another organization''s connection (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('entitlement naming another organization''s connection (expect denied 23503)', 'denied: ' || sqlstate); end;
begin
  update access_grants set missing_from_source_at = now() where id = ga;
  get diagnostics n = row_count;
  insert into check_results values ('member marks a grant missing (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member marks a grant missing (expect 0 rows)', 'denied: ' || sqlstate); end;
insert into check_results select 'member of A reads A entitlement source (expect cn=finance)', external_ref from entitlements where id = enta;

perform set_config('request.jwt.claims', '{"sub":"11111111-1190-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A runs (expect 0)', count(*)::text from access_reconciliation_runs where tenant_id = ta;
insert into check_results select 'member of B reads A entitlements (expect 0)', count(*)::text from entitlements where tenant_id = ta;
insert into check_results select 'member of B reads A grants (expect 0)', count(*)::text from access_grants where tenant_id = ta;
begin
  update entitlements set missing_from_source_at = now() where id = enta;
  get diagnostics n = row_count;
  insert into check_results values ('member of B marks an A entitlement missing (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of B marks an A entitlement missing (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
