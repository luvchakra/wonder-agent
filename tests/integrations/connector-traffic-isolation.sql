-- Integration Agent — live proof for migration 0110 (connector_traffic).
-- Reuses the FinanceBot fixture (Tenant A5 = aaaaaaaa-5000-...-0001 with
-- User A5 = 11111111-5000-...-0001; Tenant B5 = bbbbbbbb-5000-...-0002 with
-- User B5 = 22222222-5000-...-0002). One transaction that ROLLS BACK, so it
-- leaves nothing behind. DEV project only, via the Supabase MCP execute_sql
-- tool. Proves: a member reads only their own organization's traffic (table
-- and summary function); no client can write, change or delete a row or
-- call the recording and purge functions; record_connector_traffic adds to
-- the minute's row instead of inserting another; a row can never name
-- another organization's connection; and the purge keeps recent rows.

begin;

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated;

insert into integrations (id, tenant_id, integration_type_id, name) values
  ('aaaaaaaa-5000-0000-0000-0000000000f1', 'aaaaaaaa-5000-0000-0000-000000000001', 'connector', 'Fixture A'),
  ('bbbbbbbb-5000-0000-0000-0000000000f2', 'bbbbbbbb-5000-0000-0000-000000000002', 'connector', 'Fixture B');

-- 1. The service role records; a second flush in the same minute adds to the row.
select record_connector_traffic(jsonb_build_array(
  jsonb_build_object('tenant_id', 'aaaaaaaa-5000-0000-0000-000000000001', 'integration_id', 'aaaaaaaa-5000-0000-0000-0000000000f1',
    'window_start', date_trunc('minute', now()), 'direction', 'outbound', 'operation', 'http GET', 'host', 'hr.example.com',
    'outcome', 'ok', 'error_category', null, 'requests', 3, 'bytes_in', 300, 'bytes_out', 0, 'duration_ms', 90),
  jsonb_build_object('tenant_id', 'bbbbbbbb-5000-0000-0000-000000000002', 'integration_id', 'bbbbbbbb-5000-0000-0000-0000000000f2',
    'window_start', date_trunc('minute', now()), 'direction', 'inbound', 'operation', 'receive events', 'host', null,
    'outcome', 'blocked', 'error_category', 'unauthenticated', 'requests', 1, 'bytes_in', 10, 'bytes_out', 60, 'duration_ms', 2)));
select record_connector_traffic(jsonb_build_array(
  jsonb_build_object('tenant_id', 'aaaaaaaa-5000-0000-0000-000000000001', 'integration_id', 'aaaaaaaa-5000-0000-0000-0000000000f1',
    'window_start', date_trunc('minute', now()), 'direction', 'outbound', 'operation', 'http GET', 'host', 'hr.example.com',
    'outcome', 'ok', 'error_category', null, 'requests', 2, 'bytes_in', 200, 'bytes_out', 0, 'duration_ms', 60)));
insert into check_results select 'A bucket merged (expect 1 row, 5 requests)', count(*)::text || ' row, ' || sum(requests)::text || ' requests'
  from connector_traffic where integration_id = 'aaaaaaaa-5000-0000-0000-0000000000f1';

-- 2. A row naming another organization's connection is refused (same-tenant foreign key).
do $$ begin
  perform record_connector_traffic(jsonb_build_array(jsonb_build_object('tenant_id', 'aaaaaaaa-5000-0000-0000-000000000001',
    'integration_id', 'bbbbbbbb-5000-0000-0000-0000000000f2', 'window_start', date_trunc('minute', now()), 'direction', 'outbound',
    'operation', 'http GET', 'host', 'x.example.com', 'outcome', 'ok', 'requests', 1, 'bytes_in', 0, 'bytes_out', 0, 'duration_ms', 0)));
  insert into check_results values ('A row naming B''s connection (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('A row naming B''s connection (expect denied)', 'denied: ' || sqlstate);
end $$;

-- 3. User A5 reads only A's traffic, and cannot write any.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'A reads own (expect 1)', count(*)::text from connector_traffic where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A reads B (expect 0)', count(*)::text from connector_traffic where tenant_id = 'bbbbbbbb-5000-0000-0000-000000000002';
insert into check_results select 'A summary of own (expect 5)', coalesce(sum(requests), 0)::text
  from connector_traffic_summary('aaaaaaaa-5000-0000-0000-000000000001', now() - interval '1 day');
insert into check_results select 'A summary asking for B (expect 0 rows)', count(*)::text
  from connector_traffic_summary('bbbbbbbb-5000-0000-0000-000000000002', now() - interval '1 day');
do $$ begin
  insert into connector_traffic (tenant_id, window_start, direction, operation, outcome) values ('aaaaaaaa-5000-0000-0000-000000000001', date_trunc('minute', now()), 'outbound', 'forged', 'ok');
  insert into check_results values ('A inserts (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('A inserts (expect denied)', 'denied: ' || sqlstate);
end $$;
with u as (update connector_traffic set requests = 0 where true returning 1)
insert into check_results select 'A updates any (expect 0: no update policy)', count(*)::text from u;
with d as (delete from connector_traffic where true returning 1)
insert into check_results select 'A deletes any (expect 0: no delete policy)', count(*)::text from d;
do $$ begin
  perform record_connector_traffic('[]'::jsonb);
  insert into check_results values ('A calls record_connector_traffic (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('A calls record_connector_traffic (expect denied)', 'denied: ' || sqlstate);
end $$;
do $$ begin
  perform purge_connector_traffic();
  insert into check_results values ('A calls purge_connector_traffic (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('A calls purge_connector_traffic (expect denied)', 'denied: ' || sqlstate);
end $$;
reset role;

-- 4. User B5 sees none of A5's.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-5000-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'B reads A (expect 0)', count(*)::text from connector_traffic where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
reset role;

-- 5. The purge removes only rows older than 30 days.
insert into connector_traffic (tenant_id, integration_id, window_start, direction, operation, outcome, requests)
values ('aaaaaaaa-5000-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-0000000000f1', date_trunc('minute', now() - interval '31 days'), 'outbound', 'http GET', 'ok', 1);
insert into check_results select 'purge (expect 1)', purge_connector_traffic()::text;
insert into check_results select 'recent rows kept (expect 2)', count(*)::text from connector_traffic where integration_id in ('aaaaaaaa-5000-0000-0000-0000000000f1', 'bbbbbbbb-5000-0000-0000-0000000000f2');

select * from check_results;
rollback;
