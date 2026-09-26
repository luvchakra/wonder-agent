-- Access Agent — ACCESS-P0-20 live verification of migration 0094
-- (access_packages, access_package_resources, access_package_assignments,
-- access_package_assignment_items; package requests). Run via the Supabase
-- MCP execute_sql tool; cleanup in a second call (the commented deletes at
-- the end).
--
-- Proves: every package table is read only within the tenant and never
-- written by a member directly; nothing can point at another tenant's
-- package, application, entitlement, identity or request; a request names
-- an application or a package, never both or neither; one waiting request
-- per identity and package; one live assignment per identity and package;
-- one assignment per request; an ended assignment records when it ended.
--
-- Run 2026-09-26 against the dev project: another tenant's application in
-- a package, a resource in another tenant's package, a package owner from
-- another tenant, a request for another tenant's package, an assignment to
-- another tenant's identity, a work item for another tenant's application
-- 23503; a request naming both or neither 23514; a second waiting request
-- for the package 23505; a second live assignment 23505; a direct
-- assignment carrying a request 23514; ended without an end time 23514. As
-- a member: own rows 1/1/1/1, B's packages 0; marking an item fulfilled,
-- widening eligibility or deleting a resource directly 0 rows; inserting
-- an assignment 42501. Fixtures deleted afterwards (0 left).

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9400-0000-0000-000000000001', 'Fixture Tenant A94', 'fixture-tenant-a94-test'),
  ('bbbbbbbb-9400-0000-0000-000000000002', 'Fixture Tenant B94', 'fixture-tenant-b94-test');
insert into auth.users (id, email) values ('11111111-9400-0000-0000-000000000001', 'fixture-x94@example.test');
insert into users (id, email) values ('11111111-9400-0000-0000-000000000001', 'fixture-x94@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-9400-0000-0000-000000000001', '11111111-9400-0000-0000-000000000001', 'active');
insert into applications (id, tenant_id, name) values
  ('a9400000-0000-0000-0000-0000000000a1', 'aaaaaaaa-9400-0000-0000-000000000001', 'App A94'),
  ('b9400000-0000-0000-0000-0000000000b1', 'bbbbbbbb-9400-0000-0000-000000000002', 'App B94');
insert into identities (id, tenant_id, identity_type, display_name) values
  ('a9400000-0000-0000-0000-0000000000d1', 'aaaaaaaa-9400-0000-0000-000000000001', 'HUMAN', 'Person A94'),
  ('b9400000-0000-0000-0000-0000000000d1', 'bbbbbbbb-9400-0000-0000-000000000002', 'HUMAN', 'Person B94');
insert into access_packages (id, tenant_id, name, status) values
  ('a9400000-0000-0000-0000-0000000000e1', 'aaaaaaaa-9400-0000-0000-000000000001', 'Package A94', 'active'),
  ('b9400000-0000-0000-0000-0000000000e1', 'bbbbbbbb-9400-0000-0000-000000000002', 'Package B94', 'active');
insert into access_package_resources (tenant_id, package_id, application_id) values
  ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'a9400000-0000-0000-0000-0000000000a1');
