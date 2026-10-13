-- Owner request (2026-10-13): in the platform console an organization holds
-- its environments, and an environment can be removed as well as added.
--
-- Removing an environment decommissions that organization (its data is
-- kept; nobody can sign in to it) and frees its place: its address moves to
-- `<slug>-removed-<6 chars>` (so `acme-dev` can be created again) and its
-- link to the production organization moves into notes, so the
-- one-environment-per-kind index allows a new one. Production cannot be
-- removed this way. One transaction; service role only (the console audits).
create function remove_tenant_environment(p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  freed text;
begin
  select t.slug, p.environment, p.parent_tenant_id into rec
  from tenants t join platform_tenants p on p.tenant_id = t.id
  where t.id = p_tenant for update of t;
  if not found or rec.parent_tenant_id is null or rec.environment = 'production' then
    raise exception 'only an environment linked to a production organization is removed this way' using errcode = '22023';
  end if;
  freed := left(rec.slug, 25) || '-removed-' || substr(md5(gen_random_uuid()::text), 1, 6);
  freed := regexp_replace(freed, '-{2,}', '-', 'g');
  perform set_config('wonderid.slug_change', 'allowed', true);
  update tenants set slug = freed, status = 'deprovisioned' where id = p_tenant;
  perform set_config('wonderid.slug_change', '', true);
  update tenant_domains set hostname = freed, updated_at = now()
  where tenant_id = p_tenant and domain_type = 'PLATFORM_SUBDOMAIN' and hostname = rec.slug;
  update platform_tenants
  set parent_tenant_id = null,
      notes = trim(both ' ' from coalesce(notes, '') || ' Removed ' || rec.environment || ' environment of ' || rec.parent_tenant_id::text || ' (was ' || rec.slug || ') on ' || now()::date::text || '.')
  where tenant_id = p_tenant;
  return rec.slug;
end
$$;
revoke execute on function remove_tenant_environment(uuid) from public, anon, authenticated;
grant execute on function remove_tenant_environment(uuid) to service_role;
