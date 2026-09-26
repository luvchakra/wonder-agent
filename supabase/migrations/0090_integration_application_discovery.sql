-- INTEGRATION-P0-10 (WonderID Phase 3, 2026-09-26) — application
-- discovery: applications found by a connector's imports, an OpenAPI
-- document, SCIM service-provider metadata or a manual report, matched to
-- the catalog (Access's `applications`) or held as UNRECOGNIZED until a
-- person decides: register, link to an existing application, record an
-- exception, or ignore with a reason. Nothing is deleted: an ignored
-- discovery stays, with who ignored it and why, and a later sighting
-- updates it rather than raising it again.
--
-- RLS: members read their tenant's rows. There is no insert, update or
-- delete policy: decisions must be tamper-resistant and attributable
-- (#11), so the service writes with the service role after checking
-- `integration.update`, always filtered by the tenant resolved from the
-- session.

create table application_discoveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source text not null check (source in ('integration', 'openapi', 'scim', 'manual')),
  source_integration_id uuid,
  -- What identifies it in its source, normalized (lower case, trimmed), so
  -- a later sighting updates this row instead of creating another.
  source_key text not null check (char_length(source_key) between 1 and 300),
  name text not null check (char_length(name) between 1 and 200),
  vendor text check (vendor is null or char_length(vendor) <= 200),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  description text check (description is null or char_length(description) <= 2000),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'UNRECOGNIZED' check (status in ('UNRECOGNIZED', 'MATCHED', 'REGISTERED', 'EXCEPTION', 'IGNORED')),
  application_id uuid,
  suggested_application_id uuid,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  exception_until date,
  sightings integer not null default 1 check (sightings >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  unique (id, tenant_id),
  unique (tenant_id, source, source_key),
  -- An ignored or excepted discovery says why. (A matched or registered one
  -- names its application; the service enforces that, since the key to
  -- the application nulls it if the application is ever deleted.)
  check (status not in ('IGNORED', 'EXCEPTION') or decision_note is not null),
  foreign key (source_integration_id, tenant_id) references integrations (id, tenant_id) on delete set null (source_integration_id),
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete set null (application_id),
  foreign key (suggested_application_id, tenant_id) references applications (id, tenant_id) on delete set null (suggested_application_id)
);
create index application_discoveries_tenant_status_idx on application_discoveries (tenant_id, status, last_seen_at desc);
create index application_discoveries_integration_idx on application_discoveries (source_integration_id, tenant_id);
create index application_discoveries_application_idx on application_discoveries (application_id, tenant_id);
create index application_discoveries_suggested_idx on application_discoveries (suggested_application_id, tenant_id);
create index application_discoveries_decided_by_idx on application_discoveries (decided_by);
create index application_discoveries_created_by_idx on application_discoveries (created_by);

alter table application_discoveries enable row level security;
create policy application_discoveries_select on application_discoveries
  for select using (tenant_id in (select current_tenant_ids()));
