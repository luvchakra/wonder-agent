-- Compliance Agent — COMPLIANCE-P0-14 part 3 live verification of migration
-- 0186 (questions about a review item). Run via the Supabase MCP execute_sql
-- tool as one statement; it ends by raising an exception that carries the
-- results, so every fixture row rolls back with it.
--
-- Run 2026-10-14 against the dev project, 8 of 8 as expected: another
-- organization's item 23503; asking oneself 23514; an answer without a time
-- 23514; member sees 1; another organization sees 0, cannot insert (42501)
-- and updates 0 rows; a member's direct answer updates 0 rows.
--
-- Proves:
-- - a question names an item of its own organization (another
--   organization's item is refused);
-- - nobody asks themselves; an answer always carries its time;
-- - a member of the organization sees its questions; another organization
--   sees none and cannot write or answer one.

do $$
declare
  a constant uuid := 'aaaaaaaa-1860-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1860-0000-0000-000000000002';
  x constant uuid := '11111111-1860-0000-0000-000000000001';
  y constant uuid := '22222222-1860-0000-0000-000000000002';
  z constant uuid := '33333333-1860-0000-0000-000000000003';
  ia uuid;
  ib uuid;
  ca uuid;
  cb uuid;
  ita uuid;
  itb uuid;
  q uuid;
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A186', 'fixture-tenant-a186-test'), (b, 'Fixture Tenant B186', 'fixture-tenant-b186-test');
  insert into auth.users (id, email) values (x, 'fixture-x186@example.test'), (y, 'fixture-y186@example.test'), (z, 'fixture-z186@example.test');
  insert into users (id, email) values (x, 'fixture-x186@example.test'), (y, 'fixture-y186@example.test'), (z, 'fixture-z186@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (a, y, 'active'), (b, z, 'active');
  select id into ia from identities where tenant_id = a and user_id = x;
  if ia is null then
    insert into identities (tenant_id, identity_type, display_name, user_id) values (a, 'HUMAN', 'Fixture X', x) returning id into ia;
  end if;
  select id into ib from identities where tenant_id = b and user_id = z;
  if ib is null then
    insert into identities (tenant_id, identity_type, display_name, user_id) values (b, 'HUMAN', 'Fixture Z', z) returning id into ib;
  end if;
  insert into certification_campaigns (tenant_id, name, scope_type, cadence, created_by) values (a, 'Fixture review A', 'role_assignments', 'one_time', x) returning id into ca;
  insert into certification_campaigns (tenant_id, name, scope_type, cadence, created_by) values (b, 'Fixture review B', 'role_assignments', 'one_time', z) returning id into cb;
  insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id) values (a, ca, ia, x) returning id into ita;
  insert into certification_items (tenant_id, campaign_id, identity_id, reviewer_id) values (b, cb, ib, z) returning id into itb;
  insert into certification_consultations (tenant_id, item_id, asked_by, asked_of, question) values (a, ita, x, y, 'Does Y still need this?') returning id into q;

  begin
    insert into certification_consultations (tenant_id, item_id, asked_by, asked_of, question) values (a, itb, x, y, 'Another organization''s item?');
    results := results || E'\nquestion on another organization''s item (expect denied): ALLOWED';
  exception when others then results := results || E'\nquestion on another organization''s item (expect denied): denied ' || sqlstate; end;
  begin
    insert into certification_consultations (tenant_id, item_id, asked_by, asked_of, question) values (a, ita, x, x, 'Asking myself?');
    results := results || E'\nasking oneself (expect denied): ALLOWED';
  exception when others then results := results || E'\nasking oneself (expect denied): denied ' || sqlstate; end;
  begin
    update certification_consultations set answer = 'Yes' where id = q;
    results := results || E'\nanswer without a time (expect denied): ALLOWED';
  exception when others then results := results || E'\nanswer without a time (expect denied): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_consultations where item_id = ita; results := results || E'\nY (member) sees questions (expect 1): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  select count(*) into c from certification_consultations where item_id = ita; results := results || E'\nZ (another organization) sees questions (expect 0): ' || c;
  begin
    insert into certification_consultations (tenant_id, item_id, asked_by, asked_of, question) values (a, ita, z, y, 'Z writes directly');
    results := results || E'\nZ: insert a question directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nZ: insert a question directly (expect denied): denied ' || sqlstate; end;
  update certification_consultations set answer = 'Z answers', answered_at = now() where id = q;
  get diagnostics c = row_count; results := results || E'\nZ: answer directly (expect 0 rows): ' || c;
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  update certification_consultations set answer = 'Y answers directly', answered_at = now() where id = q;
  get diagnostics c = row_count; results := results || E'\nY: answer directly, not through the service (expect 0 rows): ' || c;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
