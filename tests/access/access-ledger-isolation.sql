-- Access Agent — ACCESS-P0-24 live verification of migration 0114
-- (access_ledger, access_ledger_events).
--
-- Proves: one ledger row per account and per entitlement of an account; a
-- row cannot point at another tenant's account, entitlement or identity;
-- the status vocabulary is enforced; history is append-only (no update, no
-- delete) yet goes with a deleted organization; members read only their
-- own organization's ledger and history and can write neither.
--
-- Self-cleaning: everything runs in one block that ends by raising its
-- results as an error, so every fixture is rolled back. The Supabase MCP
-- execute_sql tool refuses statements that contain a delete, so the three
-- delete checks (marked [delete]) run only from the SQL editor; drop them
-- to run the rest through the tool.

do $t$
begin
insert into tenants (id, name, slug) values
  ('aaaaaaaa-1140-0000-0000-000000000001', 'Fixture Tenant A114', 'fixture-tenant-a114-test'),
  ('bbbbbbbb-1140-0000-0000-000000000002', 'Fixture Tenant B114', 'fixture-tenant-b114-test');
insert into auth.users (id, email) values ('11111111-1140-0000-0000-000000000001', 'fixture-x114@example.test');
insert into users (id, email) values ('11111111-1140-0000-0000-000000000001', 'fixture-x114@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-1140-0000-0000-000000000001', '11111111-1140-0000-0000-000000000001', 'active');
insert into identities (id, tenant_id, identity_type, display_name) values
  ('a1140000-0000-0000-0000-0000000000d1', 'aaaaaaaa-1140-0000-0000-000000000001', 'HUMAN', 'Person A114'),
  ('b1140000-0000-0000-0000-0000000000d1', 'bbbbbbbb-1140-0000-0000-000000000002', 'HUMAN', 'Person B114');
insert into applications (id, tenant_id, name) values
  ('a1140000-0000-0000-0000-0000000000a1', 'aaaaaaaa-1140-0000-0000-000000000001', 'App A114'),
  ('b1140000-0000-0000-0000-0000000000b1', 'bbbbbbbb-1140-0000-0000-000000000002', 'App B114');
insert into entitlements (id, tenant_id, application_id, name) values
  ('a1140000-0000-0000-0000-0000000000e1', 'aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000a1', 'Read A114'),
  ('b1140000-0000-0000-0000-0000000000e1', 'bbbbbbbb-1140-0000-0000-000000000002', 'b1140000-0000-0000-0000-0000000000b1', 'Read B114');
insert into accounts (id, tenant_id, application_id, external_account_ref, identity_id) values
  ('a1140000-0000-0000-0000-0000000000c1', 'aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000a1', 'person-1', 'a1140000-0000-0000-0000-0000000000d1'),
  ('b1140000-0000-0000-0000-0000000000c1', 'bbbbbbbb-1140-0000-0000-000000000002', 'b1140000-0000-0000-0000-0000000000b1', 'b-1', 'b1140000-0000-0000-0000-0000000000d1');
insert into access_ledger (id, tenant_id, account_id, entitlement_id, application_id, identity_id, source, status) values
  ('a1140000-0000-0000-0000-0000000000f1', 'aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000c1', null, 'a1140000-0000-0000-0000-0000000000a1', 'a1140000-0000-0000-0000-0000000000d1', 'IMPORT', 'UNPROVEN'),
  ('a1140000-0000-0000-0000-0000000000f2', 'aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000c1', 'a1140000-0000-0000-0000-0000000000e1', 'a1140000-0000-0000-0000-0000000000a1', 'a1140000-0000-0000-0000-0000000000d1', 'IMPORT', 'UNPROVEN'),
  ('b1140000-0000-0000-0000-0000000000f1', 'bbbbbbbb-1140-0000-0000-000000000002', 'b1140000-0000-0000-0000-0000000000c1', null, 'b1140000-0000-0000-0000-0000000000b1', 'b1140000-0000-0000-0000-0000000000d1', 'IMPORT', 'UNPROVEN');
insert into access_ledger_events (tenant_id, ledger_id, account_id, event_type, to_status, to_source) values
  ('aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000f1', 'a1140000-0000-0000-0000-0000000000c1', 'recorded', 'UNPROVEN', 'IMPORT'),
  ('bbbbbbbb-1140-0000-0000-000000000002', 'b1140000-0000-0000-0000-0000000000f1', 'b1140000-0000-0000-0000-0000000000c1', 'recorded', 'UNPROVEN', 'IMPORT');

