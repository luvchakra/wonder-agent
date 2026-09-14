# 09 — Platform Agent Backlog

**Agent name:** `Platform Agent`
**Module:** Vendor Platform Administration
**Branch:** `module/platform`
**Status:** DORMANT — do not start until the user says "Run Platform Agent"

## Dependencies

- **Foundation Agent**: `requirePlatformAdmin()`, `platform_admins` table,
  `writeAudit()`-equivalent pattern (Platform Agent uses its own
  `platform_audit_logs` table but the same write-discipline).

No other module is a dependency — Platform Administration is intentionally isolated
from the customer-facing domain modules (it manages tenants as opaque records, not
their internal data).

## Owned entities

`platform_tenants`, `platform_feature_flags`, `feature_flags`, `subscriptions`,
`platform_audit_logs`.

## Consumed entities

Foundation's `tenants` table (read/limited-write for status changes only — Platform
Agent may update `tenants.status` since tenant suspension/activation is explicitly a
platform capability; it does not touch any other tenant-owned table).

## Published contracts

- `lib/shared/types/platform.ts`: `PlatformTenant`, `Subscription`, `FeatureFlag`.
- `modules/platform-admin/service.ts`: `isFeatureEnabled(tenantId, flagKey)` — every
  other module checks this before exposing a flag-gated feature (e.g. Integration
  Agent checks `isFeatureEnabled(tenantId, 'saviynt_connector')` before allowing that
  connector type to be configured).

---

## Higher-bar stories

Everything touching the authorization boundary itself (PLATFORM-P0-01.1) and
customer-data access from platform-admin (PLATFORM-P0-04.2, support access) is
higher bar.

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. This
agent is dormant; every story is Not Started until "Run Platform Agent" is
issued.

| Story | Title | Status |
|---|---|---|
| PLATFORM-P0-01.1 | Route isolation (higher bar) | Not Started |
| PLATFORM-P0-01.2 | Seeding & bootstrap | Not Started |
| PLATFORM-P0-02.1 | Schema | Not Started |
| PLATFORM-P0-02.2 | Tenant lifecycle actions | Not Started |
| PLATFORM-P0-02.3 | Feature flags | Not Started |
| PLATFORM-P0-03.1 | Global branding | Not Started |
| PLATFORM-P0-03.2 | Platform health surface | Not Started |
| PLATFORM-P0-04.1 | `platform_audit_logs` | Not Started |
| PLATFORM-P0-04.2 | Support access (higher bar) | Not Started |

---

## Epic PLATFORM-P0-01 — Isolated Console & Authorization

### PLATFORM-P0-01.1 — Route isolation (higher bar)

`app/platform-admin/layout.tsx` calls Foundation's `requirePlatformAdmin()` and
renders a **completely separate** navigation shell — it must not extend or import
the customer `(customer)/layout.tsx`. Navigation:

```text
Platform Overview, Tenants, Subscriptions, Feature Flags, Global Configuration,
Integration Catalog, Usage, Platform Health, Support Access, Platform Audit
```

No link to `/platform-admin` exists anywhere in customer-facing UI (verify this as
part of this story's acceptance criteria — grep `app/(customer)/**` for the literal
string `platform-admin` and expect zero matches).

### PLATFORM-P0-01.2 — Seeding & bootstrap

