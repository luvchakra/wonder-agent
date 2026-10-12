-- QA check for migration 0130 (RISK-P0-13 core): a rogue-access finding's
-- removal request.
--
-- Proves: a finding can only name a request of its own organization
-- (same-tenant key); a member cannot resolve a finding or unlink its
-- request directly (no client write path); another organization sees none
-- of it. Self-cleaning (ends in an exception); run through execute_sql.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1300-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1300-0000-0000-000000000002';
  ua constant uuid := '11111111-1300-0000-0000-000000000001';
  ub constant uuid := '11111111-1300-0000-0000-000000000002';
  ia constant uuid := 'aaaaaaaa-1300-0000-0000-0000000000b1';
  ib constant uuid := 'bbbbbbbb-1300-0000-0000-0000000000b1';
  appa constant uuid := 'aaaaaaaa-1300-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1300-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1300-0000-0000-0000000000d1';
  ra constant uuid := 'aaaaaaaa-1300-0000-0000-0000000000c1';
  rb constant uuid := 'bbbbbbbb-1300-0000-0000-0000000000c1';
  fa constant uuid := 'aaaaaaaa-1300-0000-0000-0000000000f1';
  n integer;
begin
insert into tenants (id, name, slug) values (ta, 'Fixture Tenant A130', 'fixture-tenant-a130-test'), (tb, 'Fixture Tenant B130', 'fixture-tenant-b130-test');
insert into auth.users (id, email) values (ua, 'fixture-a130@example.test'), (ub, 'fixture-b130@example.test');
insert into users (id, email) values (ua, 'fixture-a130@example.test'), (ub, 'fixture-b130@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, ua, 'active'), (tb, ub, 'active');
insert into identities (id, tenant_id, identity_type, display_name) values (ia, ta, 'HUMAN', 'Fixture A130'), (ib, tb, 'HUMAN', 'Fixture B130');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A130'), (appb, tb, 'Fixture App B130');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acca, ta, appa, 'u-a');
insert into access_requests (id, tenant_id, subject_identity_id, requested_by, application_id, request_type, justification, status) values
  (ra, ta, ia, ua, appa, 'disable_account', 'Fixture', 'pending'), (rb, tb, ib, ub, appb, 'disable_account', 'Fixture', 'pending');
insert into risk_findings (id, tenant_id, category, severity, status, title, explanation, recommendation, account_id, subject_key, risk_score, remediation_request_id)
  values (fa, ta, 'rogue_access', 'high', 'remediation_in_progress', 'Fixture rogue', 'x', 'y', acca, acca::text || '|', 70, ra);

create temporary table check_results (check_name text, result text);
begin
  update risk_findings set remediation_request_id = rb where id = fa;
  insert into check_results values ('finding names another organization''s request (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('finding names another organization''s request (expect denied 23503)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);
perform set_config('request.jwt.claims', '{"sub":"11111111-1300-0000-0000-000000000001","role":"authenticated"}', true);
begin
  update risk_findings set status = 'resolved', remediation_request_id = null where id = fa;
  get diagnostics n = row_count;
  insert into check_results values ('member of A resolves the finding directly (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of A resolves the finding directly (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('request.jwt.claims', '{"sub":"11111111-1300-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A''s finding (expect 0)', count(*)::text from risk_findings where id = fa;
perform set_config('role', 'postgres', true);
raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
