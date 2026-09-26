-- Access Agent — ACCESS-P0-19 live verification of migration 0093
-- (access_request_approvals; entitlement owners; policy approval terms).
-- Run via the Supabase MCP execute_sql tool; cleanup in a second call (the
-- commented deletes at the end).
--
-- Proves: approval steps are read only within the tenant and never written
-- by a member directly; a step cannot belong to another tenant's request or
-- name another tenant's identity; the database refuses a decision by the
-- requester or by the person the access is for, even for the service role
-- (four-eyes); a named step names a person and an access-manager step
-- names nobody; a decided step records who and when; two services cannot
-- open the same step twice; an entitlement owner is a same-tenant identity.
--
-- Run 2026-09-26 against the dev project: a step on another tenant's
-- request 23503 (the first run used stage 1, which met B's own open step
-- and got 23505 from the open-step key first; stage 5 isolates the foreign
-- key); a step naming another tenant's identity 23503; the requester
-- deciding their own request, even as the service role, 23514; an
-- access-manager step naming a person 23514; approved without a decision time
-- 23514; the same open step twice 23505; an entitlement owner from another
-- tenant 23503; the named manager deciding updated 1 row. As a member: own
-- steps 1, B's 0; reopening a decided step 0 rows; a direct insert 42501;
-- a direct delete 0 rows. Fixtures deleted afterwards (0 left).
-- The first run's "approved requires who and when" constraint was loosened
-- the same day (0093d, folded into this file): an invalidated step keeps
-- the decision it had, and deleting a decider's user must not be blocked;
-- the check above still holds (approved without a time is 23514).

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9300-0000-0000-000000000001', 'Fixture Tenant A93', 'fixture-tenant-a93-test'),
  ('bbbbbbbb-9300-0000-0000-000000000002', 'Fixture Tenant B93', 'fixture-tenant-b93-test');
insert into auth.users (id, email) values
  ('11111111-9300-0000-0000-000000000001', 'fixture-req93@example.test'),
  ('22222222-9300-0000-0000-000000000002', 'fixture-mgr93@example.test');
insert into users (id, email) values
  ('11111111-9300-0000-0000-000000000001', 'fixture-req93@example.test'),
  ('22222222-9300-0000-0000-000000000002', 'fixture-mgr93@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-9300-0000-0000-000000000001', '11111111-9300-0000-0000-000000000001', 'active'),
  ('aaaaaaaa-9300-0000-0000-000000000001', '22222222-9300-0000-0000-000000000002', 'active');
insert into applications (id, tenant_id, name) values
  ('a9300000-0000-0000-0000-0000000000a1', 'aaaaaaaa-9300-0000-0000-000000000001', 'App A93'),
  ('b9300000-0000-0000-0000-0000000000b1', 'bbbbbbbb-9300-0000-0000-000000000002', 'App B93');
insert into entitlements (id, tenant_id, application_id, name) values
  ('a9300000-0000-0000-0000-0000000000c1', 'aaaaaaaa-9300-0000-0000-000000000001', 'a9300000-0000-0000-0000-0000000000a1', 'Reader A93');
insert into identities (id, tenant_id, identity_type, display_name) values
  ('b9300000-0000-0000-0000-0000000000d1', 'bbbbbbbb-9300-0000-0000-000000000002', 'HUMAN', 'Person B93');
-- The members' own identities come from the membership trigger.
insert into access_requests (id, tenant_id, subject_identity_id, requested_by, application_id, justification, status)
  select 'a9300000-0000-0000-0000-0000000000f1', 'aaaaaaaa-9300-0000-0000-000000000001', i.id, '11111111-9300-0000-0000-000000000001', 'a9300000-0000-0000-0000-0000000000a1', 'x', 'pending'
    from identities i where i.tenant_id = 'aaaaaaaa-9300-0000-0000-000000000001' and i.user_id = '11111111-9300-0000-0000-000000000001';
insert into access_requests (id, tenant_id, subject_identity_id, requested_by, application_id, justification, status) values
  ('b9300000-0000-0000-0000-0000000000f1', 'bbbbbbbb-9300-0000-0000-000000000002', 'b9300000-0000-0000-0000-0000000000d1', '22222222-9300-0000-0000-000000000002', 'b9300000-0000-0000-0000-0000000000b1', 'x', 'pending');
insert into access_request_approvals (id, tenant_id, request_id, stage, approver_kind, approver_user_id, status, action_fingerprint)
  values ('a9300000-0000-0000-0000-0000000000e1', 'aaaaaaaa-9300-0000-0000-000000000001', 'a9300000-0000-0000-0000-0000000000f1', 1, 'manager', '22222222-9300-0000-0000-000000000002', 'pending', repeat('a', 64));
