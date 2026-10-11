-- Access Agent + Risk Agent — ACCESS-P0-25: imported access classification
-- and drift findings.
-- Owners: Access Agent (access_baselines), Risk Agent (risk_findings).
-- See docs/design/ownership-map.md before modifying.
--
-- Every imported account and grant now says whether WonderID can prove it
-- was approved, and access that appeared outside WonderID is flagged:
--
-- 1. access_baselines (Access): when an application's accounts, and
--    separately its entitlements and access, were first reconciled. What
--    was present then is legacy (LEGACY_EXCEPTION in the ledger), so access
--    granted before WonderID governed the application is never called
--    malicious. Access that appears after the baseline with no WonderID
--    evidence is rogue. Members read their own organization's baselines;
--    only the service role writes them, once per application and scope.
-- 2. risk_findings (Risk): a rogue-access finding is about an account (and
--    an entitlement of it), which may belong to a person, an external
--    person, a service account or an agent. So agent_id becomes optional
--    (every finding names an agent or an account), the subject columns are
--    added with same-tenant keys, the category 'rogue_access' joins the
--    list, and subject_key keeps one open finding per account and
--    entitlement. Agent findings are unchanged. Clients still cannot write
--    findings; the existing SELECT policy covers the new columns.

create table access_baselines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  application_id uuid not null,
  scope text not null check (scope in ('accounts', 'access')),
  taken_at timestamptz not null default now(),
  -- The reconciliation run that set it (account_reconciliation_runs or access_reconciliation_runs, by scope).
  run_id uuid,
  constraint access_baselines_application_fkey foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  constraint access_baselines_unique unique (tenant_id, application_id, scope)
);

alter table access_baselines enable row level security;

create policy access_baselines_select on access_baselines
  for select using (tenant_id in (select current_tenant_ids()));

create index access_baselines_application_fk_idx on access_baselines (application_id, tenant_id);

alter table risk_findings alter column agent_id drop not null;

alter table risk_findings
  add column identity_id uuid,
  add column account_id uuid,
  add column entitlement_id uuid,
  add column access_grant_id uuid,
  add column application_id uuid,
  add column subject_key text,
  add constraint risk_findings_identity_fkey foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete set null (identity_id),
  add constraint risk_findings_account_fkey foreign key (account_id, tenant_id) references accounts (id, tenant_id) on delete cascade,
  add constraint risk_findings_entitlement_fkey foreign key (entitlement_id, tenant_id) references entitlements (id, tenant_id) on delete cascade,
  add constraint risk_findings_application_fkey foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  add constraint risk_findings_subject_check check (agent_id is not null or account_id is not null);

alter table risk_findings drop constraint risk_findings_category_check;
alter table risk_findings add constraint risk_findings_category_check check (category in (
  'excessive_access', 'unauthorized_resource', 'unauthorized_action', 'sensitive_data_violation',
  'behavioral_deviation', 'identity_anomaly', 'ownership_violation', 'lifecycle_violation',
  'governance_drift', 'suspicious_delegation', 'unapproved_tool_use', 'rogue_access'
));

-- One open rogue-access finding per account and entitlement.
create unique index risk_findings_open_subject_key
  on risk_findings (tenant_id, category, subject_key)
  where subject_key is not null and status not in ('resolved', 'false_positive');

create index risk_findings_identity_fk_idx on risk_findings (identity_id, tenant_id) where identity_id is not null;
create index risk_findings_account_fk_idx on risk_findings (account_id, tenant_id) where account_id is not null;
create index risk_findings_entitlement_fk_idx on risk_findings (entitlement_id, tenant_id) where entitlement_id is not null;
create index risk_findings_application_fk_idx on risk_findings (application_id, tenant_id) where application_id is not null;
