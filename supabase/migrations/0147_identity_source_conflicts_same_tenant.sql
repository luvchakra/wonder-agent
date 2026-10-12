-- Identity Agent — WID-H01: the disagreement list (0146) points only at
-- its own organization's people and sources, like every other identity
-- source table (0081): same-tenant composite foreign keys, so not even a
-- service-role write can attach a disagreement in A to B's person or source.

alter table identity_source_conflicts
  drop constraint identity_source_conflicts_identity_id_fkey,
  drop constraint identity_source_conflicts_kept_source_id_fkey,
  drop constraint identity_source_conflicts_other_source_id_fkey,
  add constraint identity_source_conflicts_identity_fkey
    foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  add constraint identity_source_conflicts_kept_source_fkey
    foreign key (kept_source_id, tenant_id) references identity_sources (id, tenant_id) on delete set null (kept_source_id),
  add constraint identity_source_conflicts_other_source_fkey
    foreign key (other_source_id, tenant_id) references identity_sources (id, tenant_id) on delete cascade;
