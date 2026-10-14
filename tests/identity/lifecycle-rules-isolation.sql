-- Identity Agent — IDENTITY-P0-21 live verification of migrations 0166
-- (lifecycle_rules, lifecycle_rule_versions) and 0167 (Operations'
-- rule_runs). Run via the Supabase MCP execute_sql tool; cleanup in a
-- second call (the commented deletes at the end).
--
-- Proves: a member reads only their own organization's rules, versions and
-- runs, and writes none of them directly; a version cannot point at another
-- organization's rule; publishing is four-eyes (the approver is not the
-- person who asked); a published version and a run never change.
--
-- Run 2026-10-14 against the dev project, 12 of 12 as expected:
-- - a version of another tenant's rule: 23503;
-- - approval by the person who asked, on the rule and on a version: 23514;
-- - "published" with nothing published: 23514;
-- - rewriting a published version or a run: P0001.
-- As a member: own rules, versions and runs 1/1/1, B's 0/0; switching a
-- rule to enforce directly 0 rows; inserting a rule or a run 42501;
-- deleting a run 0 rows. The cleanup call was cancelled, so the fixtures
-- (slugs fixture-tenant-a166-test and -b166-test) are still there.

insert into tenants (id, name, slug) values
  ('aaaaaaaa-1660-0000-0000-000000000001', 'Fixture Tenant A166', 'fixture-tenant-a166-test'),
  ('bbbbbbbb-1660-0000-0000-000000000002', 'Fixture Tenant B166', 'fixture-tenant-b166-test');
insert into auth.users (id, email) values
  ('11111111-1660-0000-0000-000000000001', 'fixture-x166@example.test'),
  ('22222222-1660-0000-0000-000000000002', 'fixture-y166@example.test');
insert into users (id, email) values
  ('11111111-1660-0000-0000-000000000001', 'fixture-x166@example.test'),
  ('22222222-1660-0000-0000-000000000002', 'fixture-y166@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-1660-0000-0000-000000000001', '11111111-1660-0000-0000-000000000001', 'active');
insert into lifecycle_rules (id, tenant_id, name, trigger_type, condition, effects, status, published, published_version, published_by, publish_requested_by) values
  ('a1660000-0000-0000-0000-0000000000a1', 'aaaaaaaa-1660-0000-0000-000000000001', 'Rule A166', 'identity.created', 'true', '[]', 'published', '{"condition":"true"}', 1, '22222222-1660-0000-0000-000000000002', '11111111-1660-0000-0000-000000000001'),
  ('b1660000-0000-0000-0000-0000000000b1', 'bbbbbbbb-1660-0000-0000-000000000002', 'Rule B166', 'identity.created', 'true', '[]', 'draft', null, 0, null, null);
insert into lifecycle_rule_versions (id, tenant_id, rule_id, version, definition, requested_by, approved_by) values
  ('a1660000-0000-0000-0000-0000000000c1', 'aaaaaaaa-1660-0000-0000-000000000001', 'a1660000-0000-0000-0000-0000000000a1', 1, '{"condition":"true"}', '11111111-1660-0000-0000-000000000001', '22222222-1660-0000-0000-000000000002');
insert into rule_runs (tenant_id, rule_table, rule_id, rule_version, subject_type, subject_id, trigger, mode, outcome) values
  ('aaaaaaaa-1660-0000-0000-000000000001', 'lifecycle_rules', 'a1660000-0000-0000-0000-0000000000a1', 1, 'identity', 'a1660000-0000-0000-0000-0000000000d1', 'identity.created', 'report_only', 'reported'),
  ('bbbbbbbb-1660-0000-0000-000000000002', 'lifecycle_rules', 'b1660000-0000-0000-0000-0000000000b1', 1, 'identity', 'b1660000-0000-0000-0000-0000000000d1', 'identity.created', 'report_only', 'reported');

