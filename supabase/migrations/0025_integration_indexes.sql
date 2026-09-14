-- Integration Agent — hardening follow-up from get_advisors (performance).

create index integration_credentials_tenant_id_idx on integration_credentials (tenant_id);
create index integration_objects_sync_job_id_idx on integration_objects (sync_job_id);
create index integrations_integration_type_id_idx on integrations (integration_type_id);
