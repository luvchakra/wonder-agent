-- Access Agent — live verification of migration 0121 (ACCESS-P0-28:
-- approved requests become pending grants).
--
-- Proves: a pending grant can name only its own organization's request
-- (same-tenant foreign key); one pending grant per request and
-- entitlement; `verified` always carries its time; a placeholder account
-- (status pending, source request) is accepted; a member can neither
-- create, fulfil nor verify a grant (access_grants has no client write
-- policy); another organization sees none of the pending grants or
-- placeholder accounts.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1210-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1210-0000-0000-000000000002';
  ua constant uuid := '11111111-1210-0000-0000-000000000001';
  ub constant uuid := '11111111-1210-0000-0000-000000000002';
  pa constant uuid := 'aaaaaaaa-1210-0000-0000-0000000000b1';
  pb constant uuid := 'bbbbbbbb-1210-0000-0000-0000000000b1';
  appa constant uuid := 'aaaaaaaa-1210-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1210-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1210-0000-0000-0000000000d1';
  enta constant uuid := 'aaaaaaaa-1210-0000-0000-0000000000e1';
  reqa constant uuid := 'aaaaaaaa-1210-0000-0000-0000000000c1';
  reqb constant uuid := 'bbbbbbbb-1210-0000-0000-0000000000c1';
  ga constant uuid := 'aaaaaaaa-1210-0000-0000-0000000000f1';
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A121', 'fixture-tenant-a121-test'),
  (tb, 'Fixture Tenant B121', 'fixture-tenant-b121-test');
insert into auth.users (id, email) values (ua, 'fixture-a121@example.test'), (ub, 'fixture-b121@example.test');
insert into users (id, email) values (ua, 'fixture-a121@example.test'), (ub, 'fixture-b121@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, ua, 'active'), (tb, ub, 'active');
insert into identities (id, tenant_id, identity_type, display_name) values (pa, ta, 'HUMAN', 'Fixture Ada'), (pb, tb, 'HUMAN', 'Fixture Bo');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A'), (appb, tb, 'Fixture App B');
insert into entitlements (id, tenant_id, application_id, name) values (enta, ta, appa, 'Finance');
insert into access_requests (id, tenant_id, requested_by, subject_identity_id, application_id, entitlement_id, justification, status) values
  (reqa, ta, ua, pa, appa, enta, 'fixture', 'approved'),
  (reqb, tb, ub, pb, appb, null, 'fixture', 'approved');
-- A request's placeholder account and its pending grant.
insert into accounts (id, tenant_id, application_id, identity_id, external_account_ref, status, source, correlation)
  values (acca, ta, appa, pa, 'pending:' || pa, 'pending', 'request', 'correlated');
insert into access_grants (id, tenant_id, account_id, entitlement_id, grant_type, fulfilment_status, request_id)
  values (ga, ta, acca, enta, 'direct', 'pending_fulfilment', reqa);

create temporary table check_results (check_name text, result text);
insert into check_results select 'placeholder account stored (expect pending/request)', status || '/' || source from accounts where id = acca;

begin
  insert into access_grants (tenant_id, account_id, entitlement_id, grant_type, fulfilment_status, request_id) values (ta, acca, enta, 'direct', 'pending_fulfilment', reqb);
  insert into check_results values ('grant naming another organization''s request (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('grant naming another organization''s request (expect denied 23503)', 'denied: ' || sqlstate); end;
begin
  insert into access_grants (tenant_id, account_id, entitlement_id, grant_type, fulfilment_status, request_id) values (ta, acca, enta, 'direct', 'pending_fulfilment', reqa);
  insert into check_results values ('second grant for the same request and entitlement (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('second grant for the same request and entitlement (expect denied 23505)', 'denied: ' || sqlstate); end;
begin
  update access_grants set fulfilment_status = 'verified' where id = ga;
  insert into check_results values ('verified without a time (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('verified without a time (expect denied 23514)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1210-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A pending grant (expect pending_fulfilment)', fulfilment_status from access_grants where id = ga;
begin
  update access_grants set fulfilment_status = 'fulfilled_unverified' where id = ga;
  get diagnostics n = row_count;
  insert into check_results values ('member marks a grant fulfilled (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member marks a grant fulfilled (expect 0 rows)', 'denied: ' || sqlstate); end;
begin
  insert into access_grants (tenant_id, account_id, entitlement_id, grant_type) values (ta, acca, enta, 'direct');
  insert into check_results values ('member creates a grant (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member creates a grant (expect denied)', 'denied: ' || sqlstate); end;

perform set_config('request.jwt.claims', '{"sub":"11111111-1210-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A grants (expect 0)', count(*)::text from access_grants where tenant_id = ta;
insert into check_results select 'member of B reads A placeholder accounts (expect 0)', count(*)::text from accounts where tenant_id = ta;
begin
  update access_grants set fulfilment_status = 'verified', verified_at = now() where id = ga;
  get diagnostics n = row_count;
  insert into check_results values ('member of B verifies an A grant (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of B verifies an A grant (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
