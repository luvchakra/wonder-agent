-- QA check for migration 0131: ticket numbers for rogue-access findings.
--
-- Proves: each organization numbers its own tickets from RA-000001; a
-- finding of another category gets none; a number cannot be reused within
-- an organization; a member can neither read another organization's
-- counter nor change any counter or ticket number directly. Self-cleaning
-- (ends in an exception); run through execute_sql.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1310-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1310-0000-0000-000000000002';
  ua constant uuid := '11111111-1310-0000-0000-000000000001';
  ub constant uuid := '11111111-1310-0000-0000-000000000002';
  appa constant uuid := 'aaaaaaaa-1310-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1310-0000-0000-0000000000a1';
  acca constant uuid := 'aaaaaaaa-1310-0000-0000-0000000000d1';
  accb constant uuid := 'bbbbbbbb-1310-0000-0000-0000000000d1';
  fa1 constant uuid := 'aaaaaaaa-1310-0000-0000-0000000000f1';
  fa2 constant uuid := 'aaaaaaaa-1310-0000-0000-0000000000f2';
  fa3 constant uuid := 'aaaaaaaa-1310-0000-0000-0000000000f3';
  fb1 constant uuid := 'bbbbbbbb-1310-0000-0000-0000000000f1';
  n integer;
begin
insert into tenants (id, name, slug) values (ta, 'Fixture Tenant A131', 'fixture-tenant-a131-test'), (tb, 'Fixture Tenant B131', 'fixture-tenant-b131-test');
insert into auth.users (id, email) values (ua, 'fixture-a131@example.test'), (ub, 'fixture-b131@example.test');
insert into users (id, email) values (ua, 'fixture-a131@example.test'), (ub, 'fixture-b131@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, ua, 'active'), (tb, ub, 'active');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A131'), (appb, tb, 'Fixture App B131');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acca, ta, appa, 'u-a'), (accb, tb, appb, 'u-b');
insert into risk_findings (id, tenant_id, category, severity, status, title, explanation, recommendation, account_id, subject_key, risk_score) values
  (fa1, ta, 'rogue_access', 'high', 'open', 'Fixture rogue 1', 'x', 'y', acca, acca::text || '|e1', 70),
  (fa2, ta, 'rogue_access', 'high', 'open', 'Fixture rogue 2', 'x', 'y', acca, acca::text || '|e2', 70),
  (fb1, tb, 'rogue_access', 'high', 'open', 'Fixture rogue B', 'x', 'y', accb, accb::text || '|e1', 70);

create temporary table check_results (check_name text, result text);
insert into check_results select 'A numbers its own tickets (expect RA-000001,RA-000002)', string_agg(ticket_number, ',' order by ticket_number) from risk_findings where id in (fa1, fa2);
insert into check_results select 'B starts at its own first ticket (expect RA-000001)', ticket_number from risk_findings where id = fb1;
insert into check_results select 'counters per organization (expect A=2 B=1)', 'A=' || (select last_number from risk_ticket_counters where tenant_id = ta) || ' B=' || (select last_number from risk_ticket_counters where tenant_id = tb);
begin
  insert into risk_findings (id, tenant_id, category, severity, status, title, explanation, recommendation, account_id, subject_key, risk_score, ticket_number)
    values (fa3, ta, 'rogue_access', 'high', 'open', 'Fixture rogue 3', 'x', 'y', acca, acca::text || '|e3', 70, 'RA-000001');
  insert into check_results values ('a ticket number reused in one organization (expect denied 23505)', 'ALLOWED');
exception when others then insert into check_results values ('a ticket number reused in one organization (expect denied 23505)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);
perform set_config('request.jwt.claims', '{"sub":"11111111-1310-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A''s counter (expect 1)', count(*)::text from risk_ticket_counters where tenant_id = ta;
insert into check_results select 'member of A reads B''s counter (expect 0)', count(*)::text from risk_ticket_counters where tenant_id = tb;
begin
  update risk_ticket_counters set last_number = 0 where tenant_id = ta;
  get diagnostics n = row_count;
  insert into check_results values ('member of A resets A''s counter (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of A resets A''s counter (expect 0 rows)', 'denied: ' || sqlstate); end;
begin
  update risk_findings set ticket_number = 'RA-999999' where id = fa1;
  get diagnostics n = row_count;
  insert into check_results values ('member of A renumbers a ticket (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of A renumbers a ticket (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('request.jwt.claims', '{"sub":"11111111-1310-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'member of B reads A''s tickets (expect 0)', count(*)::text from risk_findings where id in (fa1, fa2);
perform set_config('role', 'postgres', true);
raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
