-- ACCESS-P0-34 (design §5.8.2, §14): application onboarding templates per
-- connection type, with a questionnaire.
--
-- application_onboarding_templates: an organization's starting points for
-- onboarding an application. Each names a connection type (integration_types,
-- or none for an application without a connector) and carries:
-- - defaults: onboarding configuration fields (identifier and correlation
--   fields, entitlement source, operations, request and certification
--   policy, provenance) and default business and technical owners;
-- - entitlement_types: the types to declare on the application, with how
--   each is requested, certified and timed (ACCESS-P0-33);
-- - questions: the questionnaire whoever onboards the application answers
--   (text, yes/no or one of a list; required or not).
-- A retired template stays for the onboardings that used it.
--
-- application_onboardings gains the template it started from and the
-- questionnaire's answers. Members read; the Access service writes.

create table application_onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  integration_type_id text references integration_types(id) on delete restrict,
  defaults jsonb not null default '{}'::jsonb check (jsonb_typeof(defaults) = 'object'),
  entitlement_types jsonb not null default '[]'::jsonb check (jsonb_typeof(entitlement_types) = 'array'),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create unique index application_onboarding_templates_name_key on application_onboarding_templates (tenant_id, lower(name));
create index application_onboarding_templates_type_idx on application_onboarding_templates (tenant_id, integration_type_id) where status = 'active';
create index application_onboarding_templates_integration_type_idx on application_onboarding_templates (integration_type_id) where integration_type_id is not null;
create index application_onboarding_templates_created_by_idx on application_onboarding_templates (created_by) where created_by is not null;
create index application_onboarding_templates_updated_by_idx on application_onboarding_templates (updated_by) where updated_by is not null;

alter table application_onboarding_templates enable row level security;
create policy application_onboarding_templates_select on application_onboarding_templates for select using (tenant_id in (select current_tenant_ids()));

alter table application_onboardings
  add column template_id uuid,
  add column answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  add constraint application_onboardings_template_fk foreign key (template_id, tenant_id) references application_onboarding_templates (id, tenant_id) on delete restrict;

create index application_onboardings_template_idx on application_onboardings (template_id) where template_id is not null;
