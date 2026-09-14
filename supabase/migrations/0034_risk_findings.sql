-- Risk Agent — RISK-P0-01.1 (schema)
-- Owner: Risk Agent. See docs/design/ownership-map.md before modifying.

insert into permissions (key, description) values
  ('risk.read', 'View risk findings and evidence'),
  ('risk.manage', 'Assign, remediate and resolve risk findings')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
  and p.key in ('risk.read', 'risk.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('IAM_ADMIN', 'IAM_ARCHITECT', 'SECURITY_ADMIN')
  and p.key in ('risk.read', 'risk.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('BUSINESS_OWNER', 'TECHNICAL_OWNER', 'APPLICATION_OWNER',
  'CERTIFICATION_MANAGER', 'READ_ONLY', 'AUDITOR')
  and p.key = 'risk.read'
on conflict do nothing;

-- Owned entities (docs/plan/06-RISK-AGENT-BACKLOG.md, RISK-P0-01.1).
--
-- Evidentiary data, same lockdown as every other findings/evidence table in
-- this build (access_grants, policy_evaluations, runtime_events): a
-- client-facing SELECT policy, but no client-facing INSERT/UPDATE at all.
-- A wrong or forgeable finding is exactly the "false CRITICAL / missed
-- real one" risk the backlog's own Higher-bar note warns about — every
-- write (creation by the detection rules, assignment, remediation status,
-- resolution) goes through this module's own service-role functions.
create table risk_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  category text not null check (category in (
    'excessive_access','unauthorized_resource','unauthorized_action',
    'sensitive_data_violation','behavioral_deviation','identity_anomaly',
    'ownership_violation','lifecycle_violation'
  )),
  severity text not null check (severity in ('low','medium','high','critical')),
  risk_score integer not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  title text not null,
  explanation text not null,
  recommendation text not null,
  status text not null default 'open' check (status in ('open','assigned','remediation_in_progress','resolved','false_positive')),
  assigned_to uuid references users(id),
  resolution_type text check (resolution_type in ('verified_fixed', 'accepted_risk')),
  resolution_reason text,
  policy_id uuid references policies(id),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index risk_findings_tenant_agent_idx on risk_findings (tenant_id, agent_id);
create index risk_findings_tenant_status_idx on risk_findings (tenant_id, status);
create index risk_findings_assigned_to_idx on risk_findings (assigned_to);
create index risk_findings_policy_id_idx on risk_findings (policy_id);

alter table risk_findings enable row level security;

create policy risk_findings_select on risk_findings
  for select using (tenant_id in (select current_tenant_ids()));

-- risk_evidence has no tenant_id column of its own (per the backlog's own
-- schema sketch) — isolation is enforced via a join to
-- risk_findings.tenant_id, the same pattern Access Agent used for
-- policy_rules/policy_exceptions.
create table risk_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references risk_findings(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('access_grant','runtime_event','policy_evaluation','ownership_fact','lifecycle_event')),
  reference_id uuid not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index risk_evidence_finding_id_idx on risk_evidence (finding_id);

alter table risk_evidence enable row level security;

create policy risk_evidence_select on risk_evidence
  for select using (
    finding_id in (select id from risk_findings where tenant_id in (select current_tenant_ids()))
  );
