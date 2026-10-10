-- Foundation Agent — live verification of migration 0115 (record
-- provenance: created_at/updated_at/created_by/updated_by on every object).
--
-- Proves: a row written with no actor gets its times and no name; a
-- service-role write names the actor from the x-wonderid-actor header, and
-- only when it is a UUID; a signed-in user's own id wins over any header;
-- an update keeps created_* and sets updated_at/updated_by; a caller
-- cannot rewrite created_by; a caller that sets updated_by itself keeps it.
--
-- Self-cleaning: one block that ends by raising its results as an error,
-- so every fixture is rolled back. Runs through the Supabase MCP
-- execute_sql tool (it contains no delete).

do $t$
declare
  r identities%rowtype;
begin
insert into tenants (id, name, slug) values ('aaaaaaaa-1150-0000-0000-000000000001', 'Fixture Tenant A115', 'fixture-tenant-a115-test');
insert into auth.users (id, email) values
  ('11111111-1150-0000-0000-000000000001', 'fixture-ada115@example.test'),
  ('11111111-1150-0000-0000-000000000002', 'fixture-bob115@example.test');
insert into users (id, email) values
  ('11111111-1150-0000-0000-000000000001', 'fixture-ada115@example.test'),
  ('11111111-1150-0000-0000-000000000002', 'fixture-bob115@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-1150-0000-0000-000000000001', '11111111-1150-0000-0000-000000000001', 'active');

create temporary table check_results (check_name text, result text);

-- 1. No actor at all (a job): times set, nobody named.
perform set_config('request.headers', '{}', true);
insert into identities (id, tenant_id, identity_type, display_name) values ('a1150000-0000-0000-0000-000000000001', 'aaaaaaaa-1150-0000-0000-000000000001', 'HUMAN', 'No actor');
select * into r from identities where id = 'a1150000-0000-0000-0000-000000000001';
insert into check_results values ('job write: created_at set, created_by null (expect true)', (r.created_at is not null and r.updated_at = r.created_at and r.created_by is null and r.updated_by is null)::text);

-- 2. Service-role write naming Ada in the header.
perform set_config('request.headers', '{"x-wonderid-actor":"11111111-1150-0000-0000-000000000001"}', true);
insert into identities (id, tenant_id, identity_type, display_name) values ('a1150000-0000-0000-0000-000000000002', 'aaaaaaaa-1150-0000-0000-000000000001', 'HUMAN', 'By Ada');
select * into r from identities where id = 'a1150000-0000-0000-0000-000000000002';
insert into check_results values ('service-role write with header: created_by = Ada (expect true)', (r.created_by = '11111111-1150-0000-0000-000000000001' and r.updated_by = r.created_by)::text);

-- 3. A header that is not a UUID is ignored.
perform set_config('request.headers', '{"x-wonderid-actor":"not-a-uuid"}', true);
insert into identities (id, tenant_id, identity_type, display_name) values ('a1150000-0000-0000-0000-000000000003', 'aaaaaaaa-1150-0000-0000-000000000001', 'HUMAN', 'Bad header');
select * into r from identities where id = 'a1150000-0000-0000-0000-000000000003';
insert into check_results values ('malformed header: created_by null (expect true)', (r.created_by is null)::text);

-- 4. Bob updates Ada's record: created_* kept, updated_* become Bob/now.
-- (now() is the transaction's start inside this block, so the time check
-- is only that updated_at is not before created_at.)
perform set_config('request.headers', '{"x-wonderid-actor":"11111111-1150-0000-0000-000000000002"}', true);
update identities set display_name = 'By Ada, changed by Bob' where id = 'a1150000-0000-0000-0000-000000000002';
select * into r from identities where id = 'a1150000-0000-0000-0000-000000000002';
insert into check_results values ('update: created_by still Ada, updated_by Bob, updated_at later (expect true)', (r.created_by = '11111111-1150-0000-0000-000000000001' and r.updated_by = '11111111-1150-0000-0000-000000000002' and r.updated_at >= r.created_at)::text);

-- 5. created_by cannot be rewritten by an update.
update identities set created_by = '11111111-1150-0000-0000-000000000002', created_at = '2000-01-01' where id = 'a1150000-0000-0000-0000-000000000002';
select * into r from identities where id = 'a1150000-0000-0000-0000-000000000002';
insert into check_results values ('update rewriting created_*: kept (expect true)', (r.created_by = '11111111-1150-0000-0000-000000000001' and r.created_at > '2000-01-02')::text);

-- 6. A caller that names updated_by itself keeps its value.
update identities set display_name = 'Explicit', updated_by = '11111111-1150-0000-0000-000000000001' where id = 'a1150000-0000-0000-0000-000000000002';
select * into r from identities where id = 'a1150000-0000-0000-0000-000000000002';
insert into check_results values ('explicit updated_by kept (expect true)', (r.updated_by = '11111111-1150-0000-0000-000000000001')::text);

-- 7. A signed-in user: auth.uid() wins over a header naming someone else.
grant insert, select on check_results to authenticated;
perform set_config('role', 'authenticated', true);
perform set_config('request.jwt.claims', '{"sub":"11111111-1150-0000-0000-000000000001","role":"authenticated"}', true);
perform set_config('request.headers', '{"x-wonderid-actor":"11111111-1150-0000-0000-000000000002"}', true);
insert into identities (id, tenant_id, identity_type, display_name) values ('a1150000-0000-0000-0000-000000000004', 'aaaaaaaa-1150-0000-0000-000000000001', 'HUMAN', 'By signed-in Ada');
select * into r from identities where id = 'a1150000-0000-0000-0000-000000000004';
insert into check_results values ('signed-in write: created_by = session user, not header (expect true)', (r.created_by = '11111111-1150-0000-0000-000000000001')::text);
perform set_config('role', 'postgres', true);

raise exception 'RESULTS: %', (select string_agg(check_name || ' => ' || result, E'\n' order by check_name) from check_results);
end $t$;
