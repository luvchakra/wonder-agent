-- Runtime Agent — RUNTIME-P0-15 live verification of runtime_decisions.
-- Run via the Supabase MCP execute_sql tool in three calls, as in the
-- other modules' tests/*/tenant-isolation.sql: (1) fixtures, (2) checks as
-- a tenant-A member, (3) cleanup. It proves a member reads only their own
-- tenant's decisions, and that no client can insert, update or delete a
-- decision. Decisions are immutable evidence, written only by the gateway.

-- 1. Fixtures
insert into tenants (id, name, slug) values
  ('aaaaaaaa-6200-0000-0000-000000000001', 'Fixture Tenant A62', 'fixture-tenant-a62-test'),
  ('bbbbbbbb-6200-0000-0000-000000000002', 'Fixture Tenant B62', 'fixture-tenant-b62-test');
insert into auth.users (id, email) values ('11111111-6200-0000-0000-000000000001', 'fixture-user-a62@example.test');
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-6200-0000-0000-000000000001', '11111111-6200-0000-0000-000000000001', 'active');
insert into agents (id, tenant_id, agent_name, agent_type) values
  ('a6200000-0000-0000-0000-00000000000a', 'aaaaaaaa-6200-0000-0000-000000000001', 'GwBotA', 'automation'),
  ('b6200000-0000-0000-0000-00000000000b', 'bbbbbbbb-6200-0000-0000-000000000002', 'GwBotB', 'automation');
insert into runtime_decisions (id, tenant_id, agent_id, request_id, correlation_id, action, decision, code, reason, mode, enforced) values
  ('da620000-0000-0000-0000-00000000000a', 'aaaaaaaa-6200-0000-0000-000000000001', 'a6200000-0000-0000-0000-00000000000a', 'req-a', 'c-a', 'READ', 'ALLOW', 'ALLOWED', 'ok', 'OBSERVE_ONLY', false),
  ('db620000-0000-0000-0000-00000000000b', 'bbbbbbbb-6200-0000-0000-000000000002', 'b6200000-0000-0000-0000-00000000000b', 'req-b', 'c-b', 'READ', 'DENY', 'X', 'no', 'OBSERVE_ONLY', false);

-- 2. Checks as user A62
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-6200-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'own-tenant decisions visible (expect 1)', count(*)::text from runtime_decisions where tenant_id = 'aaaaaaaa-6200-0000-0000-000000000001';
insert into check_results select 'other-tenant decisions visible (expect 0)', count(*)::text from runtime_decisions where tenant_id = 'bbbbbbbb-6200-0000-0000-000000000002';
with u as (update runtime_decisions set decision = 'ALLOW' where true returning 1)
insert into check_results select 'update any decision (expect 0)', count(*)::text from u;
with d as (delete from runtime_decisions where true returning 1)
insert into check_results select 'delete any decision (expect 0)', count(*)::text from d;
do $$ begin
  insert into runtime_decisions (tenant_id, agent_id, request_id, correlation_id, action, decision, code, reason, mode, enforced)
  values ('aaaaaaaa-6200-0000-0000-000000000001', 'a6200000-0000-0000-0000-00000000000a', 'forged', 'c', 'READ', 'ALLOW', 'X', 'x', 'OBSERVE_ONLY', false);
  insert into check_results values ('insert a decision (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('insert a decision (expect denied)', 'denied: ' || sqlstate);
end $$;
reset role;
insert into check_results select 'decisions intact (expect ALLOW,DENY)', string_agg(decision, ',' order by decision) from runtime_decisions where id in ('da620000-0000-0000-0000-00000000000a', 'db620000-0000-0000-0000-00000000000b');
select * from check_results;

-- 3. Cleanup
-- delete from runtime_decisions where id in ('da620000-0000-0000-0000-00000000000a', 'db620000-0000-0000-0000-00000000000b');
-- delete from agents where id in ('a6200000-0000-0000-0000-00000000000a', 'b6200000-0000-0000-0000-00000000000b');
-- delete from tenant_memberships where user_id = '11111111-6200-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-6200-0000-0000-000000000001';
-- delete from tenants where id in ('aaaaaaaa-6200-0000-0000-000000000001', 'bbbbbbbb-6200-0000-0000-000000000002');
