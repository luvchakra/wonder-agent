-- Owner request (2026-10-13): "Manage organizations" in the organization
-- switcher. An organization's owner (TENANT_SUPER_ADMIN of the production
-- organization) can rename it, disable it, and disable or enable each of
-- its environments. New organizations stay free; a new environment is paid
-- for (owner decision), recorded as an environment order.
--
-- Disabling is the existing suspension (tenants.status = 'suspended'), which
-- current_tenant_ids() already refuses (0152), so a disabled organization's
-- data is unreachable to every member. disabled_by_owner tells an owner's
-- disable from a platform suspension: an owner can enable only what an
-- owner disabled.

alter table tenants add column disabled_by_owner boolean not null default false;

-- Leaving the suspension clears the owner flag with the reason.
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
    new.disabled_by_owner := false;
  end if;
  return new;
end
$$;
revoke execute on function tenants_guard_slug_and_suspension() from public, anon, authenticated;

-- The organization a tenant belongs to: its production parent, or itself.
create function organization_of(p_tenant uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select parent_tenant_id from platform_tenants where tenant_id = p_tenant), p_tenant)
$$;
revoke execute on function organization_of(uuid) from public, anon, authenticated;

-- Whether the caller owns the organization a tenant belongs to: an active
-- member holding TENANT_SUPER_ADMIN there. Membership is read directly, not
-- through current_tenant_ids(), so an owner can still enable a disabled one.
create function is_organization_owner(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from tenant_memberships tm
    join user_roles ur on ur.tenant_id = tm.tenant_id and ur.user_id = tm.user_id
    join roles r on r.id = ur.role_id and r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
    where tm.tenant_id = organization_of(p_tenant) and tm.user_id = auth.uid() and tm.status = 'active'
  )
$$;
revoke execute on function is_organization_owner(uuid) from public, anon;
grant execute on function is_organization_owner(uuid) to authenticated;

-- The organizations the caller owns and their environments, disabled ones
-- included (removed ones are not).
create function my_managed_organizations()
returns table (tenant_id uuid, name text, slug text, status text, disabled_by_owner boolean, environment text, parent_tenant_id uuid)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, t.status, t.disabled_by_owner, coalesce(p.environment, 'production'), p.parent_tenant_id
  from tenants t
  left join platform_tenants p on p.tenant_id = t.id
  where t.status <> 'deprovisioned' and is_organization_owner(t.id)
$$;
revoke execute on function my_managed_organizations() from public, anon;
grant execute on function my_managed_organizations() to authenticated;