insert into access_request_approvals (tenant_id, request_id, stage, approver_kind, status, action_fingerprint)
  values ('bbbbbbbb-9300-0000-0000-000000000002', 'b9300000-0000-0000-0000-0000000000f1', 1, 'access_managers', 'pending', repeat('b', 64));

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into access_request_approvals (tenant_id, request_id, stage, approver_kind, action_fingerprint) values ('aaaaaaaa-9300-0000-0000-000000000001', 'b9300000-0000-0000-0000-0000000000f1', 5, 'access_managers', repeat('c', 64));
  insert into check_results values ('step on another tenant''s request (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('step on another tenant''s request (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_request_approvals (tenant_id, request_id, stage, approver_kind, approver_identity_id, approver_user_id, action_fingerprint) values ('aaaaaaaa-9300-0000-0000-000000000001', 'a9300000-0000-0000-0000-0000000000f1', 2, 'application_owner', 'b9300000-0000-0000-0000-0000000000d1', '22222222-9300-0000-0000-000000000002', repeat('c', 64));
  insert into check_results values ('step naming another tenant''s identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('step naming another tenant''s identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update access_request_approvals set status = 'approved', decided_by = '11111111-9300-0000-0000-000000000001', decided_at = now() where id = 'a9300000-0000-0000-0000-0000000000e1';
  insert into check_results values ('requester decides own request, service role (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('requester decides own request, service role (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_request_approvals (tenant_id, request_id, stage, approver_kind, approver_user_id, action_fingerprint) values ('aaaaaaaa-9300-0000-0000-000000000001', 'a9300000-0000-0000-0000-0000000000f1', 2, 'access_managers', '22222222-9300-0000-0000-000000000002', repeat('c', 64));
  insert into check_results values ('access-manager step naming a person (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('access-manager step naming a person (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update access_request_approvals set status = 'approved' where id = 'a9300000-0000-0000-0000-0000000000e1';
  insert into check_results values ('approved without a decision time (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('approved without a decision time (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into access_request_approvals (tenant_id, request_id, stage, approver_kind, approver_user_id, status, action_fingerprint) values ('aaaaaaaa-9300-0000-0000-000000000001', 'a9300000-0000-0000-0000-0000000000f1', 1, 'manager', '22222222-9300-0000-0000-000000000002', 'pending', repeat('a', 64));
  insert into check_results values ('the same open step twice (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('the same open step twice (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update entitlements set owner_identity_id = 'b9300000-0000-0000-0000-0000000000d1' where id = 'a9300000-0000-0000-0000-0000000000c1';
  insert into check_results values ('entitlement owner from another tenant (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('entitlement owner from another tenant (expect denied)', 'denied: ' || sqlstate); end $$;
with u as (update access_request_approvals set status = 'approved', decided_by = '22222222-9300-0000-0000-000000000002', decided_at = now() where id = 'a9300000-0000-0000-0000-0000000000e1' returning 1)
insert into check_results select 'the named manager decides, service role (expect 1)', count(*)::text from u;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-9300-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'M: own tenant steps visible (expect 1)', count(*)::text from access_request_approvals where tenant_id = 'aaaaaaaa-9300-0000-0000-000000000001';
insert into check_results select 'M: B steps visible (expect 0)', count(*)::text from access_request_approvals where tenant_id = 'bbbbbbbb-9300-0000-0000-000000000002';
with u as (update access_request_approvals set status = 'pending', decided_by = null, decided_at = null where id = 'a9300000-0000-0000-0000-0000000000e1' returning 1)
insert into check_results select 'M: reopen a decided step directly (expect 0, no update policy)', count(*)::text from u;
do $$ begin
  insert into access_request_approvals (tenant_id, request_id, stage, approver_kind, action_fingerprint) values ('aaaaaaaa-9300-0000-0000-000000000001', 'a9300000-0000-0000-0000-0000000000f1', 3, 'access_managers', repeat('d', 64));
  insert into check_results values ('M: insert a step directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('M: insert a step directly (expect denied)', 'denied: ' || sqlstate); end $$;
with d as (delete from access_request_approvals where id = 'a9300000-0000-0000-0000-0000000000e1' returning 1)
insert into check_results select 'M: delete a step directly (expect 0)', count(*)::text from d;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9300-0000-0000-000000000001', 'bbbbbbbb-9300-0000-0000-000000000002');
-- delete from users where id in ('11111111-9300-0000-0000-000000000001', '22222222-9300-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-9300-0000-0000-000000000001', '22222222-9300-0000-0000-000000000002');
