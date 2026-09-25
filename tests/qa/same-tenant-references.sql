-- QA Agent — QA-P0-17 live verification of migration 0076. Run via the
-- Supabase MCP execute_sql tool: (1) fixtures, (2) checks, (3) cleanup.
--
-- The actor is a member of BOTH fixture tenants, so RLS allows their
-- writes in either one. That is exactly the case 0076 is for: only the
-- same-tenant composite foreign keys can stop a row in one tenant from
-- pointing at the other tenant's parent. The last check runs as the
-- service role (as createControlMapping does), where RLS does not apply
-- at all.
--
-- Run 2026-09-25 against the dev project: every "expect denied" was
-- denied with 23503, every "expect 1" was 1, and the leak count was 0.

-- 1. Fixtures
insert into tenants (id, name, slug) values
  ('aaaaaaaa-7600-0000-0000-000000000001', 'Fixture Tenant A76', 'fixture-tenant-a76-test'),
  ('bbbbbbbb-7600-0000-0000-000000000002', 'Fixture Tenant B76', 'fixture-tenant-b76-test');
insert into auth.users (id, email) values ('33333333-7600-0000-0000-000000000003', 'fixture-user-ab76@example.test');
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-7600-0000-0000-000000000001', '33333333-7600-0000-0000-000000000003', 'active'),
  ('bbbbbbbb-7600-0000-0000-000000000002', '33333333-7600-0000-0000-000000000003', 'active');
insert into agents (id, tenant_id, agent_name, agent_type) values
  ('a7600000-0000-0000-0000-00000000000a', 'aaaaaaaa-7600-0000-0000-000000000001', 'Agent A76', 'workflow'),
  ('a7600000-0000-0000-0000-00000000000b', 'bbbbbbbb-7600-0000-0000-000000000002', 'Agent B76', 'workflow');
insert into applications (id, tenant_id, name) values
  ('a7600000-0000-0000-0000-0000000000a1', 'aaaaaaaa-7600-0000-0000-000000000001', 'App A76'),
  ('a7600000-0000-0000-0000-0000000000b1', 'bbbbbbbb-7600-0000-0000-000000000002', 'App B76');
insert into policies (id, tenant_id, name, policy_category, action) values
  ('a7600000-0000-0000-0000-0000000000a2', 'aaaaaaaa-7600-0000-0000-000000000001', 'Policy A76', 'identity', 'flag');

-- 2. Checks as the two-tenant member
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-7600-0000-0000-000000000003","role":"authenticated"}', true);
do $$ begin
  insert into entitlements (tenant_id, application_id, name) values ('bbbbbbbb-7600-0000-0000-000000000002', 'a7600000-0000-0000-0000-0000000000a1', 'forged');
  insert into check_results values ('B entitlement on A application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('B entitlement on A application (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into accounts (tenant_id, agent_id, application_id, external_account_ref) values ('bbbbbbbb-7600-0000-0000-000000000002', 'a7600000-0000-0000-0000-00000000000a', 'a7600000-0000-0000-0000-0000000000b1', 'forged');
  insert into check_results values ('B account for A agent (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('B account for A agent (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, agent_id, requested_by, application_id, justification) values ('bbbbbbbb-7600-0000-0000-000000000002', 'a7600000-0000-0000-0000-00000000000a', '33333333-7600-0000-0000-000000000003', 'a7600000-0000-0000-0000-0000000000b1', 'forged');
  insert into check_results values ('B request for A agent (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('B request for A agent (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into policy_exceptions (tenant_id, scope_type, policy_id, reason, approved_by) values ('bbbbbbbb-7600-0000-0000-000000000002', 'policy', 'a7600000-0000-0000-0000-0000000000a2', 'forged', '33333333-7600-0000-0000-000000000003');
  insert into check_results values ('B exception on A policy (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('B exception on A policy (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into policy_exceptions (tenant_id, scope_type, policy_id, agent_id, reason, approved_by) values ('aaaaaaaa-7600-0000-0000-000000000001', 'policy', 'a7600000-0000-0000-0000-0000000000a2', 'a7600000-0000-0000-0000-00000000000b', 'forged', '33333333-7600-0000-0000-000000000003');
  insert into check_results values ('A exception on A policy for B agent (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('A exception on A policy for B agent (expect denied)', 'denied: ' || sqlstate); end $$;
with i as (insert into entitlements (tenant_id, application_id, name) values ('bbbbbbbb-7600-0000-0000-000000000002', 'a7600000-0000-0000-0000-0000000000b1', 'own') returning 1)
insert into check_results select 'B entitlement on B application (expect 1)', count(*)::text from i;
with i as (insert into accounts (tenant_id, agent_id, application_id, external_account_ref) values ('bbbbbbbb-7600-0000-0000-000000000002', 'a7600000-0000-0000-0000-00000000000b', 'a7600000-0000-0000-0000-0000000000b1', 'own') returning 1)
insert into check_results select 'B account for B agent (expect 1)', count(*)::text from i;
with i as (insert into policy_exceptions (tenant_id, scope_type, policy_id, agent_id, reason, approved_by) values ('aaaaaaaa-7600-0000-0000-000000000001', 'policy', 'a7600000-0000-0000-0000-0000000000a2', 'a7600000-0000-0000-0000-00000000000a', 'own', '33333333-7600-0000-0000-000000000003') returning 1)
insert into check_results select 'A exception on A policy for A agent (expect 1)', count(*)::text from i;
reset role;
do $$ begin
  insert into control_mappings (tenant_id, control_id, policy_id) select 'bbbbbbbb-7600-0000-0000-000000000002', id, 'a7600000-0000-0000-0000-0000000000a2' from controls limit 1;
  insert into check_results values ('service role: B control mapping to A policy (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('service role: B control mapping to A policy (expect denied)', 'denied: ' || sqlstate); end $$;
insert into check_results select 'forged rows that exist (expect 0)', (
  (select count(*) from accounts where external_account_ref = 'forged')
 + (select count(*) from entitlements where name = 'forged')
 + (select count(*) from policy_exceptions where reason = 'forged'))::text;
select * from check_results;

-- 3. Cleanup
-- delete from policy_exceptions where tenant_id in ('aaaaaaaa-7600-0000-0000-000000000001', 'bbbbbbbb-7600-0000-0000-000000000002');
-- delete from agents where tenant_id in ('aaaaaaaa-7600-0000-0000-000000000001', 'bbbbbbbb-7600-0000-0000-000000000002');
-- delete from applications where tenant_id in ('aaaaaaaa-7600-0000-0000-000000000001', 'bbbbbbbb-7600-0000-0000-000000000002');
-- delete from policies where tenant_id in ('aaaaaaaa-7600-0000-0000-000000000001', 'bbbbbbbb-7600-0000-0000-000000000002');
-- delete from tenant_memberships where user_id = '33333333-7600-0000-0000-000000000003';
-- delete from auth.users where id = '33333333-7600-0000-0000-000000000003';
-- delete from tenants where id in ('aaaaaaaa-7600-0000-0000-000000000001', 'bbbbbbbb-7600-0000-0000-000000000002');
