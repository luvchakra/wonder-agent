-- Foundation Agent — FOUNDATION-P0-23 live verification of migration 0096
-- (membership lifecycle, self-protection, last-administrator guard, user
-- directory, sessions). Run via the Supabase MCP execute_sql tool; cleanup
-- in a second call (the commented deletes at the end).
--
-- Proves: the lifecycle statuses (deactivated accepted, anything else
-- refused); the last Tenant Administrator can be neither suspended, nor
-- stripped of the role, nor deleted — while a second administrator exists
-- they can; deleting the whole organization still cascades; nobody grants
-- themselves a role or changes their own status, except accepting their own
-- invitation; the directory returns only the requested tenant's people,
-- searches literally, and filters by status and role; members and anonymous
-- callers can run none of the service-only functions; RLS still shows a
-- member only their own organization's memberships.
--
-- Fixtures: tenant A96 with administrator X and member Y (read-only);
-- tenant B96 with member Z.
--
-- Run 2026-09-26 against the dev project, all 22 checks as expected:
-- unknown status 23514; deactivated accepted and time-stamped; the last
-- administrator could not be suspended, lose the role or be deleted (each
-- 23514); with a second administrator the first was suspended, and the
-- remaining one then could not be (23514); self-grant 23514; own status
-- change 42501; accepting one's own invitation → active; directory A 2,
-- directory B 0 of A's people; "100%" matched only "Yara 100% Fixture" and
-- "%" matched 1; role filter 0; summary 2/2; member X saw 2 memberships
-- (own organization only), was refused the directory and session
-- revocation (42501) and changed 0 memberships directly; anonymous
-- session listing 42501; deleting organization A cascaded (0 left).
-- Fixtures deleted afterwards (0 left).

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9600-0000-0000-000000000001', 'Fixture Tenant A96', 'fixture-a96'),
  ('bbbbbbbb-9600-0000-0000-000000000002', 'Fixture Tenant B96', 'fixture-b96');
insert into auth.users (id, email) values
  ('11111111-9600-0000-0000-000000000001', 'fixture-x96@example.test'),
  ('22222222-9600-0000-0000-000000000002', 'fixture-y96@example.test'),
  ('33333333-9600-0000-0000-000000000003', 'fixture-z96@example.test');
insert into users (id, email, display_name) values
  ('11111111-9600-0000-0000-000000000001', 'fixture-x96@example.test', 'Xavier Fixture'),
  ('22222222-9600-0000-0000-000000000002', 'fixture-y96@example.test', 'Yara 100% Fixture'),
  ('33333333-9600-0000-0000-000000000003', 'fixture-z96@example.test', 'Zed Fixture')
on conflict (id) do update set display_name = excluded.display_name;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-9600-0000-0000-000000000001', '11111111-9600-0000-0000-000000000001', 'active'),
  ('aaaaaaaa-9600-0000-0000-000000000001', '22222222-9600-0000-0000-000000000002', 'active'),
  ('bbbbbbbb-9600-0000-0000-000000000002', '33333333-9600-0000-0000-000000000003', 'active');
insert into user_roles (tenant_id, user_id, role_id)
select 'aaaaaaaa-9600-0000-0000-000000000001', '11111111-9600-0000-0000-000000000001', id from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
insert into user_roles (tenant_id, user_id, role_id)
select 'aaaaaaaa-9600-0000-0000-000000000001', '22222222-9600-0000-0000-000000000002', id from roles where tenant_id is null and name = 'READ_ONLY';

create temporary table check_results (check_name text, result text);

