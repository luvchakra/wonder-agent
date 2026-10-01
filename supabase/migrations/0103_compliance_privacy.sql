-- Compliance Agent — COMPLIANCE-P0-12 Privacy programme: GDPR (EU/UK) and
-- India's Digital Personal Data Protection Act 2023 + DPDP Rules 2025.
-- Explicit user request, 2026-10-01.
-- Owner: Compliance Agent. See docs/design/ownership-map.md before modifying.
--
-- WonderID is a processor (GDPR) / processes on behalf of the customer as
-- Data Fiduciary (DPDP) for the identity data a tenant governs, and these
-- tables give the tenant the controls those laws require of it:
--   privacy_settings              DPO (GDPR Art. 37-39), EU/UK representative
--                                 (Art. 27), DPDP grievance officer / DPO
--                                 contact (s.8(9), Rule 9) and regimes.
--   privacy_processing_activities Records of processing (GDPR Art. 30).
--   privacy_consent_purposes /    Consent: specific purpose, notice version,
--   privacy_consent_records       language, withdrawal as easy as giving
--                                 (GDPR Art. 7; DPDP s.5-6, Rule 3).
--   privacy_requests              Data-subject / data-principal rights with
--                                 statutory deadlines (GDPR Art. 12, 15-22;
--                                 DPDP s.11-14, Rule 14).
--   privacy_retention_policies /  Storage limitation (GDPR Art. 5(1)(e);
--   privacy_legal_holds           DPDP s.8(7), Rule 8) with legal holds.
--   privacy_breach_incidents      Breach register with the 72-hour clocks
--                                 (GDPR Art. 33-34; DPDP s.8(6), Rule 7).
--
-- Every table is tenant-scoped, RLS-enabled, and readable only with the
-- privacy.view permission (has_tenant_permission(), 0101). No client
-- writes: every change goes through modules/privacy after the matching
-- permission check, and is audited.

create table privacy_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  regimes text[] not null default array['gdpr', 'dpdp']::text[]
    check (regimes <@ array['gdpr', 'uk_gdpr', 'dpdp', 'ccpa']::text[]),
  dpo_name text check (dpo_name is null or char_length(dpo_name) <= 200),
  dpo_email text check (dpo_email is null or (dpo_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(dpo_email) <= 320)),
  grievance_officer_name text check (grievance_officer_name is null or char_length(grievance_officer_name) <= 200),
  grievance_officer_email text check (grievance_officer_email is null or (grievance_officer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(grievance_officer_email) <= 320)),
  grievance_officer_phone text check (grievance_officer_phone is null or char_length(grievance_officer_phone) <= 40),
  eu_representative text check (eu_representative is null or char_length(eu_representative) <= 500),
  supervisory_authority text check (supervisory_authority is null or char_length(supervisory_authority) <= 200),
  privacy_notice_url text check (privacy_notice_url is null or privacy_notice_url ~ '^https://'),
  privacy_notice_version text check (privacy_notice_version is null or char_length(privacy_notice_version) <= 40),
  significant_data_fiduciary boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index privacy_settings_updated_by_idx on privacy_settings (updated_by);
alter table privacy_settings enable row level security;
create policy privacy_settings_select on privacy_settings for select
  using (has_tenant_permission(tenant_id, 'privacy.view'));

create table privacy_processing_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  purpose text not null check (char_length(purpose) between 2 and 2000),
  lawful_basis text not null check (lawful_basis in (
    'consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests',
    'dpdp_consent', 'dpdp_legitimate_use')),
  data_categories text[] not null default '{}',
  special_categories boolean not null default false,
  subject_categories text[] not null default '{}',
  recipients text[] not null default '{}',
  transfer_countries text[] not null default '{}' check (array_to_string(transfer_countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  transfer_mechanism text not null default 'none' check (transfer_mechanism in ('none', 'adequacy', 'sccs', 'bcrs', 'derogation', 'dpdp_permitted')),
  retention_days integer check (retention_days is null or retention_days between 1 and 36500),
  security_measures text check (security_measures is null or char_length(security_measures) <= 4000),
  dpia_required boolean not null default false,
  dpia_completed_at timestamptz,
  owner_id uuid references users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_ropa_transfer_basis check (cardinality(transfer_countries) = 0 or transfer_mechanism <> 'none')
);

create index privacy_ropa_tenant_idx on privacy_processing_activities (tenant_id, status);
create index privacy_ropa_owner_idx on privacy_processing_activities (owner_id);
create index privacy_ropa_created_by_idx on privacy_processing_activities (created_by);
alter table privacy_processing_activities enable row level security;
create policy privacy_ropa_select on privacy_processing_activities for select
  using (has_tenant_permission(tenant_id, 'privacy.view'));

create table privacy_consent_purposes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  title text not null check (char_length(title) between 2 and 200),
  description text not null check (char_length(description) between 10 and 4000),
  notice_version text not null check (char_length(notice_version) between 1 and 40),
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create index privacy_consent_purposes_created_by_idx on privacy_consent_purposes (created_by);
alter table privacy_consent_purposes enable row level security;
-- A member sees the purposes they can consent to (their own consent page).
create policy privacy_consent_purposes_select on privacy_consent_purposes for select
  using (tenant_id in (select current_tenant_ids()));

-- One row per grant; a withdrawal closes that row and a re-grant opens a
-- new one, so the history of what was agreed, to which notice version, in
-- which language, stays provable (GDPR Art. 7(1); DPDP s.6(10)).
create table privacy_consent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  purpose_id uuid not null references privacy_consent_purposes(id) on delete cascade,
  subject_user_id uuid references users(id) on delete set null,
  subject_identifier text not null check (char_length(subject_identifier) between 1 and 320),
  notice_version text not null,
  language text not null default 'en' check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  channel text not null check (channel in ('web', 'api', 'import', 'paper', 'consent_manager')),
  status text not null default 'granted' check (status in ('granted', 'withdrawn')),
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  recorded_by uuid references users(id) on delete set null,
  constraint privacy_consent_withdrawn_shape check ((status = 'withdrawn') = (withdrawn_at is not null))
);

