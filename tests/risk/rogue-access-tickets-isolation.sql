-- QA check for migrations 0131 and 0132: one ticket per rogue account.
--
-- Proves: an account's rogue-access findings share one ticket, another
-- account gets the next number, and each organization numbers from
-- RA-000001; the ticket stays open until its last finding closes and then
-- resolves; rogue access found again opens a new ticket; a finding cannot
-- name another organization's ticket; a member can neither read another
-- organization's tickets or counter nor change any ticket or counter.
-- Self-cleaning (ends in an exception); run through execute_sql.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1320-0000-0000-000000000001';
  tb constant uuid := 'bbbbbbbb-1320-0000-0000-000000000002';
  ua constant uuid := '11111111-1320-0000-0000-000000000001';
  ub constant uuid := '11111111-1320-0000-0000-000000000002';
  appa constant uuid := 'aaaaaaaa-1320-0000-0000-0000000000a1';
  appb constant uuid := 'bbbbbbbb-1320-0000-0000-0000000000a1';
  acc1 constant uuid := 'aaaaaaaa-1320-0000-0000-0000000000d1';
  acc2 constant uuid := 'aaaaaaaa-1320-0000-0000-0000000000d2';
  accb constant uuid := 'bbbbbbbb-1320-0000-0000-0000000000d1';
  f1 constant uuid := 'aaaaaaaa-1320-0000-0000-0000000000f1';
  f2 constant uuid := 'aaaaaaaa-1320-0000-0000-0000000000f2';
  f3 constant uuid := 'aaaaaaaa-1320-0000-0000-0000000000f3';
  f4 constant uuid := 'aaaaaaaa-1320-0000-0000-0000000000f4';
  fb constant uuid := 'bbbbbbbb-1320-0000-0000-0000000000f1';
  tka uuid;
  tkb uuid;
  n integer;
begin
insert into tenants (id, name, slug) values (ta, 'Fixture Tenant A132', 'fixture-tenant-a132-test'), (tb, 'Fixture Tenant B132', 'fixture-tenant-b132-test');
insert into auth.users (id, email) values (ua, 'fixture-a132@example.test'), (ub, 'fixture-b132@example.test');
insert into users (id, email) values (ua, 'fixture-a132@example.test'), (ub, 'fixture-b132@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values (ta, ua, 'active'), (tb, ub, 'active');
insert into applications (id, tenant_id, name) values (appa, ta, 'Fixture App A132'), (appb, tb, 'Fixture App B132');
insert into accounts (id, tenant_id, application_id, external_account_ref) values (acc1, ta, appa, 'u-1'), (acc2, ta, appa, 'u-2'), (accb, tb, appb, 'u-b');
-- Two rogue entitlements on account 1, one on account 2, one in organization B.
insert into risk_findings (id, tenant_id, category, severity, status, title, explanation, recommendation, account_id, subject_key, risk_score) values
  (f1, ta, 'rogue_access', 'high', 'open', 'Fixture rogue 1', 'x', 'y', acc1, acc1::text || '|e1', 70),
  (f2, ta, 'rogue_access', 'high', 'open', 'Fixture rogue 2', 'x', 'y', acc1, acc1::text || '|e2', 70),
  (f3, ta, 'rogue_access', 'high', 'open', 'Fixture rogue 3', 'x', 'y', acc2, acc2::text || '|e1', 70),
  (fb, tb, 'rogue_access', 'high', 'open', 'Fixture rogue B', 'x', 'y', accb, accb::text || '|e1', 70);

create temporary table check_results (check_name text, result text);
insert into check_results select 'one ticket per account (expect acc1=RA-000001 x2, acc2=RA-000002)',
  string_agg(a.external_account_ref || '=' || t.ticket_number, ',' order by f.id)
  from risk_findings f join risk_access_tickets t on t.id = f.access_ticket_id join accounts a on a.id = f.account_id where f.id in (f1, f2, f3);
insert into check_results select 'B numbers its own tickets (expect RA-000001)', t.ticket_number from risk_findings f join risk_access_tickets t on t.id = f.access_ticket_id where f.id = fb;

select access_ticket_id into tka from risk_findings where id = f1;
update risk_findings set status = 'resolved', resolved_at = now() where id = f1;
insert into check_results select 'one of two findings fixed: ticket stays open (expect open)', status from risk_access_tickets where id = tka;
update risk_findings set status = 'resolved', resolved_at = now() where id = f2;
insert into check_results select 'last finding fixed: ticket resolves (expect resolved, set)', status || ', ' || case when resolved_at is null then 'unset' else 'set' end from risk_access_tickets where id = tka;
insert into risk_findings (id, tenant_id, category, severity, status, title, explanation, recommendation, account_id, subject_key, risk_score)
  values (f4, ta, 'rogue_access', 'high', 'open', 'Fixture rogue again', 'x', 'y', acc1, acc1::text || '|e3', 70);
insert into check_results select 'rogue again after the fix: a new ticket (expect RA-000003, new)', t.ticket_number || ', ' || case when t.id = tka then 'same' else 'new' end
  from risk_findings f join risk_access_tickets t on t.id = f.access_ticket_id where f.id = f4;

select access_ticket_id into tkb from risk_findings where id = fb;
begin
  update risk_findings set access_ticket_id = tkb where id = f3;
  insert into check_results values ('a finding names another organization''s ticket (expect denied 23503)', 'ALLOWED');
exception when others then insert into check_results values ('a finding names another organization''s ticket (expect denied 23503)', 'denied: ' || sqlstate); end;

grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);
perform set_config('request.jwt.claims', '{"sub":"11111111-1320-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'member of A reads A''s tickets (expect 3)', count(*)::text from risk_access_tickets where tenant_id = ta;
insert into check_results select 'member of A reads B''s tickets and counter (expect 0/0)', (select count(*) from risk_access_tickets where tenant_id = tb) || '/' || (select count(*) from risk_ticket_counters where tenant_id = tb);
begin
  update risk_access_tickets set status = 'resolved', resolved_at = now() where tenant_id = ta and status = 'open';
  get diagnostics n = row_count;
  insert into check_results values ('member of A closes a ticket directly (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of A closes a ticket directly (expect 0 rows)', 'denied: ' || sqlstate); end;
begin
  insert into risk_access_tickets (tenant_id, account_id, ticket_number) values (ta, acc2, 'RA-999999');
  insert into check_results values ('member of A opens a ticket directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('member of A opens a ticket directly (expect denied)', 'denied: ' || sqlstate); end;
begin
  update risk_ticket_counters set last_number = 0 where tenant_id = ta;
  get diagnostics n = row_count;
  insert into check_results values ('member of A resets the counter (expect 0 rows)', n::text);
exception when others then insert into check_results values ('member of A resets the counter (expect 0 rows)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);
raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
