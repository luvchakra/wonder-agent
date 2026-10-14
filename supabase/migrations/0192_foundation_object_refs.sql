-- Foundation Agent — short number keys for URLs (FOUNDATION-P0-34, owner
-- decision 2026-10-14, CLAUDE.md §19.13).
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.
--
-- Every object with its own page gets `ref`, a number per organization
-- (1, 2, 3, … in each organization, never reused, never changed), so its URL
-- is /identities/42 instead of a UUID. The UUID stays the primary key and
-- every foreign key; `ref` is only what URLs and people read.
--
-- - Generic objects: a BEFORE INSERT trigger draws the next number from a
--   per-organization, per-table counter row (the pattern of 0131 and 0190).
-- - Access requests: `ref` is the number in the request's REQ number (0190).
-- - Roles: built-in roles (no organization) are numbered first; an
--   organization's own roles continue after the highest built-in number, so
--   a number never names two roles an organization can see.
-- - Organizations (platform console only): one global sequence.
--
-- Existing rows are numbered oldest first. The backfill pauses each table's
-- own triggers so it changes no "updated by/on" and trips no guard: it only
-- fills the new column. Additive only.

create table object_ref_counters (
  tenant_id uuid not null references tenants (id) on delete cascade,
  table_name text not null,
  last_ref bigint not null default 0 check (last_ref >= 0),
  primary key (tenant_id, table_name)
);

alter table object_ref_counters enable row level security;
-- Members may read their organization's counters; only the triggers write them.
create policy object_ref_counters_select on object_ref_counters
  for select using (tenant_id in (select current_tenant_ids()));

create function assign_object_ref() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  -- Always drawn here: a number supplied by a caller is never trusted.
  insert into object_ref_counters as c (tenant_id, table_name, last_ref)
    values (new.tenant_id, tg_table_name, 1)
    on conflict (tenant_id, table_name) do update set last_ref = c.last_ref + 1
    returning c.last_ref into n;
  new.ref := n;
  return new;
end;
$$;

create function keep_object_ref() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.ref is not null and new.ref is distinct from old.ref then
    raise exception 'an object''s number cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function assign_object_ref() from public, anon, authenticated;
revoke execute on function keep_object_ref() from public, anon, authenticated;

-- Generic objects: column, backfill, constraints, triggers, counters.
do $$
declare
  t text;
  objects text[] := array[
    'accounts', 'agents', 'applications', 'entitlement_classification_rules',
    'application_onboarding_templates', 'access_packages', 'certification_campaigns',
    'certification_consultations', 'identities', 'lifecycle_rules', 'integrations',
    'application_discoveries', 'identity_sources', 'identity_reconciliation_runs',
    'policies', 'investigations', 'risk_findings', 'authorization_policies', 'groups',
    'privacy_breach_incidents', 'privacy_requests', 'tenant_memberships'
  ];
begin
  foreach t in array objects loop
    execute format('alter table public.%I add column ref bigint', t);
    execute format('alter table public.%I disable trigger user', t);
    execute format(
      'update public.%1$I x set ref = n.n from (select id, row_number() over (partition by tenant_id order by created_at, id) as n from public.%1$I) n where x.id = n.id',
      t);
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column ref set not null', t);
    execute format('create unique index %I on public.%I (tenant_id, ref)', t || '_ref_key', t);
    execute format('create trigger assign_object_ref before insert on public.%I for each row execute function assign_object_ref()', t);
    execute format('create trigger keep_object_ref before update of ref on public.%I for each row execute function keep_object_ref()', t);
    execute format(
      'insert into object_ref_counters (tenant_id, table_name, last_ref) select tenant_id, %L, max(ref) from public.%I group by tenant_id',
      t, t);
  end loop;
end;
$$;

-- Access requests: the number of the REQ number.
alter table access_requests add column ref bigint;
alter table access_requests disable trigger user;
update access_requests set ref = substring(request_number from 4)::bigint;
alter table access_requests enable trigger user;
alter table access_requests alter column ref set not null;
create unique index access_requests_ref_key on access_requests (tenant_id, ref);
create trigger keep_object_ref before update of ref on access_requests
  for each row execute function keep_object_ref();

create or replace function access_requests_assign_number() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  insert into access_request_counters as c (tenant_id, last_number, updated_at)
    values (new.tenant_id, 1, now())
    on conflict (tenant_id) do update set last_number = c.last_number + 1, updated_at = now()
    returning c.last_number into n;
  new.request_number := 'REQ' || lpad(n::text, 9, '0');
  new.ref := n;
  return new;
end;
$$;
revoke execute on function access_requests_assign_number() from public, anon, authenticated;

-- Roles: built-in roles first, then each organization's own after them.
alter table roles add column ref bigint;
alter table roles disable trigger user;
update roles x set ref = n.n
  from (select id, row_number() over (order by created_at, id) as n from roles where tenant_id is null) n
 where x.id = n.id;
update roles x set ref = n.n + (select coalesce(max(ref), 0) from roles where tenant_id is null)
  from (select id, row_number() over (partition by tenant_id order by created_at, id) as n from roles where tenant_id is not null) n
 where x.id = n.id;
alter table roles enable trigger user;
alter table roles alter column ref set not null;
create unique index roles_ref_key on roles (tenant_id, ref) where tenant_id is not null;
create unique index roles_builtin_ref_key on roles (ref) where tenant_id is null;

create function assign_role_ref() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  builtin bigint;
  n bigint;
begin
  -- Serialize built-in role numbering; organizations' roles skip past them.
  perform pg_advisory_xact_lock(hashtext('roles.ref'));
  select coalesce(max(ref), 0) into builtin from roles where tenant_id is null;
  if new.tenant_id is null then
    -- Above every number in use, so it collides with no organization's role.
    select coalesce(max(ref), 0) + 1 into n from roles;
  else
    insert into object_ref_counters as c (tenant_id, table_name, last_ref)
      values (new.tenant_id, 'roles', builtin + 1)
      on conflict (tenant_id, table_name) do update set last_ref = greatest(c.last_ref + 1, builtin + 1)
      returning c.last_ref into n;
  end if;
  new.ref := n;
  return new;
end;
$$;
revoke execute on function assign_role_ref() from public, anon, authenticated;

create trigger assign_role_ref before insert on roles
  for each row execute function assign_role_ref();
create trigger keep_object_ref before update of ref on roles
  for each row execute function keep_object_ref();

insert into object_ref_counters (tenant_id, table_name, last_ref)
  select tenant_id, 'roles', max(ref) from roles where tenant_id is not null group by tenant_id;

-- Organizations (platform console): one global sequence.
create sequence tenants_ref_seq;
alter table tenants add column ref bigint;
alter table tenants disable trigger user;
update tenants x set ref = n.n
  from (select id, row_number() over (order by created_at, id) as n from tenants) n
 where x.id = n.id;
alter table tenants enable trigger user;
select setval('tenants_ref_seq', greatest((select max(ref) from tenants), 1));
alter table tenants alter column ref set default nextval('tenants_ref_seq');
alter table tenants alter column ref set not null;
create unique index tenants_ref_key on tenants (ref);
create trigger keep_object_ref before update of ref on tenants
  for each row execute function keep_object_ref();
