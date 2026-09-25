-- Foundation Agent — FOUNDATION-P0-17 / P0-18 live verification.
--
-- Same methodology as tests/foundation/tenant-isolation.sql: run via the
-- Supabase MCP execute_sql tool in three calls: (1) fixtures, (2) checks
-- as a signed-in customer user, (3) cleanup. What it proves:
--
-- * agent_api_keys is locked down. A signed-in member of tenant A cannot
--   SELECT, INSERT, UPDATE or DELETE a key row, not even one of tenant A's
--   own. Every access goes through lib/security/agentApiKeys.ts's
--   service-role functions behind requirePermission(); the browser never
--   sees a hash.
-- * The seven new permission keys exist and are granted by least
--   privilege, e.g. runtime.emergency is not given to READ_ONLY.

-- ============================================================
-- 1. Fixtures
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-6100-0000-0000-000000000001', 'Fixture Tenant A61', 'fixture-tenant-a61-test'),
  ('bbbbbbbb-6100-0000-0000-000000000002', 'Fixture Tenant B61', 'fixture-tenant-b61-test');
insert into auth.users (id, email) values
  ('11111111-6100-0000-0000-000000000001', 'fixture-user-a61@example.test');
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-6100-0000-0000-000000000001', '11111111-6100-0000-0000-000000000001', 'active');
insert into agents (id, tenant_id, agent_name, agent_type) values
  ('a6100000-0000-0000-0000-00000000000a', 'aaaaaaaa-6100-0000-0000-000000000001', 'KeyBotA', 'automation'),
  ('b6100000-0000-0000-0000-00000000000b', 'bbbbbbbb-6100-0000-0000-000000000002', 'KeyBotB', 'automation');
insert into agent_api_keys (id, tenant_id, agent_id, name, key_prefix, key_hash) values
  ('ca610000-0000-0000-0000-00000000000a', 'aaaaaaaa-6100-0000-0000-000000000001', 'a6100000-0000-0000-0000-00000000000a', 'a-key', 'wa_ak_aaaaaa', repeat('a', 64)),
  ('cb610000-0000-0000-0000-00000000000b', 'bbbbbbbb-6100-0000-0000-000000000002', 'b6100000-0000-0000-0000-00000000000b', 'b-key', 'wa_ak_bbbbbb', repeat('b', 64));

-- ============================================================
-- 2. Checks, as fixture user A61 (member of tenant A61 only)
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-6100-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results
  select 'select own-tenant key rows (expect 0)', count(*)::text from agent_api_keys
  where tenant_id = 'aaaaaaaa-6100-0000-0000-000000000001';
insert into check_results
  select 'select other-tenant key rows (expect 0)', count(*)::text from agent_api_keys
  where tenant_id = 'bbbbbbbb-6100-0000-0000-000000000002';

with u as (update agent_api_keys set revoked_at = now() where true returning 1)
insert into check_results select 'update any key row (expect 0)', count(*)::text from u;
with d as (delete from agent_api_keys where true returning 1)
insert into check_results select 'delete any key row (expect 0)', count(*)::text from d;

do $$
begin
  insert into agent_api_keys (tenant_id, agent_id, name, key_prefix, key_hash) values
    ('aaaaaaaa-6100-0000-0000-000000000001', 'a6100000-0000-0000-0000-00000000000a', 'forged', 'wa_ak_forged', repeat('c', 64));
  insert into check_results values ('insert a key row (expect denied)', 'ALLOWED');
exception when others then
  insert into check_results values ('insert a key row (expect denied)', 'denied: ' || sqlstate);
end $$;

reset role;

insert into check_results
  select 'rows still intact after attempts (expect 2)', count(*)::text from agent_api_keys
  where id in ('ca610000-0000-0000-0000-00000000000a', 'cb610000-0000-0000-0000-00000000000b') and revoked_at is null;

insert into check_results
  select 'new permission keys present (expect 7)', count(*)::text from permissions
  where key in ('agent.suspend', 'discovery.read', 'discovery.manage', 'access.simulate', 'policy.publish', 'runtime.enforce', 'runtime.emergency');

insert into check_results
  select 'READ_ONLY holds only discovery.read of the new keys (expect discovery.read)', coalesce(string_agg(p.key, ',' order by p.key), '(none)')
  from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id
  where r.tenant_id is null and r.name = 'READ_ONLY'
    and p.key in ('agent.suspend', 'discovery.read', 'discovery.manage', 'access.simulate', 'policy.publish', 'runtime.enforce', 'runtime.emergency');

insert into check_results
  select 'runtime.emergency holders (expect SECURITY_ADMIN,TENANT_SUPER_ADMIN)', string_agg(r.name, ',' order by r.name)
  from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id
  where r.tenant_id is null and p.key = 'runtime.emergency';

select * from check_results;

-- ============================================================
-- 3. Cleanup
-- ============================================================
-- delete from agent_api_keys where id in ('ca610000-0000-0000-0000-00000000000a', 'cb610000-0000-0000-0000-00000000000b');
-- delete from agents where id in ('a6100000-0000-0000-0000-00000000000a', 'b6100000-0000-0000-0000-00000000000b');
-- delete from tenant_memberships where user_id = '11111111-6100-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-6100-0000-0000-000000000001';
-- delete from tenants where id in ('aaaaaaaa-6100-0000-0000-000000000001', 'bbbbbbbb-6100-0000-0000-000000000002');
