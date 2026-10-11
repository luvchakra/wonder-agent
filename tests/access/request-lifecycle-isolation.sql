-- QA Agent — QA-P0-24: live verification of migrations 0123 and 0124
-- (ACCESS-P0-30 remove and account requests, ACCESS-P0-32 time-bound
-- access).
--
-- Proves: a removal or account task can name only its own organization's
-- grant or account (same-tenant keys); one live removal task per grant; a
-- task's kind must match what it names; request types are only the known
-- ones ('extend' included); a member can neither mark a grant for removal
-- nor stamp a request's expiry fields directly (no client write path for
-- either); another organization sees none of it.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1240-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1240-0000-0000-000000000002';
  ua constant uuid := '11111111-1240-0000-0000-000000000001';
  ub constant uuid := '11111111-1240-0000-0000-000000000002';
  ia constant uuid := 'aaaaaaaa-1240-0000-0000-0000000000b1';
  appa constant uuid := 'aaaaaaaa-1240-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1240-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1240-0000-0000-0000000000d1';
  accb constant uuid := 'bbbbbbbb-1240-0000-0000-0000000000d1';
  enta constant uuid := 'aaaaaaaa-1240-0000-0000-0000000000e1';
  entb constant uuid := 'bbbbbbbb-1240-0000-0000-0000000000e1';
  ga constant uuid := 'aaaaaaaa-1240-0000-0000-0000000000f1';
  gb constant uuid := 'bbbbbbbb-1240-0000-0000-0000000000f1';
  ra constant uuid := 'aaaaaaaa-1240-0000-0000-0000000000c1';
  ka constant uuid := 'aaaaaaaa-1240-0000-0000-0000000000c2';
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A124', 'fixture-tenant-a124-test'),
  (tb, 'Fixture Tenant B124', 'fixture-tenant-b124-test');
insert into auth.users (id, email) values (ua, 'fixture-a124@example.test'), (ub, 'fixture-b124@example.test');
insert into users (id, email) values (ua, 'fixture-a124@example.test'), (ub, 'fixture-b124@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, ua, 'active'), (tb, ub, 'active');
insert into identities (id, tenant_id, identity_type, display_name) values (ia, ta, 'HUMAN', 'Fixture Person A124');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A'), (appb, tb, 'Fixture App B');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acca, ta, appa, 'alice'), (accb, tb, appb, 'bob');
insert into entitlements (id, tenant_id, application_id, name) values (enta, ta, appa, 'Finance'), (entb, tb, appb, 'Finance');
insert into access_grants (id, tenant_id, account_id, entitlement_id, grant_type) values (ga, ta, acca, enta, 'direct'), (gb, tb, accb, entb, 'direct');
insert into access_requests (id, tenant_id, subject_identity_id, requested_by, application_id, entitlement_id, request_type, justification, status, requested_expiry)
  values (ra, ta, ia, ua, appa, enta, 'extend', 'Fixture extension', 'approved', now() + interval '7 days');
insert into access_fulfilment_tasks (id, tenant_id, kind, removal_grant_id, application_id, due_at) values (ka, ta, 'remove', ga, appa, now() + interval '3 days');

create temporary table check_results (check_name text, result text);

begin
  insert into access_fulfilment_tasks (tenant_id, kind, removal_grant_id, application_id, due_at) values (ta, 'remove', gb, appa, now());
  insert into check_results values ('removal task naming another organization''s grant (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('removal task naming another organization''s grant (expect denied 23503)', 'denied: ' || sqlstate); end;
begin
  insert into access_fulfilment_tasks (tenant_id, kind, account_id, application_id, due_at) values (ta, 'disable_account', accb, appa, now());
  insert into check_results values ('account task naming another organization''s account (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('account task naming another organization''s account (expect denied 23503)', 'denied: ' || sqlstate); end;
begin
  insert into access_fulfilment_tasks (tenant_id, kind, removal_grant_id, application_id, due_at) values (ta, 'remove', ga, appa, now());
  insert into check_results values ('second live removal task for the same grant (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('second live removal task for the same grant (expect denied 23505)', 'denied: ' || sqlstate); end;
begin
  insert into access_fulfilment_tasks (tenant_id, kind, account_id, application_id, due_at) values (ta, 'remove', acca, appa, now());
  insert into check_results values ('removal task naming an account, not a grant (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('removal task naming an account, not a grant (expect denied 23514)', 'denied: ' || sqlstate); end;
begin
  update access_requests set request_type = 'renew' where id = ra;
  insert into check_results values ('unknown request type (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('unknown request type (expect denied 23514)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1240-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A''s extension (expect 1)', count(*)::text from access_requests where id = ra;
begin
  update access_grants set removal_status = 'pending_removal' where id = ga;
  get diagnostics n = row_count;
  insert into check_results values ('member marks a grant for removal directly (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member marks a grant for removal directly (expect 0 rows)', 'denied: ' || sqlstate); end;
begin
  update access_requests set expiry_processed_at = now(), expiry_reminded_at = now() where id = ra;
  get diagnostics n = row_count;
  insert into check_results values ('member stamps a request''s expiry directly (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member stamps a request''s expiry directly (expect 0 rows)', 'denied: ' || sqlstate); end;

perform set_config('request.jwt.claims', '{"sub":"11111111-1240-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A''s extension (expect 0)', count(*)::text from access_requests where id = ra;
insert into check_results select 'member of B reads A''s removal task (expect 0)', count(*)::text from access_fulfilment_tasks where id = ka;
begin
  update access_fulfilment_tasks set status = 'cancelled' where id = ka;
  get diagnostics n = row_count;
  insert into check_results values ('member of B cancels A''s removal task (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of B cancels A''s removal task (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
