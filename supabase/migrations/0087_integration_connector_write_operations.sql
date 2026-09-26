-- INTEGRATION-P0-11 (WonderID Phase 3, 2026-09-26) — the connector write
-- interface's idempotency record. Every write (create/update/disable/
-- delete account, grant/revoke access) is recorded here under the caller's
-- idempotency key BEFORE the connector is called: the unique key is the
-- lock, so a retry or a concurrent duplicate returns the first outcome
-- instead of acting twice (spec S6/§17.6), and a key reused for a
-- different request is refused.
--
-- `target` holds identifiers only (validated: no secret-named fields).
-- RLS: members read their tenant's rows; only the service-role worker
-- writes, with explicit tenant filters (the sync-job pattern).

create table connector_write_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  operation text not null check (operation in
    ('create_account', 'update_account', 'disable_account', 'delete_account', 'grant_access', 'revoke_access')),
  request_fingerprint text not null check (char_length(request_fingerprint) = 64),
  target jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object'),
  status text not null default 'requested' check (status in ('requested', 'succeeded', 'failed', 'blocked')),
  external_id text check (external_id is null or char_length(external_id) <= 300),
  error text check (error is null or char_length(error) <= 1000),
  requested_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, integration_id, idempotency_key),
  foreign key (integration_id, tenant_id) references integrations (id, tenant_id) on delete cascade
);
create index connector_write_operations_integration_idx on connector_write_operations (integration_id, tenant_id, created_at desc);
create index connector_write_operations_requested_by_idx on connector_write_operations (requested_by);

alter table connector_write_operations enable row level security;
create policy connector_write_operations_select on connector_write_operations
  for select using (tenant_id in (select current_tenant_ids()));
