-- Identity Agent — IDENTITY-P0-15/16 live verification of migrations
-- 0077/0078 (identities, identity_attribute_definitions,
-- identity_relationships and the agent/membership sync triggers). Run via
-- the Supabase MCP execute_sql tool as one statement batch: fixtures,
-- checks, results, cleanup.
--
-- X is a member of tenant A only: proves the negative (#4, §14): X sees,
-- writes and changes nothing of tenant B's.
-- Y is a member of both, so RLS admits Y's writes in either: only the
-- same-tenant composite foreign keys stop a tenant-A row from pointing at
-- a tenant-B identity.
--
-- Run 2026-09-26 against the dev project, after 0078: 18/18 as expected.
-- RLS denials were 42501; cross-tenant references were 23503; an AI_AGENT
-- row with no agent was 23514; a duplicate current relationship was 23505.
-- The agent mirror and the membership status sync worked for a member
-- write. No forged row existed afterwards, and the cleanup left no
-- fixtures.

-- 1. Fixtures (as the migration owner)
insert into tenants (id, name, slug) values
  ('aaaaaaaa-7700-0000-0000-000000000001', 'Fixture Tenant A77', 'fixture-tenant-a77-test'),
  ('bbbbbbbb-7700-0000-0000-000000000002', 'Fixture Tenant B77', 'fixture-tenant-b77-test');
insert into auth.users (id, email) values
  ('11111111-7700-0000-0000-000000000001', 'fixture-x77@example.test'),
  ('22222222-7700-0000-0000-000000000002', 'fixture-y77@example.test');
insert into users (id, email) values
  ('11111111-7700-0000-0000-000000000001', 'fixture-x77@example.test'),
  ('22222222-7700-0000-0000-000000000002', 'fixture-y77@example.test')
on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-7700-0000-0000-000000000001', '11111111-7700-0000-0000-000000000001', 'active'),
  ('aaaaaaaa-7700-0000-0000-000000000001', '22222222-7700-0000-0000-000000000002', 'active'),
  ('bbbbbbbb-7700-0000-0000-000000000002', '22222222-7700-0000-0000-000000000002', 'active');
insert into identities (id, tenant_id, identity_type, display_name) values
  ('b7700000-0000-0000-0000-0000000000b1', 'bbbbbbbb-7700-0000-0000-000000000002', 'SERVICE_ACCOUNT', 'svc-b77'),
  ('a7700000-0000-0000-0000-0000000000a1', 'aaaaaaaa-7700-0000-0000-000000000001', 'SERVICE_ACCOUNT', 'svc-a77');
insert into identity_attribute_definitions (tenant_id, name, display_name, data_type) values
  ('bbbbbbbb-7700-0000-0000-000000000002', 'cost_center', 'Cost center', 'string');

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;

-- 2a. Checks as X (tenant A only)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-7700-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: membership made a HUMAN identity in A (expect 1)', count(*)::text
  from identities where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' and user_id = '11111111-7700-0000-0000-000000000001' and identity_type = 'HUMAN';
insert into check_results select 'X: tenant B identities visible (expect 0)', count(*)::text from identities where tenant_id = 'bbbbbbbb-7700-0000-0000-000000000002';
insert into check_results select 'X: tenant B attribute definitions visible (expect 0)', count(*)::text from identity_attribute_definitions where tenant_id = 'bbbbbbbb-7700-0000-0000-000000000002';
do $$ begin
  insert into identities (tenant_id, identity_type, display_name) values ('bbbbbbbb-7700-0000-0000-000000000002', 'HUMAN', 'forged');
  insert into check_results values ('X: insert identity into B (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert identity into B (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into identity_attribute_definitions (tenant_id, name, display_name, data_type) values ('bbbbbbbb-7700-0000-0000-000000000002', 'forged', 'forged', 'string');
  insert into check_results values ('X: define attribute in B (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: define attribute in B (expect denied)', 'denied: ' || sqlstate); end $$;
with u as (update identities set display_name = 'forged' where id = 'b7700000-0000-0000-0000-0000000000b1' returning 1)
insert into check_results select 'X: rename B identity (expect 0)', count(*)::text from u;
with d as (delete from identities where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' returning 1)
insert into check_results select 'X: delete own-tenant identities, no delete policy (expect 0)', count(*)::text from d;

-- 2b. Checks as Y (both tenants)
select set_config('request.jwt.claims', '{"sub":"22222222-7700-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  insert into identities (tenant_id, identity_type, display_name, owner_identity_id) values ('aaaaaaaa-7700-0000-0000-000000000001', 'MACHINE', 'forged', 'b7700000-0000-0000-0000-0000000000b1');
  insert into check_results values ('Y: A identity owned by B identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('Y: A identity owned by B identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into identity_relationships (tenant_id, source_identity_id, target_identity_id, relationship_type) values ('aaaaaaaa-7700-0000-0000-000000000001', 'a7700000-0000-0000-0000-0000000000a1', 'b7700000-0000-0000-0000-0000000000b1', 'owns');
  insert into check_results values ('Y: A relationship to B identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('Y: A relationship to B identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into identities (tenant_id, identity_type, display_name) values ('aaaaaaaa-7700-0000-0000-000000000001', 'AI_AGENT', 'forged');
  insert into check_results values ('Y: AI_AGENT identity with no agent (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('Y: AI_AGENT identity with no agent (expect denied)', 'denied: ' || sqlstate); end $$;
-- The mirror follows agents written by a member (trigger after 0078's revoke).
insert into agents (id, tenant_id, agent_name, agent_type) values ('a7700000-0000-0000-0000-00000000a9e1', 'aaaaaaaa-7700-0000-0000-000000000001', 'Agent A77', 'workflow');
insert into check_results select 'Y: new agent mirrored as AI_AGENT identity, pending (expect 1)', count(*)::text
  from identities where agent_id = 'a7700000-0000-0000-0000-00000000a9e1' and identity_type = 'AI_AGENT' and status = 'pending';
update agents set lifecycle_state = 'SUSPENDED', display_name = 'Agent A77 renamed' where id = 'a7700000-0000-0000-0000-00000000a9e1';
insert into check_results select 'Y: agent suspend + rename followed (expect 1)', count(*)::text
  from identities where agent_id = 'a7700000-0000-0000-0000-00000000a9e1' and status = 'disabled' and display_name = 'Agent A77 renamed';
with i as (insert into identity_relationships (tenant_id, source_identity_id, target_identity_id, relationship_type)
  select 'aaaaaaaa-7700-0000-0000-000000000001', id, 'a7700000-0000-0000-0000-0000000000a1', 'owns' from identities where user_id = '22222222-7700-0000-0000-000000000002' and tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' returning 1)
insert into check_results select 'Y: same-tenant relationship (expect 1)', count(*)::text from i;
do $$ begin
  insert into identity_relationships (tenant_id, source_identity_id, target_identity_id, relationship_type)
    select 'aaaaaaaa-7700-0000-0000-000000000001', id, 'a7700000-0000-0000-0000-0000000000a1', 'owns' from identities where user_id = '22222222-7700-0000-0000-000000000002' and tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001';
  insert into check_results values ('Y: duplicate current relationship (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('Y: duplicate current relationship (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;

-- 2c. Membership changes (as the owner, like an admin action would)
update tenant_memberships set status = 'suspended' where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' and user_id = '11111111-7700-0000-0000-000000000001';
insert into check_results select 'membership suspended -> identity inactive (expect inactive)', status
  from identities where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' and user_id = '11111111-7700-0000-0000-000000000001';
update tenant_memberships set status = 'active' where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' and user_id = '11111111-7700-0000-0000-000000000001';
insert into check_results select 'membership reinstated -> identity active (expect active)', status
  from identities where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' and user_id = '11111111-7700-0000-0000-000000000001';
delete from tenant_memberships where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' and user_id = '11111111-7700-0000-0000-000000000001';
insert into check_results select 'membership deleted -> identity kept, inactive (expect inactive)', status
  from identities where tenant_id = 'aaaaaaaa-7700-0000-0000-000000000001' and user_id = '11111111-7700-0000-0000-000000000001';
insert into check_results select 'forged rows that exist (expect 0)', (select count(*) from identities where display_name = 'forged')::text;

select * from check_results;

-- 3. Cleanup (cascades remove identities, relationships and definitions)
delete from agents where tenant_id in ('aaaaaaaa-7700-0000-0000-000000000001', 'bbbbbbbb-7700-0000-0000-000000000002');
delete from tenant_memberships where user_id in ('11111111-7700-0000-0000-000000000001', '22222222-7700-0000-0000-000000000002');
delete from tenants where id in ('aaaaaaaa-7700-0000-0000-000000000001', 'bbbbbbbb-7700-0000-0000-000000000002');
delete from auth.users where id in ('11111111-7700-0000-0000-000000000001', '22222222-7700-0000-0000-000000000002');
