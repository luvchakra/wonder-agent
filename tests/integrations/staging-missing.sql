-- Integration Agent — live verification of migration 0117 (INTEGRATION-P0-18:
-- staging reflects the source; stage_mark_missing()).
--
-- Proves: a full run marks only the objects of its own kind and connection
-- that it did not see, never deletes them, and never marks an object a newer
-- run has seen; objects never tagged with a run are candidates; the
-- mass-missing guard holds a kind (nothing marked) above the threshold once
-- the population is large enough, and a null threshold applies a held kind;
-- a job of another organization, or one not yet started, is refused; no
-- client can call the function or create a job that claims a missing result;
-- another organization's staged objects stay invisible.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool (no delete).

do $t$
declare
  r record;
  ta constant uuid := 'aaaaaaaa-1170-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1170-0000-0000-000000000002';
  ca constant uuid := 'aaaaaaaa-1170-0000-0000-0000000000c1';
  ca2 constant uuid := 'aaaaaaaa-1170-0000-0000-0000000000c2';
  cb constant uuid := 'bbbbbbbb-1170-0000-0000-0000000000c1';
  j1 constant uuid := 'aaaaaaaa-1170-0000-0000-0000000000a1';
  j2 constant uuid := 'aaaaaaaa-1170-0000-0000-0000000000a2';
  j3 constant uuid := 'aaaaaaaa-1170-0000-0000-0000000000a3';
  jq constant uuid := 'aaaaaaaa-1170-0000-0000-0000000000a4';
  jb constant uuid := 'bbbbbbbb-1170-0000-0000-0000000000b1';
begin
insert into tenants (id, name, slug) values
  (ta, 'Fixture Tenant A117', 'fixture-tenant-a117-test'),
  (tb, 'Fixture Tenant B117', 'fixture-tenant-b117-test');
insert into auth.users (id, email) values
  ('11111111-1170-0000-0000-000000000001', 'fixture-a117@example.test'),
  ('11111111-1170-0000-0000-000000000002', 'fixture-b117@example.test');
