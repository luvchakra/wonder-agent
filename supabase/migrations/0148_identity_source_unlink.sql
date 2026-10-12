-- Identity Agent + Integration Agent — WID-H01 (owner decision 12 October
-- 2026): unlink a source record from a person, with undo.
--
-- identity_source_changes (Identity): each value a source record changed on
-- an existing identity, with the value and provenance it replaced. Written
-- by the import before the change itself, so no change is applied without
-- the history to undo it. Unlinking the record restores the values it
-- changed that nobody has changed since. Values are a person's attributes,
-- so the table is tenant-scoped and read under the identities rule.
--
-- identity_source_rejections (Integration): the identities a source record
-- was unlinked from. Matching never links the record to one of them again
-- by itself; such a match waits in Pending Matches for a person, who may
-- link it back (which removes the rejection).
--
-- Only the service-role import and the unlink service write either table.

create table identity_source_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  identity_id uuid not null,
  source_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 300),
  -- The identity field, or attributes.<name> for a custom attribute.
  field text not null check (char_length(field) between 1 and 120),
  old_value jsonb,
  new_value jsonb,
  -- The field's provenance before this change (null: none).
  old_provenance jsonb,
  run_id uuid,
  changed_at timestamptz not null default now(),
  undone_at timestamptz,
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  foreign key (source_id, tenant_id) references identity_sources (id, tenant_id) on delete cascade
);

alter table identity_source_changes enable row level security;
create policy identity_source_changes_select on identity_source_changes
  for select using (tenant_id in (select current_tenant_ids()));

create index identity_source_changes_record_idx
  on identity_source_changes (tenant_id, source_id, external_id, identity_id, changed_at)
  where undone_at is null;
create index identity_source_changes_identity_fk_idx on identity_source_changes (identity_id, tenant_id);
create index identity_source_changes_source_fk_idx on identity_source_changes (source_id, tenant_id);
create index identity_source_changes_tenant_idx on identity_source_changes (tenant_id);

create table identity_source_rejections (
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 300),
  identity_id uuid not null,
  rejected_by uuid references users(id) on delete set null,
  rejected_at timestamptz not null default now(),
  primary key (source_id, external_id, identity_id),
  foreign key (source_id, tenant_id) references identity_sources (id, tenant_id) on delete cascade,
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade
);

alter table identity_source_rejections enable row level security;
create policy identity_source_rejections_select on identity_source_rejections
  for select using (tenant_id in (select current_tenant_ids()));

create index identity_source_rejections_source_fk_idx on identity_source_rejections (source_id, tenant_id);
create index identity_source_rejections_identity_fk_idx on identity_source_rejections (identity_id, tenant_id);
create index identity_source_rejections_tenant_idx on identity_source_rejections (tenant_id);
create index identity_source_rejections_user_idx on identity_source_rejections (rejected_by);
