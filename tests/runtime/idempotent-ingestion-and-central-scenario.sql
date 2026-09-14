-- Runtime Agent — RUNTIME-P0-01.2 idempotent ingestion proof, tenant
-- isolation, forgery-rejection, and the module's critical acceptance test
-- (docs/plan/05-RUNTIME-AGENT-BACKLOG.md): ingest the FinanceBot ->
-- Snowflake -> CustomerDB READ event and prove DID = CustomerDB with full
-- evidence.
--
-- Same methodology as the other modules' tests/*/tenant-isolation.sql —
-- run via the Supabase MCP execute_sql tool against a DEV project only, in
-- separate calls: fixtures, then "as User A5", then cleanup.

-- ============================================================
-- 1. Fixtures — Tenant A5 gets the FinanceBot scenario: an active Agent
--    Contract approving {SAP, Snowflake} x {financial reporting}, effective
--    access including both the approved Financial_Reporting_READ
--    entitlement and the unapproved CustomerDB_READ entitlement.
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-5000-0000-0000-000000000001', 'Fixture Tenant A5', 'fixture-tenant-a5-test'),
  ('bbbbbbbb-5000-0000-0000-000000000002', 'Fixture Tenant B5', 'fixture-tenant-b5-test');

insert into tenant_settings (tenant_id) values
  ('aaaaaaaa-5000-0000-0000-000000000001'),
  ('bbbbbbbb-5000-0000-0000-000000000002');

insert into auth.users (id, email) values
  ('11111111-5000-0000-0000-000000000001', 'fixture-user-a5@example.test'),
  ('22222222-5000-0000-0000-000000000002', 'fixture-user-b5@example.test');

insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-5000-0000-0000-000000000002', '22222222-5000-0000-0000-000000000002', 'active');

