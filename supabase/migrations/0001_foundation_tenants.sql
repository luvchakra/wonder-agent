-- Foundation Agent — FOUNDATION-P0-02.1
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.

create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended', 'deprovisioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  default_role text not null default 'READ_ONLY',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