create unique index privacy_consent_one_active on privacy_consent_records (tenant_id, purpose_id, subject_identifier) where status = 'granted';
create index privacy_consent_subject_idx on privacy_consent_records (tenant_id, subject_user_id);
create index privacy_consent_purpose_idx on privacy_consent_records (purpose_id);
create index privacy_consent_recorded_by_idx on privacy_consent_records (recorded_by);
alter table privacy_consent_records enable row level security;
-- The subject always sees their own consents; privacy staff see all.
create policy privacy_consent_records_select on privacy_consent_records for select
  using (
    (tenant_id in (select current_tenant_ids()) and subject_user_id = auth.uid())
    or has_tenant_permission(tenant_id, 'privacy.view')
  );

-- A consent record may only move granted -> withdrawn (or be pseudonymised
-- on erasure); its terms never change after the fact.
create or replace function privacy_consent_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.purpose_id is distinct from old.purpose_id
     or new.notice_version is distinct from old.notice_version or new.language is distinct from old.language
     or new.channel is distinct from old.channel or new.granted_at is distinct from old.granted_at then
    raise exception 'consent terms are immutable once recorded' using errcode = '42501';
  end if;
  if old.status = 'withdrawn' and new.status = 'granted' then
    raise exception 'a withdrawn consent is re-granted as a new record' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function privacy_consent_guard() from public, anon, authenticated;
create trigger privacy_consent_guard before update on privacy_consent_records
  for each row execute function privacy_consent_guard();

create table privacy_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reference text not null,
  regime text not null check (regime in ('gdpr', 'uk_gdpr', 'dpdp', 'ccpa')),
  request_type text not null check (request_type in (
    'access', 'portability', 'rectification', 'erasure', 'restriction', 'objection',
    'withdraw_consent', 'grievance', 'nomination', 'opt_out')),
  subject_user_id uuid references users(id) on delete set null,
  subject_email text not null check (char_length(subject_email) between 3 and 320),
  subject_name text check (subject_name is null or char_length(subject_name) <= 200),
  description text check (description is null or char_length(description) <= 4000),
  channel text not null check (channel in ('self_service', 'email', 'web_form', 'api', 'phone', 'post', 'other')),
  status text not null default 'received' check (status in (
    'received', 'identity_verification', 'in_progress', 'awaiting_approval', 'completed', 'rejected', 'withdrawn')),
  received_at timestamptz not null default now(),
  due_at timestamptz not null,
  extended_due_at timestamptz,
  extension_reason text check (extension_reason is null or char_length(extension_reason) between 10 and 2000),
  identity_verified_at timestamptz,
  identity_verified_by uuid references users(id) on delete set null,
  verification_method text check (verification_method is null or char_length(verification_method) <= 200),
  assigned_to uuid references users(id) on delete set null,
  outcome text check (outcome is null or outcome in ('fulfilled', 'partially_fulfilled', 'refused')),
  outcome_reason text check (outcome_reason is null or char_length(outcome_reason) <= 4000),
  processed_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference),
  constraint privacy_requests_extension_shape check ((extended_due_at is null) = (extension_reason is null)),
  constraint privacy_requests_extension_later check (extended_due_at is null or extended_due_at > due_at),
  -- Four eyes on erasure: whoever processed it cannot also approve it.
  constraint privacy_requests_four_eyes check (approved_by is null or processed_by is null or approved_by <> processed_by),
  constraint privacy_requests_closed_shape check (status not in ('completed', 'rejected') or (completed_at is not null and outcome is not null))
);