insert into users (id, email) values
  ('11111111-1170-0000-0000-000000000001', 'fixture-a117@example.test'),
  ('11111111-1170-0000-0000-000000000002', 'fixture-b117@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values
  (ta, '11111111-1170-0000-0000-000000000001', 'active'),
  (tb, '11111111-1170-0000-0000-000000000002', 'active');

insert into integrations (id, tenant_id, integration_type_id, name) values
  (ca, ta, 'connector', 'Fixture A HR'),
  (ca2, ta, 'connector', 'Fixture A other'),
  (cb, tb, 'connector', 'Fixture B HR');

-- j1 then j2 (a full run) then j3 (a newer run that overlaps j2); jq never started.
insert into integration_sync_jobs (id, tenant_id, integration_id, trigger, status, started_at) values
  (j1, ta, ca, 'manual', 'succeeded', now() - interval '3 hours'),
  (j2, ta, ca, 'manual', 'running', now() - interval '2 hours'),
  (j3, ta, ca, 'manual', 'running', now() - interval '1 hour'),
  (jb, tb, cb, 'manual', 'succeeded', now() - interval '3 hours');
insert into integration_sync_jobs (id, tenant_id, integration_id, trigger) values (jq, ta, ca, 'manual');

-- Accounts on connection A: a1, a2 re-seen by j2; a3 last seen by j1 (gone);
-- a4 seen by the newer j3; a5 never tagged with a run.
insert into integration_objects (tenant_id, integration_id, object_type, external_id, raw, normalized, sync_job_id) values
  (ta, ca, 'account', 'a1', '{}', '{}', j2),
  (ta, ca, 'account', 'a2', '{}', '{}', j2),
  (ta, ca, 'account', 'a3', '{}', '{}', j1),
  (ta, ca, 'account', 'a4', '{}', '{}', j3),
  (ta, ca, 'account', 'a5', '{}', '{}', null),
  -- another kind and another connection, both last seen by j1
  (ta, ca, 'entitlement', 'e1', '{}', '{}', j1),
  (ta, ca2, 'account', 'x1', '{}', '{}', j1),
  -- another organization
  (tb, cb, 'account', 'b1', '{}', '{}', jb);
-- Identities on connection A: 25 present, j2 saw only 10 of them.
insert into integration_objects (tenant_id, integration_id, object_type, external_id, raw, normalized, sync_job_id)
  select ta, ca, 'identity', 'i' || g, '{}', '{}', case when g <= 10 then j2 else j1 end from generate_series(1, 25) g;
-- Entitlements: 5 present (below the population of 20), j2 saw one.
insert into integration_objects (tenant_id, integration_id, object_type, external_id, raw, normalized, sync_job_id)
  select ta, ca, 'entitlement', 'e' || g, '{}', '{}', case when g = 2 then j2 else j1 end from generate_series(2, 5) g;

create temporary table check_results (check_name text, result text);

-- 1. Accounts: only a3 and a5 are gone; a4 was seen by a newer run.
select * into r from stage_mark_missing(ta, j2, 'account', 20);
insert into check_results values ('accounts: candidates/present/marked/held (expect 2/5/2/false)',
  r.candidates || '/' || r.present_before || '/' || r.marked || '/' || r.held);
insert into check_results select 'accounts marked (expect a3,a5)', string_agg(external_id, ',' order by external_id)
  from integration_objects where integration_id = ca and object_type = 'account' and missing_at_source_at is not null;
insert into check_results select 'nothing deleted (expect 5 accounts)', count(*)::text from integration_objects where integration_id = ca and object_type = 'account';
insert into check_results select 'other connection untouched (expect 0)', count(*)::text from integration_objects where integration_id = ca2 and missing_at_source_at is not null;
insert into check_results select 'other organization untouched (expect 0)', count(*)::text from integration_objects where tenant_id = tb and missing_at_source_at is not null;

-- 2. Marking again finds nothing new (already-missing objects are not candidates).
select * into r from stage_mark_missing(ta, j2, 'account', 20);
insert into check_results values ('accounts again: candidates/marked (expect 0/0)', r.candidates || '/' || r.marked);

-- 3. Identities: 15 of 25 gone is above 20% -> held, nothing marked.
select * into r from stage_mark_missing(ta, j2, 'identity', 20);
insert into check_results values ('identities guarded: candidates/present/marked/held (expect 15/25/0/true)',
  r.candidates || '/' || r.present_before || '/' || r.marked || '/' || r.held);
insert into check_results select 'held kind unmarked (expect 0)', count(*)::text from integration_objects where integration_id = ca and object_type = 'identity' and missing_at_source_at is not null;
-- An approval applies it: a null threshold skips the guard.
select * into r from stage_mark_missing(ta, j2, 'identity', null);
insert into check_results values ('identities approved: marked/held (expect 15/false)', r.marked || '/' || r.held);

-- 4. Entitlements: 5 present (4 + e1) is below the population, so never held.
select * into r from stage_mark_missing(ta, j2, 'entitlement', 20);
insert into check_results values ('small kind not held: candidates/present/marked/held (expect 4/5/4/false)',
  r.candidates || '/' || r.present_before || '/' || r.marked || '/' || r.held);

-- 5. Refusals: another organization's job; a job that never started.
begin
  perform stage_mark_missing(tb, j2, 'account', 20);
  insert into check_results values ('job named with another organization (expect denied P0002)', 'ALLOWED');
exception when others then insert into check_results values ('job named with another organization (expect denied P0002)', 'denied: ' || sqlstate); end;
begin
  perform stage_mark_missing(ta, jq, 'account', 20);
  insert into check_results values ('job not started (expect denied P0002)', 'ALLOWED');
exception when others then insert into check_results values ('job not started (expect denied P0002)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);

-- 6. A member of A.
perform set_config('request.jwt.claims', '{"sub":"11111111-1170-0000-0000-000000000001","role":"authenticated"}', true);
begin
  perform stage_mark_missing(ta, j2, 'account', 20);
  insert into check_results values ('member calls stage_mark_missing (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('member calls stage_mark_missing (expect denied 42501)', 'denied: ' || sqlstate); end;
begin
  insert into integration_sync_jobs (tenant_id, integration_id, trigger, missing_status) values (ta, ca, 'manual', 'approved');
  insert into check_results values ('member creates a job claiming approval (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member creates a job claiming approval (expect denied)', 'denied: ' || sqlstate); end;
begin
  insert into integration_sync_jobs (tenant_id, integration_id, trigger, mode) values (ta, ca, 'manual', 'partial');
  insert into check_results values ('member queues a partial job (expect allowed)', 'allowed');
exception when others then insert into check_results values ('member queues a partial job (expect allowed)', 'denied: ' || sqlstate); end;
begin
  update integration_objects set missing_at_source_at = null where tenant_id = ta;
exception when others then null; end;
insert into check_results select 'member clears a missing mark (expect 21 still marked)', count(*)::text from integration_objects where tenant_id = ta and missing_at_source_at is not null;
insert into check_results select 'member of A reads A missing objects (expect 21)', count(*)::text from integration_objects where missing_at_source_at is not null;

-- 7. A member of B sees none of A's staged objects or jobs.
perform set_config('request.jwt.claims', '{"sub":"11111111-1170-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A objects (expect 0)', count(*)::text from integration_objects where tenant_id = ta;
insert into check_results select 'member of B reads A jobs (expect 0)', count(*)::text from integration_sync_jobs where tenant_id = ta;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
