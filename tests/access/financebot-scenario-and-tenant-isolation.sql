-- Access Agent — the module's critical acceptance test (FinanceBot/
-- CustomerDB) plus tenant isolation and forgery-rejection proof.
--
-- Same methodology as the other modules' tests/*/tenant-isolation.sql —
-- run via the Supabase MCP execute_sql tool against a DEV project only, in
-- three separate calls: fixtures, then "as User A4", then cleanup.

-- ============================================================
-- 1. Fixtures — Tenant A4 gets the exact FinanceBot scenario from
--    CLAUDE.md §11 / docs/plan/04-ACCESS-AGENT-BACKLOG.md's critical
--    acceptance test: an agent with Snowflake access that includes BOTH
--    the approved Financial_Reporting_READ entitlement AND the
--    unapproved CustomerDB_READ entitlement.
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-3000-0000-0000-000000000001', 'Fixture Tenant A4', 'fixture-tenant-a4-test'),
  ('bbbbbbbb-3000-0000-0000-000000000002', 'Fixture Tenant B4', 'fixture-tenant-b4-test');

insert into tenant_settings (tenant_id) values
  ('aaaaaaaa-3000-0000-0000-000000000001'),
  ('bbbbbbbb-3000-0000-0000-000000000002');

insert into auth.users (id, email) values
  ('11111111-3000-0000-0000-000000000001', 'fixture-user-a4@example.test'),
  ('22222222-3000-0000-0000-000000000002', 'fixture-user-b4@example.test');

insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-3000-0000-0000-000000000001', '11111111-3000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-3000-0000-0000-000000000002', '22222222-3000-0000-0000-000000000002', 'active');

insert into agents (id, tenant_id, agent_name, agent_type, purpose, data_classification, criticality) values
  ('facebeef-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001', 'FinanceBot', 'automation', 'Financial reporting', 'financial', 'high'),
  ('deadbeef-0000-0000-0000-000000000002', 'bbbbbbbb-3000-0000-0000-000000000002', 'OtherBot', 'automation', 'Other', 'internal', 'low');

insert into applications (id, tenant_id, name, category) values
  ('a0000001-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001', 'Snowflake', 'data_warehouse'),
  ('a0000002-0000-0000-0000-000000000002', 'bbbbbbbb-3000-0000-0000-000000000002', 'OtherApp', 'saas');

