-- Access Agent — ACCESS-P0-33 live verification of migration 0169
-- (application_entitlement_types; entitlement type, requestable, SOX flags).
-- Run via the Supabase MCP execute_sql tool; cleanup in a second call (the
-- commented deletes at the end).
--
-- Proves:
-- - a type cannot belong to another organization's application, nor name
--   another organization's request policy;
-- - one type per name per application, ignoring case;
-- - a default longer than the maximum is refused;
-- - a member reads only their own organization's types and cannot write any.
--
-- Run 2026-10-14 against the dev project, 7 of 7 as expected:
-- - another tenant's application or policy: 23503;
-- - a duplicate name in another case: 23505;
-- - a default above the maximum: 23514;
-- - as a member: own types 1, B's 0; changing a type directly 0 rows;
--   inserting one 42501.
-- The cleanup call was cancelled, so the fixtures (slugs
-- fixture-tenant-a169-test and -b169-test) are still there.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-1690-0000-0000-000000000001', 'Fixture Tenant A169', 'fixture-tenant-a169-test'),
  ('bbbbbbbb-1690-0000-0000-000000000002', 'Fixture Tenant B169', 'fixture-tenant-b169-test');
insert into auth.users (id, email) values ('11111111-1690-0000-0000-000000000001', 'fixture-x169@example.test');
insert into users (id, email) values ('11111111-1690-0000-0000-000000000001', 'fixture-x169@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-1690-0000-0000-000000000001', '11111111-1690-0000-0000-000000000001', 'active');
insert into applications (id, tenant_id, name) values
  ('a1690000-0000-0000-0000-0000000000a1', 'aaaaaaaa-1690-0000-0000-000000000001', 'App A169'),
  ('b1690000-0000-0000-0000-0000000000b1', 'bbbbbbbb-1690-0000-0000-000000000002', 'App B169');
insert into access_request_policies (id, tenant_id, name) values ('b1690000-0000-0000-0000-0000000000c1', 'bbbbbbbb-1690-0000-0000-000000000002', 'Policy B169');
insert into application_entitlement_types (tenant_id, application_id, name) values
  ('aaaaaaaa-1690-0000-0000-000000000001', 'a1690000-0000-0000-0000-0000000000a1', 'group'),
  ('bbbbbbbb-1690-0000-0000-000000000002', 'b1690000-0000-0000-0000-0000000000b1', 'role');

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into application_entitlement_types (tenant_id, application_id, name) values ('aaaaaaaa-1690-0000-0000-000000000001', 'b1690000-0000-0000-0000-0000000000b1', 'x');
  insert into check_results values ('type on another tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('type on another tenant''s application (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into application_entitlement_types (tenant_id, application_id, name, request_policy_id) values ('aaaaaaaa-1690-0000-0000-000000000001', 'a1690000-0000-0000-0000-0000000000a1', 'y', 'b1690000-0000-0000-0000-0000000000c1');
  insert into check_results values ('type naming another tenant''s request policy (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('type naming another tenant''s request policy (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into application_entitlement_types (tenant_id, application_id, name) values ('aaaaaaaa-1690-0000-0000-000000000001', 'a1690000-0000-0000-0000-0000000000a1', 'GROUP');
  insert into check_results values ('same type name twice, other case (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('same type name twice, other case (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into application_entitlement_types (tenant_id, application_id, name, default_duration_days, max_duration_days) values ('aaaaaaaa-1690-0000-0000-000000000001', 'a1690000-0000-0000-0000-0000000000a1', 'z', 60, 30);
  insert into check_results values ('default above maximum (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('default above maximum (expect denied)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1690-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own types / B types visible (expect 1/0)',
  (select count(*) from application_entitlement_types where tenant_id = 'aaaaaaaa-1690-0000-0000-000000000001')::text || '/' ||
  (select count(*) from application_entitlement_types where tenant_id = 'bbbbbbbb-1690-0000-0000-000000000002')::text;
with u as (update application_entitlement_types set request_mode = 'multiple' where tenant_id = 'aaaaaaaa-1690-0000-0000-000000000001' returning 1)
insert into check_results select 'X: change a type directly (expect 0)', count(*)::text from u;
do $$ begin
  insert into application_entitlement_types (tenant_id, application_id, name) values ('aaaaaaaa-1690-0000-0000-000000000001', 'a1690000-0000-0000-0000-0000000000a1', 'forged');
  insert into check_results values ('X: insert a type directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert a type directly (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-1690-0000-0000-000000000001', 'bbbbbbbb-1690-0000-0000-000000000002');
-- delete from users where id = '11111111-1690-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-1690-0000-0000-000000000001';
