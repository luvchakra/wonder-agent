-- Foundation Agent — Global Configuration (owner request, 2026-10-10): the
-- organization-wide settings of lib/config/registry.ts, versioned. The first
-- slice of PLATFORM-P0-13 (Configuration Studio) and of FOUNDATION-P0-27
-- (session timeouts); the vendor-only platform boundary is unchanged.
--
-- - Current values live in tenant_settings.settings -> 'config' (0001's
--   tenant_settings, until now unused).
-- - tenant_config_versions keeps every saved version: what it set, what
--   changed, who, when, and the version it restored if any. Append-only;
--   it goes with a deleted organization.
-- - save_tenant_config() writes a version and the current values in one
--   transaction, only if the caller saw the latest version (two admins
--   saving at once: the second is refused, never silently overwritten).
--   Service role only; lib/config/tenantConfig.ts validates and audits.
-- - my_session_policy(): the signed-in user's session limits, the
--   strictest of their active organizations', clamped to the global
--   limits (30 minutes idle, 12 hours in all). proxy.ts reads it.

create table tenant_config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  version integer not null check (version > 0),
  config jsonb not null,
  changes jsonb not null default '[]'::jsonb,
  restored_from integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);

alter table tenant_config_versions enable row level security;
-- Only members who manage settings read the history; nobody writes it
-- except save_tenant_config() below.
create policy tenant_config_versions_select on tenant_config_versions
  for select using (
    has_tenant_permission(tenant_id, 'tenant.settings') or has_tenant_permission(tenant_id, 'tenant.security.manage')
  );

create function tenant_config_versions_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'tenant_config_versions is append-only';
end;
$$;
revoke execute on function tenant_config_versions_append_only() from public, anon, authenticated;

create trigger tenant_config_versions_append_only
  before update or delete on tenant_config_versions
  for each row execute function tenant_config_versions_append_only();

create or replace function save_tenant_config(
  p_tenant uuid,
  p_actor uuid,
  p_expected_version integer,
  p_config jsonb,
  p_changes jsonb,
  p_restored_from integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest integer;
begin
  -- Serialize saves for this organization.
  perform 1 from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'unknown organization' using errcode = 'P0002';
  end if;
  select coalesce(max(version), 0) into latest from public.tenant_config_versions where tenant_id = p_tenant;
  if latest <> p_expected_version then
    raise exception 'configuration changed since it was read' using errcode = '40001';
  end if;
  insert into public.tenant_config_versions (tenant_id, version, config, changes, restored_from, created_by)
  values (p_tenant, latest + 1, p_config, p_changes, p_restored_from, p_actor);
  insert into public.tenant_settings (tenant_id, settings)
  values (p_tenant, jsonb_build_object('config', p_config))
  on conflict (tenant_id) do update
    set settings = public.tenant_settings.settings || jsonb_build_object('config', p_config),
        updated_at = now();
  return latest + 1;
end;
$$;
revoke execute on function save_tenant_config(uuid, uuid, integer, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function save_tenant_config(uuid, uuid, integer, jsonb, jsonb, integer) to service_role;

create or replace function my_session_policy()
returns table (idle_minutes integer, max_hours integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(min(case when (s.settings -> 'config' ->> 'session.idleMinutes') ~ '^[0-9]{1,3}$'
      then least(greatest((s.settings -> 'config' ->> 'session.idleMinutes')::integer, 5), 30) end), 30),
    coalesce(min(case when (s.settings -> 'config' ->> 'session.maxHours') ~ '^[0-9]{1,2}$'
      then least(greatest((s.settings -> 'config' ->> 'session.maxHours')::integer, 1), 12) end), 12)
  from public.tenant_memberships m
  join public.tenant_settings s on s.tenant_id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active';
$$;
revoke execute on function my_session_policy() from public, anon;
grant execute on function my_session_policy() to authenticated;

comment on table tenant_config_versions is 'Every saved version of an organization''s Global Configuration (lib/config/registry.ts). Append-only.';
comment on function my_session_policy() is 'The signed-in user''s session limits: the strictest of their active organizations, within the global 30 minutes idle and 12 hours.';