Document (in this module's audit log, not in application code) how the first
platform admin was granted, referencing Foundation's `platform_admins` table
(FOUNDATION-P0-06.1) — this story does not re-implement that table, only builds the
UI for a platform admin to grant platform-admin status to another user going
forward (`POST /api/platform/v1/admins`, itself gated by `requirePlatformAdmin()`).

---

## Epic PLATFORM-P0-02 — Tenant & Subscription Management

### PLATFORM-P0-02.1 — Schema

```sql
create table platform_tenants (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  environment text not null default 'production' check (environment in ('production','sandbox')),
  notes text,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan text not null check (plan in ('free','pro','max','enterprise')),
  max_users integer not null,
  max_agents integer not null,
  max_integrations integer not null,
  max_runtime_events_per_month bigint not null,
  audit_retention_days integer not null,
  status text not null default 'active' check (status in ('active','past_due','cancelled')),
  started_at timestamptz not null default now(),
  renewed_at timestamptz
);
```

Seed default limits per plan (exact numbers are a business decision, not an
architecture one — pick reasonable defaults, e.g. Free: 3 users / 5 agents / 1
integration / 10k events/mo / 30-day retention; document the chosen numbers in the
audit log so the user can adjust them without re-deriving the schema).

### PLATFORM-P0-02.2 — Tenant lifecycle actions

Create tenant (used for platform-initiated tenant creation, distinct from
Foundation's self-service JIT tenant creation — both paths must be able to coexist),
suspend (`tenants.status = 'suspended'`; Foundation's RLS/authorization must already
deny active use of a suspended tenant — verify this holds rather than duplicating
the check here), activate, and a soft "decommission" (`status = 'deprovisioned'`;
actual data deletion is a separate, explicitly-confirmed destructive action, never
bundled into a routine "delete tenant" click without a second confirmation step
capturing the user's intent).

### PLATFORM-P0-02.3 — Feature flags

```sql
create table platform_feature_flags (
  key text primary key,
  display_name text not null,
  description text,
  default_enabled boolean not null default false
);

create table feature_flags (
  tenant_id uuid not null references tenants(id) on delete cascade,
  flag_key text not null references platform_feature_flags(key),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flag_key)
);
```

Seed the flag catalog from the PRD's list: `agent_governance`, `certifications`,
`runtime_monitoring`, `mcp_integration`, `saviynt_connector`, `sailpoint_connector`,
`custom_api_connector`, `ai_assistant`, `compliance_mappings`, `remediation`,
`advanced_analytics`. `isFeatureEnabled(tenantId, key)` falls back to
`platform_feature_flags.default_enabled` when no per-tenant row exists.

---

## Epic PLATFORM-P0-03 — Global Configuration & Health

### PLATFORM-P0-03.1 — Global branding

A single-row configuration (logo, product name, favicon, support URL, docs URL,
default email sender, default theme) editable only from platform-admin. Customer
tenant branding, if it exists, is a separate future concept — do not conflate the
two even though both might eventually use a similar settings-row pattern.

### PLATFORM-P0-03.2 — Platform health surface

A dashboard reading real signals where already available (API error rate from
recent `audit_logs`/request logging if present, integration sync job failure counts
from Integration Agent's `integration_sync_jobs` once that module exists, database
reachability). Where a signal's source module doesn't exist yet, show "not yet
instrumented" rather than a fabricated number.

---

## Epic PLATFORM-P0-04 — Platform Audit & Support Access

### PLATFORM-P0-04.1 — `platform_audit_logs`

```sql
create table platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  tenant_id uuid,               -- the tenant acted upon, if applicable
  action text not null,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  user_agent text,
  result text not null check (result in ('success','failure')),
  created_at timestamptz not null default now()
);
```

Every platform-admin mutation (tenant status change, subscription change, flag
toggle, branding change, admin grant) writes here. This table is distinct from
tenant-scoped `audit_logs` and is never exposed to any customer role or route.

### PLATFORM-P0-04.2 — Support access (higher bar)

If this module implements any "view as tenant" support-access feature in P0, it
must be least-privileged (read-only), time-bound (expires automatically, e.g. after
1 hour), and fully logged to `platform_audit_logs` including exactly what was
viewed. If a clean way to bound and audit this isn't achievable without adding new
infrastructure, **defer this specific capability to P1** and say so in the audit log
— do not ship an unaudited or unbounded "impersonate tenant" shortcut under any
circumstance; this is a hard line, not a judgment call to make silently.

---

## Critical acceptance test

A platform owner can manage tenants/subscriptions/feature flags/platform health; a
customer super admin receives a hard authorization denial for every platform-admin
route/API, verified by attempting every `/platform-admin/*` page and every
`/api/platform/v1/*` route as a `TENANT_SUPER_ADMIN` fixture user and asserting 403
or an equivalent hard redirect on every single one.

## P1

Usage-based billing integration. Per-tenant SLAs. Scoped, audited support-access
("view as") if not completed in P0. Multi-region tenant placement.

## DO NOT IMPLEMENT

- Any customer-facing domain logic (agents, access, risk, etc.) — Platform Agent
  treats tenants as opaque billing/lifecycle records, never reaching into their
  domain data.
- Any change to the customer-facing navigation shell (Experience Agent).
