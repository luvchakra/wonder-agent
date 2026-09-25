-- Risk Agent — RISK-P0-11 live verification of investigations,
-- investigation_findings and investigation_events. Run via the Supabase
-- MCP execute_sql tool: (1) fixtures, (2) checks as a tenant-A member,
-- (3) cleanup. It proves members read only their own tenant's
-- investigations and timeline, that no client can create, change or
-- delete any of them (the service role writes, behind risk.manage), and
-- that even the service role cannot group another tenant's finding into
-- an investigation (composite foreign key).

-- 1. Fixtures
insert into tenants (id, name, slug) values
  ('aaaaaaaa-7100-0000-0000-000000000001', 'Fixture Tenant A71', 'fixture-tenant-a71-test'),
  ('bbbbbbbb-7100-0000-0000-000000000002', 'Fixture Tenant B71', 'fixture-tenant-b71-test');
insert into auth.users (id, email) values ('11111111-7100-0000-0000-000000000001', 'fixture-user-a71@example.test');
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-7100-0000-0000-000000000001', '11111111-7100-0000-0000-000000000001', 'active');
insert into agents (id, tenant_id, agent_name, agent_type, purpose, data_classification, criticality) values
  ('a7100000-0000-0000-0000-00000000000a', 'aaaaaaaa-7100-0000-0000-000000000001', 'Bot A71', 'automation', 'x', 'internal', 'low'),
  ('a7100000-0000-0000-0000-00000000000b', 'bbbbbbbb-7100-0000-0000-000000000002', 'Bot B71', 'automation', 'x', 'internal', 'low');
insert into risk_findings (id, tenant_id, agent_id, category, severity, title, explanation, recommendation) values
  ('f7100000-0000-0000-0000-00000000000a', 'aaaaaaaa-7100-0000-0000-000000000001', 'a7100000-0000-0000-0000-00000000000a', 'excessive_access', 'high', 'A', 'A', 'A'),
  ('f7100000-0000-0000-0000-00000000000b', 'bbbbbbbb-7100-0000-0000-000000000002', 'a7100000-0000-0000-0000-00000000000b', 'excessive_access', 'high', 'B', 'B', 'B');
insert into investigations (id, tenant_id, reference, title, priority) values
  ('17100000-0000-0000-0000-00000000000a', 'aaaaaaaa-7100-0000-0000-000000000001', 'INV-2026-001', 'Inv A', 'high'),
  ('17100000-0000-0000-0000-00000000000b', 'bbbbbbbb-7100-0000-0000-000000000002', 'INV-2026-001', 'Inv B', 'high');
insert into investigation_findings (investigation_id, finding_id, tenant_id) values
  ('17100000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'aaaaaaaa-7100-0000-0000-000000000001'),
  ('17100000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b', 'bbbbbbbb-7100-0000-0000-000000000002');
insert into investigation_events (investigation_id, tenant_id, event_type) values
  ('17100000-0000-0000-0000-00000000000a', 'aaaaaaaa-7100-0000-0000-000000000001', 'created'),
  ('17100000-0000-0000-0000-00000000000b', 'bbbbbbbb-7100-0000-0000-000000000002', 'created');

-- 2. Checks
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
-- As the service role: another tenant's finding cannot be grouped in, even directly.
do $$ begin
  insert into investigation_findings (investigation_id, finding_id, tenant_id) values ('17100000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000b', 'aaaaaaaa-7100-0000-0000-000000000001');
  insert into check_results values ('group other tenant''s finding, service role (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('group other tenant''s finding, service role (expect denied)', 'denied: ' || sqlstate);
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-7100-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'own investigations visible (expect 1)', count(*)::text from investigations;
insert into check_results select 'own links visible (expect 1)', count(*)::text from investigation_findings;
insert into check_results select 'own timeline visible (expect 1)', count(*)::text from investigation_events;
insert into check_results select 'other tenant''s investigation by id (expect 0)', count(*)::text from investigations where id = '17100000-0000-0000-0000-00000000000b';
with u as (update investigations set status = 'closed' where true returning 1)
insert into check_results select 'change any investigation (expect 0)', count(*)::text from u;
with d as (delete from investigation_events where true returning 1)
insert into check_results select 'delete any timeline row (expect 0)', count(*)::text from d;
with d as (delete from investigation_findings where true returning 1)
insert into check_results select 'unlink any finding (expect 0)', count(*)::text from d;
do $$ begin
  insert into investigations (tenant_id, reference, title, priority) values ('aaaaaaaa-7100-0000-0000-000000000001', 'INV-2026-002', 'forged', 'low');
  insert into check_results values ('create an investigation as a member (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('create an investigation as a member (expect denied)', 'denied: ' || sqlstate);
end $$;
do $$ begin
  insert into investigation_events (investigation_id, tenant_id, event_type) values ('17100000-0000-0000-0000-00000000000a', 'aaaaaaaa-7100-0000-0000-000000000001', 'note');
  insert into check_results values ('forge a timeline entry (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('forge a timeline entry (expect denied)', 'denied: ' || sqlstate);
end $$;
reset role;
insert into check_results select 'rows intact (expect 2 2 2)', (select count(*) from investigations where id::text like '17100000%')::text || ' ' || (select count(*) from investigation_findings where tenant_id::text like '%7100%')::text || ' ' || (select count(*) from investigation_events where tenant_id::text like '%7100%')::text;
select * from check_results;

-- 3. Cleanup
-- delete from tenants where id in ('aaaaaaaa-7100-0000-0000-000000000001', 'bbbbbbbb-7100-0000-0000-000000000002');
-- delete from auth.users where id = '11111111-7100-0000-0000-000000000001';
