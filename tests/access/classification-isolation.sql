-- Access Agent + Risk Agent — live verification of migration 0120
-- (ACCESS-P0-25: baselines and rogue-access findings).
--
-- Proves: a member reads only their own organization's baselines and access
-- findings and can write neither; one baseline per application and scope;
-- a finding must name an agent or an account; an access finding can name
-- only its own organization's account (same-tenant key); one open finding
-- per account and entitlement, while a resolved one does not block a new
-- one; agent findings still insert as before.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1200-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1200-0000-0000-000000000002';
  appa constant uuid := 'aaaaaaaa-1200-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1200-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1200-0000-0000-0000000000d1';
  accb constant uuid := 'bbbbbbbb-1200-0000-0000-0000000000d1';
  agenta constant uuid := 'aaaaaaaa-1200-0000-0000-0000000000b1';
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A120', 'fixture-tenant-a120-test'),
  (tb, 'Fixture Tenant B120', 'fixture-tenant-b120-test');
insert into auth.users (id, email) values
  ('11111111-1200-0000-0000-000000000001', 'fixture-a120@example.test'),
  ('11111111-1200-0000-0000-000000000002', 'fixture-b120@example.test');
insert into users (id, email) values
  ('11111111-1200-0000-0000-000000000001', 'fixture-a120@example.test'),
  ('11111111-1200-0000-0000-000000000002', 'fixture-b120@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  (ta, '11111111-1200-0000-0000-000000000001', 'active'),
  (tb, '11111111-1200-0000-0000-000000000002', 'active');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A'), (appb, tb, 'Fixture App B');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acca, ta, appa, 'alice'), (accb, tb, appb, 'bob');
insert into agents (id, tenant_id, agent_name, agent_type) values (agenta, ta, 'Fixture Agent A120', 'assistant');
insert into access_baselines (tenant_id, application_id, scope) values (ta, appa, 'access'), (tb, appb, 'access');
insert into risk_findings (tenant_id, account_id, application_id, subject_key, category, severity, title, explanation, recommendation)
  values (ta, acca, appa, 'acca|', 'rogue_access', 'high', 'Rogue access: alice', 'x', 'y');

create temporary table check_results (check_name text, result text);

begin
  insert into access_baselines (tenant_id, application_id, scope) values (ta, appa, 'access');
  insert into check_results values ('second baseline for the same scope (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('second baseline for the same scope (expect denied 23505)', 'denied: ' || sqlstate); end;
begin
  insert into risk_findings (tenant_id, category, severity, title, explanation, recommendation) values (ta, 'rogue_access', 'high', 't', 'x', 'y');
  insert into check_results values ('finding with no agent and no account (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('finding with no agent and no account (expect denied 23514)', 'denied: ' || sqlstate); end;
begin
  insert into risk_findings (tenant_id, account_id, subject_key, category, severity, title, explanation, recommendation) values (ta, accb, 'accb|', 'rogue_access', 'high', 't', 'x', 'y');
  insert into check_results values ('finding naming another organization''s account (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('finding naming another organization''s account (expect denied 23503)', 'denied: ' || sqlstate); end;
begin
  insert into risk_findings (tenant_id, account_id, subject_key, category, severity, title, explanation, recommendation) values (ta, acca, 'acca|', 'rogue_access', 'high', 't', 'x', 'y');
  insert into check_results values ('second open finding for the same access (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('second open finding for the same access (expect denied 23505)', 'denied: ' || sqlstate); end;
update risk_findings set status = 'resolved', resolved_at = now() where tenant_id = ta and subject_key = 'acca|';
begin
  insert into risk_findings (tenant_id, account_id, subject_key, category, severity, title, explanation, recommendation) values (ta, acca, 'acca|', 'rogue_access', 'high', 't', 'x', 'y');
  insert into check_results values ('new finding after the old one resolved (expect allowed)', 'allowed');
exception when others then insert into check_results values ('new finding after the old one resolved (expect allowed)', 'denied: ' || sqlstate); end;
begin
  insert into risk_findings (tenant_id, agent_id, category, severity, title, explanation, recommendation) values (ta, agenta, 'excessive_access', 'high', 't', 'x', 'y');
  insert into check_results values ('agent finding as before (expect allowed)', 'allowed');
exception when others then insert into check_results values ('agent finding as before (expect allowed)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1200-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A baselines (expect 1)', count(*)::text from access_baselines;
insert into check_results select 'member of A reads A access findings (expect 2)', count(*)::text from risk_findings where category = 'rogue_access';
begin
  insert into access_baselines (tenant_id, application_id, scope) values (ta, appa, 'accounts');
  insert into check_results values ('member writes a baseline (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member writes a baseline (expect denied)', 'denied: ' || sqlstate); end;
begin
  update risk_findings set status = 'resolved' where tenant_id = ta and category = 'rogue_access';
  get diagnostics n = row_count;
  insert into check_results values ('member resolves an access finding (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member resolves an access finding (expect 0 rows)', 'denied: ' || sqlstate); end;

perform set_config('request.jwt.claims', '{"sub":"11111111-1200-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A baselines (expect 0)', count(*)::text from access_baselines where tenant_id = ta;
insert into check_results select 'member of B reads A findings (expect 0)', count(*)::text from risk_findings where tenant_id = ta;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
