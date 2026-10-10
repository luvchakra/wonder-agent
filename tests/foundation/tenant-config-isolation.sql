-- Foundation Agent — live verification of migration 0116 (Global
-- Configuration: tenant_config_versions, save_tenant_config(),
-- my_session_policy()).
--
-- Proves: a save needs the latest version (a stale save is refused); the
-- history is append-only; a member without tenant.settings or
-- tenant.security.manage reads none of it, and no member writes it or
-- calls save_tenant_config(); another organization's history is never
-- visible; my_session_policy() gives the strictest active organization's
-- limits, clamped to the global 30 minutes / 12 hours, and defaults when
-- nothing is set.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool (no delete).

do $t$
declare
  v integer;
  pol record;
begin
insert into tenants (id, name, slug) values
  ('aaaaaaaa-1160-0000-0000-000000000001', 'Fixture Tenant A116', 'fixture-tenant-a116-test'),
  ('bbbbbbbb-1160-0000-0000-000000000002', 'Fixture Tenant B116', 'fixture-tenant-b116-test');
insert into tenant_settings (tenant_id) values ('aaaaaaaa-1160-0000-0000-000000000001'), ('bbbbbbbb-1160-0000-0000-000000000002') on conflict do nothing;
insert into auth.users (id, email) values
  ('11111111-1160-0000-0000-000000000001', 'fixture-admin116@example.test'),
  ('11111111-1160-0000-0000-000000000002', 'fixture-reader116@example.test');
insert into users (id, email) values
  ('11111111-1160-0000-0000-000000000001', 'fixture-admin116@example.test'),
  ('11111111-1160-0000-0000-000000000002', 'fixture-reader116@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-1160-0000-0000-000000000001', '11111111-1160-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-1160-0000-0000-000000000002', '11111111-1160-0000-0000-000000000001', 'active'),
  ('aaaaaaaa-1160-0000-0000-000000000001', '11111111-1160-0000-0000-000000000002', 'active');
insert into user_roles (tenant_id, user_id, role_id)
  select 'aaaaaaaa-1160-0000-0000-000000000001', '11111111-1160-0000-0000-000000000001', id from roles where name = 'TENANT_SUPER_ADMIN' and tenant_id is null;
insert into user_roles (tenant_id, user_id, role_id)
  select 'aaaaaaaa-1160-0000-0000-000000000001', '11111111-1160-0000-0000-000000000002', id from roles where name = 'READ_ONLY' and tenant_id is null;

create temporary table check_results (check_name text, result text);

v := save_tenant_config('aaaaaaaa-1160-0000-0000-000000000001', '11111111-1160-0000-0000-000000000001', 0,
  '{"session.idleMinutes": 10, "session.maxHours": 8}'::jsonb, '[{"key":"session.idleMinutes","from":30,"to":10}]'::jsonb, null);
insert into check_results values ('first save is version 1 (expect 1)', v::text);
perform save_tenant_config('bbbbbbbb-1160-0000-0000-000000000002', '11111111-1160-0000-0000-000000000001', 0,
  '{"session.idleMinutes": 20, "session.maxHours": 4}'::jsonb, '[]'::jsonb, null);
begin
  perform save_tenant_config('aaaaaaaa-1160-0000-0000-000000000001', '11111111-1160-0000-0000-000000000001', 0, '{}'::jsonb, '[]'::jsonb, null);
  insert into check_results values ('stale save (expect denied 40001)', 'ALLOWED');
exception when others then insert into check_results values ('stale save (expect denied 40001)', 'denied: ' || sqlstate); end;
insert into check_results select 'current values stored (expect 10)', settings -> 'config' ->> 'session.idleMinutes' from tenant_settings where tenant_id = 'aaaaaaaa-1160-0000-0000-000000000001';
begin
  update tenant_config_versions set config = '{}'::jsonb where tenant_id = 'aaaaaaaa-1160-0000-0000-000000000001';
  insert into check_results values ('rewrite history (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('rewrite history (expect denied)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

-- The administrator of A (also a member of B, with no role there).
perform set_config('request.jwt.claims', '{"sub":"11111111-1160-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'admin reads A history (expect 1)', count(*)::text from tenant_config_versions where tenant_id = 'aaaaaaaa-1160-0000-0000-000000000001';
insert into check_results select 'admin without a role in B reads B history (expect 0)', count(*)::text from tenant_config_versions where tenant_id = 'bbbbbbbb-1160-0000-0000-000000000002';
select * into pol from my_session_policy();
insert into check_results values ('strictest of A (10 min, 8 h) and B (20 min, 4 h) (expect 10/4)', pol.idle_minutes || '/' || pol.max_hours);
begin
  perform save_tenant_config('aaaaaaaa-1160-0000-0000-000000000001', '11111111-1160-0000-0000-000000000001', 1, '{}'::jsonb, '[]'::jsonb, null);
  insert into check_results values ('member calls save_tenant_config (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member calls save_tenant_config (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into tenant_config_versions (tenant_id, version, config) values ('aaaaaaaa-1160-0000-0000-000000000001', 9, '{}'::jsonb);
  insert into check_results values ('member writes history (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member writes history (expect denied)', 'denied: ' || sqlstate); end;

-- A read-only member of A.
perform set_config('request.jwt.claims', '{"sub":"11111111-1160-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'read-only member reads A history (expect 0)', count(*)::text from tenant_config_versions;
select * into pol from my_session_policy();
insert into check_results values ('read-only member of A gets A limits (expect 10/8)', pol.idle_minutes || '/' || pol.max_hours);

-- Out-of-range stored values are clamped; nothing stored means defaults.
perform set_config('role', 'postgres', true);
update tenant_settings set settings = jsonb_build_object('config', '{"session.idleMinutes": 999, "session.maxHours": 0}'::jsonb) where tenant_id = 'aaaaaaaa-1160-0000-0000-000000000001';
update tenant_settings set settings = '{}'::jsonb where tenant_id = 'bbbbbbbb-1160-0000-0000-000000000002';
perform set_config('role', 'authenticated', true);
perform set_config('request.jwt.claims', '{"sub":"11111111-1160-0000-0000-000000000001","role":"authenticated"}', true);
select * into pol from my_session_policy();
insert into check_results values ('out-of-range values clamped, unset is default (expect 30/1)', pol.idle_minutes || '/' || pol.max_hours);
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
