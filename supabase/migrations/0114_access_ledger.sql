-- Access Agent — ACCESS-P0-24: the access ledger ("why does this identity have this access?").
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.
--
-- One row per access relationship seen in a target system: an account
-- (entitlement_id null: access to the application itself) or one
-- entitlement of an account (an access_grants row). The row says where the
-- access came from (source), what WonderID evidence backs it (a request, a
-- package assignment, an administrator's grant) and its status. Missing
-- evidence is UNPROVEN, never filled in (spec §18, H5).
--
-- The current row is recomputed from the evidence (refreshAccessLedger);
-- every change to it is appended to access_ledger_events, which is never
-- updated or deleted, so history is not overwritten (spec §18.5).
--
-- ROGUE and LEGACY_EXCEPTION are reserved for ACCESS-P0-25's classification
-- (configurable, with a go-live cut-off the owner will set); until then,
-- access without WonderID evidence is UNPROVEN, never ROGUE.
--
-- Writes run on the server with the service role, every statement filtered
-- on the tenant; members read their own organization's rows (as
-- access_grants, 0027).

create table access_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null,
  entitlement_id uuid,
  application_id uuid not null,
  identity_id uuid,
  access_grant_id uuid references access_grants(id) on delete set null,
  source text not null check (source in (
    'WONDERID_REQUEST', 'WONDERID_ROLE', 'WONDERID_ACCESS_PACKAGE', 'WONDERID_LIFECYCLE', 'IMPORT',
    'LEGACY_MIGRATION', 'ADMIN_ASSIGNMENT', 'EMERGENCY_ACCESS', 'AGENT_AUTHORIZATION', 'UNKNOWN'
  )),
  status text not null check (status in (
    'VALID', 'EXPIRED', 'REVOKED', 'UNPROVEN', 'ROGUE', 'LEGACY_EXCEPTION', 'PENDING_RECONCILIATION'
  )),
  request_id uuid,
  access_package_assignment_id uuid,
  source_integration_id uuid,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  business_justification text check (business_justification is null or char_length(business_justification) <= 2000),
  start_at timestamptz,
  expiry_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_used_at timestamptz,
  missing_from_source_at timestamptz,
  -- References to the evidence used (ids and kinds), never copied secrets or row contents.
  evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (account_id, tenant_id) references accounts (id, tenant_id) on delete cascade,
  foreign key (entitlement_id, tenant_id) references entitlements (id, tenant_id) on delete cascade,
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete set null (identity_id),
  foreign key (request_id, tenant_id) references access_requests (id, tenant_id) on delete set null (request_id),
  foreign key (access_package_assignment_id, tenant_id) references access_package_assignments (id, tenant_id) on delete set null (access_package_assignment_id),
  foreign key (source_integration_id, tenant_id) references integrations (id, tenant_id) on delete set null (source_integration_id)
);

-- One row per relationship: an account, or one entitlement of it.
create unique index access_ledger_relationship_key on access_ledger (tenant_id, account_id, entitlement_id) nulls not distinct;
create index access_ledger_identity_idx on access_ledger (identity_id, tenant_id);
create index access_ledger_tenant_status_idx on access_ledger (tenant_id, status);
create index access_ledger_account_idx on access_ledger (account_id, tenant_id);
create index access_ledger_entitlement_idx on access_ledger (entitlement_id, tenant_id);
create index access_ledger_application_idx on access_ledger (application_id, tenant_id);
create index access_ledger_grant_idx on access_ledger (access_grant_id);
create index access_ledger_request_idx on access_ledger (request_id, tenant_id);
create index access_ledger_assignment_idx on access_ledger (access_package_assignment_id, tenant_id);
create index access_ledger_integration_idx on access_ledger (source_integration_id, tenant_id);
create index access_ledger_approved_by_idx on access_ledger (approved_by);

alter table access_ledger enable row level security;
create policy access_ledger_select on access_ledger
  for select using (tenant_id in (select current_tenant_ids()));
-- No client insert/update/delete policy: only the server's ledger refresh writes.

-- The history: one row per change to a relationship's provenance or status.
-- No foreign key to access_ledger, so history outlives a deleted account.
create table access_ledger_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ledger_id uuid not null,
  account_id uuid not null,
  entitlement_id uuid,
  identity_id uuid,
  event_type text not null check (event_type in ('recorded', 'changed', 'missing_from_source', 'seen_again')),
  from_status text,
  to_status text not null,
  from_source text,
  to_source text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index access_ledger_events_ledger_idx on access_ledger_events (ledger_id, occurred_at desc);
create index access_ledger_events_tenant_idx on access_ledger_events (tenant_id, occurred_at desc);
create index access_ledger_events_identity_idx on access_ledger_events (identity_id, tenant_id);

alter table access_ledger_events enable row level security;
create policy access_ledger_events_select on access_ledger_events
  for select using (tenant_id in (select current_tenant_ids()));

-- Append-only: no update, and no delete except the cascade of a deleted
-- organization (fired from inside the foreign key's own trigger, depth > 1).
create function access_ledger_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'access_ledger_events is append-only';
end;
$$;
revoke execute on function access_ledger_events_append_only() from public, anon, authenticated;

create trigger access_ledger_events_append_only
  before update or delete on access_ledger_events
  for each row execute function access_ledger_events_append_only();
