-- Foundation Agent — FOUNDATION-P0-06.1
-- Owner: Foundation Agent. Separate vendor-only authorization boundary — see
-- CLAUDE.md non-negotiable #3 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md.

create table platform_admins (
  user_id uuid primary key references users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id)
);

alter table platform_admins enable row level security;

-- Intentionally NO policies at all: not even a self-select policy. Every
-- read/write goes through supabaseServiceRole() inside
-- lib/rbac/requirePlatformAdmin.ts (and, later, Platform Agent's admin-grant
-- API). No customer role — TENANT_SUPER_ADMIN included — can ever query this
-- table directly, satisfying CLAUDE.md non-negotiable #3.
