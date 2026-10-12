-- Identity Agent — WID-H01 (owner decision 12 October 2026): the current
-- source-priority rule, plus a list of disagreements.
--
-- When two identity sources disagree on a field the higher-priority one
-- owns, the higher-priority value still wins (unchanged), and the
-- disagreement is kept here with both values and both sources, for people
-- to review. It resolves by itself when the sources agree again.
--
-- Values are a person's attributes (department, title, …), so the table is
-- tenant-scoped and readable under the same rule as identities; only the
-- import (service role) writes it. Removing a source removes the
-- disagreements it raised.

create table identity_source_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  identity_id uuid not null references identities(id) on delete cascade,
  field text not null check (char_length(field) between 1 and 120),
  kept_value text,
  kept_source_id uuid references identity_sources(id) on delete set null,
  other_value text,
  other_source_id uuid not null references identity_sources(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table identity_source_conflicts enable row level security;

create policy identity_source_conflicts_select on identity_source_conflicts
  for select
  using (tenant_id in (select current_tenant_ids()));

-- One open disagreement per person, field and disagreeing source.
create unique index identity_source_conflicts_open_key
  on identity_source_conflicts (tenant_id, identity_id, field, other_source_id)
  where resolved_at is null;
create index identity_source_conflicts_tenant_open_idx on identity_source_conflicts (tenant_id, last_seen_at desc) where resolved_at is null;
create index identity_source_conflicts_identity_idx on identity_source_conflicts (identity_id);
create index identity_source_conflicts_other_source_idx on identity_source_conflicts (other_source_id);
create index identity_source_conflicts_kept_source_idx on identity_source_conflicts (kept_source_id);
create index identity_source_conflicts_tenant_idx on identity_source_conflicts (tenant_id);
