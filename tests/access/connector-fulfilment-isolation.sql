-- QA check for migration 0129 (INTEGRATION-P0-13 with ACCESS-P0-29):
-- fulfilment tasks carried out by a connector.
--
-- Proves: a task's connector can only be a connection of its own
-- organization (same-tenant key); the connector columns hold only known
-- states; a member can neither mark a task as done by a connector nor
-- clear its error (no client write path); another organization sees none
-- of it. Migration 0128: a sync job's trigger may be 'verification'.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1290-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1290-0000-0000-000000000002';
  ua constant uuid := '11111111-1290-0000-0000-000000000001';
  ub constant uuid := '11111111-1290-0000-0000-000000000002';
  appa constant uuid := 'aaaaaaaa-1290-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1290-0000-0000-0000000000d1';
  ia constant uuid := 'aaaaaaaa-1290-0000-0000-0000000000e1';
  ib constant uuid := 'bbbbbbbb-1290-0000-0000-0000000000e1';
  ka constant uuid := 'aaaaaaaa-1290-0000-0000-0000000000c1';
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A129', 'fixture-tenant-a129-test'),
  (tb, 'Fixture Tenant B129', 'fixture-tenant-b129-test');
insert into auth.users (id, email) values (ua, 'fixture-a129@example.test'), (ub, 'fixture-b129@example.test');
insert into users (id, email) values (ua, 'fixture-a129@example.test'), (ub, 'fixture-b129@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, ua, 'active'), (tb, ub, 'active');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A129');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acca, ta, appa, 'u-a');
insert into integrations (id, tenant_id, integration_type_id, name) values (ia, ta, 'connector', 'Fixture Connection A129'), (ib, tb, 'connector', 'Fixture Connection B129');
insert into access_fulfilment_tasks (id, tenant_id, kind, account_id, application_id, due_at, connector_status, connector_integration_id, connector_attempts, connector_error)
  values (ka, ta, 'disable_account', acca, appa, now() + interval '3 days', 'failed', ia, 3, 'HTTP 503');

create temporary table check_results (check_name text, result text);

begin
  update access_fulfilment_tasks set connector_integration_id = ib where id = ka;
  insert into check_results values ('task names another organization''s connection (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('task names another organization''s connection (expect denied 23503)', 'denied: ' || sqlstate); end;
begin
  update access_fulfilment_tasks set connector_status = 'done' where id = ka;
  insert into check_results values ('unknown connector state (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('unknown connector state (expect denied 23514)', 'denied: ' || sqlstate); end;
begin
  insert into integration_sync_jobs (tenant_id, integration_id, trigger) values (ta, ia, 'verification');
  insert into check_results values ('a verification sync job (expect allowed)', 'allowed');
exception when others then insert into check_results values ('a verification sync job (expect allowed)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1290-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A''s task (expect 1)', count(*)::text from access_fulfilment_tasks where id = ka;
begin
  update access_fulfilment_tasks set connector_status = 'succeeded', connector_error = null, status = 'completed' where id = ka;
  get diagnostics n = row_count;
  insert into check_results values ('member of A marks it done by the connector (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of A marks it done by the connector (expect 0 rows)', 'denied: ' || sqlstate); end;

perform set_config('request.jwt.claims', '{"sub":"11111111-1290-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A''s task (expect 0)', count(*)::text from access_fulfilment_tasks where id = ka;
insert into check_results select 'member of B reads A''s connector error (expect 0)', count(*)::text from access_fulfilment_tasks where connector_error is not null and tenant_id = ta;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
