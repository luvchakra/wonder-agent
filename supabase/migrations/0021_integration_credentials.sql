-- Integration Agent — INTEGRATION-P0-01.2 (higher bar on credential storage)
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.

create table integration_credentials (
  integration_id uuid primary key references integrations(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  auth_type text not null check (auth_type in ('oauth2', 'api_key', 'basic', 'bearer', 'mtls')),
  encrypted_secret text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table integration_credentials enable row level security;

-- Intentionally NO policies at all — same treatment as Foundation's
-- platform_admins (CLAUDE.md non-negotiable #10). This table is reachable
-- only via supabaseServiceRole(), from lib/security/encryptSecret.ts-backed
-- server functions, and its encrypted_secret is never included in any API
-- response (docs/plan/03-INTEGRATION-AGENT-BACKLOG.md
-- INTEGRATION-P0-01.2's acceptance criteria).
