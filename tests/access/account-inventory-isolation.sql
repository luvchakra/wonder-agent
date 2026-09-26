-- Access Agent — ACCESS-P0-17 live verification of migration 0089
-- (accounts.identity_id and friends, account_reconciliation_runs). Run via
-- the Supabase MCP execute_sql tool; cleanup in a second call (the commented
-- deletes at the end).
--
-- Proves: an account can belong to a person (no agent); it cannot point at
-- another tenant's identity or integration; one account per identifier per
-- application; the trigger keeps correlation consistent with identity_id
-- (including when the identity is deleted) and fills an agent account's
-- identity; members read only their tenant's accounts and runs, cannot
-- touch another tenant's accounts, and cannot write reconciliation runs.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-8900-0000-0000-000000000001', 'Fixture Tenant A89', 'fixture-tenant-a89-test'),
  ('bbbbbbbb-8900-0000-0000-000000000002', 'Fixture Tenant B89', 'fixture-tenant-b89-test');
insert into auth.users (id, email) values ('11111111-8900-0000-0000-000000000001', 'fixture-x89@example.test');
insert into users (id, email) values ('11111111-8900-0000-0000-000000000001', 'fixture-x89@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-8900-0000-0000-000000000001', '11111111-8900-0000-0000-000000000001', 'active');
insert into identities (id, tenant_id, identity_type, display_name) values
  ('a8900000-0000-0000-0000-0000000000d1', 'aaaaaaaa-8900-0000-0000-000000000001', 'HUMAN', 'Person A89'),
  ('a8900000-0000-0000-0000-0000000000d2', 'aaaaaaaa-8900-0000-0000-000000000001', 'HUMAN', 'Person A89 two'),
  ('b8900000-0000-0000-0000-0000000000d1', 'bbbbbbbb-8900-0000-0000-000000000002', 'HUMAN', 'Person B89');
insert into agents (id, tenant_id, agent_name, agent_type) values ('a8900000-0000-0000-0000-0000000000e1', 'aaaaaaaa-8900-0000-0000-000000000001', 'Agent A89', 'automation');
insert into applications (id, tenant_id, name) values
  ('a8900000-0000-0000-0000-0000000000a1', 'aaaaaaaa-8900-0000-0000-000000000001', 'App A89'),
  ('b8900000-0000-0000-0000-0000000000b1', 'bbbbbbbb-8900-0000-0000-000000000002', 'App B89');
insert into integrations (id, tenant_id, integration_type_id, name) values ('b8900000-0000-0000-0000-0000000000f1', 'bbbbbbbb-8900-0000-0000-000000000002', 'generic_rest', 'Conn B89');
insert into accounts (id, tenant_id, application_id, external_account_ref, identity_id) values
  ('a8900000-0000-0000-0000-0000000000c1', 'aaaaaaaa-8900-0000-0000-000000000001', 'a8900000-0000-0000-0000-0000000000a1', 'person-1', 'a8900000-0000-0000-0000-0000000000d1'),
  ('a8900000-0000-0000-0000-0000000000c2', 'aaaaaaaa-8900-0000-0000-000000000001', 'a8900000-0000-0000-0000-0000000000a1', 'person-2', 'a8900000-0000-0000-0000-0000000000d2'),
  ('b8900000-0000-0000-0000-0000000000c1', 'bbbbbbbb-8900-0000-0000-000000000002', 'b8900000-0000-0000-0000-0000000000b1', 'b-1', null);
insert into accounts (id, tenant_id, application_id, external_account_ref, agent_id) values
  ('a8900000-0000-0000-0000-0000000000c3', 'aaaaaaaa-8900-0000-0000-000000000001', 'a8900000-0000-0000-0000-0000000000a1', 'agent-1', 'a8900000-0000-0000-0000-0000000000e1');
insert into account_reconciliation_runs (tenant_id, application_id, status) values ('bbbbbbbb-8900-0000-0000-000000000002', 'b8900000-0000-0000-0000-0000000000b1', 'succeeded');

create temporary table check_results (check_name text, result text);
insert into check_results select 'person account: no agent, correlated (expect correlated)', correlation from accounts where id = 'a8900000-0000-0000-0000-0000000000c1';
insert into check_results select 'agent account: identity filled by trigger (expect true)', (identity_id = (select id from identities where agent_id = 'a8900000-0000-0000-0000-0000000000e1'))::text from accounts where id = 'a8900000-0000-0000-0000-0000000000c3';
insert into check_results select 'orphan by default (expect orphan)', correlation from accounts where id = 'b8900000-0000-0000-0000-0000000000c1';
delete from identities where id = 'a8900000-0000-0000-0000-0000000000d2';
insert into check_results select 'identity deleted: account kept as orphan (expect orphan/null)', correlation || '/' || coalesce(identity_id::text, 'null') from accounts where id = 'a8900000-0000-0000-0000-0000000000c2';
do $$ begin
  insert into accounts (tenant_id, application_id, external_account_ref, identity_id) values ('aaaaaaaa-8900-0000-0000-000000000001', 'a8900000-0000-0000-0000-0000000000a1', 'x-1', 'b8900000-0000-0000-0000-0000000000d1');
  insert into check_results values ('account of another tenant''s identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('account of another tenant''s identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into accounts (tenant_id, application_id, external_account_ref, source_integration_id) values ('aaaaaaaa-8900-0000-0000-000000000001', 'a8900000-0000-0000-0000-0000000000a1', 'x-2', 'b8900000-0000-0000-0000-0000000000f1');
  insert into check_results values ('account from another tenant''s integration (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('account from another tenant''s integration (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into accounts (tenant_id, application_id, external_account_ref) values ('aaaaaaaa-8900-0000-0000-000000000001', 'a8900000-0000-0000-0000-0000000000a1', 'person-1');
  insert into check_results values ('duplicate identifier in one application (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('duplicate identifier in one application (expect denied)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-8900-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own accounts visible (expect 3)', count(*)::text from accounts where tenant_id = 'aaaaaaaa-8900-0000-0000-000000000001';
insert into check_results select 'X: B accounts and runs visible (expect 0)', ((select count(*) from accounts where tenant_id = 'bbbbbbbb-8900-0000-0000-000000000002') + (select count(*) from account_reconciliation_runs where tenant_id = 'bbbbbbbb-8900-0000-0000-000000000002'))::text;
with u as (update accounts set identity_id = 'a8900000-0000-0000-0000-0000000000d1' where id = 'b8900000-0000-0000-0000-0000000000c1' returning 1)
insert into check_results select 'X: link a B account (expect 0)', count(*)::text from u;
do $$ begin
  insert into account_reconciliation_runs (tenant_id, application_id, status) values ('aaaaaaaa-8900-0000-0000-000000000001', 'a8900000-0000-0000-0000-0000000000a1', 'succeeded');
  insert into check_results values ('X: write a run directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: write a run directly (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-8900-0000-0000-000000000001', 'bbbbbbbb-8900-0000-0000-000000000002');
-- delete from users where id = '11111111-8900-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-8900-0000-0000-000000000001';
