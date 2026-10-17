-- Identity Agent — IDENTITY-P0-23: merge two records of the same person
-- (saviynt-reference-study D-6; owner decision 2026-10-17, "go ahead, write
-- it and deploy it").
--
-- A person compares two records side by side, picks per attribute which value
-- survives, and confirms. The merge then, in one transaction:
-- - copies the chosen attributes from the merged record onto the survivor;
-- - moves current-state references to the survivor: accounts and their access,
--   live package assignments, pending requests, open findings, current
--   relationships, source records, the people it manages, what it owns, and
--   the open tasks assigned to it;
-- - moves the WonderID sign-in when only the merged record has one;
-- - sets the merged record inactive and points it at the survivor.
-- History stays where it happened (decided requests, ledger of past reviews,
-- source changes, lifecycle events, audit). Every moved row id is kept in
-- the merge record, so `unmerge_identities()` moves exactly those back.
--
-- Nothing merges without a person: the functions run only as the service
-- role, from code that has checked identity.manage and audits the action.
-- A conflict (both records hold the same package, have the same pending
-- request, come from the same identity source, or both sign in) stops the
-- merge with a clear message and changes nothing.

alter table identities add column merged_into_identity_id uuid;
alter table identities
  add constraint identities_merged_into_same_tenant foreign key (merged_into_identity_id, tenant_id) references identities (id, tenant_id);
alter table identities add constraint identities_not_merged_into_self check (merged_into_identity_id is distinct from id);
create index identities_merged_into_idx on identities (merged_into_identity_id) where merged_into_identity_id is not null;

create table identity_merges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  survivor_identity_id uuid not null,
  merged_identity_id uuid not null,
  -- Attributes taken from the merged record.
  fields text[] not null default '{}',
  -- The survivor's values (and their provenance) before the merge, and the
  -- merged record's status and sign-in.
  survivor_before jsonb not null,
  merged_before jsonb not null,
  -- "table.column" -> the ids of the rows moved to the survivor.
  moved jsonb not null default '{}',
  reason text,
  merged_by uuid,
  merged_at timestamptz not null default now(),
  undone_by uuid,
  undone_at timestamptz,
  undo_reason text,
  constraint identity_merges_two_records check (survivor_identity_id <> merged_identity_id),
  constraint identity_merges_survivor_same_tenant foreign key (survivor_identity_id, tenant_id) references identities (id, tenant_id),
  constraint identity_merges_merged_same_tenant foreign key (merged_identity_id, tenant_id) references identities (id, tenant_id),
  constraint identity_merges_undo_complete check (undone_at is not null or (undone_by is null and undo_reason is null)),
  constraint identity_merges_undo_reason check (undone_at is null or undo_reason is not null)
);
create unique index identity_merges_active_key on identity_merges (tenant_id, merged_identity_id) where undone_at is null;
create index identity_merges_survivor_idx on identity_merges (tenant_id, survivor_identity_id);
create index identity_merges_merged_idx on identity_merges (merged_identity_id);

-- Members of the organization read its merges; only the functions below write.
alter table identity_merges enable row level security;
create policy identity_merges_select on identity_merges for select using (tenant_id in (select current_tenant_ids()));

-- Attributes a person may choose between. Kept in step with
-- MERGE_FIELDS in modules/agent-identity/identityMerge.ts.
create or replace function identity_merge_fields() returns text[]
language sql immutable set search_path = public as $$
  select array['display_name', 'username', 'email', 'department', 'title', 'business_unit', 'location', 'employment_type', 'organization', 'start_date', 'end_date', 'manager_identity_id']
$$;

