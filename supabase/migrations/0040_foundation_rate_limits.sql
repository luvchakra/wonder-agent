-- Foundation Agent — FOUNDATION-P0-05.3
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.
--
-- Backs a basic per-bucket/per-subject sliding-window rate limiter for
-- authentication endpoints (sign-in, sign-up). Not customer/tenant data —
-- an internal security control table, so it carries no tenant_id and is
-- never exposed to any client role at all (service-role only), same
-- treatment as platform_admins.

create table auth_rate_limit_attempts (
  id bigint generated always as identity primary key,
  bucket text not null,
  subject text not null,
  attempted_at timestamptz not null default now()
);

create index on auth_rate_limit_attempts (bucket, subject, attempted_at);

alter table auth_rate_limit_attempts enable row level security;
-- Intentionally no policies at all: only supabaseServiceRole() reads/writes
-- this table, from lib/security/rateLimiter.ts.
