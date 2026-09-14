-- Integration Agent — INTEGRATION-P0-01.4
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.

create table integration_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  object_type text not null,
  source_field text not null,
  target_field text not null
);

create index integration_mappings_integration_id_idx on integration_mappings (integration_id);

alter table integration_mappings enable row level security;

-- No tenant_id column on this table (per its schema in
-- docs/plan/03-INTEGRATION-AGENT-BACKLOG.md INTEGRATION-P0-01.4) — isolation
-- is enforced via a join back to integrations.tenant_id. User-configured
-- (the field-mapping UI), so unlike integration_objects this does grant
-- client INSERT/UPDATE/DELETE, gated by the join plus integration.update in
-- the API route.
create policy integration_mappings_select on integration_mappings
  for select
  using (
    integration_id in (
      select id from integrations where tenant_id in (select current_tenant_ids())
    )
  );

create policy integration_mappings_insert on integration_mappings
  for insert
  with check (
    integration_id in (
      select id from integrations where tenant_id in (select current_tenant_ids())
    )
  );

create policy integration_mappings_update on integration_mappings
  for update
  using (
    integration_id in (
      select id from integrations where tenant_id in (select current_tenant_ids())
    )
  )
  with check (
    integration_id in (
      select id from integrations where tenant_id in (select current_tenant_ids())
    )
  );

create policy integration_mappings_delete on integration_mappings
  for delete
  using (
    integration_id in (
      select id from integrations where tenant_id in (select current_tenant_ids())
    )
  );
