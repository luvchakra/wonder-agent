-- Integration Agent — live verification of migration 0118 (INTEGRATION-P0-19:
-- the steps after a sync, integration_sync_jobs.pipeline / pipeline_status).
--
-- Proves: a member can queue a job but never one that claims a chain ran
-- (pipeline or pipeline_status other than the defaults), cannot rewrite a
-- job's chain, and another organization's chain stays invisible; the
-- status check refuses an unknown value.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1180-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1180-0000-0000-000000000002';
  ca constant uuid := 'aaaaaaaa-1180-0000-0000-0000000000c1';
  cb constant uuid := 'bbbbbbbb-1180-0000-0000-0000000000c1';
  ja constant uuid := 'aaaaaaaa-1180-0000-0000-0000000000a1';
  n integer;
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A118', 'fixture-tenant-a118-test'),
  (tb, 'Fixture Tenant B118', 'fixture-tenant-b118-test');
insert into auth.users (id, email) values
  ('11111111-1180-0000-0000-000000000001', 'fixture-a118@example.test'),
  ('11111111-1180-0000-0000-000000000002', 'fixture-b118@example.test');
insert into users (id, email) values
  ('11111111-1180-0000-0000-000000000001', 'fixture-a118@example.test'),
  ('11111111-1180-0000-0000-000000000002', 'fixture-b118@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  (ta, '11111111-1180-0000-0000-000000000001', 'active'),
  (tb, '11111111-1180-0000-0000-000000000002', 'active');
insert into integrations (id, tenant_id, integration_type_id, name) values
  (ca, ta, 'connector', 'Fixture A HR'),
  (cb, tb, 'connector', 'Fixture B HR');
insert into integration_sync_jobs (id, tenant_id, integration_id, trigger, status, started_at, pipeline, pipeline_status) values
  (ja, ta, ca, 'manual', 'succeeded', now(), '[{"kind":"accounts","targetId":"x","name":"SAP","status":"succeeded"}]', 'succeeded');

create temporary table check_results (check_name text, result text);

begin
  update integration_sync_jobs set pipeline_status = 'done' where id = ja;
  insert into check_results values ('unknown pipeline_status (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('unknown pipeline_status (expect denied 23514)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

perform set_config('request.jwt.claims', '{"sub":"11111111-1180-0000-0000-000000000001","role":"authenticated"}', true);
begin
  insert into integration_sync_jobs (tenant_id, integration_id, trigger, pipeline_status) values (ta, ca, 'manual', 'succeeded');
  insert into check_results values ('member creates a job claiming a chain (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member creates a job claiming a chain (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into integration_sync_jobs (tenant_id, integration_id, trigger, pipeline) values (ta, ca, 'manual', '[{"status":"succeeded"}]');
  insert into check_results values ('member creates a job with steps (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member creates a job with steps (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into integration_sync_jobs (tenant_id, integration_id, trigger) values (ta, ca, 'manual');
  insert into check_results values ('member queues a plain job (expect allowed)', 'allowed');
exception when others then insert into check_results values ('member queues a plain job (expect allowed)', 'denied: ' || sqlstate); end;
begin
  update integration_sync_jobs set pipeline_status = 'failed' where id = ja;
  get diagnostics n = row_count;
  insert into check_results values ('member rewrites the chain (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member rewrites the chain (expect 0 rows)', 'denied: ' || sqlstate); end;
insert into check_results select 'member of A reads A chain (expect succeeded)', pipeline_status from integration_sync_jobs where id = ja;

perform set_config('request.jwt.claims', '{"sub":"11111111-1180-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A jobs (expect 0)', count(*)::text from integration_sync_jobs where tenant_id = ta;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
