-- Risk Agent — RISK-P0-01.4, RISK-P0-02.2, RISK-P0-03.4, RISK-P0-03.5
-- Owner: Risk Agent. See docs/design/ownership-map.md before modifying.

-- RISK-P0-01.4 — evaluator/rule version on every finding's evidence pack.
-- Existing rows backfill to version 1 (the documented baseline) via the
-- column default, per the story's own "may backfill to a documented
-- baseline version rather than blocking on a data migration" allowance.
alter table risk_findings add column evaluator_version integer not null default 1;

-- RISK-P0-03.5 — false-positive disposition needs an optional expiry after
-- which the finding is automatically re-evaluated.
alter table risk_findings add column false_positive_expires_at timestamptz;

-- RISK-P0-02.2 — INFO severity tier, additive to the existing check
-- constraint (never a breaking rename of already-Done values).
alter table risk_findings drop constraint risk_findings_severity_check;
alter table risk_findings add constraint risk_findings_severity_check
  check (severity in ('info', 'low', 'medium', 'high', 'critical'));

-- RISK-P0-03.4 — expanded finding lifecycle states, additive to the
-- existing check constraint. `remediation_in_progress` (already Done)
-- keeps its column value — it maps onto the new doc's REMEDIATION_PENDING
-- in meaning, so it is not renamed.
alter table risk_findings drop constraint risk_findings_status_check;
alter table risk_findings add constraint risk_findings_status_check
  check (status in (
    'open', 'acknowledged', 'investigating', 'assigned',
    'remediation_in_progress', 'mitigated', 'resolved',
    'false_positive', 'exception'
  ));

-- RISK-P0-02.2 — configurable severity-factor weights. Evidentiary/
-- config data in the same style as Access Agent's policy_versions:
-- client-facing SELECT + INSERT/UPDATE (changing a weight is an audited,
-- admin-only action enforced by requirePermission('risk.manage') at the
-- app layer — RLS's job here is only tenant isolation, same division of
-- labor as `policies`). Absence of a row for a given (tenant, factor)
-- means "use the deterministic default" — never silently tunable, never
-- delegated to an LLM (non-negotiable #9).
create table risk_severity_weights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  factor_name text not null,
  weight integer not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, factor_name)
);

create index risk_severity_weights_tenant_id_idx on risk_severity_weights (tenant_id);

alter table risk_severity_weights enable row level security;

create policy risk_severity_weights_select on risk_severity_weights
  for select using (tenant_id in (select current_tenant_ids()));
create policy risk_severity_weights_insert on risk_severity_weights
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy risk_severity_weights_update on risk_severity_weights
  for update
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
