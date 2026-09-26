-- Integration Agent — INTEGRATION-P0-10 live verification of migration
-- 0090 (application_discoveries). Run via the Supabase MCP execute_sql
-- tool; cleanup in a second call (the commented deletes at the end).
--
-- Proves: members read only their tenant's discoveries and cannot insert,
-- update (decide) or delete one directly; a discovery cannot point at
-- another tenant's integration or application; an ignored or excepted
-- discovery must say why; a source key is recorded once per tenant.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9000-0000-0000-000000000001', 'Fixture Tenant A90', 'fixture-tenant-a90-test'),
  ('bbbbbbbb-9000-0000-0000-000000000002', 'Fixture Tenant B90', 'fixture-tenant-b90-test');
insert into auth.users (id, email) values ('11111111-9000-0000-0000-000000000001', 'fixture-x90@example.test');
insert into users (id, email) values ('11111111-9000-0000-0000-000000000001', 'fixture-x90@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-9000-0000-0000-000000000001', '11111111-9000-0000-0000-000000000001', 'active');
insert into applications (id, tenant_id, name) values ('b9000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-9000-0000-0000-000000000002', 'App B90');
insert into integrations (id, tenant_id, integration_type_id, name) values ('b9000000-0000-0000-0000-0000000000f1', 'bbbbbbbb-9000-0000-0000-000000000002', 'generic_rest', 'Conn B90');
insert into application_discoveries (id, tenant_id, source, source_key, name) values
  ('a9000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-9000-0000-0000-000000000001', 'manual', 'figma', 'Figma'),
  ('b9000000-0000-0000-0000-0000000000d1', 'bbbbbbbb-9000-0000-0000-000000000002', 'manual', 'miro', 'Miro');

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into application_discoveries (tenant_id, source, source_key, name, source_integration_id) values ('aaaaaaaa-9000-0000-0000-000000000001', 'integration', 'x1', 'X1', 'b9000000-0000-0000-0000-0000000000f1');
  insert into check_results values ('another tenant''s integration (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('another tenant''s integration (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into application_discoveries (tenant_id, source, source_key, name, status, application_id) values ('aaaaaaaa-9000-0000-0000-000000000001', 'manual', 'x2', 'X2', 'MATCHED', 'b9000000-0000-0000-0000-0000000000b1');
  insert into check_results values ('another tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('another tenant''s application (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update application_discoveries set status = 'IGNORED' where id = 'a9000000-0000-0000-0000-0000000000d1';
  insert into check_results values ('ignored without a reason (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('ignored without a reason (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into application_discoveries (tenant_id, source, source_key, name) values ('aaaaaaaa-9000-0000-0000-000000000001', 'manual', 'figma', 'Figma again');
  insert into check_results values ('same source key twice (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('same source key twice (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into application_discoveries (tenant_id, source, source_key, name, url) values ('aaaaaaaa-9000-0000-0000-000000000001', 'manual', 'x3', 'X3', 'http://insecure.example.com');
  insert into check_results values ('non-https address (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('non-https address (expect denied)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9000-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own discoveries visible (expect 1)', count(*)::text from application_discoveries where tenant_id = 'aaaaaaaa-9000-0000-0000-000000000001';
insert into check_results select 'X: B discoveries visible (expect 0)', count(*)::text from application_discoveries where tenant_id = 'bbbbbbbb-9000-0000-0000-000000000002';
with u as (update application_discoveries set status = 'IGNORED', decision_note = 'self' where id = 'a9000000-0000-0000-0000-0000000000d1' returning 1)
insert into check_results select 'X: decide own directly (expect 0, no update policy)', count(*)::text from u;
do $$ begin
  insert into application_discoveries (tenant_id, source, source_key, name) values ('aaaaaaaa-9000-0000-0000-000000000001', 'manual', 'x4', 'X4');
  insert into check_results values ('X: insert directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert directly (expect denied)', 'denied: ' || sqlstate); end $$;
with d as (delete from application_discoveries where tenant_id = 'aaaaaaaa-9000-0000-0000-000000000001' returning 1)
insert into check_results select 'X: delete (expect 0)', count(*)::text from d;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9000-0000-0000-000000000001', 'bbbbbbbb-9000-0000-0000-000000000002');
-- delete from users where id = '11111111-9000-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-9000-0000-0000-000000000001';
