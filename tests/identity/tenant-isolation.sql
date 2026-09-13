-- Identity Agent — tenant isolation proof for agents/agent_owners/
-- agent_identities/agent_contracts/agent_lifecycle_events.
--
-- Same methodology as tests/foundation/tenant-isolation.sql (see that file
-- for why: this sandbox's plain network egress cannot reach Supabase
-- directly, so this runs via the Supabase MCP execute_sql tool against a
-- DEV project only, simulating an authenticated JWT via
-- set_config('request.jwt.claims', ...) + set role authenticated/anon).
--
-- Run in three separate execute_sql calls: fixtures, then "as User A2",
-- then cleanup.

-- ============================================================
-- 1. Fixtures
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'Fixture Tenant A2', 'fixture-tenant-a2-test'),
  ('bbbbbbbb-1000-0000-0000-000000000002', 'Fixture Tenant B2', 'fixture-tenant-b2-test');

insert into tenant_settings (tenant_id) values
  ('aaaaaaaa-1000-0000-0000-000000000001'),
  ('bbbbbbbb-1000-0000-0000-000000000002');

insert into auth.users (id, email) values
  ('11111111-1000-0000-0000-000000000001', 'fixture-user-a2@example.test'),
  ('22222222-1000-0000-0000-000000000002', 'fixture-user-b2@example.test');

insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-1000-0000-0000-000000000002', '22222222-1000-0000-0000-000000000002', 'active');

insert into agents (id, tenant_id, agent_name, agent_type) values
  ('aaaa0001-0000-0000-0000-000000000001', 'aaaaaaaa-1000-0000-0000-000000000001', 'FixtureBot A', 'automation'),
  ('bbbb0002-0000-0000-0000-000000000002', 'bbbbbbbb-1000-0000-0000-000000000002', 'FixtureBot B', 'automation');

insert into agent_owners (tenant_id, agent_id, owner_type, user_id) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', 'business_owner', '11111111-1000-0000-0000-000000000001'),
  ('bbbbbbbb-1000-0000-0000-000000000002', 'bbbb0002-0000-0000-0000-000000000002', 'business_owner', '22222222-1000-0000-0000-000000000002');

insert into agent_identities (tenant_id, agent_id, identity_type, external_reference, source_system) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', 'service_account', 'svc-a', 'manual'),
  ('bbbbbbbb-1000-0000-0000-000000000002', 'bbbb0002-0000-0000-0000-000000000002', 'service_account', 'svc-b', 'manual');

insert into agent_contracts (tenant_id, agent_id, purpose, status, version) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', 'Fixture purpose A', 'active', 1),
  ('bbbbbbbb-1000-0000-0000-000000000002', 'bbbb0002-0000-0000-0000-000000000002', 'Fixture purpose B', 'active', 1);

insert into agent_lifecycle_events (tenant_id, agent_id, to_state, reason, actor_type) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', 'DISCOVERED', 'fixture seed', 'system'),
  ('bbbbbbbb-1000-0000-0000-000000000002', 'bbbb0002-0000-0000-0000-000000000002', 'DISCOVERED', 'fixture seed', 'system');

-- ============================================================
-- 2. Act as fixture User A2 (member of Tenant A2 only).
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1000-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results select 'agents_visible_to_A', coalesce(array_agg(agent_name order by agent_name)::text, '{}') from agents;
insert into check_results select 'agent_owners_visible_to_A', coalesce(array_agg(tenant_id order by tenant_id)::text, '{}') from agent_owners;
insert into check_results select 'agent_identities_visible_to_A', coalesce(array_agg(external_reference order by external_reference)::text, '{}') from agent_identities;
insert into check_results select 'agent_contracts_visible_to_A', coalesce(array_agg(purpose order by purpose)::text, '{}') from agent_contracts;
insert into check_results select 'agent_lifecycle_events_visible_to_A', coalesce(array_agg(reason order by reason)::text, '{}') from agent_lifecycle_events;
insert into check_results select 'agent_B_by_pk_row_count', count(*)::text from agents where id = 'bbbb0002-0000-0000-0000-000000000002';

do $$
declare rows_updated int;
begin
  update agents set agent_name = 'HACKED' where id = 'bbbb0002-0000-0000-0000-000000000002';
  get diagnostics rows_updated = row_count;
  insert into check_results values ('update_agent_B_attempt_rows_affected', rows_updated::text);
end $$;

do $$
begin
  begin
    insert into agent_owners (tenant_id, agent_id, owner_type, user_id)
    values ('bbbbbbbb-1000-0000-0000-000000000002', 'bbbb0002-0000-0000-0000-000000000002', 'technical_owner', '11111111-1000-0000-0000-000000000001');
    insert into check_results values ('cross_tenant_owner_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('cross_tenant_owner_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- agent_lifecycle_events and agent_contracts have NO client insert policy at
-- all (see migrations 0015/0016) — these must fail even for the OWNING
-- tenant's own row, since only transitionAgentLifecycle()/
-- createContractVersion() (service-role) may write them.
do $$
begin
  begin
    insert into agent_lifecycle_events (tenant_id, agent_id, to_state, reason, actor_type)
    values ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', 'REGISTERED', 'forged', 'user');
    insert into check_results values ('client_lifecycle_event_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_lifecycle_event_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into agent_contracts (tenant_id, agent_id, purpose, status, version)
    values ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', 'forged', 'active', 99);
    insert into check_results values ('client_contract_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_contract_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

reset role;
select * from check_results order by check_name;

-- Expected results (observed on first run — see the Identity Agent audit
-- log): every *_visible_to_A check contains only Tenant A2's own row;
-- agent_B_by_pk_row_count = 0; update_agent_B_attempt_rows_affected = 0;
-- cross_tenant_owner_insert / client_lifecycle_event_insert /
-- client_contract_insert all CORRECTLY_REJECTED (the latter two rejected
-- even though the row claimed Tenant A2's own tenant_id, because those two
-- tables grant no client insert policy at all).

-- ============================================================
-- 3. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from tenants where id in ('aaaaaaaa-1000-0000-0000-000000000001', 'bbbbbbbb-1000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-1000-0000-0000-000000000001', '22222222-1000-0000-0000-000000000002');
