-- FOUNDATION-P0-07 — Tenant Isolation Test Suite (critical acceptance test)
--
-- This is a SQL-level reproduction of the isolation proof required by
-- docs/plan/01-FOUNDATION-AGENT-BACKLOG.md FOUNDATION-P0-07. It exercises the
-- exact same RLS policies a real Supabase client session would, by
-- simulating an authenticated JWT via `set_config('request.jwt.claims', ...)`
-- and `set role authenticated`/`anon` — the same mechanism `auth.uid()` reads
-- from in production. Run it against a DEV Supabase project only, via the
-- Supabase MCP `execute_sql` tool (never against production) — this
-- sandbox's plain network egress cannot reach Supabase directly, so a
-- JS-client-based integration test isn't runnable from here; this SQL script
-- is the practical equivalent and was executed successfully against the
-- project's dev database on first implementation (see
-- docs/design/foundation-agent-backlog-audit.md for the run log).
--
-- Run in three separate `execute_sql` calls: fixtures, then the "as User A"
-- block, then the "as anon" block, then cleanup — each below as one call.

-- ============================================================
-- 1. Fixtures (run as the privileged/service connection)
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Fixture Tenant A', 'fixture-tenant-a-test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Fixture Tenant B', 'fixture-tenant-b-test');

insert into tenant_settings (tenant_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002');

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'fixture-user-a@example.test'),
  ('22222222-0000-0000-0000-000000000002', 'fixture-user-b@example.test');

insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'active');

insert into user_roles (tenant_id, user_id, role_id)
select 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', id
from roles where tenant_id is null and name = 'READ_ONLY';

insert into user_roles (tenant_id, user_id, role_id)
select 'bbbbbbbb-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', id
from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';

insert into audit_logs (tenant_id, actor_type, action, object_type, object_id, outcome) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'system', 'fixture.seed', 'fixture', 'a', 'success'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'system', 'fixture.seed', 'fixture', 'b', 'success');

-- ============================================================
-- 2. Act as fixture User A (member of Tenant A only). Expect:
--    - every tenant-scoped select returns only Tenant A's rows
--    - Tenant B is invisible even by direct primary-key lookup
--    - update/insert against Tenant B or into audit_logs/platform_admins
--      is rejected by RLS, not merely filtered
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results select 'tenants_visible_to_A', coalesce(array_agg(slug order by slug)::text, '{}') from tenants;
insert into check_results select 'tenant_settings_visible_to_A', coalesce(array_agg(tenant_id order by tenant_id)::text, '{}') from tenant_settings;
insert into check_results select 'memberships_visible_to_A', coalesce(array_agg(tenant_id order by tenant_id)::text, '{}') from tenant_memberships;
insert into check_results select 'user_roles_visible_to_A', coalesce(array_agg(tenant_id order by tenant_id)::text, '{}') from user_roles;
insert into check_results select 'audit_logs_visible_to_A', coalesce(array_agg(object_id order by object_id)::text, '{}') from audit_logs;
insert into check_results select 'users_visible_to_A', coalesce(array_agg(email order by email)::text, '{}') from users;
insert into check_results select 'tenant_B_by_pk_row_count', count(*)::text from tenants where id = 'bbbbbbbb-0000-0000-0000-000000000002';

do $$
declare rows_updated int;
begin
  update tenants set name = 'HACKED' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  get diagnostics rows_updated = row_count;
  insert into check_results values ('update_tenant_B_attempt_rows_affected', rows_updated::text);
end $$;

