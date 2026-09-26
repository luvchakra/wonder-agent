-- Foundation Agent — FOUNDATION-P0-19 live verification of migration 0100
-- (scoped role assignments and explicit authorization policies). Run via
-- the Supabase MCP execute_sql tool; cleanup in a second call (the
-- commented deletes at the end).
--
-- Proves: existing assignments stayed organization-wide and unconditional;
-- a scope names only the tenant's own applications and agents and known
-- environments; a validity window runs forwards; the Tenant Administrator
-- role cannot be scoped, timed or conditioned; a policy never covers
-- tenant.security.manage and never exempts another tenant's role; a member
-- of tenant A reads A's policies and none of B's, and cannot write
-- policies or assignment terms directly.
--
-- (Result recorded in docs/design/foundation-agent-backlog-audit.md.)

create temporary table check_results (check_name text, result text);
insert into check_results select 'existing assignments not organization-wide (expect 0)', count(*)::text
  from user_roles where scope_type <> 'tenant' or starts_at is not null or expires_at is not null or requires_mfa;

insert into tenants (id, name, slug) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'Fixture Tenant A100', 'fixture-a100'),
  ('bbbbbbbb-1000-0000-0000-000000000002', 'Fixture Tenant B100', 'fixture-b100');
insert into auth.users (id, email) values ('11111111-1000-0000-0000-000000000001', 'fixture-x100@example.test'), ('22222222-1000-0000-0000-000000000002', 'fixture-y100@example.test');
insert into users (id, email) values ('11111111-1000-0000-0000-000000000001', 'fixture-x100@example.test'), ('22222222-1000-0000-0000-000000000002', 'fixture-y100@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-1000-0000-0000-000000000002', '22222222-1000-0000-0000-000000000002', 'active');
insert into applications (id, tenant_id, name) values
  ('cccccccc-1000-0000-0000-00000000000a', 'aaaaaaaa-1000-0000-0000-000000000001', 'Fixture App A'),
  ('cccccccc-1000-0000-0000-00000000000b', 'bbbbbbbb-1000-0000-0000-000000000002', 'Fixture App B');
insert into roles (id, tenant_id, name, display_name, description, is_system) values
  ('dddddddd-1000-0000-0000-000000000002', 'bbbbbbbb-1000-0000-0000-000000000002', 'Fixture B100 Role', 'Fixture B100 Role', 'B', false);
insert into authorization_policies (id, tenant_id, name, effect, permissions) values
  ('eeeeeeee-1000-0000-0000-00000000000a', 'aaaaaaaa-1000-0000-0000-000000000001', 'Fixture policy A', 'DENY', array['runtime.emergency']),
  ('eeeeeeee-1000-0000-0000-00000000000b', 'bbbbbbbb-1000-0000-0000-000000000002', 'Fixture policy B', 'DENY', array['runtime.emergency']);

-- Scoped to A's own application: allowed.
insert into user_roles (tenant_id, user_id, role_id, scope_type, scope_values, expires_at)
  select 'aaaaaaaa-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001', id, 'application', array['cccccccc-1000-0000-0000-00000000000a'], now() + interval '30 days'
  from roles where tenant_id is null and name = 'AGENT_ADMIN';
insert into check_results select 'scoped, expiring assignment to A''s application (expect 1)', count(*)::text
  from user_roles where user_id = '11111111-1000-0000-0000-000000000001' and scope_type = 'application';

do $$ begin
  update user_roles set scope_values = array['cccccccc-1000-0000-0000-00000000000b'] where user_id = '11111111-1000-0000-0000-000000000001' and scope_type = 'application';
  insert into check_results values ('scope to B''s application (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('scope to B''s application (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into user_roles (tenant_id, user_id, role_id, scope_type, scope_values)
    select 'aaaaaaaa-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001', id, 'environment', array['prod'] from roles where tenant_id is null and name = 'AUDITOR';
  insert into check_results values ('unknown environment (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('unknown environment (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into user_roles (tenant_id, user_id, role_id, starts_at, expires_at)
    select 'aaaaaaaa-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001', id, now() + interval '2 days', now() + interval '1 day' from roles where tenant_id is null and name = 'AUDITOR';
  insert into check_results values ('window ending before it starts (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('window ending before it starts (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into user_roles (tenant_id, user_id, role_id, expires_at)
    select 'aaaaaaaa-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001', id, now() + interval '1 day' from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
  insert into check_results values ('expiring Tenant Administrator (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('expiring Tenant Administrator (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into authorization_policies (tenant_id, name, effect, permissions) values ('aaaaaaaa-1000-0000-0000-000000000001', 'Lockout', 'DENY', array['tenant.security.manage']);
  insert into check_results values ('policy over tenant.security.manage (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('policy over tenant.security.manage (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into authorization_policies (tenant_id, name, effect, permissions, exempt_role_ids) values ('aaaaaaaa-1000-0000-0000-000000000001', 'Foreign exemption', 'DENY', array['agent.update'], array['dddddddd-1000-0000-0000-000000000002'::uuid]);
  insert into check_results values ('policy exempting B''s role in A (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('policy exempting B''s role in A (expect denied 23514)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into authorization_policies (tenant_id, name, effect, permissions, scope_type, scope_values) values ('aaaaaaaa-1000-0000-0000-000000000001', 'Foreign scope', 'DENY', array['agent.update'], 'application', array['cccccccc-1000-0000-0000-00000000000b']);
  insert into check_results values ('policy scoped to B''s application (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('policy scoped to B''s application (expect denied 23514)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1000-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X reads A''s policies (expect 1)', count(*)::text from authorization_policies where tenant_id = 'aaaaaaaa-1000-0000-0000-000000000001';
insert into check_results select 'X reads B''s policies (expect 0)', count(*)::text from authorization_policies where tenant_id = 'bbbbbbbb-1000-0000-0000-000000000002';
do $$ begin
  insert into authorization_policies (tenant_id, name, effect, permissions) values ('aaaaaaaa-1000-0000-0000-000000000001', 'Member made', 'DENY', array['agent.update']);
  insert into check_results values ('X writes a policy directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('X writes a policy directly (expect denied 42501)', 'denied: ' || sqlstate); end $$;
with u as (update authorization_policies set status = 'inactive' where tenant_id = 'aaaaaaaa-1000-0000-0000-000000000001' returning 1)
insert into check_results select 'X deactivates a policy directly (expect 0)', count(*)::text from u;
with u as (update user_roles set expires_at = null, scope_type = 'tenant', scope_values = '{}' where user_id = '11111111-1000-0000-0000-000000000001' returning 1)
insert into check_results select 'X widens their own assignment directly (expect 0)', count(*)::text from u;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-1000-0000-0000-000000000001', 'bbbbbbbb-1000-0000-0000-000000000002');
-- delete from users where id in ('11111111-1000-0000-0000-000000000001', '22222222-1000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-1000-0000-0000-000000000001', '22222222-1000-0000-0000-000000000002');
