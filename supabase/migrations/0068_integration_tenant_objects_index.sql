-- INTEGRATION (2026-09-25, §15) — serves the new tenant-wide read
-- getNormalizedObjectsForTenant(tenant, type) newest first, which replaced
-- one query per integration in Identity's discovery inbox. Additive: an
-- index only; no data, RLS or policy change.
create index if not exists integration_objects_tenant_type_imported_idx
  on integration_objects (tenant_id, object_type, imported_at desc);
