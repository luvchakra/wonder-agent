-- Access Agent — ACCESS-P0-16 live verification of migration 0088
-- (application_onboardings). Run via the Supabase MCP execute_sql tool;
-- cleanup in a second call (the delete at the end).
--
-- Proves: members read only their own tenant's onboarding; no member can
-- insert, update or delete an onboarding row directly (approvals are
-- service-written only, CLAUDE.md §17.4); an onboarding cannot point at
-- another tenant's application; and the submitter can never be the
-- approver, even for the service role (four-eyes, 23514).
--
-- Run 2026-09-26 against the dev project: own row visible 1, B rows 0;
-- a member's direct approve/promote updated 0 rows, direct insert 42501,
-- delete 0; another tenant's application 23503 (the first run pointed at
-- an application that already had an onboarding and got 23505 from the
-- one-per-application key, so the fixture now uses a second application);
-- submitter-approves 23514; the row stayed WAITING_FOR_APPROVAL. Cleanup
-- left 0 fixture tenants and 0 onboarding rows.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-8800-0000-0000-000000000001', 'Fixture Tenant A88', 'fixture-tenant-a88-test'),
  ('bbbbbbbb-8800-0000-0000-000000000002', 'Fixture Tenant B88', 'fixture-tenant-b88-test');
insert into auth.users (id, email) values
  ('11111111-8800-0000-0000-000000000001', 'fixture-x88@example.test'),
  ('22222222-8800-0000-0000-000000000002', 'fixture-y88@example.test');
insert into users (id, email) values
  ('11111111-8800-0000-0000-000000000001', 'fixture-x88@example.test'),
  ('22222222-8800-0000-0000-000000000002', 'fixture-y88@example.test')
on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-8800-0000-0000-000000000001', '11111111-8800-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-8800-0000-0000-000000000002', '22222222-8800-0000-0000-000000000002', 'active');
insert into applications (id, tenant_id, name) values
  ('a8800000-0000-0000-0000-0000000000a1', 'aaaaaaaa-8800-0000-0000-000000000001', 'App A88'),
  ('b8800000-0000-0000-0000-0000000000b1', 'bbbbbbbb-8800-0000-0000-000000000002', 'App B88'),
  ('b8800000-0000-0000-0000-0000000000b2', 'bbbbbbbb-8800-0000-0000-000000000002', 'App B88 two');
insert into application_onboardings (id, tenant_id, application_id, status, config_hash, submitted_by) values
  ('a8800000-0000-0000-0000-0000000000c1', 'aaaaaaaa-8800-0000-0000-000000000001', 'a8800000-0000-0000-0000-0000000000a1', 'WAITING_FOR_APPROVAL', repeat('a', 64), '11111111-8800-0000-0000-000000000001'),
  ('b8800000-0000-0000-0000-0000000000c1', 'bbbbbbbb-8800-0000-0000-000000000002', 'b8800000-0000-0000-0000-0000000000b1', 'CONFIGURING', repeat('b', 64), null);

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-8800-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own onboarding visible (expect 1)', count(*)::text from application_onboardings where tenant_id = 'aaaaaaaa-8800-0000-0000-000000000001';
insert into check_results select 'X: B onboarding visible (expect 0)', count(*)::text from application_onboardings where tenant_id = 'bbbbbbbb-8800-0000-0000-000000000002';
with u as (update application_onboardings set status = 'APPROVED', approved_by = '22222222-8800-0000-0000-000000000002', approved_hash = config_hash where id = 'a8800000-0000-0000-0000-0000000000c1' returning 1)
insert into check_results select 'X: self-approve own tenant row directly (expect 0, no update policy)', count(*)::text from u;
with u as (update application_onboardings set status = 'PROMOTED' where id = 'b8800000-0000-0000-0000-0000000000c1' returning 1)
insert into check_results select 'X: promote a B row (expect 0)', count(*)::text from u;
do $$ begin
  insert into application_onboardings (tenant_id, application_id, config_hash) values ('aaaaaaaa-8800-0000-0000-000000000001', 'a8800000-0000-0000-0000-0000000000a1', repeat('c', 64));
  insert into check_results values ('X: insert in own tenant directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert in own tenant directly (expect denied)', 'denied: ' || sqlstate); end $$;
with d as (delete from application_onboardings where tenant_id = 'aaaaaaaa-8800-0000-0000-000000000001' returning 1)
insert into check_results select 'X: delete, no delete policy (expect 0)', count(*)::text from d;
reset role;
do $$ begin
  insert into application_onboardings (tenant_id, application_id, config_hash) values ('aaaaaaaa-8800-0000-0000-000000000001', 'b8800000-0000-0000-0000-0000000000b2', repeat('d', 64));
  insert into check_results values ('onboarding of another tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('onboarding of another tenant''s application (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update application_onboardings set status = 'APPROVED', approved_by = submitted_by where id = 'a8800000-0000-0000-0000-0000000000c1';
  insert into check_results values ('service role: submitter approves (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('service role: submitter approves (expect denied)', 'denied: ' || sqlstate); end $$;
insert into check_results select 'A row still waiting (expect WAITING_FOR_APPROVAL)', status from application_onboardings where id = 'a8800000-0000-0000-0000-0000000000c1';
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-8800-0000-0000-000000000001', 'bbbbbbbb-8800-0000-0000-000000000002');
-- delete from users where id in ('11111111-8800-0000-0000-000000000001', '22222222-8800-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-8800-0000-0000-000000000001', '22222222-8800-0000-0000-000000000002');
