-- Integration Agent — live proof for migration 0108 (connector_definitions).
-- Reuses the FinanceBot fixture (Tenant A5 = aaaaaaaa-5000-...-0001 with
-- User A5 = 11111111-5000-...-0001; Tenant B5 = bbbbbbbb-5000-...-0002 with
-- User B5 = 22222222-5000-...-0002). One transaction that ROLLS BACK, so it
-- leaves nothing behind. DEV project only, via the Supabase MCP execute_sql
-- tool. Proves: a member reads only their own organization's definitions;
-- only a member with integration.create may publish one, and only into
-- their own organization; nobody (service role included) can edit a
-- published version; and no client can delete one.

begin;

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;

insert into connector_definitions (tenant_id, key, version, name, category, driver, manifest) values
  ('aaaaaaaa-5000-0000-0000-000000000001', 'fixture-a', '1.0.0', 'Fixture A', 'application', 'http', '{}'),
  ('bbbbbbbb-5000-0000-0000-000000000002', 'fixture-b', '1.0.0', 'Fixture B', 'application', 'http', '{}');

-- 1. User A5 with no role: reads own only, cannot publish.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'A reads own (expect 1)', count(*)::text from connector_definitions where key like 'fixture-%' and tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A reads B (expect 0)', count(*)::text from connector_definitions where tenant_id = 'bbbbbbbb-5000-0000-0000-000000000002';
do $$ begin
  insert into connector_definitions (tenant_id, key, version, name, category, driver, manifest) values ('aaaaaaaa-5000-0000-0000-000000000001', 'no-role', '1.0.0', 'x', 'other', 'http', '{}');
  insert into check_results values ('A without integration.create publishes (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('A without integration.create publishes (expect denied)', 'denied: ' || sqlstate);
end $$;
reset role;

-- 2. Give User A5 the IAM Admin role (integration.create).
insert into user_roles (tenant_id, user_id, role_id) select 'aaaaaaaa-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001', id from roles where tenant_id is null and name = 'IAM_ADMIN';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
with i as (insert into connector_definitions (tenant_id, key, version, name, category, driver, manifest) values ('aaaaaaaa-5000-0000-0000-000000000001', 'fixture-a', '1.1.0', 'Fixture A', 'application', 'http', '{}') returning 1)
insert into check_results select 'A admin publishes own (expect 1)', count(*)::text from i;
do $$ begin
  insert into connector_definitions (tenant_id, key, version, name, category, driver, manifest) values ('bbbbbbbb-5000-0000-0000-000000000002', 'forged', '1.0.0', 'x', 'other', 'http', '{}');
  insert into check_results values ('A admin publishes into B (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('A admin publishes into B (expect denied)', 'denied: ' || sqlstate);
end $$;
with u as (update connector_definitions set name = 'edited' where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001' returning 1)
insert into check_results select 'A admin edits own (expect 0: no update policy)', count(*)::text from u;
with d as (delete from connector_definitions where true returning 1)
insert into check_results select 'A admin deletes any (expect 0: no delete policy)', count(*)::text from d;
reset role;

-- 3. User B5 sees none of A5's.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-5000-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'B reads A (expect 0)', count(*)::text from connector_definitions where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
reset role;

-- 4. The service role cannot edit a published version either.
do $$ begin
  update connector_definitions set manifest = '{"tampered":true}' where key = 'fixture-a';
  insert into check_results values ('owner edits a version (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('owner edits a version (expect denied)', 'denied: ' || sqlstate);
end $$;

select * from check_results;
rollback;
