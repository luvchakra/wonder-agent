-- Access Agent — INTEGRATION-P0-13 with ACCESS-P0-29 (decision D3, approved
-- 2026-10-12): fulfilment tasks carried out by a connector.
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.
--
-- When a remove-access or disable-account task opens for a system whose
-- connection has writes turned on and supports that operation, the
-- connector makes the change. These columns record that attempt on the
-- task, separately from what a person does with it:
--   connector_status   running → succeeded | failed (null: not tried)
--   connector_integration_id  the connection that wrote (same tenant)
--   connector_attempts, connector_started_at, connector_error
-- A succeeded write completes the task (not yet verified); reconciliation
-- verifies it. A failed one leaves the task open for its owner, with the
-- reason. Only the service writes these (no client write policy, as 0122).
--
-- Additive only.

alter table access_fulfilment_tasks
  add column connector_status text check (connector_status in ('running', 'succeeded', 'failed')),
  add column connector_integration_id uuid,
  add column connector_attempts integer not null default 0 check (connector_attempts between 0 and 20),
  add column connector_started_at timestamptz,
  add column connector_error text check (connector_error is null or char_length(connector_error) <= 1000),
  add constraint access_fulfilment_tasks_connector_integration_fkey
    foreign key (connector_integration_id, tenant_id) references integrations (id, tenant_id) on delete set null (connector_integration_id);

-- Covers the same-tenant foreign key (both its columns).
create index access_fulfilment_tasks_connector_integration_fk_idx on access_fulfilment_tasks (connector_integration_id, tenant_id) where connector_integration_id is not null;
-- The sweep for writes whose outcome never came back.
create index access_fulfilment_tasks_connector_running_idx on access_fulfilment_tasks (connector_started_at) where connector_status = 'running';