-- Renames an organization (its display name; the address is the platform
-- console's). Its environments follow: "<name> (Dev)" and so on.
create function owner_rename_organization(p_tenant uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  old_name text;
  clean text := btrim(coalesce(p_name, ''));
begin
  if organization_of(p_tenant) <> p_tenant then
    raise exception 'rename the organization, not one of its environments' using errcode = '22023';
  end if;
  if not is_organization_owner(p_tenant) then
    raise exception 'only the organization''s owner can rename it' using errcode = '42501';
  end if;
  if length(clean) < 2 or length(clean) > 80 then
    raise exception 'the name is 2 to 80 characters' using errcode = '22023';
  end if;
  select name into old_name from tenants where id = p_tenant and status <> 'deprovisioned' for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  update tenants set name = clean, updated_at = now() where id = p_tenant;
  update tenants t
  set name = clean || ' (' || case p.environment when 'development' then 'Dev' when 'test' then 'Test' when 'staging' then 'Staging' else initcap(p.environment) end || ')',
      updated_at = now()
  from platform_tenants p
  where p.tenant_id = t.id and p.parent_tenant_id = p_tenant and t.status <> 'deprovisioned';
  return old_name;
end
$$;
revoke execute on function owner_rename_organization(uuid, text) from public, anon;
grant execute on function owner_rename_organization(uuid, text) to authenticated;

-- Disables or enables an organization or one environment. Disabling an
-- organization disables its environments with it; enabling it enables the
-- ones an owner disabled. An environment cannot be enabled while its
-- organization is disabled. A platform suspension is not the owner's to
-- lift. Returns the ids changed.
create function owner_set_organization_disabled(p_tenant uuid, p_disabled boolean) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare
  t tenants%rowtype;
  org uuid := organization_of(p_tenant);
begin
  if not is_organization_owner(p_tenant) then
    raise exception 'only the organization''s owner can do that' using errcode = '42501';
  end if;
  select * into t from tenants where id = p_tenant for update;
  if not found or t.status = 'deprovisioned' then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if p_disabled then
    return query
      update tenants set status = 'suspended', disabled_by_owner = true, suspension_reason = 'Disabled by the organization''s owner', updated_at = now()
      where status = 'active'
        and (id = p_tenant or (org = p_tenant and id in (select tenant_id from platform_tenants where parent_tenant_id = p_tenant)))
      returning id;
  else
    if t.status = 'suspended' and not t.disabled_by_owner then
      raise exception 'WonderID suspended this organization; contact support' using errcode = '42501';
    end if;
    if org <> p_tenant and exists (select 1 from tenants where id = org and status <> 'active') then
      raise exception 'enable the organization first' using errcode = '22023';
    end if;
    return query
      update tenants set status = 'active', updated_at = now()
      where status = 'suspended' and disabled_by_owner
        and (id = p_tenant or (org = p_tenant and id in (select tenant_id from platform_tenants where parent_tenant_id = p_tenant)))
      returning id;
  end if;
end
$$;
revoke execute on function owner_set_organization_disabled(uuid, boolean) from public, anon;
grant execute on function owner_set_organization_disabled(uuid, boolean) to authenticated;

-- A paid environment: one order per environment bought. tenant_id is the
-- organization that bought it. payment_mode 'test' is a payment taken
-- without a provider (no money moves), allowed only while none is
-- configured (owner decision 2026-10-13); the order says so for ever.
create table environment_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  environment text not null check (environment in ('development', 'test', 'staging')),
  price_id text not null,
  plan text not null check (plan in ('pro', 'max')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit_amount bigint not null check (unit_amount >= 0),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  payment_mode text not null check (payment_mode in ('test', 'stripe', 'razorpay')),
  status text not null default 'paid' check (status in ('paid', 'fulfilled', 'failed')),
  environment_tenant_id uuid,
  failure text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
-- One environment of a kind being set up at a time (a double click).
create unique index environment_orders_one_open on environment_orders (tenant_id, environment) where status = 'paid';
create index environment_orders_tenant on environment_orders (tenant_id, created_at desc);
alter table environment_orders enable row level security;
-- Written only by the application (service role); read by billing viewers.
create policy environment_orders_billing_read on environment_orders for select to authenticated
  using (has_tenant_permission(tenant_id, 'billing.view'));
revoke insert, update, delete on environment_orders from anon, authenticated;

-- Owner feedback (2026-10-13): an organization that was set up as
-- development (no production organization above it) could not add
-- environments. Any top-level organization can now; its own environment
-- cannot be added twice. Otherwise as in 0156.
create or replace function create_tenant_environment(p_parent uuid, p_environment text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  parent tenants%rowtype;
  suffix text;
  label text;
  new_id uuid;
  admin_role uuid;
begin
  suffix := case p_environment when 'development' then 'dev' when 'test' then 'test' when 'staging' then 'staging' end;
  if suffix is null then
    raise exception 'environment must be development, test or staging' using errcode = '22023';
  end if;
  select * into parent from tenants where id = p_parent;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if parent.status <> 'active' then
    raise exception 'the organization is not active' using errcode = '22023';
  end if;
  -- Any top-level organization holds environments, whatever its own one
  -- is (an organization set up as development can add test and staging).
  if exists (select 1 from platform_tenants where tenant_id = p_parent and parent_tenant_id is not null) then
    raise exception 'environments belong to an organization, not to another environment' using errcode = '22023';
  end if;
  if coalesce((select environment from platform_tenants where tenant_id = p_parent), 'production') = p_environment then
    raise exception 'the organization itself is that environment' using errcode = '23505';
  end if;
  label := case p_environment when 'development' then 'Dev' when 'test' then 'Test' else 'Staging' end;

  insert into tenants (name, slug) values (left(parent.name, 180) || ' (' || label || ')', parent.slug || '-' || suffix)
  returning id into new_id;
  insert into tenant_settings (tenant_id) values (new_id) on conflict (tenant_id) do nothing;
  insert into platform_tenants (tenant_id, environment, parent_tenant_id) values (new_id, p_environment, p_parent)
  on conflict (tenant_id) do update set environment = excluded.environment, parent_tenant_id = excluded.parent_tenant_id;

  select id into admin_role from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
  insert into tenant_memberships (tenant_id, user_id, status)
  select distinct new_id, ur.user_id, 'active'
  from user_roles ur
  join tenant_memberships tm on tm.tenant_id = ur.tenant_id and tm.user_id = ur.user_id and tm.status = 'active'
  where ur.tenant_id = p_parent and ur.role_id = admin_role;
  insert into user_roles (tenant_id, user_id, role_id)
  select new_id, m.user_id, admin_role from tenant_memberships m where m.tenant_id = new_id;

  return new_id;
end
$$;
revoke execute on function create_tenant_environment(uuid, text) from public, anon, authenticated;
grant execute on function create_tenant_environment(uuid, text) to service_role;