-- What moves: table, column, and which of its rows are current state.
create or replace function identity_merge_moves() returns table (tbl text, col text, cond text)
language sql immutable set search_path = public as $$
  values
    ('accounts', 'identity_id', 'true'),
    ('accounts', 'unlinked_identity_id', 'true'),
    ('access_ledger', 'identity_id', 'true'),
    ('access_package_assignments', 'identity_id', $c$status in ('provisioning', 'active', 'partially_failed')$c$),
    ('access_requests', 'subject_identity_id', $c$status = 'pending'$c$),
    ('risk_findings', 'identity_id', $c$status not in ('resolved', 'false_positive')$c$),
    ('identity_relationships', 'source_identity_id', 'valid_to is null'),
    ('identity_relationships', 'target_identity_id', 'valid_to is null'),
    ('identities', 'manager_identity_id', 'true'),
    ('identities', 'owner_identity_id', 'true'),
    ('identities', 'sponsor_identity_id', 'true'),
    ('applications', 'business_owner_identity_id', 'true'),
    ('applications', 'technical_owner_identity_id', 'true'),
    ('entitlements', 'owner_identity_id', 'true'),
    ('access_packages', 'owner_identity_id', 'true'),
    ('identity_lifecycle_tasks', 'assignee_identity_id', $c$status = 'open'$c$),
    ('access_fulfilment_tasks', 'assignee_identity_id', $c$status in ('open', 'claimed')$c$),
    ('application_fulfilment_assignments', 'assignee_identity_id', 'true')
$$;

