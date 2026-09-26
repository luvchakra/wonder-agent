-- FOUNDATION-P0-22 (WonderID Phase 4b, 2026-09-26) — tenant identity,
-- tenant URL and domain registry (TENANT-001/002/003 of
-- docs/requirements/WonderID_Tenant_User_Permissioning_Model.md).
--
-- 1. Tenants: the slug is the tenant's address — lowercase, URL-safe,
--    3–40 characters, not a reserved word, and immutable once set. The
--    uuid stays the security identity. Suspension records when (and, when
--    given, why).
-- 2. tenant_domains: the hostnames a tenant is reached at.
--    PLATFORM_SUBDOMAIN rows store only the label (`acme`), so the same
--    database serves `acme.<BASE_APP_HOST>` in every environment;
--    CUSTOM_DOMAIN rows store a full hostname and must be verified before
--    they resolve (verification itself arrives with custom domains, P1).
--    Every tenant gets its platform subdomain, primary and verified, from
--    a trigger; existing tenants are backfilled.
-- 3. resolve_tenant_host(): the one public lookup — a hostname to the
--    tenant's id, name, slug and status, for routing and the tenant-branded
--    sign-in page before anyone signs in. It reveals nothing else. The
--    hostname never authorizes: the app still requires an active membership
--    in that tenant (non-negotiable #2).
--
-- RLS: members read their own tenant's domains; writes are the platform's
-- (service role) and the trigger's.

alter table tenants
  add column suspended_at timestamptz,
  add column suspension_reason text check (suspension_reason is null or char_length(suspension_reason) <= 1000);

create function tenant_slug_is_valid(p_slug text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'
     and p_slug not like '%--%'
     and p_slug not in (
       'www', 'app', 'api', 'admin', 'administrator', 'platform', 'platform-admin', 'auth', 'login', 'signin', 'sign-in',
       'signup', 'sign-up', 'sso', 'oauth', 'mail', 'email', 'smtp', 'static', 'assets', 'cdn', 'media', 'files', 'help',
       'status', 'docs', 'support', 'billing', 'wonderid', 'wonderagent', 'root', 'system', 'internal', 'test', 'demo',
       'dev', 'staging', 'prod', 'production', 'localhost', 'security', 'account', 'accounts', 'dashboard', 'console'
     )
$$;

alter table tenants add constraint tenants_slug_policy check (tenant_slug_is_valid(slug));

create function tenants_guard_slug_and_suspension() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'a tenant''s slug is its address and cannot change' using errcode = '23514';
  end if;
  if new.status = 'suspended' and old.status is distinct from 'suspended' then
    new.suspended_at := coalesce(new.suspended_at, now());
  elsif new.status <> 'suspended' and old.status = 'suspended' then
    new.suspended_at := null;
    new.suspension_reason := null;
  end if;
  return new;
end
$$;
revoke execute on function tenants_guard_slug_and_suspension() from public, anon, authenticated;

create trigger tenants_guard_slug_and_suspension
  before update on tenants
  for each row execute function tenants_guard_slug_and_suspension();

create table tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  domain_type text not null check (domain_type in ('PLATFORM_SUBDOMAIN', 'CUSTOM_DOMAIN')),
  -- PLATFORM_SUBDOMAIN: the label under BASE_APP_HOST. CUSTOM_DOMAIN: the full hostname.
  hostname text not null check (hostname = lower(hostname) and char_length(hostname) between 3 and 253),
  status text not null default 'pending' check (status in ('pending', 'verified', 'disabled')),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (domain_type, hostname),
  check (domain_type <> 'PLATFORM_SUBDOMAIN' or tenant_slug_is_valid(hostname)),
  check (domain_type <> 'CUSTOM_DOMAIN' or hostname ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'),
  check ((status = 'verified') = (verified_at is not null))
);
-- One primary address per tenant.
create unique index tenant_domains_one_primary on tenant_domains (tenant_id) where is_primary;
create index tenant_domains_tenant_idx on tenant_domains (tenant_id);

alter table tenant_domains enable row level security;
create policy tenant_domains_select on tenant_domains
  for select using (tenant_id in (select current_tenant_ids()));

-- Every tenant is reachable at its platform subdomain from the moment it exists.
create function tenants_add_platform_subdomain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into tenant_domains (tenant_id, domain_type, hostname, status, is_primary, verified_at)
  values (new.id, 'PLATFORM_SUBDOMAIN', new.slug, 'verified', true, now())
  on conflict (domain_type, hostname) do nothing;
  return new;
end
$$;
revoke execute on function tenants_add_platform_subdomain() from public, anon, authenticated;

create trigger tenants_add_platform_subdomain
  after insert on tenants
  for each row execute function tenants_add_platform_subdomain();

insert into tenant_domains (tenant_id, domain_type, hostname, status, is_primary, verified_at)
select id, 'PLATFORM_SUBDOMAIN', slug, 'verified', true, now() from tenants
on conflict (domain_type, hostname) do nothing;

-- The one public lookup: which tenant a hostname addresses, for routing and
-- the tenant's own sign-in page. Verified domains only; nothing but the
-- tenant's public face (id, name, slug, status) is returned.
create function resolve_tenant_host(p_subdomain text, p_hostname text)
returns table (tenant_id uuid, name text, slug text, status text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, t.status
    from tenant_domains d
    join tenants t on t.id = d.tenant_id
   where d.status = 'verified'
     and ((p_subdomain is not null and d.domain_type = 'PLATFORM_SUBDOMAIN' and d.hostname = lower(p_subdomain))
       or (p_hostname is not null and d.domain_type = 'CUSTOM_DOMAIN' and d.hostname = lower(p_hostname)))
   limit 1
$$;
revoke execute on function resolve_tenant_host(text, text) from public;
grant execute on function resolve_tenant_host(text, text) to anon, authenticated;
