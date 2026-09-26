-- Foundation Agent — FOUNDATION-P0-22 live verification of migration 0095
-- (tenant slug policy, tenant_domains, resolve_tenant_host). Run via the
-- Supabase MCP execute_sql tool; cleanup in a second call (the commented
-- deletes at the end).
--
-- Proves: a new tenant gets its platform subdomain, verified and primary;
-- the slug policy refuses malformed and reserved slugs and a slug never
-- changes; suspension is time-stamped and cleared on reactivation; a member
-- reads only their own tenant's domains and writes none; the public lookup
-- answers for verified addresses only (not a pending custom domain), with
-- only the tenant's public face, including to an anonymous caller.
--
-- Run 2026-09-26 against the dev project: new tenant's verified primary
-- subdomain 1; malformed, reserved and changed slugs 23514; suspension
-- time-stamped and cleared on reactivation (true/true); taking another
-- tenant's subdomain 23505. Anonymous: the lookup returns the verified
-- subdomain's tenant ("Fixture Tenant B95/active") and nothing for a
-- pending custom domain; reading tenant_domains 42501. Member: own domains
-- 1, another tenant's 0, changing one directly 0 rows, adding one 42501.
-- (The first run read tenant_domains as anon outside an exception block;
-- its 42501 aborted the run, so that check is now wrapped.) Fixtures
-- deleted afterwards (0 left).

insert into tenants (id, name, slug) values
  ('aaaaaaaa-9500-0000-0000-000000000001', 'Fixture Tenant A95', 'fixture-a95'),
  ('bbbbbbbb-9500-0000-0000-000000000002', 'Fixture Tenant B95', 'fixture-b95');
insert into auth.users (id, email) values ('11111111-9500-0000-0000-000000000001', 'fixture-x95@example.test');
insert into users (id, email) values ('11111111-9500-0000-0000-000000000001', 'fixture-x95@example.test') on conflict (id) do nothing;
insert into tenant_memberships (tenant_id, user_id, status) values ('aaaaaaaa-9500-0000-0000-000000000001', '11111111-9500-0000-0000-000000000001', 'active');
insert into tenant_domains (tenant_id, domain_type, hostname, status) values ('bbbbbbbb-9500-0000-0000-000000000002', 'CUSTOM_DOMAIN', 'identity.fixture-b95.example', 'pending');

create temporary table check_results (check_name text, result text);
insert into check_results select 'new tenant has its verified primary subdomain (expect 1)', count(*)::text from tenant_domains where tenant_id = 'aaaaaaaa-9500-0000-0000-000000000001' and domain_type = 'PLATFORM_SUBDOMAIN' and hostname = 'fixture-a95' and status = 'verified' and is_primary;
do $$ begin
  insert into tenants (name, slug) values ('Bad', 'Bad_Slug');
  insert into check_results values ('malformed slug (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('malformed slug (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into tenants (name, slug) values ('Reserved', 'admin');
  insert into check_results values ('reserved slug (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('reserved slug (expect denied)', 'denied: ' || sqlstate); end $$;
do $$ begin
  update tenants set slug = 'fixture-a95-renamed' where id = 'aaaaaaaa-9500-0000-0000-000000000001';
  insert into check_results values ('changing a slug (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('changing a slug (expect denied)', 'denied: ' || sqlstate); end $$;
update tenants set status = 'suspended', suspension_reason = 'fixture' where id = 'bbbbbbbb-9500-0000-0000-000000000002';
insert into check_results select 'suspension time-stamped (expect true)', (suspended_at is not null)::text from tenants where id = 'bbbbbbbb-9500-0000-0000-000000000002';
update tenants set status = 'active' where id = 'bbbbbbbb-9500-0000-0000-000000000002';
insert into check_results select 'reactivation clears it (expect true)', (suspended_at is null and suspension_reason is null)::text from tenants where id = 'bbbbbbbb-9500-0000-0000-000000000002';
do $$ begin
  insert into tenant_domains (tenant_id, domain_type, hostname, status, verified_at) values ('aaaaaaaa-9500-0000-0000-000000000001', 'PLATFORM_SUBDOMAIN', 'fixture-b95', 'verified', now());
  insert into check_results values ('taking another tenant''s subdomain (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('taking another tenant''s subdomain (expect denied)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated, anon;
set role anon;
insert into check_results select 'anon: lookup a verified subdomain (expect Fixture Tenant B95/active)', coalesce(max(name || '/' || status), 'none') from resolve_tenant_host('fixture-b95', null);
insert into check_results select 'anon: lookup a pending custom domain (expect none)', coalesce(max(name), 'none') from resolve_tenant_host(null, 'identity.fixture-b95.example');
do $$ declare n int; begin
  select count(*) into n from tenant_domains;
  insert into check_results values ('anon: read domains (expect denied or 0)', n::text);
exception when others then insert into check_results values ('anon: read domains (expect denied or 0)', 'denied: ' || sqlstate); end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-9500-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'X: own tenant domains (expect 1)', count(*)::text from tenant_domains where tenant_id = 'aaaaaaaa-9500-0000-0000-000000000001';
insert into check_results select 'X: B domains (expect 0)', count(*)::text from tenant_domains where tenant_id = 'bbbbbbbb-9500-0000-0000-000000000002';
with u as (update tenant_domains set status = 'disabled' where tenant_id = 'aaaaaaaa-9500-0000-0000-000000000001' returning 1)
insert into check_results select 'X: change own domain directly (expect 0)', count(*)::text from u;
do $$ begin
  insert into tenant_domains (tenant_id, domain_type, hostname) values ('aaaaaaaa-9500-0000-0000-000000000001', 'CUSTOM_DOMAIN', 'evil.example.com');
  insert into check_results values ('X: add a domain directly (expect denied)', 'ALLOWED');
exception when others then insert into check_results values ('X: add a domain directly (expect denied)', 'denied: ' || sqlstate); end $$;
reset role;
select * from check_results;

-- Cleanup (second call):
-- delete from tenants where id in ('aaaaaaaa-9500-0000-0000-000000000001', 'bbbbbbbb-9500-0000-0000-000000000002');
-- delete from users where id = '11111111-9500-0000-0000-000000000001';
-- delete from auth.users where id = '11111111-9500-0000-0000-000000000001';
