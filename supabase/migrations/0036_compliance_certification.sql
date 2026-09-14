-- Compliance Agent — COMPLIANCE-P0-01.1 / P0-02.1 (schema)
-- Owner: Compliance Agent. See docs/design/ownership-map.md before modifying.

insert into permissions (key, description) values
  ('compliance.read', 'View certification campaigns, items, decisions and control status'),
  ('compliance.manage', 'Launch campaigns, record certification decisions and manage control mappings')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('TENANT_SUPER_ADMIN', 'IAM_ADMIN', 'IAM_ARCHITECT', 'SECURITY_ADMIN', 'CERTIFICATION_MANAGER')
  and p.key in ('compliance.read', 'compliance.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('BUSINESS_OWNER', 'TECHNICAL_OWNER', 'APPLICATION_OWNER', 'READ_ONLY', 'AUDITOR')
  and p.key = 'compliance.read'
on conflict do nothing;

-- Owned entities (docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md, COMPLIANCE-P0-01.1).
--
-- certification_campaigns: ordinary tenant-scoped admin-configured business
-- data (no computed/evidentiary field on this table itself) — same
-- treatment as Access Agent's `policies`.
create table certification_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  scope_type text not null check (scope_type in ('agent','application','entitlement','privileged_access','high_risk_agent')),
  scope jsonb not null default '{}'::jsonb,
  cadence text not null check (cadence in ('one_time','periodic','event_driven')),
  status text not null default 'draft' check (status in ('draft','active','completed','cancelled')),
  due_date timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index certification_campaigns_tenant_id_idx on certification_campaigns (tenant_id);
create index certification_campaigns_created_by_idx on certification_campaigns (created_by);

alter table certification_campaigns enable row level security;

create policy certification_campaigns_select on certification_campaigns
  for select using (tenant_id in (select current_tenant_ids()));
create policy certification_campaigns_insert on certification_campaigns
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy certification_campaigns_update on certification_campaigns
  for update using (tenant_id in (select current_tenant_ids()));

-- certification_items: `risk_at_review`/`usage_at_review`/`recommendation`
-- are computed snapshots at launch time, not human-typed — same
-- evidentiary lockdown as risk_findings/access_grants: client SELECT only,
-- no client-facing INSERT/UPDATE at all. A forgeable recommendation would
-- undermine the certification review's whole point.
create table certification_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  campaign_id uuid not null references certification_campaigns(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  access_grant_id uuid references access_grants(id) on delete set null,
  reviewer_id uuid not null references users(id),
  risk_at_review text,
  usage_at_review text check (usage_at_review in ('used','never','unknown')),
  recommendation text check (recommendation in ('keep','review','remove')),
  status text not null default 'pending' check (status in ('pending','decided')),
  due_date timestamptz,
  created_at timestamptz not null default now()
);

create index certification_items_tenant_campaign_idx on certification_items (tenant_id, campaign_id);
create index certification_items_agent_id_idx on certification_items (agent_id);
create index certification_items_reviewer_id_idx on certification_items (reviewer_id);
create index certification_items_access_grant_id_idx on certification_items (access_grant_id);

alter table certification_items enable row level security;

create policy certification_items_select on certification_items
  for select using (tenant_id in (select current_tenant_ids()));

-- certification_decisions: immutable audit trail — same lockdown, and
-- deliberately no UPDATE policy at all (not even service-role convention;
-- a correction is a new decision row, never an edit, per non-negotiable
-- #11). No tenant_id column of its own (per the backlog's schema sketch);
-- isolation is enforced via a join to certification_items.tenant_id, the
-- same pattern used for policy_rules/risk_evidence.
create table certification_decisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references certification_items(id) on delete cascade,
  decision text not null check (decision in ('approve','revoke','modify','delegate','request_information')),
  justification text not null,
  decided_by uuid not null references users(id),
  decided_at timestamptz not null default now(),
  remediation_id uuid
);

create index certification_decisions_item_id_idx on certification_decisions (item_id);
create index certification_decisions_decided_by_idx on certification_decisions (decided_by);

alter table certification_decisions enable row level security;

create policy certification_decisions_select on certification_decisions
  for select using (
    item_id in (select id from certification_items where tenant_id in (select current_tenant_ids()))
  );

-- Owned entities (COMPLIANCE-P0-02.1, higher bar). control_frameworks/
-- controls are global catalog data, not tenant-scoped — same treatment as
-- Integration Agent's integration_types (migration 0019): readable by any
-- authenticated user, no client-facing mutation.
create table control_frameworks (
  id text primary key,
  display_name text not null
);

alter table control_frameworks enable row level security;

create policy control_frameworks_select_all on control_frameworks
  for select using (true);

insert into control_frameworks (id, display_name) values
  ('iso27001', 'ISO/IEC 27001'),
  ('iso42001', 'ISO/IEC 42001 (AI Management System)'),
  ('nist_ai_rmf', 'NIST AI Risk Management Framework'),
  ('nist_csf', 'NIST Cybersecurity Framework'),
  ('soc2', 'SOC 2'),
  ('cis', 'CIS Controls');

create table controls (
  id uuid primary key default gen_random_uuid(),
  framework_id text not null references control_frameworks(id),
  control_ref text not null,
  requirement text not null,
  unique (framework_id, control_ref)
);

create index controls_framework_id_idx on controls (framework_id);

alter table controls enable row level security;

create policy controls_select_all on controls
  for select using (true);

-- Representative control sets only (3-5 per framework), per the backlog's
-- explicit P0 scope note — full control libraries are P1, framework by
-- framework. Recorded here rather than in the audit log alone since the
-- migration itself is the evidence of what was actually seeded.
insert into controls (framework_id, control_ref, requirement) values
  ('iso27001', 'A.9.2.3', 'Management of privileged access rights'),
  ('iso27001', 'A.9.2.5', 'Review of user access rights'),
  ('iso27001', 'A.12.4.1', 'Event logging'),
  ('iso27001', 'A.9.4.1', 'Information access restriction'),
  ('iso42001', '6.1.2', 'AI risk assessment'),
  ('iso42001', '8.1', 'Operational planning and control of AI systems'),
  ('iso42001', '9.1', 'Monitoring, measurement, analysis and evaluation'),
  ('nist_ai_rmf', 'GOVERN 1.1', 'Legal and regulatory requirements involving AI are understood and managed'),
  ('nist_ai_rmf', 'MEASURE 2.1', 'Appropriate methods and metrics are identified and applied to AI system risk'),
  ('nist_ai_rmf', 'MANAGE 2.1', 'Resources are allocated to manage AI risks'),
  ('nist_csf', 'PR.AC-1', 'Identities and credentials are managed for authorized devices and users'),
  ('nist_csf', 'PR.AC-4', 'Access permissions are managed, incorporating least privilege'),
  ('nist_csf', 'DE.CM-1', 'The network is monitored to detect potential cybersecurity events'),
  ('soc2', 'CC6.1', 'Logical access security measures restrict access to authorized users'),
  ('soc2', 'CC6.3', 'Access is removed when no longer required'),
  ('soc2', 'CC7.2', 'Anomalies are monitored and evaluated'),
  ('cis', '5.1', 'Establish and maintain an inventory of accounts'),
  ('cis', '6.1', 'Establish an access granting process'),
  ('cis', '6.2', 'Establish an access revoking process'),
  ('cis', '8.2', 'Collect audit logs');

-- control_mappings/control_evidence: `status` is a computed compliance
-- posture signal — the highest-sensitivity data this module produces
-- (COMPLIANCE-P0-02.2's non-negotiable-#10 wording rule depends on it
-- being trustworthy). Same evidentiary lockdown: client SELECT only.
create table control_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  control_id uuid not null references controls(id),
  policy_id uuid references policies(id),
  status text not null default 'no_evidence' check (status in ('compliant','partial','non_compliant','not_applicable','no_evidence')),
  owner_id uuid references users(id),
  created_at timestamptz not null default now()
);

create index control_mappings_tenant_id_idx on control_mappings (tenant_id);
create index control_mappings_control_id_idx on control_mappings (control_id);
create index control_mappings_policy_id_idx on control_mappings (policy_id);
create index control_mappings_owner_id_idx on control_mappings (owner_id);

alter table control_mappings enable row level security;

create policy control_mappings_select on control_mappings
  for select using (tenant_id in (select current_tenant_ids()));

create table control_evidence (
  id uuid primary key default gen_random_uuid(),
  control_mapping_id uuid not null references control_mappings(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('certification_decision','policy_evaluation','audit_log','manual_attestation')),
  reference_id uuid,
  summary text not null,
  created_at timestamptz not null default now()
);

create index control_evidence_control_mapping_id_idx on control_evidence (control_mapping_id);

alter table control_evidence enable row level security;

create policy control_evidence_select on control_evidence
  for select using (
    control_mapping_id in (select id from control_mappings where tenant_id in (select current_tenant_ids()))
  );
