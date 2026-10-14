-- Access Agent — WID-H06 live verification of migration 0182. Run via the
-- Supabase MCP execute_sql tool as one statement; it ends by raising an
-- exception that carries the results, so every fixture row rolls back.
--
-- Run 2026-10-14 against the dev project, 5 of 5 as expected (23514 for
-- each refusal).
--
-- Proves, for every writer including the service role:
-- - a delegation naming an automation member as delegate is refused;
-- - one naming an automation member as delegator is refused;
-- - a delegation between two people is still accepted;
-- - no delegated role copy is written for an automation member;
-- - an ordinary (undelegated) role row for an automation member is still
--   written, as its own page does.

do $$
declare
  t constant uuid := 'aaaaaaaa-1820-0000-0000-000000000001';
  p constant uuid := '11111111-1820-0000-0000-000000000001';
  q constant uuid := '22222222-1820-0000-0000-000000000002';
  bot constant uuid := '33333333-1820-0000-0000-000000000003';
  r uuid;
  d uuid;
  results text := '';
begin
  insert into tenants (id, name, slug) values (t, 'Fixture Tenant 182', 'fixture-tenant-182-test');
  insert into auth.users (id, email) values (p, 'fixture-p182@example.test'), (q, 'fixture-q182@example.test'), (bot, 'fixture-bot182@example.test');
  insert into users (id, email) values (p, 'fixture-p182@example.test'), (q, 'fixture-q182@example.test'), (bot, 'fixture-bot182@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (t, p, 'active'), (t, q, 'active');
  insert into tenant_memberships (tenant_id, user_id, status, account_type) values (t, bot, 'active', 'automation');
  select id into r from roles order by name limit 1;

  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, scope, starts_at, ends_at) values (t, p, bot, 'administration', now(), now() + interval '7 days');
    results := results || E'\ndelegate is an automation member (expect denied): ALLOWED';
  exception when others then results := results || E'\ndelegate is an automation member (expect denied): denied ' || sqlstate; end;
  begin
    insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, scope, starts_at, ends_at) values (t, bot, p, 'approvals', now(), now() + interval '7 days');
    results := results || E'\ndelegator is an automation member (expect denied): ALLOWED';
  exception when others then results := results || E'\ndelegator is an automation member (expect denied): denied ' || sqlstate; end;

  insert into access_delegations (tenant_id, delegator_user_id, delegate_user_id, scope, starts_at, ends_at) values (t, p, q, 'administration', now(), now() + interval '7 days') returning id into d;
  results := results || E'\ntwo people (expect accepted): accepted';

  begin
    insert into user_roles (tenant_id, user_id, role_id, delegation_id) values (t, bot, r, d);
    results := results || E'\ndelegated role copy for an automation member (expect denied): ALLOWED';
  exception when others then results := results || E'\ndelegated role copy for an automation member (expect denied): denied ' || sqlstate; end;
  begin
    insert into user_roles (tenant_id, user_id, role_id) values (t, bot, r);
    results := results || E'\nundelegated role for an automation member (expect accepted): accepted';
  exception when others then results := results || E'\nundelegated role for an automation member (expect accepted): REFUSED ' || sqlstate || ' ' || sqlerrm; end;

  raise exception 'RESULTS (rolled back):%', results;
end $$;
