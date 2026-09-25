-- Runtime Agent — RUNTIME-P0-18 live verification of runtime_emergency_controls.
-- Run via the Supabase MCP execute_sql tool: (1) fixtures, (2) checks as a
-- tenant-A member, (3) cleanup. It proves members read only their own
-- tenant's controls and that no client can engage, lift or delete one:
-- only the service role writes, behind requirePermission('runtime.emergency').

-- 1. Fixtures
insert into tenants (id, name, slug) values
  ('aaaaaaaa-6400-0000-0000-000000000001', 'Fixture Tenant A64', 'fixture-tenant-a64-test'),
  ('bbbbbbbb-6400-0000-0000-000000000002', 'Fixture Tenant B64', 'fixture-tenant-b64-test');
insert into auth.users (id, email) values ('11111111-6400-0000-0000-000000000001', 'fixture-user-a64@example.test');
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-6400-0000-0000-000000000001', '11111111-6400-0000-0000-000000000001', 'active');
insert into runtime_emergency_controls (id, tenant_id, control_type, target, reason) values
  ('ec640000-0000-0000-0000-00000000000a', 'aaaaaaaa-6400-0000-0000-000000000001', 'tool_suspension', 'x', 'fixture'),
  ('ec640000-0000-0000-0000-00000000000b', 'bbbbbbbb-6400-0000-0000-000000000002', 'kill_switch', null, 'fixture');

-- 2. Checks as user A64
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-6400-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'own-tenant controls visible (expect 1)', count(*)::text from runtime_emergency_controls where tenant_id = 'aaaaaaaa-6400-0000-0000-000000000001';
insert into check_results select 'other-tenant controls visible (expect 0)', count(*)::text from runtime_emergency_controls where tenant_id = 'bbbbbbbb-6400-0000-0000-000000000002';
with u as (update runtime_emergency_controls set lifted_at = now() where true returning 1)
insert into check_results select 'lift any control (expect 0)', count(*)::text from u;
with d as (delete from runtime_emergency_controls where true returning 1)
insert into check_results select 'delete any control (expect 0)', count(*)::text from d;
do $$ begin
  insert into runtime_emergency_controls (tenant_id, control_type, reason) values ('aaaaaaaa-6400-0000-0000-000000000001', 'kill_switch', 'forged');
  insert into check_results values ('engage a control (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('engage a control (expect denied)', 'denied: ' || sqlstate);
end $$;
reset role;
insert into check_results select 'controls still active (expect 2)', count(*)::text from runtime_emergency_controls where id in ('ec640000-0000-0000-0000-00000000000a', 'ec640000-0000-0000-0000-00000000000b') and lifted_at is null;
select * from check_results;

-- 3. Cleanup
-- delete from runtime_emergency_controls where id in ('ec640000-0000-0000-0000-00000000000a', 'ec640000-0000-0000-0000-00000000000b');
-- delete from tenant_memberships where user_id = '11111111-6400-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-6400-0000-0000-000000000001';
-- delete from tenants where id in ('aaaaaaaa-6400-0000-0000-000000000001', 'bbbbbbbb-6400-0000-0000-000000000002');
