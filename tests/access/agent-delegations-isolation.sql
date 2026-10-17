-- Access Agent — ACCESS-P0-23 part 4 live verification of migration 0200
-- (agent_delegations). Run via the Supabase MCP execute_sql tool as one
-- statement; it ends by raising an exception that carries the results, so
-- every fixture row rolls back with it.
--
-- Proves:
-- - the delegating person sees their delegation; another member does not;
--   another organization's member does not; nobody writes one directly;
-- - nobody approves their own (decided_by = requested_by refused);
-- - at most 180 days; an agent never delegates to itself; an agent of
--   another organization cannot be named;
-- - an automation member cannot delegate.
--
-- Run 2026-10-17 against the dev project, 9 of 9 as expected: own approval,
-- 181 days, agent to itself and automation 23514; another organization's
-- agent 23503; X sees 1, writes 42501; W and Z see 0.

do $$
declare
  a constant uuid := 'aaaaaaaa-2000-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-2000-0000-0000-000000000002';
  x constant uuid := '11111111-2000-0000-0000-000000000001';
  w constant uuid := '44444444-2000-0000-0000-000000000004';
  z constant uuid := '33333333-2000-0000-0000-000000000003';
  bot constant uuid := 'a2000000-0000-0000-0000-00000000a9e1';
  bot2 constant uuid := 'a2000000-0000-0000-0000-00000000a9e2';
  botb constant uuid := 'b2000000-0000-0000-0000-00000000b9e1';
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A200', 'fixture-tenant-a200-test'), (b, 'Fixture Tenant B200', 'fixture-tenant-b200-test');
  insert into auth.users (id, email) values (x, 'fixture-x200@example.test'), (w, 'fixture-w200@example.test'), (z, 'fixture-z200@example.test');
  insert into users (id, email) values (x, 'fixture-x200@example.test'), (w, 'fixture-w200@example.test'), (z, 'fixture-z200@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (a, w, 'active'), (b, z, 'active');
  insert into agents (id, tenant_id, agent_name, agent_type) values (bot, a, 'Fixture Bot 200', 'workflow'), (bot2, a, 'Fixture Bot2 200', 'workflow'), (botb, b, 'Fixture Bot B200', 'workflow');
  insert into agent_delegations (tenant_id, delegator_kind, delegator_user_id, delegate_agent_id, actions, reason, ends_at, requested_by)
    values (a, 'user', x, bot, array['read'], 'fixture', now() + interval '7 days', x);

  begin
    update agent_delegations set status = 'active', decided_by = x, decided_at = now() where tenant_id = a;
    results := results || E'\napprove own (expect denied): ALLOWED';
  exception when others then results := results || E'\napprove own (expect denied): ' || sqlstate; end;
  begin
    insert into agent_delegations (tenant_id, delegator_kind, delegator_user_id, delegate_agent_id, actions, reason, ends_at, requested_by)
      values (a, 'user', x, bot, array['read'], 'too long', now() + interval '181 days', x);
    results := results || E'\n181 days (expect denied): ALLOWED';
  exception when others then results := results || E'\n181 days (expect denied): ' || sqlstate; end;
  begin
    insert into agent_delegations (tenant_id, delegator_kind, delegator_agent_id, delegate_agent_id, actions, reason, ends_at, requested_by)
      values (a, 'agent', bot, bot, array['read'], 'self', now() + interval '1 day', x);
    results := results || E'\nagent to itself (expect denied): ALLOWED';
  exception when others then results := results || E'\nagent to itself (expect denied): ' || sqlstate; end;
  begin
    insert into agent_delegations (tenant_id, delegator_kind, delegator_user_id, delegate_agent_id, actions, reason, ends_at, requested_by)
      values (a, 'user', x, botb, array['read'], 'other org agent', now() + interval '1 day', x);
    results := results || E'\nagent of another organization (expect denied): ALLOWED';
  exception when others then results := results || E'\nagent of another organization (expect denied): ' || sqlstate; end;
  update tenant_memberships set account_type = 'automation' where tenant_id = a and user_id = w;
  begin
    insert into agent_delegations (tenant_id, delegator_kind, delegator_user_id, delegate_agent_id, actions, reason, ends_at, requested_by)
      values (a, 'user', w, bot2, array['read'], 'automation', now() + interval '1 day', w);
    results := results || E'\nautomation member delegates (expect denied): ALLOWED';
  exception when others then results := results || E'\nautomation member delegates (expect denied): ' || sqlstate; end;
  update tenant_memberships set account_type = 'internal' where tenant_id = a and user_id = w;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from agent_delegations where tenant_id = a;
  results := results || E'\nX (delegator) sees (expect 1): ' || c;
  begin
    insert into agent_delegations (tenant_id, delegator_kind, delegator_user_id, delegate_agent_id, actions, reason, ends_at, requested_by)
      values (a, 'user', x, bot2, array['read'], 'direct', now() + interval '1 day', x);
    results := results || E'\nX writes directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX writes directly (expect denied): ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from agent_delegations where tenant_id = a;
  results := results || E'\nW (another member) sees (expect 0): ' || c;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from agent_delegations where tenant_id = a;
  results := results || E'\nZ (tenant B) sees (expect 0): ' || c;
  reset role;

  raise exception 'RESULTS:%', results;
end $$;
