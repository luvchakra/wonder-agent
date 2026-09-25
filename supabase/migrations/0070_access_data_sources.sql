-- ACCESS-P0-13 (master stories P0-11) — data sources inventory. User
-- decision 2026-09-25: Access owns data sources beside `applications`.
--
-- A data source is where data lives (a database, warehouse, bucket, file
-- share, SaaS object, API), optionally inside an application, with a
-- classification. Entitlements may point at the data source they grant
-- access to, so effective access (CAN) carries the data source and its
-- classification.
--
-- Additive only: one new table and one nullable column on entitlements.
-- Same RLS pattern as `applications` (0026): tenant-scoped select /
-- insert / update for the calling user, with access.manage checked in the
-- service and API. No delete policy: a data source is retired, not
-- removed, so the evidence that referenced it stays intact.

-- Composite-key target for the same-tenant foreign keys below.
alter table applications add constraint applications_id_tenant_key unique (id, tenant_id);

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (kind in ('database', 'warehouse', 'object_store', 'file_share', 'saas', 'api', 'other')),
  classification text check (classification is null or char_length(classification) <= 100),
  owner text check (owner is null or char_length(owner) <= 200),
  description text check (description is null or char_length(description) <= 2000),
  external_ref text check (external_ref is null or char_length(external_ref) <= 500),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id),
  -- Same-tenant references are enforced by the database, not only by the
  -- service: a composite key means a data source can only point at an
  -- application of its own tenant (§14, non-negotiable #4).
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete set null (application_id)
);

create index data_sources_application_idx on data_sources (application_id);

alter table data_sources enable row level security;

create policy data_sources_select on data_sources
  for select using (tenant_id in (select current_tenant_ids()));
create policy data_sources_insert on data_sources
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy data_sources_update on data_sources
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

alter table entitlements add column data_source_id uuid;
alter table entitlements add constraint entitlements_data_source_same_tenant_fkey
  foreign key (data_source_id, tenant_id) references data_sources (id, tenant_id) on delete set null (data_source_id);
create index entitlements_data_source_idx on entitlements (data_source_id);
