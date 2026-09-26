-- ACCESS-P0-15 (WonderID Phase 3, 2026-09-26) — the application catalog.
--
-- Extends the existing `applications` table (it stays the one application
-- registry the access graph, policies and risk already use) with what an
-- enterprise catalog needs: type, vendor and URL, business and technical
-- owners (same-tenant references to WonderID identities), environment,
-- risk level, criticality, data classification, where it was discovered,
-- and an onboarding/lifecycle status using the spec's states (ACCESS-P0-16
-- drives the transitions).
--
-- Additive: every new column is nullable or defaulted. Applications that
-- already exist are in use (grants, policies, runtime decisions refer to
-- them), so they are backfilled as ACTIVE; new ones start DISCOVERED.
-- `source_integration_id` gets the same-tenant foreign key it lacked
-- (checked before adding: no row pointed elsewhere).

alter table applications
  add column display_name text check (display_name is null or char_length(display_name) between 1 and 200),
  add column description text check (description is null or char_length(description) <= 2000),
  add column app_type text not null default 'other' check (app_type in
    ('saas', 'on_prem', 'custom', 'cloud_platform', 'database', 'directory', 'ai_service', 'api', 'other')),
  add column vendor text check (vendor is null or char_length(vendor) <= 200),
  add column url text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  add column business_owner_identity_id uuid,
  add column technical_owner_identity_id uuid,
  add column environment text not null default 'production' check (environment in ('production', 'staging', 'development', 'test')),
  add column risk_level text check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical')),
  add column criticality text check (criticality is null or criticality in ('low', 'medium', 'high', 'critical')),
  add column data_classification text check (data_classification is null or data_classification in ('public', 'internal', 'confidential', 'restricted')),
  add column discovery_source text not null default 'manual' check (discovery_source in ('manual', 'integration', 'idp', 'openapi', 'scim')),
  add column onboarding_status text not null default 'DISCOVERED' check (onboarding_status in
    ('DISCOVERED', 'CONFIGURING', 'CONNECTED', 'VALIDATING', 'SIMULATION_FAILED', 'READY_FOR_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'RETIRED')),
  add column updated_at timestamptz not null default now(),
  add constraint applications_business_owner_fkey foreign key (business_owner_identity_id, tenant_id)
    references identities (id, tenant_id) on delete set null (business_owner_identity_id),
  add constraint applications_technical_owner_fkey foreign key (technical_owner_identity_id, tenant_id)
    references identities (id, tenant_id) on delete set null (technical_owner_identity_id),
  add constraint applications_source_integration_fkey foreign key (source_integration_id, tenant_id)
    references integrations (id, tenant_id) on delete set null (source_integration_id);

update applications
   set onboarding_status = 'ACTIVE',
       discovery_source = case when source_integration_id is not null then 'integration' else 'manual' end;

create index applications_business_owner_fk_idx on applications (business_owner_identity_id, tenant_id);
create index applications_technical_owner_fk_idx on applications (technical_owner_identity_id, tenant_id);
create index applications_source_integration_fk_idx on applications (source_integration_id, tenant_id);
create index applications_tenant_status_idx on applications (tenant_id, onboarding_status, name);
