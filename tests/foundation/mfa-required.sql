-- Foundation Agent — live verification of migration 0152 (FOUNDATION-P0-27:
-- an organization can require MFA).
--
-- Proves: with `security.mfaRequired` = 1, an aal1 session of a member
-- reaches none of the organization's rows (current_tenant_ids() leaves it
-- out) while another organization of the same person stays reachable; an
-- aal2 session reaches both; an automation member is exempt; any stored
-- value other than 1 means not required; my_memberships() lists the
-- caller's own active memberships of active organizations, with the MFA
-- flag, and nobody else's; anon cannot call it.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool (no delete).

do $t$
declare
  a constant uuid := 'aaaaaaaa-1520-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1520-0000-0000-000000000002';
  c constant uuid := 'cccccccc-1520-0000-0000-000000000003';
  person constant uuid := '11111111-1520-0000-0000-000000000001';
  robot constant uuid := '11111111-1520-0000-0000-000000000002';
  other constant uuid := '11111111-1520-0000-0000-000000000003';
begin
insert into tenants (id, name, slug, status) values
  (a, 'Fixture MFA A152', 'fixture-mfa-a152-test', 'active'),
  (b, 'Fixture MFA B152', 'fixture-mfa-b152-test', 'active'),
  (c, 'Fixture MFA C152', 'fixture-mfa-c152-test', 'suspended');
insert into tenant_settings (tenant_id, settings) values
  (a, '{"config": {"security.mfaRequired": 1}}'),
  (b, '{"config": {"security.mfaRequired": "yes"}}'),
  (c, '{}')
  on conflict (tenant_id) do update set settings = excluded.settings;
insert into auth.users (id, email) values (person, 'fixture-person152@example.test'), (robot, 'fixture-robot152@example.test'), (other, 'fixture-other152@example.test');
insert into users (id, email) values (person, 'fixture-person152@example.test'), (robot, 'fixture-robot152@example.test'), (other, 'fixture-other152@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status, account_type) values
  (a, person, 'active', 'internal'),
  (b, person, 'active', 'internal'),
  (c, person, 'active', 'internal'),
  (a, robot, 'active', 'automation'),
  (a, other, 'active', 'internal');

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;
perform set_config('role', 'authenticated', true);

-- The person, without MFA.
perform set_config('request.jwt.claims', json_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal1')::text, true);
insert into check_results select 'aal1: organizations reachable (expect B only)', coalesce(string_agg(t.slug, ',' order by t.slug), '') from tenants t where t.id in (select current_tenant_ids());
insert into check_results select 'aal1: membership rows of A visible (expect 0)', count(*)::text from tenant_memberships where tenant_id = a;
insert into check_results select 'aal1: tenant A visible (expect 0)', count(*)::text from tenants where id = a;
insert into check_results select 'aal1: my_memberships (expect A:true, B:false; never suspended C)', string_agg(right(m.slug, 9) || ':' || m.mfa_required, ', ' order by m.slug) from my_memberships() m;

-- The same person after MFA.
perform set_config('request.jwt.claims', json_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
insert into check_results select 'aal2: organizations reachable (expect A and B)', string_agg(right(t.slug, 9), ',' order by t.slug) from tenants t where t.id in (select current_tenant_ids());
insert into check_results select 'aal2: membership rows of A visible (expect 3)', count(*)::text from tenant_memberships where tenant_id = a;

-- No aal claim at all is not MFA.
perform set_config('request.jwt.claims', json_build_object('sub', person, 'role', 'authenticated')::text, true);
insert into check_results select 'no aal claim: tenant A visible (expect 0)', count(*)::text from tenants where id = a;

-- An automation member, aal1.
perform set_config('request.jwt.claims', json_build_object('sub', robot, 'role', 'authenticated', 'aal', 'aal1')::text, true);
insert into check_results select 'automation member, aal1: tenant A visible (expect 1)', count(*)::text from tenants where id = a;
insert into check_results select 'automation member: my_memberships only its own (expect 1 automation)', count(*)::text || ' ' || min(account_type) from my_memberships();

-- anon.
perform set_config('role', 'anon', true);
perform set_config('request.jwt.claims', '{"role":"anon"}', true);
begin
  perform * from my_memberships();
  insert into check_results values ('anon calls my_memberships (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('anon calls my_memberships (expect denied)', 'denied: ' || sqlstate); end;
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
