-- Access Agent — live verification of migration 0122 (ACCESS-P0-29:
-- fulfilment tasks).
--
-- Proves: a task can name only its own organization's grant (same-tenant
-- key); one task per grant; a failed task always has a reason; a member
-- reads their organization's tasks but can neither create nor change one
-- (no client write policy); another organization sees none.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1220-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1220-0000-0000-000000000002';
  ua constant uuid := '11111111-1220-0000-0000-000000000001';
  ub constant uuid := '11111111-1220-0000-0000-000000000002';
  appa constant uuid := 'aaaaaaaa-1220-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1220-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1220-0000-0000-0000000000d1';
  accb constant uuid := 'bbbbbbbb-1220-0000-0000-0000000000d1';
  enta constant uuid := 'aaaaaaaa-1220-0000-0000-0000000000e1';
  entb constant uuid := 'bbbbbbbb-1220-0000-0000-0000000000e1';
  ga constant uuid := 'aaaaaaaa-1220-0000-0000-0000000000f1';
  gb constant uuid := 'bbbbbbbb-1220-0000-0000-0000000000f1';
  ka constant uuid := 'aaaaaaaa-1220-0000-0000-0000000000c1';
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A122', 'fixture-tenant-a122-test'),
  (tb, 'Fixture Tenant B122', 'fixture-tenant-b122-test');
insert into auth.users (id, email) values (ua, 'fixture-a122@example.test'), (ub, 'fixture-b122@example.test');
insert into users (id, email) values (ua, 'fixture-a122@example.test'), (ub, 'fixture-b122@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, ua, 'active'), (tb, ub, 'active');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A'), (appb, tb, 'Fixture App B');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acca, ta, appa, 'alice'), (accb, tb, appb, 'bob');
insert into entitlements (id, tenant_id, application_id, name) values (enta, ta, appa, 'Finance'), (entb, tb, appb, 'Finance');
insert into access_grants (id, tenant_id, account_id, entitlement_id, grant_type, fulfilment_status) values
  (ga, ta, acca, enta, 'direct', 'pending_fulfilment'),
  (gb, tb, accb, entb, 'direct', 'pending_fulfilment');
insert into access_fulfilment_tasks (id, tenant_id, access_grant_id, application_id, due_at) values (ka, ta, ga, appa, now() + interval '3 days');

create temporary table check_results (check_name text, result text);

begin
  insert into access_fulfilment_tasks (tenant_id, access_grant_id, application_id, due_at) values (ta, gb, appa, now());
  insert into check_results values ('task naming another organization''s grant (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('task naming another organization''s grant (expect denied 23503)', 'denied: ' || sqlstate); end;
begin
  insert into access_fulfilment_tasks (tenant_id, access_grant_id, application_id, due_at) values (ta, ga, appa, now());
  insert into check_results values ('second task for the same grant (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('second task for the same grant (expect denied 23505)', 'denied: ' || sqlstate); end;
begin
  update access_fulfilment_tasks set status = 'failed' where id = ka;
  insert into check_results values ('failed without a reason (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('failed without a reason (expect denied 23514)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1220-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A tasks (expect 1)', count(*)::text from access_fulfilment_tasks where tenant_id = ta;
begin
  update access_fulfilment_tasks set status = 'completed' where id = ka;
  get diagnostics n = row_count;
  insert into check_results values ('member completes a task directly (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member completes a task directly (expect 0 rows)', 'denied: ' || sqlstate); end;
begin
  insert into access_fulfilment_tasks (tenant_id, access_grant_id, application_id, due_at) values (ta, ga, appa, now());
  insert into check_results values ('member creates a task (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member creates a task (expect denied)', 'denied: ' || sqlstate); end;

perform set_config('request.jwt.claims', '{"sub":"11111111-1220-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A tasks (expect 0)', count(*)::text from access_fulfilment_tasks where tenant_id = ta;
begin
  update access_fulfilment_tasks set status = 'cancelled' where id = ka;
  get diagnostics n = row_count;
  insert into check_results values ('member of B cancels an A task (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of B cancels an A task (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
