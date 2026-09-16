-- Compliance Agent — COMPLIANCE-P0-08 tenant-isolation proof
-- (governance_attestations, migration 0055). Reuses the FinanceBot
-- fixture already present from Runtime/Risk/Compliance's own tests
-- (Tenant A5 = aaaaaaaa-5000-0000-0000-000000000001, agent
-- facebeef-5000-0000-0000-000000000001, User A5 =
-- 11111111-5000-0000-0000-000000000001; Tenant B5's User B5 =
-- 22222222-5000-0000-0000-000000000002) rather than a new fixture.
--
-- Run via the Supabase MCP execute_sql tool against a DEV project only.

insert into governance_attestations (id, tenant_id, agent_id, policy_requirement, checklist, approver_id, decision, comments, evidence_references)
values (
  'facebeef-6400-0000-0000-000000000001',
  'aaaaaaaa-5000-0000-0000-000000000001',
  'facebeef-5000-0000-0000-000000000001',
  'Financial data handling',
  '[{"item":"Reviewed approved data scope","checked":true}]'::jsonb,
  '11111111-5000-0000-0000-000000000001',
  'attested',
  'Looks good',
  '[]'::jsonb
);

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

-- Act as fixture User A5 (Tenant A5 member) — must see the row.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results select 'attestations_visible_to_A', count(*)::text from governance_attestations where id = 'facebeef-6400-0000-0000-000000000001';

-- No client insert policy on governance_attestations at all (migration
-- 0055) — a client-role insert must be rejected.
do $$
begin
  begin
    insert into governance_attestations (tenant_id, agent_id, policy_requirement, checklist, approver_id, decision)
    values ('aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-5000-0000-0000-000000000001', 'Forged', '[]'::jsonb, '11111111-5000-0000-0000-000000000001', 'attested');
    insert into check_results values ('client_attestation_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_attestation_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- Immutability: no UPDATE policy exists on governance_attestations at
-- all, so a client-role UPDATE affects zero rows.
do $$
declare rows_updated int;
begin
  update governance_attestations set comments = 'edited' where id = 'facebeef-6400-0000-0000-000000000001';
  get diagnostics rows_updated = row_count;
  insert into check_results values ('client_attestation_update_rows_affected', rows_updated::text);
end $$;

reset role;

-- Act as fixture User B5 (Tenant B5 only) — must see zero.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-5000-0000-0000-000000000002","role":"authenticated"}', true);

insert into check_results select 'attestations_visible_to_B', count(*)::text from governance_attestations where id = 'facebeef-6400-0000-0000-000000000001';

reset role;
select * from check_results order by check_name;

-- Expected: attestations_visible_to_A -> 1; client_attestation_insert ->
-- CORRECTLY_REJECTED; client_attestation_update_rows_affected -> 0;
-- attestations_visible_to_B -> 0.

-- ============================================================
-- Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from governance_attestations where id = 'facebeef-6400-0000-0000-000000000001';
