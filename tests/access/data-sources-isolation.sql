-- Access Agent — ACCESS-P0-13 live verification of data_sources and the
-- entitlements.data_source_id link. Run via the Supabase MCP execute_sql
-- tool: (1) fixtures, (2) checks as a tenant-A member, (3) cleanup. It
-- proves a member sees and changes only their own tenant's data sources,
-- and that the database itself refuses a cross-tenant reference: a data
-- source cannot point at another tenant's application, and an entitlement
-- cannot point at another tenant's data source (composite foreign keys),
-- even for a row the member is allowed to write.

-- 1. Fixtures
insert into tenants (id, name, slug) values
  ('aaaaaaaa-7000-0000-0000-000000000001', 'Fixture Tenant A70', 'fixture-tenant-a70-test'),
  ('bbbbbbbb-7000-0000-0000-000000000002', 'Fixture Tenant B70', 'fixture-tenant-b70-test');
insert into auth.users (id, email) values ('11111111-7000-0000-0000-000000000001', 'fixture-user-a70@example.test');
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-7000-0000-0000-000000000001', '11111111-7000-0000-0000-000000000001', 'active');
insert into applications (id, tenant_id, name) values
  ('a7000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7000-0000-0000-000000000001', 'App A70'),
  ('a7000000-0000-0000-0000-00000000000b', 'bbbbbbbb-7000-0000-0000-000000000002', 'App B70');
insert into entitlements (id, tenant_id, application_id, name) values
  ('e7000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7000-0000-0000-000000000001', 'a7000000-0000-0000-0000-00000000000a', 'Ent A70');
insert into data_sources (id, tenant_id, name, kind, classification) values
  ('d7000000-0000-0000-0000-00000000000a', 'aaaaaaaa-7000-0000-0000-000000000001', 'DS A70', 'warehouse', 'restricted'),
  ('d7000000-0000-0000-0000-00000000000b', 'bbbbbbbb-7000-0000-0000-000000000002', 'DS B70', 'database', 'pii');

-- 2. Checks as user A70
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-7000-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'own data sources visible (expect 1)', count(*)::text from data_sources where tenant_id = 'aaaaaaaa-7000-0000-0000-000000000001';
insert into check_results select 'other-tenant data sources visible (expect 0)', count(*)::text from data_sources where tenant_id = 'bbbbbbbb-7000-0000-0000-000000000002';
with u as (update data_sources set classification = 'public' where id = 'd7000000-0000-0000-0000-00000000000b' returning 1)
insert into check_results select 'reclassify other tenant''s source (expect 0)', count(*)::text from u;
with d as (delete from data_sources where true returning 1)
insert into check_results select 'delete any data source (expect 0: no delete policy)', count(*)::text from d;
do $$ begin
  insert into data_sources (tenant_id, name, kind) values ('bbbbbbbb-7000-0000-0000-000000000002', 'forged', 'other');
  insert into check_results values ('insert into other tenant (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('insert into other tenant (expect denied)', 'denied: ' || sqlstate);
end $$;
do $$ begin
  insert into data_sources (tenant_id, name, kind, application_id) values ('aaaaaaaa-7000-0000-0000-000000000001', 'points at B app', 'other', 'a7000000-0000-0000-0000-00000000000b');
  insert into check_results values ('own source -> other tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('own source -> other tenant''s application (expect denied)', 'denied: ' || sqlstate);
end $$;
do $$ begin
  update entitlements set data_source_id = 'd7000000-0000-0000-0000-00000000000b' where id = 'e7000000-0000-0000-0000-00000000000a';
  insert into check_results values ('own entitlement -> other tenant''s source (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('own entitlement -> other tenant''s source (expect denied)', 'denied: ' || sqlstate);
end $$;
with u as (update entitlements set data_source_id = 'd7000000-0000-0000-0000-00000000000a' where id = 'e7000000-0000-0000-0000-00000000000a' returning 1)
insert into check_results select 'own entitlement -> own source (expect 1)', count(*)::text from u;
reset role;
insert into check_results select 'B source unchanged (expect pii)', classification from data_sources where id = 'd7000000-0000-0000-0000-00000000000b';
select * from check_results;

-- 3. Cleanup
-- delete from entitlements where id = 'e7000000-0000-0000-0000-00000000000a';
-- delete from data_sources where tenant_id in ('aaaaaaaa-7000-0000-0000-000000000001', 'bbbbbbbb-7000-0000-0000-000000000002');
-- delete from applications where id in ('a7000000-0000-0000-0000-00000000000a', 'a7000000-0000-0000-0000-00000000000b');
-- delete from tenant_memberships where user_id = '11111111-7000-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-7000-0000-0000-000000000001';
-- delete from tenants where id in ('aaaaaaaa-7000-0000-0000-000000000001', 'bbbbbbbb-7000-0000-0000-000000000002');
