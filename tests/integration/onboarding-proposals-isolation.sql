-- Integration Agent — INTEGRATION-P0-12 live verification of migration
-- 0091 (onboarding_proposals). Run via the Supabase MCP execute_sql tool;
-- cleanup in a second call (the commented deletes at the end).
--
-- Run 2026-09-26 against the dev project, every expectation held:
-- - a proposal for another tenant's application: 23503;
-- - a malformed hash: 23514;
-- - a member sees 1 own proposal and 0 of another tenant's;
-- - a member's direct apply updates 0 rows and a direct insert is 42501;
-- - cleanup left 0 fixture tenants and 0 proposals.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9100-0000-0000-000000000001', 'Fixture Tenant A91', 'fixture-tenant-a91-test'),
  ('bbbbbbbb-9100-0000-0000-000000000002', 'Fixture Tenant B91', 'fixture-tenant-b91-test');
insert into auth.users (id, email) values ('11111111-9100-0000-0000-000000000001', 'fixture-x91@example.test');
insert into users (id, email) values ('11111111-9100-0000-0000-000000000001', 'fixture-x91@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-9100-0000-0000-000000000001', '11111111-9100-0000-0000-000000000001', 'active');
insert into applications (id, tenant_id, name) values
  ('a9100000-0000-0000-0000-0000000000a1', 'aaaaaaaa-9100-0000-0000-000000000001', 'App A91'),
  ('b9100000-0000-0000-0000-0000000000b1', 'bbbbbbbb-9100-0000-0000-000000000002', 'App B91');
insert into onboarding_proposals (id, tenant_id, application_id, input_kind, input_sha256, input_bytes, proposal, overall_confidence) values
  ('a9100000-0000-0000-0000-0000000000c1', 'aaaaaaaa-9100-0000-0000-000000000001', 'a9100000-0000-0000-0000-0000000000a1', 'sample', repeat('a', 64), 10, '{}', 'low'),
  ('b9100000-0000-0000-0000-0000000000c1', 'bbbbbbbb-9100-0000-0000-000000000002', 'b9100000-0000-0000-0000-0000000000b1', 'sample', repeat('b', 64), 10, '{}', 'low');

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into onboarding_proposals (tenant_id, application_id, input_kind, input_sha256, input_bytes, proposal, overall_confidence) values ('aaaaaaaa-9100-0000-0000-000000000001', 'b9100000-0000-0000-0000-0000000000b1', 'sample', repeat('c', 64), 10, '{}', 'low');
  insert into check_results values ('proposal for another tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('proposal for another tenant''s application (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into onboarding_proposals (tenant_id, application_id, input_kind, input_sha256, input_bytes, proposal, overall_confidence) values ('aaaaaaaa-9100-0000-0000-000000000001', 'a9100000-0000-0000-0000-0000000000a1', 'sample', 'short', 10, '{}', 'low');
  insert into check_results values ('malformed hash (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('malformed hash (expect denied)', 'denied: ' || sqlstate); end $$;
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9100-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own proposals visible (expect 1)', count(*)::text from onboarding_proposals where tenant_id = 'aaaaaaaa-9100-0000-0000-000000000001';
insert into check_results select 'X: B proposals visible (expect 0)', count(*)::text from onboarding_proposals where tenant_id = 'bbbbbbbb-9100-0000-0000-000000000002';
with u as (update onboarding_proposals set status = 'APPLIED' where id = 'a9100000-0000-0000-0000-0000000000c1' returning 1)
insert into check_results select 'X: apply directly (expect 0, no update policy)', count(*)::text from u;
do $$ begin
  insert into onboarding_proposals (tenant_id, application_id, input_kind, input_sha256, input_bytes, proposal, overall_confidence) values ('aaaaaaaa-9100-0000-0000-000000000001', 'a9100000-0000-0000-0000-0000000000a1', 'sample', repeat('d', 64), 10, '{}', 'low');
  insert into check_results values ('X: insert directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert directly (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9100-0000-0000-000000000001', 'bbbbbbbb-9100-0000-0000-000000000002');
-- delete from users where id = '11111111-9100-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-9100-0000-0000-000000000001';