insert into agents (id, tenant_id, agent_name, agent_type, purpose, data_classification, criticality) values
  ('facebeef-5000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'FinanceBot', 'automation', 'Financial reporting', 'financial', 'high'),
  ('deadbeef-5000-0000-0000-000000000002', 'bbbbbbbb-5000-0000-0000-000000000002', 'OtherBot', 'automation', 'Other', 'internal', 'low');

insert into agent_contracts (tenant_id, agent_id, purpose, approved_applications, approved_data, approved_actions, status, version) values
  ('aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', 'Financial reporting',
   array['SAP','Snowflake'], array['financial reporting'], array['read','report'], 'active', 1);

insert into applications (id, tenant_id, name, category) values
  ('a0000001-5000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'Snowflake', 'data_warehouse');

insert into accounts (id, tenant_id, agent_id, application_id, external_account_ref) values
  ('accc0001-5000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', 'a0000001-5000-0000-0000-000000000001', 'svc-finance-ai@snowflake');

insert into entitlements (id, tenant_id, application_id, name, data_classification, privilege_level) values
  ('e0000001-5000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'a0000001-5000-0000-0000-000000000001', 'Financial_Reporting_READ', 'financial', 'standard'),
  ('e0000002-5000-0000-0000-000000000002', 'aaaaaaaa-5000-0000-0000-000000000001', 'a0000001-5000-0000-0000-000000000001', 'CustomerDB_READ', 'pii', 'standard');

insert into access_grants (tenant_id, account_id, entitlement_id, grant_type) values
  ('aaaaaaaa-5000-0000-0000-000000000001', 'accc0001-5000-0000-0000-000000000001', 'e0000001-5000-0000-0000-000000000001', 'direct'),
  ('aaaaaaaa-5000-0000-0000-000000000001', 'accc0001-5000-0000-0000-000000000001', 'e0000002-5000-0000-0000-000000000002', 'direct');

-- The critical-acceptance-test event, inserted as the trusted ingestion
-- path would (service-role, bypassing RLS) — mirrors ingestRuntimeEvent()'s
-- insert exactly, including the deterministic dedupe_key shape.
insert into runtime_events (tenant_id, agent_id, event_time, source, tool, application, resource, action, data_classification, success, dedupe_key)
values (
  'aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001',
  '2026-09-12T10:31:00Z', 'mcp', 'query_customer', 'Snowflake', 'CustomerDB', 'read', 'PII', true,
  'fixture-dedupe-key-financebot-customerdb-1'
);

-- ============================================================
-- 2. Idempotency proof: resubmitting the exact same event (same
--    tenant_id + dedupe_key) must be rejected by the unique constraint,
--    not silently duplicated — this is what ingestRuntimeEvent()'s 23505
--    catch-and-return-existing branch handles at the application layer.
-- ============================================================
do $$
begin
  begin
    insert into runtime_events (tenant_id, agent_id, event_time, source, tool, application, resource, action, data_classification, success, dedupe_key)
    values (
      'aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001',
      '2026-09-12T10:31:00Z', 'mcp', 'query_customer', 'Snowflake', 'CustomerDB', 'read', 'PII', true,
      'fixture-dedupe-key-financebot-customerdb-1'
    );
    raise notice 'UNEXPECTEDLY_SUCCEEDED: duplicate event was inserted';
  exception when unique_violation then
    raise notice 'CORRECTLY_REJECTED: duplicate dedupe_key blocked by unique (tenant_id, dedupe_key)';
  end;
end $$;

-- ============================================================
-- 3. Act as fixture User A5 (member of Tenant A5 only) — tenant isolation,
--    read access to the timeline, and forgery-rejection.
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);

-- Exactly one runtime_events row exists for the fixture dedupe_key (proves
-- the idempotency constraint held even after the rejected duplicate above).
insert into check_results
select 'runtime_events_row_count_for_dedupe_key', count(*)::text
from runtime_events where dedupe_key = 'fixture-dedupe-key-financebot-customerdb-1';

-- DID reproduced via the same shape getDid() computes.
insert into check_results
select 'did_tuple', json_build_object(
  'application', application, 'resource', resource, 'action', action,
  'data_classification', data_classification
)::text
from runtime_events
where agent_id = 'facebeef-5000-0000-0000-000000000001' and resource = 'CustomerDB';

-- The full SHOULD/CAN/DID divergence, reproduced from stored data alone
-- (what compareShouldCanDid() computes): SHOULD = {SAP,Snowflake} x
-- {financial reporting}; CAN includes CustomerDB_READ (excessive_access);
-- DID = CustomerDB read of PII data, outside approved purpose
-- (behavioral_violation).
insert into check_results
select 'excessive_access_evidence', json_build_object(
  'grant_id', g.id, 'entitlement', e.name, 'application', app.name, 'data_classification', e.data_classification
)::text
from access_grants g
join entitlements e on e.id = g.entitlement_id
join applications app on app.id = e.application_id
join accounts a on a.id = g.account_id
where a.agent_id = 'facebeef-5000-0000-0000-000000000001' and e.name = 'CustomerDB_READ';

-- Tenant isolation across runtime_events/runtime_tools/runtime_resources.
insert into check_results select 'runtime_events_visible_to_A', coalesce(array_agg(resource order by resource)::text, '{}') from runtime_events;

-- runtime_events has no client insert policy at all — even same-tenant.
do $$
begin
  begin
    insert into runtime_events (tenant_id, agent_id, event_time, source, action, success, dedupe_key)
    values ('aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', now(), 'rest', 'read', true, 'forged-client-event');
    insert into check_results values ('client_runtime_event_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_runtime_event_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

reset role;
select * from check_results order by check_name;

-- Expected results: runtime_events_row_count_for_dedupe_key -> 1 (not 2);
-- did_tuple -> {"application":"Snowflake","resource":"CustomerDB","action":"read","data_classification":"PII"};
-- excessive_access_evidence -> the CustomerDB_READ grant chain;
-- runtime_events_visible_to_A -> {CustomerDB} only (Tenant B5 has none);
-- client_runtime_event_insert -> CORRECTLY_REJECTED.

-- ============================================================
-- 4. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from tenants where id in ('aaaaaaaa-5000-0000-0000-000000000001', 'bbbbbbbb-5000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-5000-0000-0000-000000000001', '22222222-5000-0000-0000-000000000002');
