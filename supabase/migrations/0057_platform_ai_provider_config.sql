-- Platform Agent — PLATFORM-P0-05.2 (AI Provider Configuration)
-- Owner: Platform Agent. See docs/design/ownership-map.md before modifying.
--
-- Resolved 2026-09-16 via AskUserQuestion: provider = OpenAI; key scope =
-- both — a tenant may bring its own OpenAI key (BYOK) or fall back to a
-- platform-wide default key (the platform operator's PLATFORM_OPENAI_API_KEY
-- env var, never stored in this table — see lib/db/env.ts). The tenant
-- chooses per row via `use_own_key`.
--
-- Only the per-tenant BYOK override is persisted here; the platform-wide
-- default key itself is an env var (CLAUDE.md §16 — server-only secret),
-- consistent with how SUPABASE_SERVICE_ROLE_KEY/SECRET_ENCRYPTION_KEY are
-- handled, not a "tenant_id null" row (which would create a fragile
-- nullable-uniqueness special case for no benefit).
--
-- Same lockdown as integration_credentials (0021): RLS enabled, zero
-- client-facing policies at all. Configuring/reading this table only ever
-- happens through modules/platform-admin/aiProviderConfig.ts's
-- service-role functions, gated by requirePermission('ai.manage'). The
-- encrypted key is never included in any API response.

insert into permissions (key, description) values
  ('ai.manage', 'Configure the tenant''s AI provider (bring-your-own-key) settings')
on conflict (key) do nothing;

-- Same restriction as sso.manage: TENANT_SUPER_ADMIN only (via the
-- TENANT_SUPER_ADMIN cross-join in 0003, which already ran and does not
-- retroactively cover permissions inserted later — so grant explicitly).
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN' and p.key = 'ai.manage'
on conflict do nothing;

create table platform_ai_provider_configs (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  provider text not null default 'openai' check (provider in ('openai')),
  use_own_key boolean not null default false,
  encrypted_api_key text,
  model text not null default 'gpt-4o-mini',
  updated_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index platform_ai_provider_configs_updated_by_idx on platform_ai_provider_configs (updated_by);

alter table platform_ai_provider_configs enable row level security;

-- Intentionally NO client-facing policies at all (mirrors
-- integration_credentials, 0021) — reachable only via
-- lib/db/supabaseServer.ts's supabaseServiceRole() client, and only from
-- modules/platform-admin/aiProviderConfig.ts.
