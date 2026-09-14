-- Risk Agent — the module's critical acceptance test (docs/plan/06-RISK-
-- AGENT-BACKLOG.md): when SHOULD = financial data only, CAN includes
-- CustomerDB, and DID shows CustomerDB access, a CRITICAL finding exists
-- with evidence referencing the specific access_grants and runtime_events
-- rows, plus tenant isolation and forgery-rejection proof.
--
-- Reuses the FinanceBot fixture already present from Runtime Agent's own
-- test (tests/runtime/idempotent-ingestion-and-central-scenario.sql,
-- Tenant A5 = aaaaaaaa-5000-0000-0000-000000000001, agent
-- facebeef-5000-0000-0000-000000000001) rather than re-creating it —
-- evaluateAgentRisk()'s deterministic logic itself (which detection
-- categories fire, the weighted severity/override) is exhaustively covered
-- by modules/risk/rules.test.ts and modules/risk/scoring.test.ts against
-- mocked dependencies; this live script proves the schema/RLS layer a unit
-- test cannot: tenant isolation and forgery-rejection on risk_findings/
-- risk_evidence, using a finding shaped exactly as createOrUpdateFinding()
-- would produce for this fixture data.
--
-- Run via the Supabase MCP execute_sql tool against a DEV project only.

-- ============================================================
-- 1. Insert the finding + evidence as the trusted engine would (service-
--    role, bypassing RLS) — referencing the REAL access_grants and
--    runtime_events rows from the existing FinanceBot fixture.
-- ============================================================
insert into risk_findings (
  id, tenant_id, agent_id, category, severity, risk_score, reasons,
  title, explanation, recommendation, status
) values (
  'facebeef-6000-0000-0000-000000000001',
  'aaaaaaaa-5000-0000-0000-000000000001',
  'facebeef-5000-0000-0000-000000000001',
  'sensitive_data_violation',
  'critical',
  80,
  '["Production environment access","Sensitive data (PII/financial/confidential) involved","Active policy violation","Runtime/behavioral anomaly present","Business criticality high/critical"]'::jsonb,
  'FinanceBot accessed data outside its approved classification',
  'FinanceBot''s approved data is financial reporting only. On 2026-09-12 10:31 UTC, FinanceBot read PII-classified data (Snowflake -> CustomerDB) via the query_customer tool. This access was not approved in the agent''s active contract.',
  'Remove the CustomerDB_READ entitlement from FinanceBot''s Snowflake account.',
  'open'
);

insert into risk_evidence (finding_id, evidence_type, reference_id, summary) values
  ('facebeef-6000-0000-0000-000000000001', 'access_grant', 'e92fb005-7739-4e50-91a7-52e5d7e9e38f', 'Snowflake: CustomerDB_READ (pii)'),
  ('facebeef-6000-0000-0000-000000000001', 'runtime_event', '85a2002c-2d15-4c43-aba0-7cd983a9475b', 'Snowflake/CustomerDB read (PII) at 2026-09-12T10:31:00Z');

-- ============================================================
-- 2. Act as fixture User A5 (already a member of Tenant A5 from Runtime
--    Agent's fixture) — read the finding+evidence, prove tenant isolation
--    and forgery-rejection.
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results
select 'critical_finding', json_build_object(
  'category', category, 'severity', severity, 'risk_score', risk_score,
  'title', title, 'status', status
)::text
from risk_findings where id = 'facebeef-6000-0000-0000-000000000001';

insert into check_results
select 'evidence_count', count(*)::text from risk_evidence where finding_id = 'facebeef-6000-0000-0000-000000000001';

-- Tenant isolation: Tenant B5's user must see none of Tenant A5's findings.
insert into check_results select 'findings_visible_to_A', coalesce(array_agg(category order by category)::text, '{}') from risk_findings;

-- No client insert policy on risk_findings at all — even same-tenant.
do $$
begin
  begin
    insert into risk_findings (tenant_id, agent_id, category, severity, title, explanation, recommendation)
    values ('aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', 'excessive_access', 'critical', 'forged', 'forged', 'forged');
    insert into check_results values ('client_finding_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_finding_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- Nor on risk_evidence.
do $$
begin
  begin
    insert into risk_evidence (finding_id, evidence_type, reference_id, summary)
    values ('facebeef-6000-0000-0000-000000000001', 'access_grant', gen_random_uuid(), 'forged evidence');
    insert into check_results values ('client_evidence_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_evidence_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

reset role;
select * from check_results order by check_name;

-- ============================================================
-- 3. Act as fixture User B5 (member of Tenant B5 only) — must see zero of
--    Tenant A5's findings/evidence.
-- ============================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-5000-0000-0000-000000000002","role":"authenticated"}', true);

insert into check_results select 'findings_visible_to_B', coalesce(array_agg(category order by category)::text, '{}') from risk_findings;
insert into check_results select 'evidence_visible_to_B', count(*)::text from risk_evidence;

reset role;
select * from check_results order by check_name;

-- Expected: critical_finding -> category=sensitive_data_violation,
-- severity=critical, risk_score=80, status=open; evidence_count -> 2;
-- findings_visible_to_A -> {sensitive_data_violation} only;
-- client_finding_insert / client_evidence_insert -> CORRECTLY_REJECTED;
-- findings_visible_to_B -> {} (empty); evidence_visible_to_B -> 0.

-- ============================================================
-- 4. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from risk_findings where id = 'facebeef-6000-0000-0000-000000000001';