insert into accounts (id, tenant_id, agent_id, application_id, external_account_ref) values
  ('accc0001-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001', 'facebeef-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'svc-finance-ai@snowflake'),
  ('accc0002-0000-0000-0000-000000000002', 'bbbbbbbb-3000-0000-0000-000000000002', 'deadbeef-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000002', 'svc-other@otherapp');

insert into entitlements (id, tenant_id, application_id, name, data_classification, privilege_level) values
  ('e0000001-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'Financial_Reporting_READ', 'financial', 'standard'),
  ('e0000002-0000-0000-0000-000000000002', 'aaaaaaaa-3000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'CustomerDB_READ', 'pii', 'standard'),
  ('e0000003-0000-0000-0000-000000000003', 'bbbbbbbb-3000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000002', 'Other_READ', null, 'standard');

insert into access_grants (tenant_id, account_id, entitlement_id, grant_type) values
  ('aaaaaaaa-3000-0000-0000-000000000001', 'accc0001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 'direct'),
  ('aaaaaaaa-3000-0000-0000-000000000001', 'accc0001-0000-0000-0000-000000000001', 'e0000002-0000-0000-0000-000000000002', 'direct'),
  ('bbbbbbbb-3000-0000-0000-000000000002', 'accc0002-0000-0000-0000-000000000002', 'e0000003-0000-0000-0000-000000000003', 'direct');

-- ============================================================
-- 2. Act as fixture User A4 (member of Tenant A4 only).
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-3000-0000-0000-000000000001","role":"authenticated"}', true);

-- The critical acceptance test itself: getEffectiveAccess('FinanceBot')
-- must include CustomerDB_READ even though only Financial_Reporting_READ
-- would be approved in its Agent Contract.
insert into check_results
select 'financebot_effective_access',
  coalesce(array_agg(e.name order by e.name)::text, '{}')
from access_grants g
join accounts a on a.id = g.account_id
join entitlements e on e.id = g.entitlement_id
where a.agent_id = 'facebeef-0000-0000-0000-000000000001' and g.revoked_at is null;

-- explainAccessPath('FinanceBot', 'Snowflake:CustomerDB_READ') equivalent.
insert into check_results
select 'explain_customerdb_path',
  json_build_object(
    'account', a.external_account_ref,
    'grant_type', g.grant_type,
    'entitlement', e.name,
    'application', app.name,
    'data_classification', e.data_classification
  )::text
from access_grants g
join accounts a on a.id = g.account_id
join entitlements e on e.id = g.entitlement_id
join applications app on app.id = e.application_id
where a.agent_id = 'facebeef-0000-0000-0000-000000000001'
  and app.name = 'Snowflake' and e.name = 'CustomerDB_READ'
  and g.revoked_at is null;

-- Tenant isolation across every new Access table.
insert into check_results select 'applications_visible_to_A', coalesce(array_agg(name order by name)::text, '{}') from applications;
insert into check_results select 'accounts_visible_to_A', coalesce(array_agg(external_account_ref order by external_account_ref)::text, '{}') from accounts;
insert into check_results select 'entitlements_visible_to_A', coalesce(array_agg(name order by name)::text, '{}') from entitlements;
insert into check_results select 'access_grants_visible_to_A', coalesce(array_agg(tenant_id order by tenant_id)::text, '{}') from access_grants;

do $$
declare rows_updated int;
begin
  update applications set name = 'HACKED' where id = 'a0000002-0000-0000-0000-000000000002';
  get diagnostics rows_updated = row_count;
  insert into check_results values ('update_application_B_rows_affected', rows_updated::text);
end $$;

-- access_grants has no client insert policy at all — even same-tenant.
do $$
begin
  begin
    insert into access_grants (tenant_id, account_id, entitlement_id, grant_type)
    values ('aaaaaaaa-3000-0000-0000-000000000001', 'accc0001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 'direct');
    insert into check_results values ('client_access_grant_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_access_grant_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- access_requests: same-tenant insert with status already 'approved' must
-- be rejected by the WITH CHECK.
do $$
begin
  begin
    insert into access_requests (tenant_id, agent_id, requested_by, application_id, justification, status)
    values ('aaaaaaaa-3000-0000-0000-000000000001', 'facebeef-0000-0000-0000-000000000001', '11111111-3000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'forged', 'approved');
    insert into check_results values ('forged_access_request_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('forged_access_request_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- policy_evaluations: no client write policy at all.
do $$
begin
  begin
    insert into policy_evaluations (tenant_id, policy_id, agent_id, result)
    values ('aaaaaaaa-3000-0000-0000-000000000001', gen_random_uuid(), 'facebeef-0000-0000-0000-000000000001', 'pass');
    insert into check_results values ('client_policy_evaluation_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_policy_evaluation_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

reset role;
select * from check_results order by check_name;

-- Expected results (observed on first run — see the Access Agent audit
-- log): financebot_effective_access -> {CustomerDB_READ,Financial_Reporting_READ};
-- explain_customerdb_path -> the full chain (account, grant_type, entitlement,
-- application, data_classification); every *_visible_to_A check contains
-- only Tenant A4's own rows; update_application_B_rows_affected -> 0;
-- client_access_grant_insert / forged_access_request_insert /
-- client_policy_evaluation_insert all CORRECTLY_REJECTED.

-- ============================================================
-- 3. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from tenants where id in ('aaaaaaaa-3000-0000-0000-000000000001', 'bbbbbbbb-3000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-3000-0000-0000-000000000001', '22222222-3000-0000-0000-000000000002');
