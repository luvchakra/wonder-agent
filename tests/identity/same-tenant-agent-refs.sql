-- Identity Agent — IDENTITY-P0-13 live verification of migration 0075.
-- Run via the Supabase MCP execute_sql tool: (1) fixtures, (2) checks as a
-- tenant-B member, (3) cleanup. It proves that a member of tenant B,
-- writing rows in their own tenant (which RLS allows), still cannot point
-- an owner, identity or relationship at tenant A's agent: the composite
-- (agent_id, tenant_id) foreign keys refuse it. The same writes against
-- tenant B's own agent succeed.

-- 1. Fixtures
insert into tenants (id, name, slug) values
  ('aaaaaaaa-7500-0000-0000-000000000001', 'Fixture Tenant A75', 'fixture-tenant-a75-test'),
  ('bbbbbbbb-7500-0000-0000-000000000002', 'Fixture Tenant B75', 'fixture-tenant-b75-test');
insert into auth.users (id, email) values ('22222222-7500-0000-0000-000000000002', 'fixture-user-b75@example.test');
insert into tenant_memberships (tenant_id, user_id, status) values
  ('bbbbbbbb-7500-0000-0000-000000000002', '22222222-7500-0000-0000-000000000002', 'active');
insert into agents (id, tenant_id, agent_name, agent_type) values
  ('a7500000-0000-0000-0000-00000000000a', 'aaaaaaaa-7500-0000-0000-000000000001', 'Agent A75', 'workflow'),
  ('a7500000-0000-0000-0000-00000000000b', 'bbbbbbbb-7500-0000-0000-000000000002', 'Agent B75', 'workflow'),
  ('a7500000-0000-0000-0000-00000000000c', 'bbbbbbbb-7500-0000-0000-000000000002', 'Agent B75 two', 'workflow');

-- 2. Checks as user B75
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-7500-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  insert into agent_owners (tenant_id, agent_id, owner_type, user_id) values ('bbbbbbbb-7500-0000-0000-000000000002', 'a7500000-0000-0000-0000-00000000000a', 'business_owner', '22222222-7500-0000-0000-000000000002');
  insert into check_results values ('owner on other tenant''s agent (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('owner on other tenant''s agent (expect denied)', 'denied: ' || sqlstate);
end $$;
do $$ begin
  insert into agent_identities (tenant_id, agent_id, identity_type, external_reference, source_system) values ('bbbbbbbb-7500-0000-0000-000000000002', 'a7500000-0000-0000-0000-00000000000a', 'api_key', 'forged', 'manual');
  insert into check_results values ('identity on other tenant''s agent (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('identity on other tenant''s agent (expect denied)', 'denied: ' || sqlstate);
end $$;
do $$ begin
  insert into agent_relationships (tenant_id, agent_id, related_agent_id, relationship_type) values ('bbbbbbbb-7500-0000-0000-000000000002', 'a7500000-0000-0000-0000-00000000000b', 'a7500000-0000-0000-0000-00000000000a', 'delegates_to');
  insert into check_results values ('relationship to other tenant''s agent (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('relationship to other tenant''s agent (expect denied)', 'denied: ' || sqlstate);
end $$;
with i as (insert into agent_owners (tenant_id, agent_id, owner_type, user_id) values ('bbbbbbbb-7500-0000-0000-000000000002', 'a7500000-0000-0000-0000-00000000000b', 'business_owner', '22222222-7500-0000-0000-000000000002') returning 1)
insert into check_results select 'owner on own agent (expect 1)', count(*)::text from i;
with i as (insert into agent_relationships (tenant_id, agent_id, related_agent_id, relationship_type) values ('bbbbbbbb-7500-0000-0000-000000000002', 'a7500000-0000-0000-0000-00000000000b', 'a7500000-0000-0000-0000-00000000000c', 'delegates_to') returning 1)
insert into check_results select 'relationship between own agents (expect 1)', count(*)::text from i;
reset role;
insert into check_results select 'rows referencing A75 agent (expect 0)',
  ((select count(*) from agent_owners where agent_id = 'a7500000-0000-0000-0000-00000000000a')
 + (select count(*) from agent_identities where agent_id = 'a7500000-0000-0000-0000-00000000000a')
 + (select count(*) from agent_relationships where related_agent_id = 'a7500000-0000-0000-0000-00000000000a'))::text;
select * from check_results;

-- 3. Cleanup
-- delete from agents where tenant_id in ('aaaaaaaa-7500-0000-0000-000000000001', 'bbbbbbbb-7500-0000-0000-000000000002');
-- delete from tenant_memberships where user_id = '22222222-7500-0000-0000-000000000002';
-- delete from auth.users where id = '22222222-7500-0000-0000-000000000002';
-- delete from tenants where id in ('aaaaaaaa-7500-0000-0000-000000000001', 'bbbbbbbb-7500-0000-0000-000000000002');