create or replace function merge_identities(p_tenant uuid, p_survivor uuid, p_merged uuid, p_fields text[], p_actor uuid, p_reason text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  s identities;
  m identities;
  f text;
  mv record;
  ids jsonb;
  moved jsonb := '{}';
  closed jsonb;
  links jsonb;
  prov jsonb;
  survivor_before jsonb;
  merge_id uuid;
begin
  if p_survivor = p_merged then
    raise exception 'Choose two different records.' using errcode = '22023';
  end if;
  select * into s from identities where id = p_survivor and tenant_id = p_tenant for update;
  select * into m from identities where id = p_merged and tenant_id = p_tenant for update;
  if s.id is null or m.id is null then
    raise exception 'One of the records was not found in this organization.' using errcode = 'P0002';
  end if;
  if s.identity_type <> m.identity_type or s.identity_type not in ('HUMAN', 'EXTERNAL') then
    raise exception 'Only two records of the same kind of person can be merged.' using errcode = '22023';
  end if;
  if s.merged_into_identity_id is not null or m.merged_into_identity_id is not null then
    raise exception 'One of the records has already been merged.' using errcode = '22023';
  end if;
  if s.user_id is not null and m.user_id is not null then
    raise exception 'Both records sign in to WonderID. Remove one person''s access first.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_fields, '{}')) x where x <> all (identity_merge_fields())) then
    raise exception 'An attribute that cannot be merged was chosen.' using errcode = '22023';
  end if;
  if p_fields @> array['manager_identity_id'] and m.manager_identity_id = p_survivor then
    raise exception 'A person cannot be their own manager.' using errcode = '22023';
  end if;
  if exists (select 1 from identity_source_links a join identity_source_links b on b.source_id = a.source_id
             where a.identity_id = p_survivor and b.identity_id = p_merged) then
    raise exception 'Both records come from the same identity source, so the source says they are different people.' using errcode = '23505';
  end if;
  if exists (select 1 from access_package_assignments a join access_package_assignments b on b.package_id = a.package_id
             where a.tenant_id = p_tenant and a.identity_id = p_survivor and b.identity_id = p_merged
               and a.status in ('provisioning', 'active', 'partially_failed') and b.status in ('provisioning', 'active', 'partially_failed')) then
    raise exception 'Both records hold the same access package. Remove it from one first.' using errcode = '23505';
  end if;
  if exists (select 1 from access_requests a join access_requests b
               on b.tenant_id = a.tenant_id
              and ((b.access_package_id is not null and b.access_package_id = a.access_package_id)
                or (b.access_package_id is null and a.access_package_id is null and b.application_id = a.application_id
                    and coalesce(b.entitlement_id, '00000000-0000-0000-0000-000000000000') = coalesce(a.entitlement_id, '00000000-0000-0000-0000-000000000000')))
             where a.tenant_id = p_tenant and a.subject_identity_id = p_survivor and b.subject_identity_id = p_merged
               and a.status = 'pending' and b.status = 'pending') then
    raise exception 'Both records have the same pending request. Decide or cancel one first.' using errcode = '23505';
  end if;

  -- The survivor's values before, for undo.
  survivor_before := jsonb_build_object('field_provenance', coalesce(s.field_provenance, '{}'::jsonb));
  foreach f in array coalesce(p_fields, '{}') loop
    survivor_before := survivor_before || jsonb_build_object(f, to_jsonb(s) -> f);
  end loop;

  -- 1. Attributes chosen from the merged record, with their provenance.
  prov := coalesce(s.field_provenance, '{}'::jsonb);
  foreach f in array coalesce(p_fields, '{}') loop
    execute format('update identities s set %1$I = m.%1$I from identities m where s.id = $1 and m.id = $2 and s.tenant_id = $3', f)
      using p_survivor, p_merged, p_tenant;
    prov := case when coalesce(m.field_provenance, '{}'::jsonb) ? f then prov || jsonb_build_object(f, m.field_provenance -> f) else prov - f end;
  end loop;
  update identities set field_provenance = prov where id = p_survivor and tenant_id = p_tenant;

  -- 2. Current relationships that would duplicate one of the survivor's, or
  -- link the two records to each other, end now.
  with c as (
    update identity_relationships r set valid_to = now()
     where r.tenant_id = p_tenant and r.valid_to is null
       and (r.source_identity_id = p_merged or r.target_identity_id = p_merged)
       and (
         r.source_identity_id = p_survivor or r.target_identity_id = p_survivor
         or exists (select 1 from identity_relationships o
                     where o.tenant_id = p_tenant and o.valid_to is null and o.relationship_type = r.relationship_type
                       and o.source_identity_id = case when r.source_identity_id = p_merged then p_survivor else r.source_identity_id end
                       and o.target_identity_id = case when r.target_identity_id = p_merged then p_survivor else r.target_identity_id end)
       )
    returning r.id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into closed from c;

  -- 3. Current-state references move to the survivor.
  for mv in select * from identity_merge_moves() loop
    execute format(
      'with u as (update %1$I set %2$I = $1 where tenant_id = $3 and %2$I = $2 and (%3$s) %4$s returning id) select coalesce(jsonb_agg(id), ''[]''::jsonb) from u',
      mv.tbl, mv.col, mv.cond, case when mv.tbl = 'identities' then 'and id <> $1' else '' end)
      into ids using p_survivor, p_merged, p_tenant;
    if jsonb_array_length(ids) > 0 then
      moved := moved || jsonb_build_object(mv.tbl || '.' || mv.col, ids);
    end if;
  end loop;

  -- Source records have no id of their own: keep (source, external id).
  with u as (update identity_source_links set identity_id = p_survivor where tenant_id = p_tenant and identity_id = p_merged returning source_id, external_id)
  select coalesce(jsonb_agg(jsonb_build_array(source_id, external_id)), '[]'::jsonb) into links from u;

  -- 4. The sign-in follows the person; the merged record goes inactive.
  update identities set user_id = null, status = 'inactive', merged_into_identity_id = p_survivor
   where id = p_merged and tenant_id = p_tenant;
  if m.user_id is not null then
    update identities set user_id = m.user_id where id = p_survivor and tenant_id = p_tenant;
  end if;

  insert into identity_merges (tenant_id, survivor_identity_id, merged_identity_id, fields, survivor_before, merged_before, moved, reason, merged_by)
  values (p_tenant, p_survivor, p_merged, coalesce(p_fields, '{}'), survivor_before,
          jsonb_build_object('status', m.status, 'user_id', m.user_id),
          moved || jsonb_build_object('identity_relationships.closed', closed, 'identity_source_links', links),
          nullif(btrim(p_reason), ''), p_actor)
  returning id into merge_id;
  return merge_id;
end;
$$;

create or replace function unmerge_identities(p_tenant uuid, p_merge uuid, p_actor uuid, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
  r identity_merges;
  k text;
  t text;
  c text;
  f text;
  survivor_user uuid;
begin
  select * into r from identity_merges where id = p_merge and tenant_id = p_tenant for update;
  if r.id is null then
    raise exception 'That merge was not found in this organization.' using errcode = 'P0002';
  end if;
  if r.undone_at is not null then
    raise exception 'That merge has already been undone.' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the merge is being undone.' using errcode = '22023';
  end if;
  perform 1 from identities where id in (r.survivor_identity_id, r.merged_identity_id) and tenant_id = p_tenant for update;

  -- The sign-in goes back first, so the unique sign-in index never sees it twice.
  if r.merged_before ->> 'user_id' is not null then
    select user_id into survivor_user from identities where id = r.survivor_identity_id;
    if survivor_user is distinct from (r.merged_before ->> 'user_id')::uuid then
      raise exception 'The sign-in has changed since the merge, so it cannot be undone automatically.' using errcode = '22023';
    end if;
    update identities set user_id = null where id = r.survivor_identity_id and tenant_id = p_tenant;
  end if;
  update identities
     set merged_into_identity_id = null, status = r.merged_before ->> 'status', user_id = (r.merged_before ->> 'user_id')::uuid
   where id = r.merged_identity_id and tenant_id = p_tenant;

  -- Attributes back to the survivor's values before.
  foreach f in array r.fields loop
    execute format('update identities set %1$I = (jsonb_populate_record(null::identities, $1)).%1$I where id = $2 and tenant_id = $3', f)
      using jsonb_build_object(f, r.survivor_before -> f), r.survivor_identity_id, p_tenant;
  end loop;
  update identities set field_provenance = r.survivor_before -> 'field_provenance' where id = r.survivor_identity_id and tenant_id = p_tenant;

  -- Exactly the rows that moved go back, if they still point at the survivor.
  for k in select jsonb_object_keys(r.moved) loop
    continue when k in ('identity_relationships.closed', 'identity_source_links');
    t := split_part(k, '.', 1);
    c := split_part(k, '.', 2);
    execute format('update %1$I set %2$I = $1 where tenant_id = $3 and %2$I = $2 and id in (select (jsonb_array_elements_text($4))::uuid)', t, c)
      using r.merged_identity_id, r.survivor_identity_id, p_tenant, r.moved -> k;
  end loop;
  update identity_relationships set valid_to = null
   where tenant_id = p_tenant and id in (select (jsonb_array_elements_text(coalesce(r.moved -> 'identity_relationships.closed', '[]')))::uuid);
  update identity_source_links l set identity_id = r.merged_identity_id
    from jsonb_array_elements(coalesce(r.moved -> 'identity_source_links', '[]')) e
   where l.tenant_id = p_tenant and l.identity_id = r.survivor_identity_id
     and l.source_id = (e ->> 0)::uuid and l.external_id = e ->> 1;

  update identity_merges set undone_at = now(), undone_by = p_actor, undo_reason = btrim(p_reason) where id = p_merge;
end;
$$;

revoke execute on function identity_merge_fields() from public, anon, authenticated;
revoke execute on function identity_merge_moves() from public, anon, authenticated;
revoke execute on function merge_identities(uuid, uuid, uuid, text[], uuid, text) from public, anon, authenticated;
revoke execute on function unmerge_identities(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function identity_merge_fields() to service_role;
grant execute on function identity_merge_moves() to service_role;
grant execute on function merge_identities(uuid, uuid, uuid, text[], uuid, text) to service_role;
grant execute on function unmerge_identities(uuid, uuid, uuid, text) to service_role;
