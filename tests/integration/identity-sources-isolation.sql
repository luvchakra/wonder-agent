-- Integration Agent — INTEGRATION-P0-08/09 live verification of migrations
-- 0080/0081 (identity_sources, identity_reconciliation_runs,
-- identity_source_links, pending_identity_correlations). Run via the
-- Supabase MCP execute_sql tool: fixtures + checks + results in one call,
-- cleanup in a second.
--
-- X is a member of tenant A only (the negative: sees and writes nothing of
-- B's). Y is a member of both, so only the same-tenant composite foreign
-- keys stop an A row pointing at B's source, integration or identity.
-- Runs, links and pending matches have no client write policy at all:
-- only the service-role worker writes them.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-8100-0000-0000-000000000001', 'Fixture Tenant A81', 'fixture-tenant-a81-test'),
  ('bbbbbbbb-8100-0000-0000-000000000002', 'Fixture Tenant B81', 'fixture-tenant-b81-test');
insert into auth.users (id, email) values
  ('11111111-8100-0000-0000-000000000001', 'fixture-x81@example.test'),
  ('22222222-8100-0000-0000-000000000002', 'fixture-y81@example.test');
insert into users (id, email) values
  ('11111111-8100-0000-0000-000000000001', 'fixture-x81@example.test'),
  ('22222222-8100-0000-0000-000000000002', 'fixture-y81@example.test')
on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-8100-0000-0000-000000000001', '11111111-8100-0000-0000-000000000001', 'active'),
  ('aaaaaaaa-8100-0000-0000-000000000001', '22222222-8100-0000-0000-000000000002', 'active'),
  ('bbbbbbbb-8100-0000-0000-000000000002', '22222222-8100-0000-0000-000000000002', 'active');
insert into integrations (id, tenant_id, integration_type_id, name) values
  ('b8100000-0000-0000-0000-0000000000b9', 'bbbbbbbb-8100-0000-0000-000000000002', 'generic_rest', 'Int B81');
insert into identity_sources (id, tenant_id, name, template) values
  ('a8100000-0000-0000-0000-0000000000a5', 'aaaaaaaa-8100-0000-0000-000000000001', 'Source A81', 'csv'),
  ('b8100000-0000-0000-0000-0000000000b5', 'bbbbbbbb-8100-0000-0000-000000000002', 'Source B81', 'csv');
insert into identities (id, tenant_id, identity_type, display_name) values
  ('b8100000-0000-0000-0000-0000000000b1', 'bbbbbbbb-8100-0000-0000-000000000002', 'HUMAN', 'Person B81');
insert into identity_reconciliation_runs (id, tenant_id, source_id, trigger) values
  ('b8100000-0000-0000-0000-0000000000b7', 'bbbbbbbb-8100-0000-0000-000000000002', 'b8100000-0000-0000-0000-0000000000b5', 'upload');
insert into identity_source_links (tenant_id, source_id, external_id, identity_id) values
  ('bbbbbbbb-8100-0000-0000-000000000002', 'b8100000-0000-0000-0000-0000000000b5', 'B-1', 'b8100000-0000-0000-0000-0000000000b1');
insert into pending_identity_correlations (tenant_id, source_id, external_id, reason) values
  ('bbbbbbbb-8100-0000-0000-000000000002', 'b8100000-0000-0000-0000-0000000000b5', 'B-2', 'fixture');

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-8100-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: B sources/runs/links/pending visible (expect 0)', (
  (select count(*) from identity_sources where tenant_id = 'bbbbbbbb-8100-0000-0000-000000000002')
 + (select count(*) from identity_reconciliation_runs where tenant_id = 'bbbbbbbb-8100-0000-0000-000000000002')
 + (select count(*) from identity_source_links where tenant_id = 'bbbbbbbb-8100-0000-0000-000000000002')
 + (select count(*) from pending_identity_correlations where tenant_id = 'bbbbbbbb-8100-0000-0000-000000000002'))::text;