insert into access_requests (id, tenant_id, subject_identity_id, requested_by, access_package_id, justification, status) values
  ('a9400000-0000-0000-0000-0000000000f1', 'aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000d1', '11111111-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'x', 'pending');
insert into access_package_assignments (id, tenant_id, package_id, identity_id, source) values
  ('a9400000-0000-0000-0000-0000000000c1', 'aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'a9400000-0000-0000-0000-0000000000d1', 'direct');
insert into access_package_assignment_items (tenant_id, assignment_id, application_id) values
  ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000c1', 'a9400000-0000-0000-0000-0000000000a1');

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into access_package_resources (tenant_id, package_id, application_id) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'b9400000-0000-0000-0000-0000000000b1');
  insert into check_results values ('package includes another tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('package includes another tenant''s application (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_package_resources (tenant_id, package_id, application_id) values ('aaaaaaaa-9400-0000-0000-000000000001', 'b9400000-0000-0000-0000-0000000000e1', 'a9400000-0000-0000-0000-0000000000a1');
  insert into check_results values ('resource in another tenant''s package (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('resource in another tenant''s package (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update access_packages set owner_identity_id = 'b9400000-0000-0000-0000-0000000000d1' where id = 'a9400000-0000-0000-0000-0000000000e1';
  insert into check_results values ('package owner from another tenant (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('package owner from another tenant (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, subject_identity_id, requested_by, access_package_id, justification) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000d1', '11111111-9400-0000-0000-000000000001', 'b9400000-0000-0000-0000-0000000000e1', 'x');
  insert into check_results values ('request for another tenant''s package (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('request for another tenant''s package (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, subject_identity_id, requested_by, application_id, access_package_id, justification) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000d1', '11111111-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000a1', 'a9400000-0000-0000-0000-0000000000e1', 'x');
  insert into check_results values ('request naming an application and a package (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('request naming an application and a package (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, subject_identity_id, requested_by, justification) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000d1', '11111111-9400-0000-0000-000000000001', 'x');
  insert into check_results values ('request naming neither (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('request naming neither (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, subject_identity_id, requested_by, access_package_id, justification, status) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000d1', '11111111-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'x', 'pending');
  insert into check_results values ('second waiting request for the package (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('second waiting request for the package (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_package_assignments (tenant_id, package_id, identity_id, source) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'a9400000-0000-0000-0000-0000000000d1', 'direct');
  insert into check_results values ('second live assignment (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('second live assignment (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_package_assignments (tenant_id, package_id, identity_id, source) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'b9400000-0000-0000-0000-0000000000d1', 'direct');
  insert into check_results values ('assignment to another tenant''s identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('assignment to another tenant''s identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_package_assignments (tenant_id, package_id, identity_id, source, request_id, status, ended_at) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'a9400000-0000-0000-0000-0000000000d1', 'direct', 'a9400000-0000-0000-0000-0000000000f1', 'revoked', now());
  insert into check_results values ('direct assignment carrying a request (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('direct assignment carrying a request (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update access_package_assignments set status = 'revoked' where id = 'a9400000-0000-0000-0000-0000000000c1';
  insert into check_results values ('ended without an end time (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('ended without an end time (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_package_assignment_items (tenant_id, assignment_id, application_id) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000c1', 'b9400000-0000-0000-0000-0000000000b1');
  insert into check_results values ('work item for another tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('work item for another tenant''s application (expect denied)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9400-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own packages / resources / assignments / items visible (expect 1/1/1/1)',
  (select count(*) from access_packages where tenant_id = 'aaaaaaaa-9400-0000-0000-000000000001')::text || '/' ||
  (select count(*) from access_package_resources where tenant_id = 'aaaaaaaa-9400-0000-0000-000000000001')::text || '/' ||
  (select count(*) from access_package_assignments where tenant_id = 'aaaaaaaa-9400-0000-0000-000000000001')::text || '/' ||
  (select count(*) from access_package_assignment_items where tenant_id = 'aaaaaaaa-9400-0000-0000-000000000001')::text;
insert into check_results select 'X: B packages visible (expect 0)', count(*)::text from access_packages where tenant_id = 'bbbbbbbb-9400-0000-0000-000000000002';
with u as (update access_package_assignment_items set status = 'fulfilled' where tenant_id = 'aaaaaaaa-9400-0000-0000-000000000001' returning 1)
insert into check_results select 'X: mark an item fulfilled directly (expect 0)', count(*)::text from u;
with u as (update access_packages set eligible_identity_types = array['HUMAN', 'AI_AGENT'] where id = 'a9400000-0000-0000-0000-0000000000e1' returning 1)
insert into check_results select 'X: widen a package''s eligibility directly (expect 0)', count(*)::text from u;
do $$ begin
  insert into access_package_assignments (tenant_id, package_id, identity_id, source, status) values ('aaaaaaaa-9400-0000-0000-000000000001', 'a9400000-0000-0000-0000-0000000000e1', 'a9400000-0000-0000-0000-0000000000d1', 'direct', 'revoked');
  insert into check_results values ('X: insert an assignment directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert an assignment directly (expect denied)', 'denied: ' || sqlstate); end $$;
with d as (delete from access_package_resources where tenant_id = 'aaaaaaaa-9400-0000-0000-000000000001' returning 1)
insert into check_results select 'X: delete a package resource directly (expect 0)', count(*)::text from d;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from access_requests where tenant_id in ('aaaaaaaa-9400-0000-0000-000000000001', 'bbbbbbbb-9400-0000-0000-000000000002');
-- delete from tenants where id in ('aaaaaaaa-9400-0000-0000-000000000001', 'bbbbbbbb-9400-0000-0000-000000000002');
-- delete from users where id = '11111111-9400-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-9400-0000-0000-000000000001';