create temporary table check_results (check_name text, result text);
begin
  insert into access_ledger (tenant_id, account_id, entitlement_id, application_id, source, status) values ('aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000c1', null, 'a1140000-0000-0000-0000-0000000000a1', 'IMPORT', 'UNPROVEN');
  insert into check_results values ('second row for the same account (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('second row for the same account (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into access_ledger (tenant_id, account_id, entitlement_id, application_id, source, status) values ('aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000c1', 'a1140000-0000-0000-0000-0000000000e1', 'a1140000-0000-0000-0000-0000000000a1', 'IMPORT', 'UNPROVEN');
  insert into check_results values ('second row for the same entitlement (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('second row for the same entitlement (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into access_ledger (tenant_id, account_id, application_id, source, status) values ('aaaaaaaa-1140-0000-0000-000000000001', 'b1140000-0000-0000-0000-0000000000c1', 'a1140000-0000-0000-0000-0000000000a1', 'IMPORT', 'UNPROVEN');
  insert into check_results values ('row on another tenant''s account (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('row on another tenant''s account (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into access_ledger (tenant_id, account_id, entitlement_id, application_id, source, status) values ('aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000c1', 'b1140000-0000-0000-0000-0000000000e1', 'a1140000-0000-0000-0000-0000000000a1', 'IMPORT', 'UNPROVEN');
  insert into check_results values ('row on another tenant''s entitlement (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('row on another tenant''s entitlement (expect denied)', 'denied: ' || sqlstate); end;
begin
  update access_ledger set identity_id = 'b1140000-0000-0000-0000-0000000000d1' where id = 'a1140000-0000-0000-0000-0000000000f1';
  insert into check_results values ('point at another tenant''s identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('point at another tenant''s identity (expect denied)', 'denied: ' || sqlstate); end;
begin
  update access_ledger set status = 'MALICIOUS' where id = 'a1140000-0000-0000-0000-0000000000f1';
  insert into check_results values ('unknown status (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('unknown status (expect denied)', 'denied: ' || sqlstate); end;
begin
  update access_ledger_events set to_status = 'VALID' where ledger_id = 'a1140000-0000-0000-0000-0000000000f1';
  insert into check_results values ('rewrite history (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('rewrite history (expect denied)', 'denied: ' || sqlstate); end;
begin
  delete from access_ledger_events where ledger_id = 'a1140000-0000-0000-0000-0000000000f1';
  insert into check_results values ('[delete] delete history (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('[delete] delete history (expect denied)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);
perform set_config('request.jwt.claims', '{"sub":"11111111-1140-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own ledger rows and events (expect 2/1)', (select count(*) from access_ledger)::text || '/' || (select count(*) from access_ledger_events)::text;
insert into check_results select 'X: B ledger rows and events (expect 0)', ((select count(*) from access_ledger where tenant_id = 'bbbbbbbb-1140-0000-0000-000000000002') + (select count(*) from access_ledger_events where tenant_id = 'bbbbbbbb-1140-0000-0000-000000000002'))::text;
with u as (update access_ledger set status = 'VALID' where tenant_id = 'aaaaaaaa-1140-0000-0000-000000000001' returning 1)
insert into check_results select 'X: mark own access approved (expect 0)', count(*)::text from u;
with d as (delete from access_ledger returning 1)
insert into check_results select '[delete] X: delete ledger rows (expect 0)', count(*)::text from d;
begin
  insert into access_ledger (tenant_id, account_id, entitlement_id, application_id, source, status) values ('aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000c1', null, 'a1140000-0000-0000-0000-0000000000a1', 'WONDERID_REQUEST', 'VALID');
  insert into check_results values ('X: write a ledger row (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: write a ledger row (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into access_ledger_events (tenant_id, ledger_id, account_id, event_type, to_status, to_source) values ('aaaaaaaa-1140-0000-0000-000000000001', 'a1140000-0000-0000-0000-0000000000f1', 'a1140000-0000-0000-0000-0000000000c1', 'changed', 'VALID', 'WONDERID_REQUEST');
  insert into check_results values ('X: write history (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: write history (expect denied)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);

delete from tenants where id = 'bbbbbbbb-1140-0000-0000-000000000002';
insert into check_results select '[delete] deleted organization takes its ledger and history (expect 0)', ((select count(*) from access_ledger where tenant_id = 'bbbbbbbb-1140-0000-0000-000000000002') + (select count(*) from access_ledger_events where tenant_id = 'bbbbbbbb-1140-0000-0000-000000000002'))::text;
raise exception 'RESULTS (rolled back): %', (select string_agg(check_name || ' => ' || result, ' | ') from check_results);
end $t$;

-- Run 2026-10-10 through execute_sql without the [delete] checks: all 12 passed
-- (unique 23505 x2, cross-tenant references 23503 x3, status check 23514,
-- history update refused P0001, member sees 2/1 own rows and 0 of B's, member
-- update affects 0 rows, member writes refused 42501 x2).