-- Lifecycle statuses.
do $$ begin
  update tenant_memberships set status = 'bogus' where user_id = '22222222-9600-0000-0000-000000000002';
  insert into check_results values ('unknown status (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('unknown status (expect denied)', 'denied: ' || sqlstate); end $$;
update tenant_memberships set status = 'deactivated', status_changed_by = '11111111-9600-0000-0000-000000000001', status_reason = 'fixture' where user_id = '22222222-9600-0000-0000-000000000002';
insert into check_results select 'deactivated accepted, change stamped (expect deactivated/true)', status || '/' || (status_changed_at is not null)::text from tenant_memberships where user_id = '22222222-9600-0000-0000-000000000002';
update tenant_memberships set status = 'active', status_changed_by = '11111111-9600-0000-0000-000000000001' where user_id = '22222222-9600-0000-0000-000000000002';

-- Last administrator.
do $$ begin
  update tenant_memberships set status = 'suspended', status_changed_by = '22222222-9600-0000-0000-000000000002' where user_id = '11111111-9600-0000-0000-000000000001';
  insert into check_results values ('suspend the last admin (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('suspend the last admin (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  delete from user_roles where user_id = '11111111-9600-0000-0000-000000000001' and tenant_id = 'aaaaaaaa-9600-0000-0000-000000000001';
  insert into check_results values ('remove the last admin''s role (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('remove the last admin''s role (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  delete from tenant_memberships where user_id = '11111111-9600-0000-0000-000000000001';
  insert into check_results values ('delete the last admin''s membership (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('delete the last admin''s membership (expect denied 23514)', 'denied: ' || sqlstate); end $$;
-- A second administrator makes it possible, and the first can come back.
insert into user_roles (tenant_id, user_id, role_id, granted_by)
select 'aaaaaaaa-9600-0000-0000-000000000001', '22222222-9600-0000-0000-000000000002', id, '11111111-9600-0000-0000-000000000001' from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
update tenant_memberships set status = 'suspended', status_changed_by = '22222222-9600-0000-0000-000000000002' where user_id = '11111111-9600-0000-0000-000000000001';
insert into check_results select 'suspend an admin while another exists (expect suspended)', status from tenant_memberships where user_id = '11111111-9600-0000-0000-000000000001';
do $$ begin
  update tenant_memberships set status = 'suspended', status_changed_by = '33333333-9600-0000-0000-000000000003' where user_id = '22222222-9600-0000-0000-000000000002';
  insert into check_results values ('then suspend the remaining admin (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('then suspend the remaining admin (expect denied 23514)', 'denied: ' || sqlstate); end $$;
update tenant_memberships set status = 'active', status_changed_by = '22222222-9600-0000-0000-000000000002' where user_id = '11111111-9600-0000-0000-000000000001';

-- Self-protection.
do $$ begin
  insert into user_roles (tenant_id, user_id, role_id, granted_by)
  select 'aaaaaaaa-9600-0000-0000-000000000001', '22222222-9600-0000-0000-000000000002', id, '22222222-9600-0000-0000-000000000002' from roles where tenant_id is null and name = 'AUDITOR';
  insert into check_results values ('grant yourself a role (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('grant yourself a role (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update tenant_memberships set status = 'suspended', status_changed_by = '22222222-9600-0000-0000-000000000002' where user_id = '22222222-9600-0000-0000-000000000002';
  insert into check_results values ('change your own status (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('change your own status (expect denied 42501)', 'denied: ' || sqlstate); end $$;
insert into tenant_memberships (tenant_id, user_id, status, invited_by) values ('bbbbbbbb-9600-0000-0000-000000000002', '22222222-9600-0000-0000-000000000002', 'invited', '33333333-9600-0000-0000-000000000003');
update tenant_memberships set status = 'active', status_changed_by = '22222222-9600-0000-0000-000000000002' where tenant_id = 'bbbbbbbb-9600-0000-0000-000000000002' and user_id = '22222222-9600-0000-0000-000000000002';
insert into check_results select 'accept your own invitation (expect active)', status from tenant_memberships where tenant_id = 'bbbbbbbb-9600-0000-0000-000000000002' and user_id = '22222222-9600-0000-0000-000000000002';

-- Directory.
insert into check_results select 'directory A (expect 2)', count(*)::text from tenant_user_directory('aaaaaaaa-9600-0000-0000-000000000001', null, null, null, 25, 0);
insert into check_results select 'directory B holds no A-only person (expect 0)', count(*)::text from tenant_user_directory('bbbbbbbb-9600-0000-0000-000000000002', null, null, null, 25, 0) where user_id = '11111111-9600-0000-0000-000000000001';
insert into check_results select 'search "100%" is literal (expect Yara 100% Fixture)', coalesce(max(display_name), 'none') from tenant_user_directory('aaaaaaaa-9600-0000-0000-000000000001', '100%', null, null, 25, 0);
insert into check_results select 'search "%" matches no name without a percent sign (expect 1)', count(*)::text from tenant_user_directory('aaaaaaaa-9600-0000-0000-000000000001', '%', null, null, 25, 0);
insert into check_results select 'role filter AUDITOR (expect 0)', count(*)::text from tenant_user_directory('aaaaaaaa-9600-0000-0000-000000000001', null, null, 'AUDITOR', 25, 0);
insert into check_results select 'summary A: total/admins (expect 2/2)', total || '/' || administrators from tenant_user_summary('aaaaaaaa-9600-0000-0000-000000000001');

-- Members and anonymous callers.
grant insert, select on check_results to authenticated, anon;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9600-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: memberships visible (expect 2, own tenant only)', count(*)::text from tenant_memberships where user_id in ('11111111-9600-0000-0000-000000000001', '22222222-9600-0000-0000-000000000002', '33333333-9600-0000-0000-000000000003');
do $$ begin
  perform * from tenant_user_directory('aaaaaaaa-9600-0000-0000-000000000001', null, null, null, 25, 0);
  insert into check_results values ('X: call the directory directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X: call the directory directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
do $$ begin
  perform revoke_user_sessions('22222222-9600-0000-0000-000000000002');
  insert into check_results values ('X: revoke sessions directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X: revoke sessions directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
with u as (update tenant_memberships set status = 'suspended' where user_id = '22222222-9600-0000-0000-000000000002' returning 1)
insert into check_results select 'X: change a membership directly (expect 0)', count(*)::text from u;
reset role;
set role anon;
do $$ begin
  perform * from user_sessions('22222222-9600-0000-0000-000000000002');
  insert into check_results values ('anon: list sessions (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('anon: list sessions (expect denied 42501)', 'denied: ' || sqlstate); end $$;
reset role;

-- Deleting the organization still cascades past the guard.
delete from tenants where id = 'aaaaaaaa-9600-0000-0000-000000000001';
insert into check_results select 'deleting organization A cascades (expect 0 memberships left)', count(*)::text from tenant_memberships where tenant_id = 'aaaaaaaa-9600-0000-0000-000000000001';
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9600-0000-0000-000000000001', 'bbbbbbbb-9600-0000-0000-000000000002');
-- delete from users where id in ('11111111-9600-0000-0000-000000000001', '22222222-9600-0000-0000-000000000002', '33333333-9600-0000-0000-000000000003');
-- delete from auth.users where id in ('11111111-9600-0000-0000-000000000001', '22222222-9600-0000-0000-000000000002', '33333333-9600-0000-0000-000000000003');
