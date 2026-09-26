-- Foundation Agent — FOUNDATION-P0-26 live verification of migration 0099
-- (groups). Run via the Supabase MCP execute_sql tool; cleanup in a second
-- call (the commented deletes at the end).
--
-- Proves: a group member must belong to the group's tenant, and a group's
-- role must be a system role or that tenant's own; nobody is recorded as
-- adding themselves to a group, and nobody who is in a group gives it a
-- role — not even through the service role; a member of tenant A sees A's
-- groups, members and group roles and none of B's, and cannot create a
-- group, join one or give one a role directly; the user directory filters
-- by group.
--
-- (Result recorded in docs/design/foundation-agent-backlog-audit.md.)

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9900-0000-0000-000000000001', 'Fixture Tenant A99', 'fixture-a99'),
  ('bbbbbbbb-9900-0000-0000-000000000002', 'Fixture Tenant B99', 'fixture-b99');
insert into auth.users (id, email) values ('11111111-9900-0000-0000-000000000001', 'fixture-x99@example.test'), ('22222222-9900-0000-0000-000000000002', 'fixture-y99@example.test'), ('33333333-9900-0000-0000-000000000003', 'fixture-z99@example.test');
insert into users (id, email) values ('11111111-9900-0000-0000-000000000001', 'fixture-x99@example.test'), ('22222222-9900-0000-0000-000000000002', 'fixture-y99@example.test'), ('33333333-9900-0000-0000-000000000003', 'fixture-z99@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-9900-0000-0000-000000000001', '11111111-9900-0000-0000-000000000001', 'active'),
  ('aaaaaaaa-9900-0000-0000-000000000001', '33333333-9900-0000-0000-000000000003', 'active'),
  ('bbbbbbbb-9900-0000-0000-000000000002', '22222222-9900-0000-0000-000000000002', 'active');
insert into roles (id, tenant_id, name, display_name, description, is_system) values
  ('dddddddd-9900-0000-0000-000000000002', 'bbbbbbbb-9900-0000-0000-000000000002', 'Fixture B Role', 'Fixture B Role', 'B', false);
insert into groups (id, tenant_id, name) values
  ('cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', 'Fixture Group A'),
  ('cccccccc-9900-0000-0000-00000000000b', 'bbbbbbbb-9900-0000-0000-000000000002', 'Fixture Group B');
insert into group_members (group_id, tenant_id, user_id, added_by) values
  ('cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', '11111111-9900-0000-0000-000000000001', '33333333-9900-0000-0000-000000000003');
insert into group_roles (group_id, tenant_id, role_id, granted_by)
  select 'cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', id, '33333333-9900-0000-0000-000000000003' from roles where tenant_id is null and name = 'READ_ONLY';

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into group_members (group_id, tenant_id, user_id) values ('cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', '22222222-9900-0000-0000-000000000002');
  insert into check_results values ('B''s member put in A''s group (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('B''s member put in A''s group (expect denied 23503)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into group_members (group_id, tenant_id, user_id) values ('cccccccc-9900-0000-0000-00000000000a', 'bbbbbbbb-9900-0000-0000-000000000002', '22222222-9900-0000-0000-000000000002');
  insert into check_results values ('A''s group used under tenant B (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('A''s group used under tenant B (expect denied 23503)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into group_members (group_id, tenant_id, user_id, added_by) values ('cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', '33333333-9900-0000-0000-000000000003', '33333333-9900-0000-0000-000000000003');
  insert into check_results values ('someone adds themselves (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('someone adds themselves (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into group_roles (group_id, tenant_id, role_id) values ('cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', 'dddddddd-9900-0000-0000-000000000002');
  insert into check_results values ('B''s custom role given to A''s group (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('B''s custom role given to A''s group (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into group_roles (group_id, tenant_id, role_id, granted_by)
    select 'cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', id, '11111111-9900-0000-0000-000000000001' from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
  insert into check_results values ('a member gives their own group a role (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('a member gives their own group a role (expect denied 42501)', 'denied: ' || sqlstate); end $$;
insert into check_results select 'directory filtered by group A (expect 1)', count(*)::text
  from tenant_user_directory('aaaaaaaa-9900-0000-0000-000000000001', null, null, null, 25, 0, 'cccccccc-9900-0000-0000-00000000000a');
insert into check_results select 'directory unfiltered (expect 2)', count(*)::text
  from tenant_user_directory('aaaaaaaa-9900-0000-0000-000000000001', null, null, null, 25, 0);

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9900-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X sees A''s groups (expect 1)', count(*)::text from groups where tenant_id = 'aaaaaaaa-9900-0000-0000-000000000001';
insert into check_results select 'X sees B''s groups (expect 0)', count(*)::text from groups where tenant_id = 'bbbbbbbb-9900-0000-0000-000000000002';
insert into check_results select 'X sees A''s group members and roles (expect 2)', ((select count(*) from group_members where tenant_id = 'aaaaaaaa-9900-0000-0000-000000000001') + (select count(*) from group_roles where tenant_id = 'aaaaaaaa-9900-0000-0000-000000000001'))::text;
insert into check_results select 'X sees B''s group members and roles (expect 0)', ((select count(*) from group_members where tenant_id = 'bbbbbbbb-9900-0000-0000-000000000002') + (select count(*) from group_roles where tenant_id = 'bbbbbbbb-9900-0000-0000-000000000002'))::text;
do $$ begin
  insert into groups (tenant_id, name) values ('aaaaaaaa-9900-0000-0000-000000000001', 'Member Made');
  insert into check_results values ('X creates a group directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X creates a group directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into group_members (group_id, tenant_id, user_id) values ('cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', '33333333-9900-0000-0000-000000000003');
  insert into check_results values ('X adds a member directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X adds a member directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into group_roles (group_id, tenant_id, role_id) select 'cccccccc-9900-0000-0000-00000000000a', 'aaaaaaaa-9900-0000-0000-000000000001', id from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
  insert into check_results values ('X gives a group a role directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X gives a group a role directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
with d as (delete from group_members where tenant_id = 'aaaaaaaa-9900-0000-0000-000000000001' returning 1)
insert into check_results select 'X removes members directly (expect 0)', count(*)::text from d;
do $$ begin
  perform * from tenant_user_directory('aaaaaaaa-9900-0000-0000-000000000001', null, null, null, 25, 0, null);
  insert into check_results values ('X calls the directory function (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X calls the directory function (expect denied 42501)', 'denied: ' || sqlstate); end $$;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9900-0000-0000-000000000001', 'bbbbbbbb-9900-0000-0000-000000000002');
-- delete from users where id in ('11111111-9900-0000-0000-000000000001', '22222222-9900-0000-0000-000000000002', '33333333-9900-0000-0000-000000000003');
-- delete from auth.users where id in ('11111111-9900-0000-0000-000000000001', '22222222-9900-0000-0000-000000000002', '33333333-9900-0000-0000-000000000003');
