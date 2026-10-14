-- Access Agent — ACCESS-P0-33 part 2 live verification of migration 0170
-- (entitlement_classification_rules, their versions, rule_runs widening).
-- Run via the Supabase MCP execute_sql tool as one statement. It ends by
-- raising an exception that carries the results, so every fixture row rolls
-- back with it and nothing is left to clean up.
--
-- Proves:
-- - one rule per name per organization, ignoring case;
-- - a rule cannot be published by the person who asked, nor a version
--   approved by its requester; published needs a definition;
-- - a version cannot belong to another organization's rule, and is never
--   changed once written;
-- - rule_runs accepts this table's runs;
-- - a member reads only their own organization's rules and versions and
--   cannot write either.
--
-- Run 2026-10-14 against the dev project, 11 of 11 as expected:
-- - duplicate name in another case: 23505;
-- - published by the requester, version approved by its requester, published
--   with no definition: 23514 each;
-- - a version on another organization's rule: 23503;
-- - changing a version: P0001 (append-only);
-- - a rule_runs row for entitlement_classification_rules: accepted;
-- - as a member: own rules 1, B's 0; own versions 1, B's 0; changing a rule
--   directly 0 rows; inserting one 42501.

do $$
declare
  a constant uuid := 'aaaaaaaa-1700-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-1700-0000-0000-000000000002';
  x constant uuid := '11111111-1700-0000-0000-000000000001';
  y constant uuid := '22222222-1700-0000-0000-000000000002';
  ra constant uuid := 'a1700000-0000-0000-0000-0000000000a1';
  rb constant uuid := 'b1700000-0000-0000-0000-0000000000b1';
  def constant jsonb := '{"trigger":{"type":"entitlement.imported"},"scope":{},"condition":"true","effects":[],"mode":"report_only","priority":100}';
  results text := '';
  n integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A170', 'fixture-tenant-a170-test'), (b, 'Fixture Tenant B170', 'fixture-tenant-b170-test');
  insert into auth.users (id, email) values (x, 'fixture-x170@example.test'), (y, 'fixture-y170@example.test');
  insert into users (id, email) values (x, 'fixture-x170@example.test'), (y, 'fixture-y170@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active');
  insert into entitlement_classification_rules (id, tenant_id, name, trigger_type, status, published, published_version, published_by)
    values (ra, a, 'Admins', 'entitlement.imported', 'published', def, 1, y), (rb, b, 'B rule', 'entitlement.imported', 'published', def, 1, y);
  insert into entitlement_classification_rule_versions (tenant_id, rule_id, version, definition, requested_by, approved_by) values (a, ra, 1, def, x, y), (b, rb, 1, def, x, y);

  begin
    insert into entitlement_classification_rules (tenant_id, name, trigger_type) values (a, 'ADMINS', 'entitlement.imported');
    results := results || E'\nduplicate name, other case (expect denied): ALLOWED';
  exception when others then results := results || E'\nduplicate name, other case (expect denied): denied ' || sqlstate; end;
  begin
    update entitlement_classification_rules set publish_requested_by = y where id = ra;
    results := results || E'\npublished by the requester (expect denied): ALLOWED';
  exception when others then results := results || E'\npublished by the requester (expect denied): denied ' || sqlstate; end;
  begin
    insert into entitlement_classification_rule_versions (tenant_id, rule_id, version, definition, requested_by, approved_by) values (a, ra, 2, def, x, x);
    results := results || E'\nversion approved by its requester (expect denied): ALLOWED';
  exception when others then results := results || E'\nversion approved by its requester (expect denied): denied ' || sqlstate; end;
  begin
    insert into entitlement_classification_rules (tenant_id, name, trigger_type, status) values (a, 'No definition', 'entitlement.imported', 'published');
    results := results || E'\npublished with no definition (expect denied): ALLOWED';
  exception when others then results := results || E'\npublished with no definition (expect denied): denied ' || sqlstate; end;
  begin
    insert into entitlement_classification_rule_versions (tenant_id, rule_id, version, definition) values (a, rb, 5, def);
    results := results || E'\nversion on another tenant''s rule (expect denied): ALLOWED';
  exception when others then results := results || E'\nversion on another tenant''s rule (expect denied): denied ' || sqlstate; end;
  begin
    update entitlement_classification_rule_versions set definition = '{}' where rule_id = ra;
    results := results || E'\nchange a version (expect denied): ALLOWED';
  exception when others then results := results || E'\nchange a version (expect denied): denied ' || sqlstate; end;
  begin
    insert into rule_runs (tenant_id, rule_table, rule_id, rule_version, subject_type, subject_id, trigger, mode, outcome)
      values (a, 'entitlement_classification_rules', ra, 1, 'entitlement', gen_random_uuid(), 'entitlement.imported', 'report_only', 'reported');
    results := results || E'\nrule_runs row for classification rules (expect accepted): accepted';
  exception when others then results := results || E'\nrule_runs row for classification rules (expect accepted): denied ' || sqlstate; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  results := results || E'\nX: own rules / B rules (expect 1/0): '
    || (select count(*) from entitlement_classification_rules where tenant_id = a) || '/' || (select count(*) from entitlement_classification_rules where tenant_id = b);
  results := results || E'\nX: own versions / B versions (expect 1/0): '
    || (select count(*) from entitlement_classification_rule_versions where tenant_id = a) || '/' || (select count(*) from entitlement_classification_rule_versions where tenant_id = b);
  update entitlement_classification_rules set mode = 'enforce' where tenant_id = a;
  get diagnostics n = row_count;
  results := results || E'\nX: change a rule directly (expect 0): ' || n;
  begin
    insert into entitlement_classification_rules (tenant_id, name, trigger_type) values (a, 'forged', 'entitlement.imported');
    results := results || E'\nX: insert a rule directly (expect denied): ALLOWED';
  exception when others then results := results || E'\nX: insert a rule directly (expect denied): denied ' || sqlstate; end;
  execute 'reset role';

  raise exception 'RESULTS (rolled back):%', results;
end $$;