do $$
begin
  begin
    insert into tenant_memberships (tenant_id, user_id, status)
    values ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'active');
    insert into check_results values ('cross_tenant_membership_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('cross_tenant_membership_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into audit_logs (tenant_id, actor_type, action, object_type, object_id, outcome)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'user', 'tamper.attempt', 'fixture', 'x', 'success');
    insert into check_results values ('client_audit_log_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_audit_log_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into platform_admins (user_id) values ('11111111-0000-0000-0000-000000000001');
    insert into check_results values ('client_platform_admins_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_platform_admins_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

do $$
declare cnt int;
begin
  begin
    select count(*) into cnt from platform_admins;
    insert into check_results values ('client_platform_admins_select', 'ROWS_RETURNED_' || cnt::text);
  exception when others then
    insert into check_results values ('client_platform_admins_select', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

reset role;
select * from check_results order by check_name;

-- Expected results (observed on first run — see audit log):
--   tenants_visible_to_A              -> {fixture-tenant-a-test}
--   tenant_settings_visible_to_A      -> {aaaaaaaa-0000-0000-0000-000000000001}
--   memberships_visible_to_A          -> {aaaaaaaa-0000-0000-0000-000000000001}
--   user_roles_visible_to_A           -> {aaaaaaaa-0000-0000-0000-000000000001}
--   audit_logs_visible_to_A           -> {a}
--   users_visible_to_A                -> {fixture-user-a@example.test}
--   tenant_B_by_pk_row_count          -> 0
--   update_tenant_B_attempt_rows_affected -> 0
--   cross_tenant_membership_insert    -> CORRECTLY_REJECTED (RLS policy violation)
--   client_audit_log_insert           -> CORRECTLY_REJECTED (RLS policy violation)
--   client_platform_admins_insert     -> CORRECTLY_REJECTED (RLS policy violation)
--   client_platform_admins_select     -> ROWS_RETURNED_0

-- ============================================================
-- 3. Unauthenticated (anon) — every tenant-scoped table returns zero rows;
--    catalog tables (permissions, system roles) remain readable.
-- ============================================================
-- create temporary table check_results (check_name text, result text);
-- grant insert, select on check_results to authenticated, anon;
--
-- set role anon;
-- select set_config('request.jwt.claims', '{"role":"anon"}', true);
--
-- insert into check_results select 'anon_tenants', coalesce(array_agg(slug)::text, '{}') from tenants;
-- insert into check_results select 'anon_tenant_memberships', coalesce(array_agg(tenant_id)::text, '{}') from tenant_memberships;
-- insert into check_results select 'anon_users', coalesce(array_agg(email)::text, '{}') from users;
-- insert into check_results select 'anon_audit_logs', coalesce(array_agg(object_id)::text, '{}') from audit_logs;
-- insert into check_results select 'anon_roles_system_rows_only_check', coalesce(array_agg(distinct (tenant_id is null))::text, '{}') from roles;
-- insert into check_results select 'anon_permissions_catalog_readable', count(*)::text from permissions;
--
-- reset role;
-- select * from check_results order by check_name;

-- Expected: every anon_* tenant-scoped check returns {}, and
-- anon_permissions_catalog_readable returns the current permission count
-- (catalog data, not tenant-scoped, so it's fine for anon to read).

-- ============================================================
-- 5. Suspended-tenant enforcement (added 2026-09-14, migration
--    0039_foundation_fix_current_tenant_ids_status_check.sql).
--
--    Platform Agent's own build discovered and verified live that
--    current_tenant_ids() originally filtered only on
--    tenant_memberships.status, never tenants.status — so suspending a
--    tenant had zero actual enforcement effect: a suspended tenant's
--    active members retained full read/write access to every
--    tenant-scoped table system-wide. Every isolation test above only
--    ever checked cross-tenant access between two *active* tenants, never
--    a suspended tenant's own members, so this gap went uncaught until
--    Platform Agent's tenant-lifecycle story exercised it. Fixed by
--    joining to tenants and requiring t.status = 'active' too. This
--    section is the permanent regression test for that fix — run it
--    (fixtures already exist from section 1) after any future change to
--    current_tenant_ids() or the tenants/tenant_memberships schema.
-- ============================================================
-- update tenants set status = 'suspended' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
--
-- create temporary table check_results (check_name text, result text);
-- grant insert, select on check_results to authenticated, anon;
--
-- set role authenticated;
-- select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
--
-- insert into check_results select 'current_tenant_ids_includes_suspended_tenant', (exists(select 1 from current_tenant_ids() t where t = 'aaaaaaaa-0000-0000-0000-000000000001'))::text;
-- insert into check_results select 'suspended_tenant_row_visible', count(*)::text from tenants where id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- insert into check_results select 'suspended_tenant_memberships_visible', count(*)::text from tenant_memberships where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
--
-- reset role;
--
-- -- Always revert — a fixture must never be left suspended.
-- update tenants set status = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
--
-- select * from check_results order by check_name;
--
-- Expected: current_tenant_ids_includes_suspended_tenant -> false;
-- suspended_tenant_row_visible / suspended_tenant_memberships_visible -> 0.
-- Verified live on 2026-09-14 (against the aaaaaaaa-5000-... FinanceBot
-- fixture, since the original aaaaaaaa-0000-... fixture from section 1 had
-- already been cleaned up between sessions by the time this fix landed —
-- see docs/design/foundation-agent-backlog-audit.md for the exact run
-- log and results).

-- ============================================================
-- 6. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from tenants where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');

-- ============================================================
-- 7. sso_connections tenant isolation (FOUNDATION-P0-03.3, added
--    2026-09-14). Verified live against the aaaaaaaa-5000-.../
--    bbbbbbbb-5000-... FinanceBot fixtures (section 1's original
--    aaaaaaaa-0000-... fixture had already been cleaned up between
--    sessions by this point — see the 2026-09-14 audit log entries for
--    the exact run log). A fixture row
--    ('fixture-tenant-a5-test.example', tenant aaaaaaaa-5000-...) was left
--    in place for reuse by future runs of this section.
-- ============================================================
-- create temporary table check_results (check_name text, result text);
-- grant insert, select on check_results to authenticated;
--
-- do $$
-- begin
--   perform set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
--   set local role authenticated;
--   insert into check_results select 'A5_user_sees_own_connection', count(*)::text from sso_connections where domain = 'fixture-tenant-a5-test.example';
--   reset role;
-- end $$;
--
-- do $$
-- begin
--   perform set_config('request.jwt.claims', '{"sub":"22222222-5000-0000-0000-000000000002","role":"authenticated"}', true);
--   set local role authenticated;
--   insert into check_results select 'B5_user_sees_A5_connection(should_be_0)', count(*)::text from sso_connections where domain = 'fixture-tenant-a5-test.example';
--   reset role;
-- end $$;
--
-- do $$
-- begin
--   perform set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
--   set local role authenticated;
--   begin
--     insert into sso_connections (tenant_id, protocol, domain, idp_metadata) values ('aaaaaaaa-5000-0000-0000-000000000001','saml','forged.example','{}'::jsonb);
--     insert into check_results values ('A5_user_client_insert_rejected', 'UNEXPECTEDLY_SUCCEEDED');
--   exception when insufficient_privilege then
--     insert into check_results values ('A5_user_client_insert_rejected', 'REJECTED_AS_EXPECTED');
--   end;
--   reset role;
-- end $$;
--
-- do $$
-- declare
--   affected int;
-- begin
--   perform set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
--   set local role authenticated;
--   begin
--     update sso_connections set status = 'disabled' where domain = 'fixture-tenant-a5-test.example';
--     get diagnostics affected = row_count;
--     insert into check_results values ('A5_user_client_update_row_count(should_be_0)', affected::text);
--   exception when insufficient_privilege then
--     insert into check_results values ('A5_user_client_update_row_count(should_be_0)', 'REJECTED_WITH_EXCEPTION');
--   end;
--   reset role;
-- end $$;
--
-- select * from check_results;
--
-- Expected/actual (verified 2026-09-14): A5_user_sees_own_connection=1,
-- B5_user_sees_A5_connection=0, A5_user_client_insert_rejected=
-- REJECTED_AS_EXPECTED, A5_user_client_update_row_count=0 (no update
-- policy exists at all for authenticated — RLS silently filters rather
-- than throwing, same lesson Compliance Agent's audit log recorded: check
-- row_count, not just absence of an exception).
--
-- NOT verified live (documented limitation, not a fabrication): an actual
-- end-to-end SAML/OIDC redirect against a real IdP, and the JIT
-- membership-provisioning code path (lib/auth/sso.ts
-- provisionSsoMembership()) end-to-end via a real SSO sign-in. Both
-- require a real identity provider and a Supabase-project-level SSO
-- provider registration (an Enterprise/Pro-tier, dashboard/CLI setup step)
-- that does not exist on this environment's connected project — this
-- matches the backlog's own stop-and-report allowance for this story.
-- The deterministic role-mapping logic (resolveJitRole()) that IS
-- reachable without a real IdP is unit-tested in lib/auth/sso.test.ts.
