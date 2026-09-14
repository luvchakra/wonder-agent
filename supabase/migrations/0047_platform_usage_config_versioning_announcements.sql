-- Platform Agent — PLATFORM-P0-05.1, PLATFORM-P0-05.3, PLATFORM-P0-05.4
-- Owner: Platform Agent. See docs/design/ownership-map.md before modifying.
--
-- Every table here follows platform_admins'/migration 0038's own
-- precedent exactly: RLS enabled, but deliberately NO policies at all —
-- not even a self-select policy. Every read/write goes through
-- supabaseServiceRole() inside modules/platform-admin/* after an explicit
-- requirePlatformAdmin() check (or, for getActiveAnnouncements(), any
-- server-side caller — it only ever returns read-only announcement text,
-- same reasoning as isFeatureEnabled()'s existing precedent).
--
-- PLATFORM-P0-05.1 (Usage & Limits) needs no new table — usage is
-- measured on demand from existing tables (agents/tenant_memberships/
-- integrations/runtime_events), same pattern as Runtime Agent's own
-- data-quality metrics.

-- PLATFORM-P0-05.3 — versioned platform configuration history.
create table platform_config_versions (
  id uuid primary key default gen_random_uuid(),
  config_type text not null check (config_type in ('branding', 'feature_flag_default')),
  config_key text,
  old_value jsonb,
  new_value jsonb not null,
  actor_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index platform_config_versions_type_key_idx on platform_config_versions (config_type, config_key, created_at desc);

alter table platform_config_versions enable row level security;

-- PLATFORM-P0-05.4 — maintenance-mode windows and platform notices.
create table platform_announcements (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'tenant')),
  tenant_id uuid references tenants(id) on delete cascade,
  type text not null check (type in ('maintenance', 'notice')),
  title text not null,
  body text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (scope = 'global' or tenant_id is not null)
);

create index platform_announcements_tenant_id_idx on platform_announcements (tenant_id);
create index platform_announcements_active_idx on platform_announcements (scope, starts_at, ends_at);

alter table platform_announcements enable row level security;
