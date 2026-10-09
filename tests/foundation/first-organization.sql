-- Foundation Agent — live verification of migration 0107
-- (create_first_tenant_for_current_user). Run via the Supabase MCP
-- execute_sql tool; cleanup in a second call (the commented deletes at the end).
--
-- Proves: a brand-new account gets exactly one organization (a second call
-- creates nothing) and is its Tenant Administrator; an invited person, a
-- person with a suspended membership and a platform administrator get none;
-- an anonymous caller is refused.
--
-- (Result recorded in docs/design/foundation-agent-backlog-audit.md.)

insert into tenants (id, name, slug) values ('aaaaaaaa-0107-0000-0000-000000000001', 'Fixture Tenant A107', 'fixture-a107');
insert into auth.users (id, email) values
  ('11111111-0107-0000-0000-000000000001', 'fixture-new107@example.test'),
  ('22222222-0107-0000-0000-000000000002', 'fixture-inv107@example.test'),
  ('33333333-0107-0000-0000-000000000003', 'fixture-sus107@example.test'),
  ('44444444-0107-0000-0000-000000000004', 'fixture-pa107@example.test');
insert into users (id, email) values
  ('11111111-0107-0000-0000-000000000001', 'fixture-new107@example.test'),
  ('22222222-0107-0000-0000-000000000002', 'fixture-inv107@example.test'),
  ('33333333-0107-0000-0000-000000000003', 'fixture-sus107@example.test'),
  ('44444444-0107-0000-0000-000000000004', 'fixture-pa107@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-0107-0000-0000-000000000001', '22222222-0107-0000-0000-000000000002', 'invited'),
  ('aaaaaaaa-0107-0000-0000-000000000001', '33333333-0107-0000-0000-000000000003', 'suspended');
insert into platform_admins (user_id) values ('44444444-0107-0000-0000-000000000004');

create temporary table check_results (check_name text, result text);
grant all on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0107-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'new account, first call (expect created)', case when create_first_tenant_for_current_user('Fixture New 107', 'fixture-new-107-aaaaaa') is null then 'none' else 'created' end;
insert into check_results select 'new account, second call (expect none)', coalesce(create_first_tenant_for_current_user('Fixture New 107 again', 'fixture-new-107-bbbbbb')::text, 'none');
select set_config('request.jwt.claims', '{"sub":"22222222-0107-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'invited person (expect none)', coalesce(create_first_tenant_for_current_user('Fixture Inv 107', 'fixture-inv-107-aaaaaa')::text, 'none');
select set_config('request.jwt.claims', '{"sub":"33333333-0107-0000-0000-000000000003","role":"authenticated"}', true);
insert into check_results select 'suspended member (expect none)', coalesce(create_first_tenant_for_current_user('Fixture Sus 107', 'fixture-sus-107-aaaaaa')::text, 'none');
select set_config('request.jwt.claims', '{"sub":"44444444-0107-0000-0000-000000000004","role":"authenticated"}', true);
insert into check_results select 'platform administrator (expect none)', coalesce(create_first_tenant_for_current_user('Fixture PA 107', 'fixture-pa-107-aaaaaa')::text, 'none');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  perform create_first_tenant_for_current_user('Fixture Anon 107', 'fixture-anon-107-aaaaaa');
  insert into check_results values ('anonymous caller (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('anonymous caller (expect denied 42501)', 'denied: ' || sqlstate); end $$;
reset role;

insert into check_results select 'new account''s memberships (expect 1)', count(*)::text from tenant_memberships where user_id = '11111111-0107-0000-0000-000000000001';
insert into check_results select 'new account is Tenant Administrator (expect 1)', count(*)::text
  from user_roles ur join roles r on r.id = ur.role_id
  where ur.user_id = '11111111-0107-0000-0000-000000000001' and r.name = 'TENANT_SUPER_ADMIN';
insert into check_results select 'organizations for the others (expect 0)', count(*)::text from tenants where slug like 'fixture-%-107-%' and name <> 'Fixture New 107';
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id = 'aaaaaaaa-0107-0000-0000-000000000001' or slug like 'fixture-%-107-%';
-- delete from platform_admins where user_id = '44444444-0107-0000-0000-000000000004';
-- delete from users where id in ('11111111-0107-0000-0000-000000000001', '22222222-0107-0000-0000-000000000002', '33333333-0107-0000-0000-000000000003', '44444444-0107-0000-0000-000000000004');
-- delete from auth.users where id in ('11111111-0107-0000-0000-000000000001', '22222222-0107-0000-0000-000000000002', '33333333-0107-0000-0000-000000000003', '44444444-0107-0000-0000-000000000004');
