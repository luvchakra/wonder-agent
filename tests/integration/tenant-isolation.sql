-- Integration Agent — tenant isolation + credential-secrecy proof.
--
-- Same methodology as tests/foundation/tenant-isolation.sql and
-- tests/identity/tenant-isolation.sql — run via the Supabase MCP
-- execute_sql tool against a DEV project only. Run in three separate calls:
-- fixtures, then "as User A3", then cleanup.

-- ============================================================
-- 1. Fixtures
-- ============================================================
insert into tenants (id, name, slug) values
  ('aaaaaaaa-2000-0000-0000-000000000001', 'Fixture Tenant A3', 'fixture-tenant-a3-test'),
  ('bbbbbbbb-2000-0000-0000-000000000002', 'Fixture Tenant B3', 'fixture-tenant-b3-test');

insert into tenant_settings (tenant_id) values
  ('aaaaaaaa-2000-0000-0000-000000000001'),
  ('bbbbbbbb-2000-0000-0000-000000000002');

insert into auth.users (id, email) values
  ('11111111-2000-0000-0000-000000000001', 'fixture-user-a3@example.test'),
  ('22222222-2000-0000-0000-000000000002', 'fixture-user-b3@example.test');

insert into tenant_memberships (tenant_id, user_id, status) values
  ('aaaaaaaa-2000-0000-0000-000000000001', '11111111-2000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-2000-0000-0000-000000000002', '22222222-2000-0000-0000-000000000002', 'active');

insert into integrations (id, tenant_id, integration_type_id, name) values
  ('cccc0001-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000001', 'generic_rest', 'Fixture Integration A'),
  ('dddd0002-0000-0000-0000-000000000002', 'bbbbbbbb-2000-0000-0000-000000000002', 'generic_rest', 'Fixture Integration B');

insert into integration_credentials (integration_id, tenant_id, auth_type, encrypted_secret) values
  ('cccc0001-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000001', 'api_key', 'FAKE-ENCRYPTED-SECRET-A'),
  ('dddd0002-0000-0000-0000-000000000002', 'bbbbbbbb-2000-0000-0000-000000000002', 'api_key', 'FAKE-ENCRYPTED-SECRET-B');

insert into integration_sync_jobs (tenant_id, integration_id, trigger) values
  ('aaaaaaaa-2000-0000-0000-000000000001', 'cccc0001-0000-0000-0000-000000000001', 'manual'),
  ('bbbbbbbb-2000-0000-0000-000000000002', 'dddd0002-0000-0000-0000-000000000002', 'manual');

insert into integration_objects (tenant_id, integration_id, object_type, external_id, raw, normalized) values
  ('aaaaaaaa-2000-0000-0000-000000000001', 'cccc0001-0000-0000-0000-000000000001', 'account', 'acct-a', '{"x":1}', '{"x":1}'),
  ('bbbbbbbb-2000-0000-0000-000000000002', 'dddd0002-0000-0000-0000-000000000002', 'account', 'acct-b', '{"x":2}', '{"x":2}');

insert into integration_mappings (integration_id, object_type, source_field, target_field) values
  ('cccc0001-0000-0000-0000-000000000001', 'account', 'foo', 'bar'),
  ('dddd0002-0000-0000-0000-000000000002', 'account', 'foo', 'bar');

-- ============================================================
-- 2. Act as fixture User A3 (member of Tenant A3 only).
-- ============================================================
create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-2000-0000-0000-000000000001","role":"authenticated"}', true);

insert into check_results select 'integrations_visible_to_A', coalesce(array_agg(name order by name)::text, '{}') from integrations;
insert into check_results select 'sync_jobs_visible_to_A', coalesce(array_agg(tenant_id order by tenant_id)::text, '{}') from integration_sync_jobs;
insert into check_results select 'objects_visible_to_A', coalesce(array_agg(external_id order by external_id)::text, '{}') from integration_objects;
insert into check_results select 'mappings_visible_to_A', coalesce(array_agg(integration_id order by integration_id)::text, '{}') from integration_mappings;

-- The core secrecy check: integration_credentials must be COMPLETELY
-- invisible to any authenticated client, even for the tenant's own row.
do $$
declare cnt int;
begin
  begin
    select count(*) into cnt from integration_credentials;
    insert into check_results values ('client_credentials_select', 'ROWS_RETURNED_' || cnt::text);
  exception when others then
    insert into check_results values ('client_credentials_select', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

do $$
declare rows_updated int;
begin
  update integrations set name = 'HACKED' where id = 'dddd0002-0000-0000-0000-000000000002';
  get diagnostics rows_updated = row_count;
  insert into check_results values ('update_integration_B_rows_affected', rows_updated::text);
end $$;

-- integration_objects has no client insert policy at all — even a
-- same-tenant forged "imported record" must be rejected.
do $$
begin
  begin
    insert into integration_objects (tenant_id, integration_id, object_type, external_id, raw, normalized)
    values ('aaaaaaaa-2000-0000-0000-000000000001', 'cccc0001-0000-0000-0000-000000000001', 'account', 'forged', '{}', '{}');
    insert into check_results values ('client_object_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('client_object_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- integration_sync_jobs: same-tenant insert with a forged 'succeeded' status
-- must be rejected by the WITH CHECK (status must start 'queued').
do $$
begin
  begin
    insert into integration_sync_jobs (tenant_id, integration_id, trigger, status, records_processed)
    values ('aaaaaaaa-2000-0000-0000-000000000001', 'cccc0001-0000-0000-0000-000000000001', 'manual', 'succeeded', 999);
    insert into check_results values ('forged_job_status_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('forged_job_status_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

-- Cross-tenant mapping insert (claiming Tenant B's integration_id) rejected
-- via the join-based policy.
do $$
begin
  begin
    insert into integration_mappings (integration_id, object_type, source_field, target_field)
    values ('dddd0002-0000-0000-0000-000000000002', 'account', 'x', 'y');
    insert into check_results values ('cross_tenant_mapping_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then
    insert into check_results values ('cross_tenant_mapping_insert', 'CORRECTLY_REJECTED: ' || sqlerrm);
  end;
end $$;

reset role;
select * from check_results order by check_name;

-- Expected results (observed on first run — see the Integration Agent audit
-- log): every *_visible_to_A check contains only Tenant A3's own row;
-- client_credentials_select -> ROWS_RETURNED_0 (invisible even for the
-- caller's own tenant); update_integration_B_rows_affected -> 0;
-- client_object_insert / forged_job_status_insert / cross_tenant_mapping_insert
-- all CORRECTLY_REJECTED.

-- ============================================================
-- 3. Cleanup — always run this after the suite, on a dev project.
-- ============================================================
-- delete from tenants where id in ('aaaaaaaa-2000-0000-0000-000000000001', 'bbbbbbbb-2000-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-2000-0000-0000-000000000001', '22222222-2000-0000-0000-000000000002');