do $$ begin
  insert into identity_sources (tenant_id, name, template) values ('bbbbbbbb-8100-0000-0000-000000000002', 'forged', 'csv');
  insert into check_results values ('X: create source in B (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: create source in B (expect denied)', 'denied: ' || sqlstate); end $$;
with u as (update identity_sources set priority = 1 where id = 'b8100000-0000-0000-0000-0000000000b5' returning 1)
insert into check_results select 'X: change B source (expect 0)', count(*)::text from u;
do $$ begin
  insert into identity_reconciliation_runs (tenant_id, source_id, trigger) values ('aaaaaaaa-8100-0000-0000-000000000001', 'a8100000-0000-0000-0000-0000000000a5', 'upload');
  insert into check_results values ('X: write a run in own tenant, no client policy (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: write a run in own tenant, no client policy (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into pending_identity_correlations (tenant_id, source_id, external_id, reason) values ('aaaaaaaa-8100-0000-0000-000000000001', 'a8100000-0000-0000-0000-0000000000a5', 'x', 'forged');
  insert into check_results values ('X: write a pending match, no client policy (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: write a pending match, no client policy (expect denied)', 'denied: ' || sqlstate); end $$;
with u as (update pending_identity_correlations set status = 'dismissed' where tenant_id = 'bbbbbbbb-8100-0000-0000-000000000002' returning 1)
insert into check_results select 'X: dismiss B pending match (expect 0)', count(*)::text from u;
select set_config('request.jwt.claims', '{"sub":"22222222-8100-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  insert into identity_sources (tenant_id, name, template, integration_id) values ('aaaaaaaa-8100-0000-0000-000000000001', 'forged', 'integration', 'b8100000-0000-0000-0000-0000000000b9');
  insert into check_results values ('Y: A source reading B integration (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('Y: A source reading B integration (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;
do $$ begin
  insert into identity_source_links (tenant_id, source_id, external_id, identity_id) values ('aaaaaaaa-8100-0000-0000-000000000001', 'a8100000-0000-0000-0000-0000000000a5', 'A-1', 'b8100000-0000-0000-0000-0000000000b1');
  insert into check_results values ('service role: A link to B identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('service role: A link to B identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into identity_reconciliation_runs (tenant_id, source_id, trigger) values ('aaaaaaaa-8100-0000-0000-000000000001', 'b8100000-0000-0000-0000-0000000000b5', 'upload');
  insert into check_results values ('service role: A run of B source (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('service role: A run of B source (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into pending_identity_correlations (tenant_id, source_id, external_id, reason, resolved_identity_id) values ('aaaaaaaa-8100-0000-0000-000000000001', 'a8100000-0000-0000-0000-0000000000a5', 'A-2', 'forged', 'b8100000-0000-0000-0000-0000000000b1');
  insert into check_results values ('service role: A match resolved to B identity (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('service role: A match resolved to B identity (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into pending_identity_correlations (tenant_id, source_id, external_id, reason) values ('bbbbbbbb-8100-0000-0000-000000000002', 'b8100000-0000-0000-0000-0000000000b5', 'B-2', 'second open row');
  insert into check_results values ('second open match for one record (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('second open match for one record (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update identities set field_provenance = '[]'::jsonb where id = 'b8100000-0000-0000-0000-0000000000b1';
  insert into check_results values ('provenance must be an object (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('provenance must be an object (expect denied)', 'denied: ' || sqlstate); end $$;
insert into check_results select 'forged rows that exist (expect 0)', (
  (select count(*) from identity_sources where name = 'forged')
 + (select count(*) from pending_identity_correlations where reason in ('forged', 'second open row')))::text;
select * from check_results;

-- Cleanup (second call):
-- delete from tenant_memberships where user_id in ('11111111-8100-0000-0000-000000000001', '22222222-8100-0000-0000-000000000002');
-- delete from tenants where id in ('aaaaaaaa-8100-0000-0000-000000000001', 'bbbbbbbb-8100-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-8100-0000-0000-000000000001', '22222222-8100-0000-0000-000000000002');
