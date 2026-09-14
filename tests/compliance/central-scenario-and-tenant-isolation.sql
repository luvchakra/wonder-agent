-- Compliance Agent — the module's critical acceptance test
-- (docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md): launch a certification
-- reproducing the PRD's exact worked table (Access vs Risk vs Used vs
-- Recommendation), capture decisions, retain immutable evidence/audit
-- history — plus tenant isolation and forgery-rejection proof.
--
-- Reuses the FinanceBot fixture already present from Runtime/Risk Agent's
-- own tests (Tenant A5 = aaaaaaaa-5000-0000-0000-000000000001, agent
-- facebeef-5000-0000-0000-000000000001, existing Snowflake/
-- Financial_Reporting_READ grant) and adds the two additional
-- applications/entitlements the PRD's worked table needs (SAP, S3) —
-- rather than re-creating the whole fixture. evaluateAgentRisk()/
-- computeRecommendation()'s own deterministic logic is already
-- exhaustively covered by modules/certification-compliance/campaigns.test.ts
-- and modules/risk/rules.test.ts; this live script proves the schema/RLS
-- layer those unit tests cannot reach.
--
-- Run via the Supabase MCP execute_sql tool against a DEV project only.

-- ============================================================
-- 1. Extend the fixture: SAP and S3 applications/entitlements/accounts/
--    grants, so all three rows of the PRD's worked table have a real
--    access_grants row to reference.
-- ============================================================
insert into applications (id, tenant_id, name, category) values
  ('a0000002-6000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'SAP', 'erp'),
  ('a0000003-6000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'S3', 'storage');

insert into accounts (id, tenant_id, agent_id, application_id, external_account_ref) values
  ('accc0002-6000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', 'a0000002-6000-0000-0000-000000000001', 'svc-finance-ai@sap'),
  ('accc0003-6000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', 'a0000003-6000-0000-0000-000000000001', 'svc-finance-ai@s3');

insert into entitlements (id, tenant_id, application_id, name, data_classification, privilege_level) values
  ('e0000003-6000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'a0000002-6000-0000-0000-000000000001', 'SAP_READ', 'financial', 'standard'),
  ('e0000004-6000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'a0000003-6000-0000-0000-000000000001', 'S3_READ', null, 'standard');

insert into access_grants (id, tenant_id, account_id, entitlement_id, grant_type) values
  ('facebeef-6100-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'accc0002-6000-0000-0000-000000000001', 'e0000003-6000-0000-0000-000000000001', 'direct'),
  ('facebeef-6100-0000-0000-000000000002', 'aaaaaaaa-5000-0000-0000-000000000001', 'accc0003-6000-0000-0000-000000000001', 'e0000004-6000-0000-0000-000000000001', 'direct');

-- ============================================================
-- 2. Launch the campaign and populate items exactly as launchCampaign()
--    would (service-role, bypassing RLS) — the PRD's exact worked table.
-- ============================================================
insert into certification_campaigns (id, tenant_id, name, scope_type, scope, cadence, status, created_by)
values (
  'facebeef-6200-0000-0000-000000000001',
  'aaaaaaaa-5000-0000-0000-000000000001',
  'Q3 High-Risk Agent Certification',
  'agent',
  '{"criticality":["high","critical"]}'::jsonb,
  'one_time',
  'active',
  '11111111-5000-0000-0000-000000000001'
);

-- Snowflake READ / High / Used -> Review (references the real, existing
-- CustomerDB_READ grant, since that is the one actually flagged high-risk).
insert into certification_items (id, tenant_id, campaign_id, agent_id, access_grant_id, reviewer_id, risk_at_review, usage_at_review, recommendation)
values (
  'facebeef-6300-0000-0000-000000000001',
  'aaaaaaaa-5000-0000-0000-000000000001',
  'facebeef-6200-0000-0000-000000000001',
  'facebeef-5000-0000-0000-000000000001',
  (select id from access_grants where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001' and entitlement_id = 'e0000002-5000-0000-0000-000000000002'),
  '11111111-5000-0000-0000-000000000001',
  'high', 'used', 'review'
);

-- SAP READ / Low / Used -> Keep
insert into certification_items (id, tenant_id, campaign_id, agent_id, access_grant_id, reviewer_id, risk_at_review, usage_at_review, recommendation)
values (
  'facebeef-6300-0000-0000-000000000002',
  'aaaaaaaa-5000-0000-0000-000000000001',
  'facebeef-6200-0000-0000-000000000001',
  'facebeef-5000-0000-0000-000000000001',
  'facebeef-6100-0000-0000-000000000001',
  '11111111-5000-0000-0000-000000000001',
  'low', 'used', 'keep'
);

-- S3 READ / Medium / Never -> Remove
insert into certification_items (id, tenant_id, campaign_id, agent_id, access_grant_id, reviewer_id, risk_at_review, usage_at_review, recommendation)
values (
  'facebeef-6300-0000-0000-000000000003',
  'aaaaaaaa-5000-0000-0000-000000000001',
  'facebeef-6200-0000-0000-000000000001',
  'facebeef-5000-0000-0000-000000000001',
  'facebeef-6100-0000-0000-000000000002',
  '11111111-5000-0000-0000-000000000001',
  'medium', 'never', 'remove'
);

-- ============================================================
-- 3. Capture the four decision types the critical acceptance test
--    requires: approve (Keep), revoke (Remove -- with the REAL grant
--    revocation, same effect recordDecision()'s revoke branch produces
--    via revokeAccessGrant()), and prove decisions are immutable.
-- ============================================================
insert into certification_decisions (item_id, decision, justification, decided_by, remediation_id)
values ('facebeef-6300-0000-0000-000000000002', 'approve', 'Low risk, actively used for financial reporting.', '11111111-5000-0000-0000-000000000001', null);
update certification_items set status = 'decided' where id = 'facebeef-6300-0000-0000-000000000002';

insert into certification_decisions (item_id, decision, justification, decided_by, remediation_id)
values ('facebeef-6300-0000-0000-000000000003', 'revoke', 'Never used; remove per recommendation.', '11111111-5000-0000-0000-000000000001', 'facebeef-6100-0000-0000-000000000002');
update certification_items set status = 'decided' where id = 'facebeef-6300-0000-0000-000000000003';
-- The real remediation effect recordDecision()'s revoke branch produces via revokeAccessGrant():
update access_grants set revoked_at = now() where id = 'facebeef-6100-0000-0000-000000000002';

-- Review item is left pending (the reviewer wants a closer look) — status stays 'pending'.

-- ============================================================
-- 4. Act as fixture User A5 (already a member of Tenant A5) — read the
--    worked table back, prove tenant isolation, immutability, and
--    forgery-rejection.
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results
select 'worked_table', json_agg(json_build_object(
  'application', app.name, 'risk', ci.risk_at_review, 'usage', ci.usage_at_review,
  'recommendation', ci.recommendation, 'status', ci.status
) order by app.name)::text
from certification_items ci
join access_grants g on g.id = ci.access_grant_id
join entitlements e on e.id = g.entitlement_id
join applications app on app.id = e.application_id
where ci.campaign_id = 'facebeef-6200-0000-0000-000000000001';

insert into check_results select 's3_grant_revoked', (revoked_at is not null)::text from access_grants where id = 'facebeef-6100-0000-0000-000000000002';

insert into check_results select 'decision_count', count(*)::text from certification_decisions
where item_id in ('facebeef-6300-0000-0000-000000000002', 'facebeef-6300-0000-0000-000000000003');

-- Tenant isolation.
insert into check_results select 'items_visible_to_A', count(*)::text from certification_items where campaign_id = 'facebeef-6200-0000-0000-000000000001';

-- No client insert policy on certification_items or certification_decisions.
do $$
begin
  begin
    insert into certification_items (tenant_id, campaign_id, agent_id, reviewer_id, recommendation)
    values ('aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-6200-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001', 'keep');
    insert into check_results values ('client_item_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_item_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into certification_decisions (item_id, decision, justification, decided_by)
    values ('facebeef-6300-0000-0000-000000000001', 'approve', 'forged', '11111111-5000-0000-0000-000000000001');
    insert into check_results values ('client_decision_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_decision_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- Immutability: no UPDATE policy exists on certification_decisions at all,
-- so a client-role UPDATE affects zero rows (Postgres does not raise an
-- error for an UPDATE that matches no visible rows under RLS — it must be
-- checked via affected row count, not a thrown exception).
do $$
declare rows_updated int;
begin
  update certification_decisions set justification = 'edited' where item_id = 'facebeef-6300-0000-0000-000000000002';
  get diagnostics rows_updated = row_count;
  insert into check_results values ('client_decision_update_rows_affected', rows_updated::text);
end $$;

reset role;

-- ============================================================
-- 5. Act as fixture User B5 (Tenant B5 only) — must see zero.
-- ============================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-5000-0000-0000-000000000002","role":"authenticated"}', true);

insert into check_results select 'items_visible_to_B', count(*)::text from certification_items where campaign_id = 'facebeef-6200-0000-0000-000000000001';
insert into check_results select 'decisions_visible_to_B', count(*)::text from certification_decisions
where item_id in ('facebeef-6300-0000-0000-000000000001', 'facebeef-6300-0000-0000-000000000002', 'facebeef-6300-0000-0000-000000000003');

reset role;
select * from check_results order by check_name;

-- Expected: worked_table -> three rows matching the PRD exactly (S3/medium/
-- never/remove/decided; SAP/low/used/keep/decided; Snowflake/high/used/
-- review/pending); s3_grant_revoked -> true; decision_count -> 2;
-- items_visible_to_A -> 3; client_item_insert / client_decision_insert /
-- client_decision_update -> all CORRECTLY_REJECTED; items_visible_to_B /
-- decisions_visible_to_B -> 0.

-- ============================================================
-- 6. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from certification_campaigns where id = 'facebeef-6200-0000-0000-000000000001';