create temporary table check_results (check_name text, result text);
do $$ begin
  insert into lifecycle_rule_versions (tenant_id, rule_id, version, definition) values ('aaaaaaaa-1660-0000-0000-000000000001', 'b1660000-0000-0000-0000-0000000000b1', 1, '{}');
  insert into check_results values ('version of another tenant''s rule (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('version of another tenant''s rule (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update lifecycle_rules set published_by = publish_requested_by where id = 'a1660000-0000-0000-0000-0000000000a1';
  insert into check_results values ('publish approved by the person who asked (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('publish approved by the person who asked (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into lifecycle_rule_versions (tenant_id, rule_id, version, definition, requested_by, approved_by) values ('aaaaaaaa-1660-0000-0000-000000000001', 'a1660000-0000-0000-0000-0000000000a1', 2, '{}', '11111111-1660-0000-0000-000000000001', '11111111-1660-0000-0000-000000000001');
  insert into check_results values ('version approved by its requester (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('version approved by its requester (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update lifecycle_rules set status = 'published' where id = 'b1660000-0000-0000-0000-0000000000b1';
  insert into check_results values ('published with nothing published (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('published with nothing published (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update lifecycle_rule_versions set definition = '{"condition":"false"}' where id = 'a1660000-0000-0000-0000-0000000000c1';
  insert into check_results values ('rewrite a published version (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('rewrite a published version (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update rule_runs set outcome = 'applied' where tenant_id = 'aaaaaaaa-1660-0000-0000-000000000001';
  insert into check_results values ('rewrite a run (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('rewrite a run (expect denied)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1660-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own rules / versions / runs visible (expect 1/1/1)',
  (select count(*) from lifecycle_rules where tenant_id = 'aaaaaaaa-1660-0000-0000-000000000001')::text || '/' ||
  (select count(*) from lifecycle_rule_versions where tenant_id = 'aaaaaaaa-1660-0000-0000-000000000001')::text || '/' ||
  (select count(*) from rule_runs where tenant_id = 'aaaaaaaa-1660-0000-0000-000000000001')::text;
insert into check_results select 'X: B rules / runs visible (expect 0/0)',
  (select count(*) from lifecycle_rules where tenant_id = 'bbbbbbbb-1660-0000-0000-000000000002')::text || '/' ||
  (select count(*) from rule_runs where tenant_id = 'bbbbbbbb-1660-0000-0000-000000000002')::text;
with u as (update lifecycle_rules set mode = 'enforce' where tenant_id = 'aaaaaaaa-1660-0000-0000-000000000001' returning 1)
insert into check_results select 'X: switch a rule to enforce directly (expect 0)', count(*)::text from u;
do $$ begin
  insert into lifecycle_rules (tenant_id, name, trigger_type) values ('aaaaaaaa-1660-0000-0000-000000000001', 'Forged', 'identity.created');
  insert into check_results values ('X: insert a rule directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert a rule directly (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into rule_runs (tenant_id, rule_table, rule_id, rule_version, subject_type, subject_id, trigger, mode, outcome) values ('aaaaaaaa-1660-0000-0000-000000000001', 'lifecycle_rules', 'a1660000-0000-0000-0000-0000000000a1', 1, 'identity', 'a1660000-0000-0000-0000-0000000000d1', 'identity.created', 'enforce', 'applied');
  insert into check_results values ('X: insert a run directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: insert a run directly (expect denied)', 'denied: ' || sqlstate); end $$;
with d as (delete from rule_runs where tenant_id = 'aaaaaaaa-1660-0000-0000-000000000001' returning 1)
insert into check_results select 'X: delete a run directly (expect 0)', count(*)::text from d;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from rule_runs where tenant_id in ('aaaaaaaa-1660-0000-0000-000000000001', 'bbbbbbbb-1660-0000-0000-000000000002');
-- delete from tenants where id in ('aaaaaaaa-1660-0000-0000-000000000001', 'bbbbbbbb-1660-0000-0000-000000000002');
-- delete from users where id in ('11111111-1660-0000-0000-000000000001', '22222222-1660-0000-0000-000000000002');
-- delete from auth.users where id in ('11111111-1660-0000-0000-000000000001', '22222222-1660-0000-0000-000000000002');
