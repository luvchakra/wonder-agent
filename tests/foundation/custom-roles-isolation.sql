-- Foundation Agent — FOUNDATION-P0-25 live verification of migration 0098
-- (system and custom roles). Run via the Supabase MCP execute_sql tool;
-- cleanup in a second call (the commented deletes at the end).
--
-- Proves: the specification's system roles exist with display names;
-- system role definitions and their permissions cannot be changed, not
-- even by the service role (only a migration that says so); a custom role
-- never takes a system role's name, and names are unique per tenant; a
-- custom role is never assigned in another tenant; a member of tenant A
-- sees A's custom roles and not B's, and cannot create, change or grant
-- any role directly.
--
-- Run 2026-09-26 against the dev project, all 14 as expected: 4 new system
-- roles; "Tenant Administrator"; the service role could not edit a system
-- role, grant one a permission, or add one (42501 each); a system-role name
-- and a duplicate name were refused (23505); B's role could not be assigned
-- in A (23514); A's custom role took a permission; member X saw A's role
-- (1) and not B's (0), and could not create (42501), change (0 rows) or
-- self-grant (42501) a role. Fixtures deleted afterwards (0 left; custom
-- roles cascaded with their tenants).

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9800-0000-0000-000000000001', 'Fixture Tenant A98', 'fixture-a98'),
  ('bbbbbbbb-9800-0000-0000-000000000002', 'Fixture Tenant B98', 'fixture-b98');
insert into auth.users (id, email) values ('11111111-9800-0000-0000-000000000001', 'fixture-x98@example.test'), ('22222222-9800-0000-0000-000000000002', 'fixture-y98@example.test');
insert into users (id, email) values ('11111111-9800-0000-0000-000000000001', 'fixture-x98@example.test'), ('22222222-9800-0000-0000-000000000002', 'fixture-y98@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-9800-0000-0000-000000000001', '11111111-9800-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-9800-0000-0000-000000000002', '22222222-9800-0000-0000-000000000002', 'active');
insert into roles (id, tenant_id, name, display_name, description, is_system) values
  ('cccccccc-9800-0000-0000-000000000001', 'aaaaaaaa-9800-0000-0000-000000000001', 'Fixture Reviewer', 'Fixture Reviewer', 'A', false),
  ('dddddddd-9800-0000-0000-000000000002', 'bbbbbbbb-9800-0000-0000-000000000002', 'Fixture Reviewer', 'Fixture Reviewer', 'B', false);

create temporary table check_results (check_name text, result text);
insert into check_results select 'new system roles (expect 4)', count(*)::text from roles where tenant_id is null
  and name in ('AGENT_ADMIN', 'RUNTIME_SECURITY_ADMIN', 'GOVERNANCE_ADMIN', 'SECURITY_ANALYST') and display_name is not null;
insert into check_results select 'Tenant Administrator display name (expect Tenant Administrator)', display_name from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
do $$ begin
  update roles set description = 'tampered' where tenant_id is null and name = 'AUDITOR';
  insert into check_results values ('service role edits a system role (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('service role edits a system role (expect denied 42501)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.tenant_id is null and r.name = 'READ_ONLY' and p.key = 'runtime.emergency';
  insert into check_results values ('service role grants a system role a permission (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('service role grants a system role a permission (expect denied 42501)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into roles (tenant_id, name, display_name, is_system) values (null, 'FIXTURE_SYSTEM', 'x', true);
  insert into check_results values ('service role adds a system role (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('service role adds a system role (expect denied 42501)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into roles (tenant_id, name, display_name, is_system) values ('aaaaaaaa-9800-0000-0000-000000000001', 'security administrator', 'x', false);
  insert into check_results values ('custom role named like a system role (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('custom role named like a system role (expect denied 23505)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into roles (tenant_id, name, display_name, is_system) values ('aaaaaaaa-9800-0000-0000-000000000001', 'FIXTURE reviewer', 'x', false);
  insert into check_results values ('duplicate custom name in a tenant (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('duplicate custom name in a tenant (expect denied 23505)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into user_roles (tenant_id, user_id, role_id) values ('aaaaaaaa-9800-0000-0000-000000000001', '11111111-9800-0000-0000-000000000001', 'dddddddd-9800-0000-0000-000000000002');
  insert into check_results values ('assign B''s custom role in A (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('assign B''s custom role in A (expect denied 23514)', 'denied: ' || sqlstate); end $$;
insert into role_permissions (role_id, permission_id) select 'cccccccc-9800-0000-0000-000000000001', id from permissions where key = 'agent.read';
insert into check_results select 'custom role takes a permission (expect 1)', count(*)::text from role_permissions where role_id = 'cccccccc-9800-0000-0000-000000000001';

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9800-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X sees A''s custom role (expect 1)', count(*)::text from roles where id = 'cccccccc-9800-0000-0000-000000000001';
insert into check_results select 'X sees B''s custom role (expect 0)', count(*)::text from roles where id = 'dddddddd-9800-0000-0000-000000000002';
do $$ begin
  insert into roles (tenant_id, name, display_name, is_system) values ('aaaaaaaa-9800-0000-0000-000000000001', 'Member Made', 'x', false);
  insert into check_results values ('X creates a role directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X creates a role directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
with u as (update roles set description = 'x' where id = 'cccccccc-9800-0000-0000-000000000001' returning 1)
insert into check_results select 'X changes A''s custom role directly (expect 0)', count(*)::text from u;
do $$ begin
  insert into user_roles (tenant_id, user_id, role_id) values ('aaaaaaaa-9800-0000-0000-000000000001', '11111111-9800-0000-0000-000000000001', 'cccccccc-9800-0000-0000-000000000001');
  insert into check_results values ('X grants themselves a role directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X grants themselves a role directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9800-0000-0000-000000000001', 'bbbbbbbb-9800-0000-0000-000000000002');
-- delete from users where id in ('11111111-9800-0000-0000-000000000001', '22222222-9800-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-9800-0000-0000-000000000001', '22222222-9800-0000-0000-000000000002');