create index privacy_requests_tenant_idx on privacy_requests (tenant_id, status, due_at);
create index privacy_requests_subject_idx on privacy_requests (subject_user_id);
create index privacy_requests_assigned_idx on privacy_requests (assigned_to);
create index privacy_requests_verified_by_idx on privacy_requests (identity_verified_by);
create index privacy_requests_processed_by_idx on privacy_requests (processed_by);
create index privacy_requests_approved_by_idx on privacy_requests (approved_by);
create index privacy_requests_created_by_idx on privacy_requests (created_by);
alter table privacy_requests enable row level security;
-- A subject sees their own requests; privacy staff see all.
create policy privacy_requests_select on privacy_requests for select
  using (
    (tenant_id in (select current_tenant_ids()) and subject_user_id = auth.uid())
    or has_tenant_permission(tenant_id, 'privacy.view')
  );

create table privacy_retention_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  data_category text not null check (data_category in (
    'audit_logs', 'runtime_events', 'notifications', 'closed_privacy_requests', 'withdrawn_consents', 'removed_members')),
  retention_days integer not null check (retention_days between 30 and 36500),
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_run_affected bigint,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, data_category),
  -- DPDP Rules 2025 Rule 8(3) keep logs at least one year; SOX-relevant
  -- audit evidence is kept far longer by plan (7 years on enterprise).
  constraint privacy_retention_audit_floor check (data_category <> 'audit_logs' or retention_days >= 365)
);

create index privacy_retention_updated_by_idx on privacy_retention_policies (updated_by);
alter table privacy_retention_policies enable row level security;
create policy privacy_retention_select on privacy_retention_policies for select
  using (has_tenant_permission(tenant_id, 'privacy.view'));

create table privacy_legal_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  reason text not null check (char_length(reason) between 10 and 2000),
  data_categories text[] not null check (cardinality(data_categories) > 0 and data_categories <@ array[
    'audit_logs', 'runtime_events', 'notifications', 'closed_privacy_requests', 'withdrawn_consents', 'removed_members']::text[]),
  placed_by uuid not null references users(id),
  placed_at timestamptz not null default now(),
  released_by uuid references users(id),
  released_at timestamptz,
  constraint privacy_legal_holds_release_shape check ((released_at is null) = (released_by is null))
);

create index privacy_legal_holds_tenant_idx on privacy_legal_holds (tenant_id) where released_at is null;
create index privacy_legal_holds_placed_by_idx on privacy_legal_holds (placed_by);
create index privacy_legal_holds_released_by_idx on privacy_legal_holds (released_by);
alter table privacy_legal_holds enable row level security;
create policy privacy_legal_holds_select on privacy_legal_holds for select
  using (has_tenant_permission(tenant_id, 'privacy.view'));

create table privacy_breach_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  reference text not null,
  title text not null check (char_length(title) between 3 and 200),
  description text not null check (char_length(description) between 10 and 8000),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  risk_to_individuals text not null check (risk_to_individuals in ('unlikely', 'risk', 'high_risk')),
  regimes text[] not null check (cardinality(regimes) > 0 and regimes <@ array['gdpr', 'uk_gdpr', 'dpdp', 'ccpa']::text[]),
  data_categories text[] not null default '{}',
  subjects_affected integer check (subjects_affected is null or subjects_affected >= 0),
  occurred_at timestamptz,
  detected_at timestamptz not null,
  contained_at timestamptz,
  authority_notified_at timestamptz,
  authority_reference text check (authority_reference is null or char_length(authority_reference) <= 200),
  dpb_notified_at timestamptz,
  dpb_report_at timestamptz,
  subjects_notified_at timestamptz,
  delay_reason text check (delay_reason is null or char_length(delay_reason) <= 4000),
  root_cause text check (root_cause is null or char_length(root_cause) <= 8000),
  remediation text check (remediation is null or char_length(remediation) <= 8000),
  status text not null default 'open' check (status in ('open', 'contained', 'closed')),
  created_by uuid references users(id) on delete set null,
  closed_by uuid references users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference),
  constraint privacy_breach_detect_order check (occurred_at is null or occurred_at <= detected_at),
  constraint privacy_breach_closed_shape check ((status = 'closed') = (closed_at is not null))
);

create index privacy_breach_tenant_idx on privacy_breach_incidents (tenant_id, status, detected_at desc);
create index privacy_breach_created_by_idx on privacy_breach_incidents (created_by);
create index privacy_breach_closed_by_idx on privacy_breach_incidents (closed_by);
alter table privacy_breach_incidents enable row level security;
create policy privacy_breach_select on privacy_breach_incidents for select
  using (has_tenant_permission(tenant_id, 'privacy.view'));

-- Notification reads by a subject (their own data export) need no new
-- policy: notifications/notification_preferences are already readable to
-- their own user.
