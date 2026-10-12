-- Foundation Agent — FOUNDATION-P0-31: live verification of migrations
-- 0126 and 0127 (automation credentials).
--
-- Proves: only those holding automation.manage in the credential's own
-- organization can read a credential; nobody writes one directly (no client
-- write policy); the creator can never be the approver (four-eyes, in the
-- database); a credential can only belong to its own organization's
-- identity; the rate-limit counter is service-role only; an automation
-- membership creates no person identity and is left out of the users
-- directory; the Configuration Administrator template holds no
-- personal-data permission.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1260-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1260-0000-0000-000000000002';
  admin_a constant uuid := '11111111-1260-0000-0000-000000000001';
  member_a constant uuid := '11111111-1260-0000-0000-000000000002';
  admin_b constant uuid := '11111111-1260-0000-0000-000000000003';
  bot_a constant uuid := '11111111-1260-0000-0000-000000000004';
  app_a constant uuid := 'aaaaaaaa-1260-0000-0000-0000000000a1';
  app_b constant uuid := 'bbbbbbbb-1260-0000-0000-0000000000a1';
  cred_a constant uuid := 'aaaaaaaa-1260-0000-0000-0000000000c1';
  admin_role uuid := (select id from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN');
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A126', 'fixture-tenant-a126-test'),
  (tb, 'Fixture Tenant B126', 'fixture-tenant-b126-test');
insert into auth.users (id, email) values
  (admin_a, 'fixture-admin-a126@example.test'), (member_a, 'fixture-member-a126@example.test'),
  (admin_b, 'fixture-admin-b126@example.test'), (bot_a, 'automation-fixture126@automation.invalid');
insert into users (id, email) values
  (admin_a, 'fixture-admin-a126@example.test'), (member_a, 'fixture-member-a126@example.test'),
  (admin_b, 'fixture-admin-b126@example.test'), (bot_a, 'automation-fixture126@automation.invalid') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, admin_a, 'active'), (ta, member_a, 'active'), (tb, admin_b, 'active');
insert into tenant_memberships (tenant_id, user_id, status, account_type) values (ta, bot_a, 'active', 'automation');
insert into user_roles (tenant_id, user_id, role_id) values (ta, admin_a, admin_role), (tb, admin_b, admin_role);
insert into identities (id, tenant_id, identity_type, display_name) values (app_a, ta, 'APPLICATION', 'Fixture Pipeline A'), (app_b, tb, 'APPLICATION', 'Fixture Pipeline B');
insert into automation_credentials (id, tenant_id, identity_id, backing_user_id, backing_secret_enc, name, key_prefix, key_hash, expires_at, created_by)
  values (cred_a, ta, app_a, bot_a, 'enc', 'Fixture credential', 'wa_ac_abcdef', repeat('a', 64), now() + interval '90 days', admin_a);

create temporary table check_results (check_name text, result text);

begin
  update automation_credentials set status = 'active', approved_by = admin_a, approved_at = now() where id = cred_a;
  insert into check_results values ('creator approves their own credential (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('creator approves their own credential (expect denied 23514)', 'denied: ' || sqlstate); end;
begin
  update automation_credentials set status = 'active' where id = cred_a;
  insert into check_results values ('active without an approver (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('active without an approver (expect denied 23514)', 'denied: ' || sqlstate); end;
begin
  insert into automation_credentials (tenant_id, identity_id, backing_user_id, backing_secret_enc, name, key_prefix, key_hash, expires_at, created_by)
    values (ta, app_b, member_a, 'enc', 'Cross', 'wa_ac_zzzzzz', repeat('b', 64), now() + interval '1 day', admin_a);
  insert into check_results values ('credential for another organization''s identity (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('credential for another organization''s identity (expect denied 23503)', 'denied: ' || sqlstate); end;
insert into check_results select 'automation membership creates a person identity (expect 0)', count(*)::text from identities where user_id = bot_a;
insert into check_results select 'users directory lists the automation member (expect 0)', count(*)::text from tenant_user_directory(ta, null, null, null, 100, 0) where user_id = bot_a;
insert into check_results select 'users directory still lists people (expect 2)', count(*)::text from tenant_user_directory(ta, null, null, null, 100, 0);
insert into check_results
  select 'Configuration Administrator holds personal-data permissions (expect 0)', count(*)::text
    from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id
   where r.tenant_id is null and r.name = 'CONFIGURATION_ADMIN' and (p.key like 'user%' or p.key like 'privacy.%' or p.key like 'identity.%' or p.key = 'automation.manage');
insert into check_results
  select 'Configuration Administrator can read integrations (expect 1)', count(*)::text
    from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id
   where r.tenant_id is null and r.name = 'CONFIGURATION_ADMIN' and p.key = 'integration.read';

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1260-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'admin of A reads A''s credential (expect 1)', count(*)::text from automation_credentials where id = cred_a;
begin
  insert into automation_credentials (tenant_id, identity_id, backing_user_id, backing_secret_enc, name, key_prefix, key_hash, expires_at, created_by)
    values (ta, app_a, member_a, 'enc', 'Direct', 'wa_ac_yyyyyy', repeat('c', 64), now() + interval '1 day', admin_a);
  insert into check_results values ('admin of A inserts a credential directly (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('admin of A inserts a credential directly (expect denied 42501)', 'denied: ' || sqlstate); end;
begin
  update automation_credentials set expires_at = now() + interval '5 years' where id = cred_a;
  get diagnostics n = row_count;
  insert into check_results values ('admin of A extends a credential directly (expect 0 rows)', n::text);
exception when others then insert into check_results values ('admin of A extends a credential directly (expect 0 rows)', 'denied: ' || sqlstate); end;
begin
  perform automation_credential_hit(cred_a, ta);
  insert into check_results values ('member calls the rate-limit counter (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('member calls the rate-limit counter (expect denied 42501)', 'denied: ' || sqlstate); end;
insert into check_results select 'admin of A reads the usage counter (expect 0)', count(*)::text from automation_credential_usage;

perform set_config('request.jwt.claims', '{"sub":"11111111-1260-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of A without automation.manage reads it (expect 0)', count(*)::text from automation_credentials where id = cred_a;

perform set_config('request.jwt.claims', '{"sub":"11111111-1260-0000-0000-000000000003","role":"authenticated"}', true);
insert into check_results select 'admin of B reads A''s credential (expect 0)', count(*)::text from automation_credentials where id = cred_a;
begin
  update automation_credentials set status = 'revoked', revoked_at = now() where id = cred_a;
  get diagnostics n = row_count;
  insert into check_results values ('admin of B revokes A''s credential (expect 0 rows)', n::text);
exception when others then insert into check_results values ('admin of B revokes A''s credential (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
