-- Owner request (2026-10-13), building on 0156:
-- 1. The onboarding wizard lets a person choose their organization's address
--    prefix and its environment (production, development, test, staging).
-- 2. A platform administrator can change an organization's environment later.
-- 3. A platform administrator can change an organization's address prefix
--    (its slug) at any time. This replaces 0095's rule that a slug never
--    changes: it still cannot change from anywhere else.
--
-- The slug stays the address only: the uuid is the security identity, so
-- nothing that references a tenant changes on a rename. The old address
-- stops resolving at once (its platform subdomain is renamed, not kept),
-- so a prefix can be reused only after it is released.

-- (3) The slug changes only inside rename_tenant_slug(), which sets a
-- transaction-local flag; any other update of the slug is still refused.
create or replace function tenants_guard_slug_and_suspension() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.slug is distinct from old.slug and coalesce(current_setting('wonderid.slug_change', true), '') <> 'allowed' then
    raise exception 'a tenant''s slug is its address and changes only through the platform console' using errcode = '23514';
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

-- Renames an organization's address: its slug and its platform subdomain,
-- in one transaction. Returns the old slug. Service role only (the platform
-- console, after requirePlatformAdmin(), writes the platform audit event).
create function rename_tenant_slug(p_tenant uuid, p_slug text) returns text
language plpgsql security definer set search_path = public as $$
declare
  old_slug text;
begin
  select slug into old_slug from tenants where id = p_tenant for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if not tenant_slug_is_valid(p_slug) then
    raise exception 'not a valid address prefix' using errcode = '22023';
  end if;
  if p_slug = old_slug then
    return old_slug;
  end if;
  perform set_config('wonderid.slug_change', 'allowed', true);
  update tenants set slug = p_slug where id = p_tenant;
  perform set_config('wonderid.slug_change', '', true);
  update tenant_domains set hostname = p_slug, updated_at = now()
  where tenant_id = p_tenant and domain_type = 'PLATFORM_SUBDOMAIN' and hostname = old_slug;
  if not found then
    insert into tenant_domains (tenant_id, domain_type, hostname, status, is_primary, verified_at)
    values (p_tenant, 'PLATFORM_SUBDOMAIN', p_slug, 'verified', not exists (select 1 from tenant_domains where tenant_id = p_tenant and is_primary), now());
  end if;
  return old_slug;
end
$$;
revoke execute on function rename_tenant_slug(uuid, text) from public, anon, authenticated;
grant execute on function rename_tenant_slug(uuid, text) to service_role;

-- (2) Sets an organization's environment. Production clears the link to a
-- parent; a non-production organization keeps any link it has. Service role
-- only (platform console).
create function set_tenant_environment(p_tenant uuid, p_environment text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_environment not in ('production', 'development', 'test', 'staging', 'sandbox') then
    raise exception 'environment must be production, development, test, staging or sandbox' using errcode = '22023';
  end if;
  if not exists (select 1 from tenants where id = p_tenant) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  insert into platform_tenants (tenant_id, environment) values (p_tenant, p_environment)
  on conflict (tenant_id) do update
    set environment = excluded.environment,
        parent_tenant_id = case when excluded.environment = 'production' then null else platform_tenants.parent_tenant_id end;
end
$$;
revoke execute on function set_tenant_environment(uuid, text) from public, anon, authenticated;
grant execute on function set_tenant_environment(uuid, text) to service_role;

-- (1) The onboarding wizard: create the first organization (or another one)
-- with the address prefix and environment the person chose. Same rules as
-- the two-argument versions (0008, 0107), which stay for existing callers;
-- the environment is recorded on the vendor-side platform record.
create function create_tenant_with_owner(tenant_name text, tenant_slug text, p_environment text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if p_environment not in ('production', 'development', 'test', 'staging') then
    raise exception 'environment must be production, development, test or staging' using errcode = '22023';
  end if;
  new_id := create_tenant_with_owner(tenant_name, tenant_slug);
  insert into platform_tenants (tenant_id, environment) values (new_id, p_environment)
  on conflict (tenant_id) do update set environment = excluded.environment;
  return new_id;
end
$$;
revoke execute on function create_tenant_with_owner(text, text, text) from public, anon;
grant execute on function create_tenant_with_owner(text, text, text) to authenticated;

create function create_first_tenant_for_current_user(tenant_name text, tenant_slug text, p_environment text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Must be authenticated to create a tenant';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('first-tenant:' || caller::text, 0));
  if exists (select 1 from tenant_memberships where user_id = caller)
     or exists (select 1 from platform_admins where user_id = caller) then
    return null;
  end if;
  return create_tenant_with_owner(tenant_name, tenant_slug, p_environment);
end
$$;
revoke execute on function create_first_tenant_for_current_user(text, text, text) from public, anon;
grant execute on function create_first_tenant_for_current_user(text, text, text) to authenticated;

-- Whether an address prefix is free, for the wizard to say so before
-- creating. Only true or false: reveals nothing about who holds it.
create function tenant_slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select tenant_slug_is_valid(p_slug)
     and not exists (select 1 from tenants where slug = p_slug)
     and not exists (select 1 from tenant_domains where domain_type = 'PLATFORM_SUBDOMAIN' and hostname = p_slug)
$$;
revoke execute on function tenant_slug_available(text) from public, anon;
grant execute on function tenant_slug_available(text) to authenticated;
