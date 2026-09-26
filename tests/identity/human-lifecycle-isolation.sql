-- Identity Agent — IDENTITY-P0-18 live verification of migration 0084
-- (identity_lifecycle_events, identity_lifecycle_tasks). Run via the
-- Supabase MCP execute_sql tool; cleanup in a second call.
--
-- Run 2026-09-26 against the dev project: every "expect" held (results
-- in the Identity audit log).

insert into tenants (id, name, slug) values
  ('aaaaaaaa-8400-0000-0000-000000000001', 'Fixture Tenant A84', 'fixture-tenant-a84-test'),
  ('bbbbbbbb-8400-0000-0000-000000000002', 'Fixture Tenant B84', 'fixture-tenant-b84-test');
insert into auth.users (id, email) values
  ('11111111-8400-0000-0000-000000000001', 'fixture-x84@example.test'),
  ('22222222-8400-0000-0000-000000000002', 'fixture-y84@example.test');
insert into users (id, email) values
  ('11111111-8400-0000-0000-000000000001', 'fixture-x84@example.test'),
  ('22222222-8400-0000-0000-000000000002', 'fixture-y84@example.test')
on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-8400-0000-0000-000000000001', '11111111-8400-0000-0000-000000000001', 'active'),
  ('aaaaaaaa-8400-0000-0000-000000000001', '22222222-8400-0000-0000-000000000002', 'active'),
  ('bbbbbbbb-8400-0000-0000-000000000002', '22222222-8400-0000-0000-000000000002', 'active');
insert into identities (id, tenant_id, identity_type, display_name, lifecycle_state) values
  ('a8400000-0000-0000-0000-0000000000a1', 'aaaaaaaa-8400-0000-0000-000000000001', 'HUMAN', 'Person A84', 'ACTIVE'),
  ('b8400000-0000-0000-0000-0000000000b1', 'bbbbbbbb-8400-0000-0000-000000000002', 'HUMAN', 'Person B84', 'ACTIVE');
insert into identity_lifecycle_events (id, tenant_id, identity_id, event_type, origin) values
  ('b8400000-0000-0000-0000-0000000000e1', 'bbbbbbbb-8400-0000-0000-000000000002', 'b8400000-0000-0000-0000-0000000000b1', 'leaver', 'manual');
insert into identity_lifecycle_tasks (id, tenant_id, event_id, identity_id, task_type) values
  ('b8400000-0000-0000-0000-0000000000f1', 'bbbbbbbb-8400-0000-0000-000000000002', 'b8400000-0000-0000-0000-0000000000e1', 'b8400000-0000-0000-0000-0000000000b1', 'revoke_access');

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-8400-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: B events/tasks visible (expect 0)', (
  (select count(*) from identity_lifecycle_events where tenant_id = 'bbbbbbbb-8400-0000-0000-000000000002')
 + (select count(*) from identity_lifecycle_tasks where tenant_id = 'bbbbbbbb-8400-0000-0000-000000000002'))::text;
do $$ begin
  insert into identity_lifecycle_events (tenant_id, identity_id, event_type, origin) values ('bbbbbbbb-8400-0000-0000-000000000002', 'b8400000-0000-0000-0000-0000000000b1', 'rehire', 'manual');
  insert into check_results values ('X: record an event in B (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: record an event in B (expect denied)', 'denied: ' || sqlstate); end $$;
with u as (update identity_lifecycle_tasks set status = 'done', completed_at = now() where id = 'b8400000-0000-0000-0000-0000000000f1' returning 1)
insert into check_results select 'X: close a B task (expect 0)', count(*)::text from u;
with d as (delete from identity_lifecycle_events where tenant_id = 'aaaaaaaa-8400-0000-0000-000000000001' returning 1)
insert into check_results select 'X: delete history, no delete policy (expect 0)', count(*)::text from d;
select set_config('request.jwt.claims', '{"sub":"22222222-8400-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  insert into identity_lifecycle_events (tenant_id, identity_id, event_type, origin) values ('aaaaaaaa-8400-0000-0000-000000000001', 'b8400000-0000-0000-0000-0000000000b1', 'leaver', 'manual');
  insert into check_results values ('Y: A event about a B person (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('Y: A event about a B person (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into identity_lifecycle_tasks (tenant_id, event_id, identity_id, task_type) values ('aaaaaaaa-8400-0000-0000-000000000001', 'b8400000-0000-0000-0000-0000000000e1', 'a8400000-0000-0000-0000-0000000000a1', 'review_access');
  insert into check_results values ('Y: A task on a B event (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('Y: A task on a B event (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;
do $$ begin
  update identity_lifecycle_tasks set status = 'skipped', completed_at = now() where id = 'b8400000-0000-0000-0000-0000000000f1';
  insert into check_results values ('skip without a note (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('skip without a note (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update identity_lifecycle_tasks set status = 'done' where id = 'b8400000-0000-0000-0000-0000000000f1';
  insert into check_results values ('closed without a completion time (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('closed without a completion time (expect denied)', 'denied: ' || sqlstate); end $$;
insert into check_results select 'forged rows that exist (expect 0)', (
  (select count(*) from identity_lifecycle_events where tenant_id = 'bbbbbbbb-8400-0000-0000-000000000002' and event_type = 'rehire')
 + (select count(*) from identity_lifecycle_events where tenant_id = 'aaaaaaaa-8400-0000-0000-000000000001')
 + (select count(*) from identity_lifecycle_tasks where tenant_id = 'aaaaaaaa-8400-0000-0000-000000000001'))::text;
select * from check_results;

-- Cleanup (second call):
-- delete from tenant_memberships where user_id in ('11111111-8400-0000-0000-000000000001', '22222222-8400-0000-0000-000000000002');
-- delete from tenants where id in ('aaaaaaaa-8400-0000-0000-000000000001', 'bbbbbbbb-8400-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-8400-0000-0000-000000000001', '22222222-8400-0000-0000-000000000002');
