-- Owner request (2026-10-13): the platform console's organization page holds
-- the organization's details: its name and description, a contact person,
-- the company's contacts, and company details (industry, user base size,
-- country, website). Vendor-side metadata about a customer, like
-- platform_tenants (0038): no client policies, so no customer role reads or
-- writes it; the console reads and writes it with the service role after
-- requirePlatformAdmin(), audited. One row per organization (its top-level
-- tenant), never per environment.

create table platform_organization_profiles (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  description text check (description is null or length(description) <= 1000),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+?[0-9 ()\-]{6,24}$'),
  company_name text check (company_name is null or length(company_name) <= 160),
  company_email text check (company_email is null or company_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company_phone text check (company_phone is null or company_phone ~ '^\+?[0-9 ()\-]{6,24}$'),
  industry text check (industry is null or length(industry) <= 80),
  user_base_size text check (user_base_size is null or user_base_size in ('1-50', '51-200', '201-1000', '1001-5000', '5001-20000', '20000+')),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  website text check (website is null or website ~* '^https?://[^\s]+$'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table platform_organization_profiles enable row level security;
revoke all on platform_organization_profiles from anon, authenticated;

-- Renames an organization from the platform console: its name, and its
-- environments' names follow ("<name> (Test)"). Service role only.
create function platform_rename_organization(p_tenant uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  old_name text;
  clean text := btrim(coalesce(p_name, ''));
begin
  if exists (select 1 from platform_tenants where tenant_id = p_tenant and parent_tenant_id is not null) then
    raise exception 'rename the organization, not one of its environments' using errcode = '22023';
  end if;
  if length(clean) < 2 or length(clean) > 80 then
    raise exception 'the name is 2 to 80 characters' using errcode = '22023';
  end if;
  select name into old_name from tenants where id = p_tenant for update;
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
revoke execute on function platform_rename_organization(uuid, text) from public, anon, authenticated;
grant execute on function platform_rename_organization(uuid, text) to service_role;
