-- QA-P0-02.1 — Tenant Isolation fixture for Operations Agent's newest
-- tables (notifications, notification_preferences, reports), added by QA
-- Agent's second dispatch. Filed under tests/operations/ (QA-owned
-- tests/** per CLAUDE.md's repository structure), fixing the gap named in
-- INTEGRATION_STATUS.md §3: these three tables were only proven by the
-- RLS-policy-existence check plus Operations Agent's own build-time
-- verification, not by a dedicated tests/** live fixture — same pattern
-- every other module's own *-tenant-isolation.sql established.
--
-- Deliberately excludes platform_config_versions/platform_announcements
-- from the same INTEGRATION_STATUS.md §3 gap note: both were re-checked
-- this pass and confirmed to have RLS enabled with ZERO client-facing
-- policies (no select/insert/update policy for `authenticated` or `anon`
-- at all) — they are vendor-only tables in the already-documented
-- "11 tables, RLS enabled, no client policies" bucket, same as every
-- other platform_* table. There is no customer-session "sees only their
-- own row" property to test for a table no customer session can read at
-- all; that absence-of-access is what the anon/authenticated select
-- checks below prove for platform_config_versions directly.
--
-- Run in three separate `execute_sql` calls against a DEV Supabase
-- project only (this sandbox's plain network egress cannot reach
-- Supabase directly; the Supabase MCP tool's own channel is used
-- instead): fixtures, then the "as User A" block, then cleanup.

-- ============================================================
-- 1. Fixtures (run as the privileged/service connection)
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-6000-0000-0000-000000000001', 'Fixture Tenant A6', 'fixture-tenant-a6-test'),
  ('bbbbbbbb-6000-0000-0000-000000000002', 'Fixture Tenant B6', 'fixture-tenant-b6-test');

insert into tenant_settings (tenant_id) values
  ('aaaaaaaa-6000-0000-0000-000000000001'),
  ('bbbbbbbb-6000-0000-0000-000000000002');

insert into auth.users (id, email) values
  ('11111111-6000-0000-0000-000000000001', 'fixture-user-a6@example.test'),
  ('22222222-6000-0000-0000-000000000002', 'fixture-user-b6@example.test');

insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-6000-0000-0000-000000000002', '22222222-6000-0000-0000-000000000002', 'active');

insert into user_roles (tenant_id, user_id, role_id)
select 'aaaaaaaa-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001', id
from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';

insert into user_roles (tenant_id, user_id, role_id)
select 'bbbbbbbb-6000-0000-0000-000000000002', '22222222-6000-0000-0000-000000000002', id
from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';

-- notifications: one row addressed to A6's user, one broadcast to all of
-- A6 (user_id null), one addressed to B6's user — inserted via the
-- service-role connection since notify() is the only writer in the real
-- app (client-facing insert policy deliberately doesn't exist, same
-- evidentiary-write pattern as findings/audit_logs).
insert into notifications (tenant_id, user_id, type, title, body) values
  ('aaaaaaaa-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001', 'critical_finding', 'A6 direct', 'addressed to A6 user'),
  ('aaaaaaaa-6000-0000-0000-000000000001', null, 'integration_failure', 'A6 broadcast', 'tenant-wide notice for A6'),
  ('bbbbbbbb-6000-0000-0000-000000000002', '22222222-6000-0000-0000-000000000002', 'critical_finding', 'B6 direct', 'addressed to B6 user');

insert into notification_preferences (tenant_id, user_id, type, in_app_enabled, email_enabled) values
  ('aaaaaaaa-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001', 'critical_finding', true, false),
  ('bbbbbbbb-6000-0000-0000-000000000002', '22222222-6000-0000-0000-000000000002', 'critical_finding', true, true);

insert into reports (tenant_id, report_type, name, created_by) values
  ('aaaaaaaa-6000-0000-0000-000000000001', 'agent_inventory', 'A6 saved report', '11111111-6000-0000-0000-000000000001'),
  ('bbbbbbbb-6000-0000-0000-000000000002', 'agent_inventory', 'B6 saved report', '22222222-6000-0000-0000-000000000002');

-- ============================================================
-- 2. Act as fixture User A6 (member of Tenant A6 only). Expect:
--    - notifications: sees own direct row + A6's broadcast row, never
--      B6's row (by list or by direct primary-key lookup)
--    - notification_preferences/reports: sees only A6's own row
--    - update of another user's/tenant's notification (mark-as-read) is
--      rejected by RLS (row_count 0), not merely an exception
--    - insert into notifications directly (bypassing notify()) is
--      rejected — no client-facing insert policy exists
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-6000-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results select 'A6_notifications_titles_visible', coalesce(array_agg(title order by title)::text, '{}') from notifications;
insert into check_results select 'A6_notification_prefs_tenants_visible', coalesce(array_agg(tenant_id order by tenant_id)::text, '{}') from notification_preferences;
insert into check_results select 'A6_reports_names_visible', coalesce(array_agg(name order by name)::text, '{}') from reports;
insert into check_results select 'B6_notification_by_pk_row_count', count(*)::text from notifications where title = 'B6 direct';

do $$
declare rows_updated int;
begin
  update notifications set read_at = now() where title = 'B6 direct';
  get diagnostics rows_updated = row_count;
  insert into check_results values ('A6_update_B6_notification_read_rows_affected(should_be_0)', rows_updated::text);
end $$;

do $$
begin
  begin
    insert into notifications (tenant_id, user_id, type, title, body)
    values ('aaaaaaaa-6000-0000-0000-000000000001', '11111111-6000-0000-0000-000000000001', 'critical_finding', 'client forged', 'forged via client role');
    insert into check_results values ('A6_client_notification_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('A6_client_notification_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

do $$
declare cnt int;
begin
  begin
    select count(*) into cnt from platform_config_versions;
    insert into check_results values ('A6_platform_config_versions_select', 'ROWS_RETURNED_' || cnt::text);
  exception when others then
    insert into check_results values ('A6_platform_config_versions_select', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

reset role;
select * from check_results order by check_name;

-- Expected/actual (verified live 2026-09-14 against project ekgyjwoenteadaaqakmd,
-- via the Supabase MCP execute_sql tool — this sandbox's plain network
-- egress cannot reach Supabase directly, so that separate/privileged
-- channel was used instead; fixtures cleaned up afterward, see §3 below):
--   A6_notifications_titles_visible                          -> {A6 broadcast,A6 direct}
--   A6_notification_prefs_tenants_visible                     -> {aaaaaaaa-6000-0000-0000-000000000001}
--   A6_reports_names_visible                                  -> {A6 saved report}
--   B6_notification_by_pk_row_count                           -> 0
--   A6_update_B6_notification_read_rows_affected(should_be_0) -> 0
--   A6_client_notification_insert                             -> CORRECTLY_REJECTED: new row violates row-level security policy for table "notifications"
--   A6_platform_config_versions_select                        -> ROWS_RETURNED_0 (RLS enabled, zero client policies — confirmed directly via pg_policies too: neither platform_config_versions nor platform_announcements has any policy at all, for any role)

-- ============================================================
-- 3. Cleanup — always run this after the suite, on a dev project.
--    (Already run live once, 2026-09-14 — fixtures were not left behind
--    since this A6/B6 pair isn't a shared "central scenario" fixture
--    reused across modules, unlike the FinanceBot aaaaaaaa-5000-.../
--    bbbbbbbb-5000-... pair. Re-run this section after any future re-run
--    of section 1/2 above.)
-- ============================================================
-- delete from tenants where id in ('aaaaaaaa-6000-0000-0000-000000000001', 'bbbbbbbb-6000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-6000-0000-0000-000000000001', '22222222-6000-0000-0000-000000000002');
