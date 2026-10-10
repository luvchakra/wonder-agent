-- Integration Agent — the file connector (CSV), connection schedules and object-page imports.
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- User decision (2026-10-10): CSV is a connector type for scheduled,
-- job-based ingestion, and each object page may import a CSV directly,
-- through the connector framework (non-negotiable #20).
--
-- 1. connector_files: the CSV files sent to a file connection's receiver
--    (/api/connect/v1/<id>/file) or imported from an object page
--    (/api/v1/imports), kept until a sync reads them. A file holds an
--    organization's raw data (names, emails, access), so like
--    connector_receivers (0109) and integration_credentials (0021) it has
--    RLS on and NO client policy: only server code reads it, with the
--    service role and an explicit tenant filter on every query
--    (modules/integrations/framework/files.ts). A select policy without the
--    content was considered and not taken: hiding one column from a
--    PostgREST select needs column grants, which a later `grant select`
--    silently undoes. The connection page shows file metadata through a
--    server function instead.
--    Writes: insert (a received file), update of consumed_at (a sync read
--    it), and the daily retention purge (the newest 5 per connection are
--    kept; an unread file is never purged).
-- 2. integrations.schedule: manual | hourly | daily, as identity_sources.schedule
--    (0081). The daily cron /api/cron/connector-syncs runs due connections.
-- 3. integration_sync_jobs.schedule_window: the window a scheduled job ran
--    for ('d:2026-10-10', 'h:2026-10-10T05'). A unique index makes the cron
--    idempotent per (connection, window); clients cannot set it.
-- 4. One "File imports" connection per tenant (config.purpose =
--    'file_imports'): a unique index, so two concurrent first imports
--    cannot create two.
-- 5. connector_definitions accepts every driver the framework has (mcp,
--    file, none were missing from 0108's check) and the ai_runtime and
--    event_source categories.
--
-- Additive: new table, new nullable/defaulted columns, new indexes, a
-- widened check, a tightened client insert policy. Nothing is deleted.

-- 1. connector_files
create table connector_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid not null,
  kind text not null check (kind in ('identity', 'account', 'entitlement', 'access_grant', 'application', 'policy')),
  filename text check (filename is null or char_length(filename) <= 200),
  byte_size integer not null check (byte_size between 0 and 10485760),
  row_count integer not null check (row_count between 0 and 50000),
  content text not null check (octet_length(content) <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_by uuid references users(id) on delete set null,
  constraint connector_files_integration_fkey
    foreign key (integration_id, tenant_id) references integrations (id, tenant_id) on delete cascade
);

create index connector_files_integration_received_idx on connector_files (integration_id, received_at desc);
create index connector_files_unread_idx on connector_files (integration_id, kind, received_at desc) where consumed_at is null;
create index connector_files_tenant_idx on connector_files (tenant_id);
create index connector_files_created_by_idx on connector_files (created_by);

alter table connector_files enable row level security;
-- Intentionally no policies (see 1. above).

-- 2. Connection schedules
alter table integrations add column schedule text not null default 'manual'
  check (schedule in ('manual', 'hourly', 'daily'));
create index integrations_scheduled_idx on integrations (schedule) where schedule <> 'manual';

-- 3. Idempotent scheduled runs
alter table integration_sync_jobs add column schedule_window text
  check (schedule_window is null or schedule_window ~ '^(d:[0-9]{4}-[0-9]{2}-[0-9]{2}|h:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2})$');
create unique index integration_sync_jobs_schedule_window_uidx
  on integration_sync_jobs (integration_id, schedule_window) where schedule_window is not null;

-- A client-created job is a manual one: it can never claim a schedule
-- window (and so block the cron's run for it). Otherwise unchanged from 0022.
alter policy integration_sync_jobs_insert on integration_sync_jobs
  with check (
    tenant_id in (select current_tenant_ids())
    and status = 'queued'
    and started_at is null
    and ended_at is null
    and records_processed = 0
    and records_failed = 0
    and errors = '[]'::jsonb
    and schedule_window is null
  );

-- 4. One File imports connection per tenant
create unique index integrations_file_imports_uidx on integrations (tenant_id)
  where (config ->> 'purpose') = 'file_imports';

-- 5. Every driver and category the framework has
alter table connector_definitions drop constraint connector_definitions_driver_check;
alter table connector_definitions add constraint connector_definitions_driver_check
  check (driver in ('http', 'ldap', 'sql', 'mcp', 'file', 'none'));
alter table connector_definitions drop constraint connector_definitions_category_check;
alter table connector_definitions add constraint connector_definitions_category_check
  check (category in ('hr', 'identity_provider', 'directory', 'application', 'database', 'secrets', 'infrastructure', 'ai_runtime', 'event_source', 'other'));
