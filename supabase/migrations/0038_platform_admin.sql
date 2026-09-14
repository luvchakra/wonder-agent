-- Platform Agent — PLATFORM-P0-02.1 / P0-02.3 / P0-03.1 / P0-04.1 (schema)
-- Owner: Platform Agent. See docs/design/ownership-map.md before modifying.
--
-- Every table here follows platform_admins' own precedent exactly
-- (migration 0006): RLS enabled, but deliberately NO policies at all —
-- not even a self-select policy. No customer role, however privileged,
-- can ever query these tables directly; every read/write goes through
-- supabaseServiceRole() inside modules/platform-admin/* after an explicit
-- requirePlatformAdmin() check. This is the vendor-only authorization
-- boundary itself (non-negotiable #3) — a client-facing RLS policy here,
-- even a narrow one, would be a hole in that boundary.

create table platform_tenants (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  notes text,
  created_at timestamptz not null default now()
);

alter table platform_tenants enable row level security;

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan text not null check (plan in ('free', 'pro', 'max', 'enterprise')),
  max_users integer not null,
  max_agents integer not null,
  max_integrations integer not null,
  max_runtime_events_per_month bigint not null,
  audit_retention_days integer not null,
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  started_at timestamptz not null default now(),
  renewed_at timestamptz
);

create index subscriptions_tenant_id_idx on subscriptions (tenant_id);

alter table subscriptions enable row level security;

create table platform_feature_flags (
  key text primary key,
  display_name text not null,
  description text,
  default_enabled boolean not null default false
);

alter table platform_feature_flags enable row level security;

-- Seeded from the PRD's flag list. Defaults chosen so the P0 modules that
-- already ship (Foundation through Compliance) are usable out of the box;
-- the two connector types this build hasn't verified end-to-end
-- (sailpoint, which has no connector code at all yet) or that are
-- inherently premium/opt-in default to off. Documented here, not just in
-- the audit log, since the migration itself is the source of truth for
-- what was actually seeded.
insert into platform_feature_flags (key, display_name, description, default_enabled) values
  ('agent_governance', 'Agent Governance', 'Core AI agent identity, ownership and lifecycle management', true),
  ('certifications', 'Access Certifications', 'Certification campaigns and reviewer decision workflow', true),
  ('runtime_monitoring', 'Runtime Monitoring', 'Runtime event ingestion and SHOULD/CAN/DID comparison', true),
  ('mcp_integration', 'MCP Integration', 'Model Context Protocol server discovery and event ingestion', true),
  ('saviynt_connector', 'Saviynt Connector', 'Saviynt Enterprise Identity Cloud read integration', true),
  ('sailpoint_connector', 'SailPoint Connector', 'SailPoint IdentityIQ/IdentityNow integration', false),
  ('custom_api_connector', 'Custom API Connector', 'Generic REST connector for custom IAM/API sources', true),
  ('ai_assistant', 'AI Assistant', 'LLM-assisted explanation/investigation features (never used for deterministic decisions)', false),
  ('compliance_mappings', 'Compliance Mappings', 'Control framework mapping and evidence tracking', true),
  ('remediation', 'Remediation', 'Human-initiated remediation hand-off from findings/certifications', true),
  ('advanced_analytics', 'Advanced Analytics', 'Extended risk/trend analytics beyond the P0 dashboard', false);

create table feature_flags (
  tenant_id uuid not null references tenants(id) on delete cascade,
  flag_key text not null references platform_feature_flags(key),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flag_key)
);

alter table feature_flags enable row level security;

-- PLATFORM-P0-03.1. Single-row global configuration — enforced by a fixed
-- primary key value, the same "singleton row" pattern used elsewhere for
-- one-row config tables. Not listed in the backlog's literal "Owned
-- entities" list, but required to implement PLATFORM-P0-03.1's own text;
-- flagged in the audit log as an additive, obviously-Platform-Agent-owned
-- table completing what the story asks for (same reasoning Risk Agent
-- used for risk_findings.risk_score/reasons).
create table platform_branding (
  id boolean primary key default true check (id),
  product_name text not null default 'WonderAgent',
  logo_url text,
  favicon_url text,
  support_url text,
  docs_url text,
  default_email_sender text,
  default_theme text not null default 'system' check (default_theme in ('light', 'dark', 'system')),
  updated_at timestamptz not null default now()
);

alter table platform_branding enable row level security;

insert into platform_branding (id) values (true);

-- PLATFORM-P0-04.1. Distinct from tenant-scoped audit_logs (Foundation) —
-- never exposed to any customer role or route.
create table platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references users(id),
  tenant_id uuid references tenants(id) on delete set null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  user_agent text,
  result text not null check (result in ('success', 'failure')),
  created_at timestamptz not null default now()
);

create index platform_audit_logs_tenant_id_idx on platform_audit_logs (tenant_id);
create index platform_audit_logs_actor_id_idx on platform_audit_logs (actor_id);
create index platform_audit_logs_created_at_idx on platform_audit_logs (created_at desc);

alter table platform_audit_logs enable row level security;
