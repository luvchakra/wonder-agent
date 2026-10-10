-- Integration Agent — connector_files secrecy and scheduled-job windows (migration 0111).
--
-- Same methodology as tests/integration/tenant-isolation.sql: run through
-- the Supabase execute_sql tool against a DEV project only, in three calls
-- (fixtures, then "as User A4", then cleanup).

-- ============================================================
-- 1. Fixtures
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-4000-0000-0000-000000000001', 'Fixture Tenant A4', 'fixture-tenant-a4-test'),
  ('bbbbbbbb-4000-0000-0000-000000000002', 'Fixture Tenant B4', 'fixture-tenant-b4-test');

insert into tenant_settings (tenant_id) values
  ('aaaaaaaa-4000-0000-0000-000000000001'),
  ('bbbbbbbb-4000-0000-0000-000000000002');

insert into auth.users (id, email) values
  ('11111111-4000-0000-0000-000000000001', 'fixture-user-a4@example.test'),
  ('22222222-4000-0000-0000-000000000002', 'fixture-user-b4@example.test');

insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-4000-0000-0000-000000000001', '11111111-4000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-4000-0000-0000-000000000002', '22222222-4000-0000-0000-000000000002', 'active');

insert into integrations (id, tenant_id, integration_type_id, name, config) values
  ('cccc0004-0000-0000-0000-000000000001', 'aaaaaaaa-4000-0000-0000-000000000001', 'connector', 'File imports A', '{"purpose":"file_imports"}'),
  ('dddd0004-0000-0000-0000-000000000002', 'bbbbbbbb-4000-0000-0000-000000000002', 'connector', 'File imports B', '{"purpose":"file_imports"}');

insert into connector_files (tenant_id, integration_id, kind, filename, byte_size, row_count, content, sha256) values
  ('aaaaaaaa-4000-0000-0000-000000000001', 'cccc0004-0000-0000-0000-000000000001', 'identity', 'a.csv', 20, 1, 'externalId,email
a1,a@x', repeat('a', 64)),
  ('bbbbbbbb-4000-0000-0000-000000000002', 'dddd0004-0000-0000-0000-000000000002', 'identity', 'b.csv', 20, 1, 'externalId,email
b1,b@x', repeat('b', 64));

-- A file may not name another tenant's connection (same-tenant foreign key), even through the service role.
do $$
begin
  begin
    insert into connector_files (tenant_id, integration_id, kind, byte_size, row_count, content, sha256)
    values ('aaaaaaaa-4000-0000-0000-000000000001', 'dddd0004-0000-0000-0000-000000000002', 'identity', 1, 0, 'x', repeat('c', 64));
    raise notice 'cross_tenant_file_fk: UNEXPECTEDLY_SUCCEEDED';
  exception when foreign_key_violation then
    raise notice 'cross_tenant_file_fk: CORRECTLY_REJECTED';
  end;
end $$;

-- A second File imports connection for one tenant is refused.
do $$
begin
  begin
    insert into integrations (tenant_id, integration_type_id, name, config)
    values ('aaaaaaaa-4000-0000-0000-000000000001', 'connector', 'File imports A again', '{"purpose":"file_imports"}');
    raise notice 'second_file_imports_connection: UNEXPECTEDLY_SUCCEEDED';
  exception when unique_violation then
    raise notice 'second_file_imports_connection: CORRECTLY_REJECTED';
  end;
end $$;

-- ============================================================
-- 2. Act as fixture User A4 (member of Tenant A4 only).
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-4000-0000-0000-000000000001","role":"authenticated"}', true);

-- connector_files is invisible to every client, even the tenant's own rows.
insert into check_results select 'files_visible_to_A', count(*)::text from connector_files;

do $$
declare n int;
begin
  update connector_files set consumed_at = now();
  get diagnostics n = row_count;
  insert into check_results values ('files_updated_by_A', n::text);
end $$;

do $$
begin
  begin
    insert into connector_files (tenant_id, integration_id, kind, byte_size, row_count, content, sha256)
    values ('aaaaaaaa-4000-0000-0000-000000000001', 'cccc0004-0000-0000-0000-000000000001', 'identity', 1, 0, 'x', repeat('d', 64));
    insert into check_results values ('client_file_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_file_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- A client job can never claim a schedule window (that would block the cron's run).
do $$
begin
  begin
    insert into integration_sync_jobs (tenant_id, integration_id, trigger, schedule_window)
    values ('aaaaaaaa-4000-0000-0000-000000000001', 'cccc0004-0000-0000-0000-000000000001', 'scheduled', 'd:2026-10-10');
    insert into check_results values ('client_job_with_window', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_job_with_window', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- A plain manual job still works for the caller's own tenant.
insert into integration_sync_jobs (tenant_id, integration_id, trigger)
values ('aaaaaaaa-4000-0000-0000-000000000001', 'cccc0004-0000-0000-0000-000000000001', 'manual');
insert into check_results select 'client_manual_job', count(*)::text from integration_sync_jobs where integration_id = 'cccc0004-0000-0000-0000-000000000001';

-- The schedule column is tenant-scoped like the rest of the row.
do $$
declare n int;
begin
  update integrations set schedule = 'daily' where id = 'dddd0004-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  insert into check_results values ('schedule_B_updated_by_A', n::text);
end $$;

reset role;
select * from check_results order by check_name;

-- Expected: files_visible_to_A -> 0; files_updated_by_A -> 0;
-- client_file_insert / client_job_with_window -> CORRECTLY_REJECTED;
-- client_manual_job -> 1; schedule_B_updated_by_A -> 0; and the notices
-- cross_tenant_file_fk / second_file_imports_connection -> CORRECTLY_REJECTED.

-- ============================================================
-- 3. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from tenants where id in ('aaaaaaaa-4000-0000-0000-000000000001', 'bbbbbbbb-4000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-4000-0000-0000-000000000001', '22222222-4000-0000-0000-000000000002');
