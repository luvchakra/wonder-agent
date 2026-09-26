-- Access Agent — ACCESS-P0-18 live verification of migration 0092
-- (access_request_policies; access_requests for identities). Run via the
-- Supabase MCP execute_sql tool; cleanup in a second call (the commented
-- deletes at the end).
--
-- Proves: policies are read only within the tenant and cannot be written
-- by a member directly; a policy or request cannot point at another
-- tenant's application, entitlement or identity; one policy per scope; a
-- request names an agent or an identity; two identical pending requests
-- for one person cannot both exist; existing agent requests are untouched.
--
-- Run 2026-09-26 against the dev project: policy on B's application 23503;
-- second policy for one scope 23505; request for B's identity 23503;
-- request for nobody 23514; second identical pending request 23505; own
-- policies visible 1, B's 0; member loosening its own policy updates 0
-- rows; member inserting a policy 42501; agent-less, subject-less requests
-- 0. Fixtures deleted afterwards.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9200-0000-0000-000000000001', 'Fixture Tenant A92', 'fixture-tenant-a92-test'),
  ('bbbbbbbb-9200-0000-0000-000000000002', 'Fixture Tenant B92', 'fixture-tenant-b92-test');
insert into auth.users (id, email) values ('11111111-9200-0000-0000-000000000001', 'fixture-x92@example.test');
insert into users (id, email) values ('11111111-9200-0000-0000-000000000001', 'fixture-x92@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-9200-0000-0000-000000000001', '11111111-9200-0000-0000-000000000001', 'active');
insert into applications (id, tenant_id, name) values
  ('a9200000-0000-0000-0000-0000000000a1', 'aaaaaaaa-9200-0000-0000-000000000001', 'App A92'),
  ('b9200000-0000-0000-0000-0000000000b1', 'bbbbbbbb-9200-0000-0000-000000000002', 'App B92');
insert into identities (id, tenant_id, identity_type, display_name) values
  ('a9200000-0000-0000-0000-0000000000d1', 'aaaaaaaa-9200-0000-0000-000000000001', 'HUMAN', 'Person A92'),
  ('b9200000-0000-0000-0000-0000000000d1', 'bbbbbbbb-9200-0000-0000-000000000002', 'HUMAN', 'Person B92');
insert into access_request_policies (id, tenant_id, name, application_id) values
  ('a9200000-0000-0000-0000-0000000000e1', 'aaaaaaaa-9200-0000-0000-000000000001', 'A policy', 'a9200000-0000-0000-0000-0000000000a1'),
  ('b9200000-0000-0000-0000-0000000000e1', 'bbbbbbbb-9200-0000-0000-000000000002', 'B policy', 'b9200000-0000-0000-0000-0000000000b1');
insert into access_requests (tenant_id, subject_identity_id, requested_by, application_id, justification, status) values
  ('aaaaaaaa-9200-0000-0000-000000000001', 'a9200000-0000-0000-0000-0000000000d1', '11111111-9200-0000-0000-000000000001', 'a9200000-0000-0000-0000-0000000000a1', 'x', 'pending');

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into access_request_policies (tenant_id, name, application_id) values ('aaaaaaaa-9200-0000-0000-000000000001', 'forged', 'b9200000-0000-0000-0000-0000000000b1');
  insert into check_results values ('policy on another tenant''s application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('policy on another tenant''s application (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_request_policies (tenant_id, name, application_id) values ('aaaaaaaa-9200-0000-0000-000000000001', 'second', 'a9200000-0000-0000-0000-0000000000a1');
  insert into check_results values ('second policy for one scope (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('second policy for one scope (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, subject_identity_id, requested_by, application_id, justification) values ('aaaaaaaa-9200-0000-0000-000000000001', 'b9200000-0000-0000-0000-0000000000d1', '11111111-9200-0000-0000-000000000001', 'a9200000-0000-0000-0000-0000000000a1', 'x');
  insert into check_results values ('request for another tenant''s identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('request for another tenant''s identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, requested_by, application_id, justification) values ('aaaaaaaa-9200-0000-0000-000000000001', '11111111-9200-0000-0000-000000000001', 'a9200000-0000-0000-0000-0000000000a1', 'x');
  insert into check_results values ('request for nobody (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('request for nobody (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_requests (tenant_id, subject_identity_id, requested_by, application_id, justification, status) values ('aaaaaaaa-9200-0000-0000-000000000001', 'a9200000-0000-0000-0000-0000000000d1', '11111111-9200-0000-0000-000000000001', 'a9200000-0000-0000-0000-0000000000a1', 'x', 'pending');
  insert into check_results values ('second identical pending request (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('second identical pending request (expect denied)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9200-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own policies visible (expect 1)', count(*)::text from access_request_policies where tenant_id = 'aaaaaaaa-9200-0000-0000-000000000001';
insert into check_results select 'X: B policies visible (expect 0)', count(*)::text from access_request_policies where tenant_id = 'bbbbbbbb-9200-0000-0000-000000000002';
with u as (update access_request_policies set auto_approve = true, risk_threshold = 'critical' where id = 'a9200000-0000-0000-0000-0000000000e1' returning 1)
insert into check_results select 'X: loosen own policy directly (expect 0, no update policy)', count(*)::text from u;
do $$ begin
  insert into access_request_policies (tenant_id, name) values ('aaaaaaaa-9200-0000-0000-000000000001', 'default');
  insert into check_results values ('X: insert a policy directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert a policy directly (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;
insert into check_results select 'existing agent requests keep their agent (expect 0 without)', count(*)::text from access_requests where agent_id is null and subject_identity_id is null;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9200-0000-0000-000000000001', 'bbbbbbbb-9200-0000-0000-000000000002');
-- delete from users where id = '11111111-9200-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-9200-0000-0000-000000000001';
