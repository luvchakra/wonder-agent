# 09 — Platform Agent Backlog

**Agent name:** `Platform Agent`
**Module:** Vendor Platform Administration
**Branch:** `module/platform`
**Status:** DORMANT — do not start until the user says "Run Platform Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every row is in `docs/design/platform-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| PLATFORM-P0-01.1 | Route isolation (higher bar) | Done |
| PLATFORM-P0-01.2 | Seeding & bootstrap | Done |
| PLATFORM-P0-02.1 | Schema | Done |
| PLATFORM-P0-02.2 | Tenant lifecycle actions | Partial — status changes correctly, but a CRITICAL cross-module finding means suspension does not yet block data access (Foundation's `current_tenant_ids()` gap) — see audit log |
| PLATFORM-P0-02.3 | Feature flags | Done |
| PLATFORM-P0-03.1 | Global branding | Done |
| PLATFORM-P0-03.2 | Platform health surface | Done |
| PLATFORM-P0-04.1 | `platform_audit_logs` | Done |
| PLATFORM-P0-04.2 | Support access (higher bar) | Deferred — no time-bound/audited support-access infrastructure exists; the backlog explicitly forbids shipping an unbounded shortcut, so nothing was built |
| PLATFORM-P0-05.1 | Usage & Limits tracking/enforcement | Done — `checkUsageLimit()`/`getUsageSummary()` published; not yet called by any other module's create path (same as `isFeatureEnabled()` itself) |
| PLATFORM-P0-05.2 | AI Provider Configuration | Deferred — genuine open product/architecture question (which providers, what capability/budget model), not a mechanical ownership-map gap; stopped and recorded rather than guessed, per CLAUDE.md §4's stop-and-report rule |
| PLATFORM-P0-05.3 | Global Configuration Versioning | Done |
| PLATFORM-P0-05.4 | Maintenance Mode & Platform Announcements | Partial — Platform-side schema/management/`getActiveAnnouncements()` read contract done; Experience Agent's customer-facing rendering of active announcements is not built (cross-module, Experience Agent's own ownership) |

---

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

## Epic PLATFORM-P0-05 — Expanded Platform Governance Capabilities

New stories added by the 2026-09-14 requirements refresh (see that section below for
full context and source attribution).

### PLATFORM-P0-05.1 — Usage & Limits tracking/enforcement

Track actual usage against the limit columns already stored on `subscriptions`
(`max_users`, `max_agents`, `max_integrations`, `max_runtime_events_per_month`,
`audit_retention_days`) for agents, runtime events, integrations, users, storage and
AI consumption where applicable, and define safe behavior at hard/soft limit
boundaries (block vs. warn vs. throttle). Today the schema stores the limit numbers
but nothing measures or enforces usage against them.

**Acceptance criteria:** a published usage-check contract (e.g.
`checkUsageLimit(tenantId, resource)`) other modules' write paths can call before a
consequential create (mirroring the `isFeatureEnabled()` pattern already published);
platform-admin UI surfaces current usage vs. limit per tenant; soft/hard limit
behavior is documented and testable; no cross-tenant usage aggregation.

### PLATFORM-P0-05.2 — AI Provider Configuration

Store AI provider credentials securely server-side (using Foundation's
`encryptSecret()`/`decryptSecret()`, never a module-invented scheme) and configure
model routing, allowed capabilities, budget and safety controls, gating the
platform-wide `ai_assistant` feature flag. Credentials must never reach browser code,
logs or source control (non-negotiable #10).

**Ownership-map flag:** this needs a new table (e.g. `platform_ai_provider_configs`)
that isn't yet listed in `docs/design/ownership-map.md`. Not added here per this
task's constraints — flagged for the user to approve an ownership-map addition
before implementation.

### PLATFORM-P0-05.3 — Global Configuration Versioning

Version critical platform configuration (branding, feature-flag defaults, AI
provider config) and provide diff/rollback metadata rather than silently
overwriting historical configuration. Builds on top of PLATFORM-P0-03.1 (Global
branding), which today is a single mutable row with no history.

**Acceptance criteria:** every write to versioned configuration retains the prior
version (append-only or explicit version table) with actor/timestamp; a rollback
path exists; `platform_audit_logs` continues to record before/after as it already
does for branding changes.

### PLATFORM-P0-05.4 — Maintenance Mode & Platform Announcements

Publish platform notices and maintenance-mode windows with scope (global or
per-tenant), start/end time and full audit. Customer-facing UI must be able to
communicate service state clearly during a maintenance window.

**Ownership-map flag:** this needs a new table (e.g. `platform_announcements`) not
yet listed in the ownership map. It also has a cross-module dependency: Platform
Agent owns the admin-side data model and publishing UI, but rendering the notice
inside customer-facing UI is Experience Agent's ownership (`app/(customer)/*`) per
the existing UI-ownership split in `docs/design/ownership-map.md` §3 — Platform
Agent should publish a read contract (e.g. `getActiveAnnouncements(tenantId)`) for
Experience Agent to consume rather than reaching into customer UI itself. Flagged
for the user; not implemented here.

---

## Critical acceptance test

A platform owner can manage tenants/subscriptions/feature flags/platform health; a
customer super admin receives a hard authorization denial for every platform-admin
route/API, verified by attempting every `/platform-admin/*` page and every
`/api/platform/v1/*` route as a `TENANT_SUPER_ADMIN` fixture user and asserting 403
or an equivalent hard redirect on every single one.

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`09_PLATFORM_ADMIN.md`) that expands this module's P0/P1/P2 scope beyond what was
already tracked above. Reconciled against the existing Progress Tracker (nothing
currently `Done` — including the critical cross-module tenant-suspension finding
this module surfaced this session — was reopened or marked down); the following are
genuinely new stories added to the tracker as Epic PLATFORM-P0-05 above:

- **PLATFORM-P0-05.1 — Usage & Limits tracking/enforcement** (from the new doc's
  PLATFORM-P0-04 "Usage & Limits"). See epic section above for objective and
  acceptance criteria.
- **PLATFORM-P0-05.2 — AI Provider Configuration** (from the new doc's PLATFORM-P0-06
  "AI Provider Configuration"). See epic section above. Ownership-map addition
  flagged for the user.
- **PLATFORM-P0-05.3 — Global Configuration Versioning** (from the new doc's
  PLATFORM-P0-09 "Global Configuration Versioning"). See epic section above.
- **PLATFORM-P0-05.4 — Maintenance Mode & Platform Announcements** (from the new
  doc's PLATFORM-P0-11 "Maintenance/Announcements"). See epic section above.
  Ownership-map addition and an Experience Agent cross-module dependency flagged
  for the user.

### Already covered, no new tracker row needed

- New doc's **PLATFORM-P0-01** (Separate Security Boundary) → already satisfied by
  existing **PLATFORM-P0-01.1** (Route isolation, higher bar) — `Done`.
- New doc's **PLATFORM-P0-02** (Tenant Management) → already satisfied by existing
  **PLATFORM-P0-02.1** (Schema, `Done`) and **PLATFORM-P0-02.2** (Tenant lifecycle
  actions, `Partial` per the tenant-suspension-enforcement finding, tracked
  separately and not reopened here). The new doc's "region" and "admin contact"
  fields are not present on `platform_tenants` today; this is a minor field-level
  gap, not a missing capability, and is noted here rather than spawning a new story.
- New doc's **PLATFORM-P0-03** (Plans & Entitlements — the "define plan → feature →
  limit in data" portion) → already satisfied by the existing `subscriptions` schema
  (PLATFORM-P0-02.1) plus the published `isFeatureEnabled()` entitlement contract
  (PLATFORM-P0-02.3). The portion of PLATFORM-P0-03 about actually *consuming*
  numeric limits at write time is what's new — see PLATFORM-P0-05.1 above rather
  than duplicating it here.
- New doc's **PLATFORM-P0-05** (Feature Flags) → already satisfied by existing
  **PLATFORM-P0-02.3** (Feature flags) — `Done`. The new doc's additional attributes
  (rollout state, owner, rationale, formal rollback) are not present on
  `platform_feature_flags`/`feature_flags` today; audit trail for toggles is already
  covered by PLATFORM-P0-04.1. Not spawning a new story for these attributes alone.
- New doc's **PLATFORM-P0-07** (Platform Audit) → already satisfied by existing
  **PLATFORM-P0-04.1** (`platform_audit_logs`) — `Done`.
- New doc's **PLATFORM-P0-08** (Platform Health) → already satisfied by existing
  **PLATFORM-P0-03.2** (Platform health surface) — `Done`.
- New doc's **PLATFORM-P0-10** (Branding) → already satisfied by existing
  **PLATFORM-P0-03.1** (Global branding) — `Done`.
- New doc's **PLATFORM-P1-02** (Support Tools) → already tracked in this backlog's
  P1 list ("Scoped, audited support-access ('view as') if not completed in P0") and
  in PLATFORM-P0-04.2's deferral note — no change.
- New doc's **PLATFORM-P1-04** (Billing Integration) → already tracked in this
  backlog's P1 list ("Usage-based billing integration") — no change.

**Not a decision made unilaterally:** the new requirements package's "Modular
Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a different *process*
model ("Only the agent explicitly activated by the user may start work. Agents must
never launch another agent automatically") than this repository's standing
autopilot/auto-chain policy in `CLAUDE.md` §7 and `docs/ORCHESTRATION.md` §2. That is
a meta/process question, not a product requirement, and is called out to the user
separately rather than silently changed here.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded a second copy of this module's requirements doc
(`09_PLATFORM_ADMIN.md`, this time at
`/root/.claude/uploads/7af02f4f-be08-5f91-b0d5-fc0907e4645c/29e2bf3e-09_PLATFORM_ADMIN.md`),
described as an updated/expanded version superseding the smaller one already
reconciled in the "Requirements Refresh — 2026-09-14" section above. Read in
full (281 lines) and compared section-by-section against both this backlog
(including the section above) and the live codebase
(`modules/platform-admin/*`, `app/platform-admin/*`,
`supabase/migrations/0038_platform_admin.sql` and
`0047_platform_usage_config_versioning_announcements.sql`,
`docs/design/ownership-map.md`, `docs/design/platform-agent-backlog-audit.md`).

**Finding: this document is content-equivalent to the one already
reconciled — no genuinely new requirement, story, or acceptance criterion
was found, so no new Progress Tracker rows were added.**

Evidence for that conclusion (not asserted on faith):

- Its "Original Master PRD Requirements" section (`# 4. Platform
  Administration Console`, `# 38. Platform Admin UI`, the Claude Code
  Execution Plan and Critical acceptance test) is verbatim identical to the
  text already carried in this backlog's own "Original Master PRD
  Requirements" section above — including the full Tenant Management field
  list, the four subscription plans, the full ten-item plan-configuration
  list (max users/agents/integrations/runtime events/audit retention plus
  certification/policy/API/MCP limits — this list was already present in
  the backlog's own copied PRD text before this pass, so it is not new; the
  fact that `subscriptions` doesn't yet have dedicated columns for
  certification/policy/API/MCP limits is a pre-existing implementation gap
  from the *original* PRD text, not something this expanded doc introduces
  — already implicitly covered by PLATFORM-P0-02.1/03's "define in data"
  framing and not re-flagged here to avoid manufacturing a duplicate story
  for text that was already in scope).
- Its "Expanded Requirements — Vendor Platform Administration P0/P1/P2"
  section contains exactly the same 11 P0 items (PLATFORM-P0-01 through
  PLATFORM-P0-11), 6 P1 items (PLATFORM-P1-01 through PLATFORM-P1-06), and
  3 P2 items (PLATFORM-P2-01 through PLATFORM-P2-03) — same numbering, same
  titles, same body text word-for-word — as the doc already reconciled in
  the section above (verified by direct comparison of the quoted text in
  that section, e.g. PLATFORM-P0-04 "Usage & Limits", PLATFORM-P0-06 "AI
  Provider Configuration", PLATFORM-P0-09 "Global Configuration
  Versioning", PLATFORM-P0-11 "Maintenance/Announcements" — all present
  here with identical wording).
- The Platform Admin UI navigation list (`Platform Overview, Tenants,
  Subscriptions, Feature Flags, Global Configuration, Integration Catalog,
  Usage, Platform Health, Support Access, Platform Audit`) is unchanged —
  no new nav item (e.g. no "Announcements" or "Config Versions" entry was
  added in this version), consistent with the doc being the same source
  rather than a genuinely later draft.
- A codebase check (not just a doc-vs-doc diff) confirms the four stories
  the first pass already added (PLATFORM-P0-05.1 Usage & Limits,
  PLATFORM-P0-05.2 AI Provider Configuration, PLATFORM-P0-05.3 Global
  Configuration Versioning, PLATFORM-P0-05.4 Maintenance Mode &
  Announcements) remain the correct and complete set: `usage.ts`,
  `configVersions.ts`/`configRollback.ts`, and `announcements.ts` exist
  under `modules/platform-admin/` (migration `0047`) exactly matching what
  those four rows already describe, `platform_config_versions` and
  `platform_announcements` are both already listed in
  `docs/design/ownership-map.md` as Platform-Agent-owned, and no
  `platform_ai_provider_configs`-shaped table or AI-provider-config module
  file exists anywhere in the repo — consistent with PLATFORM-P0-05.2
  remaining a deliberately deferred open question, not silently dropped or
  silently implemented.
- Confirmed non-negotiable #3 (Platform Administration is a strictly
  separate vendor-only boundary) is not blurred anywhere in this document:
  every capability described (tenant management, subscriptions, feature
  flags, branding, health, audit, usage/limits, AI provider config, config
  versioning, maintenance/announcements, support tools, billing, release
  management, platform API administration, regional control planes,
  customer-managed keys, advanced operator roles) is scoped to
  vendor-operator access only, and the doc repeats the "customer admins
  must receive a hard authorization denial, not a hidden-only UI" framing
  already implemented by PLATFORM-P0-01.1 — nothing in this pass requires
  flagging on that front.

**No Progress Tracker rows added or changed in this pass.** No status on
any existing row was touched (PLATFORM-P0-02.2's `Partial` note,
PLATFORM-P0-04.2's `Deferred` note, and PLATFORM-P0-05.2's `Deferred` note
all stand exactly as the prior pass left them).

## P1

Usage-based billing integration. Per-tenant SLAs. Scoped, audited support-access
("view as") if not completed in P0. Multi-region tenant placement.

- **Configuration Import/Export** (new doc PLATFORM-P1-01): export/import platform
  configuration without secrets, with schema/version validation, preview and
  rollback.
- **Subscription Lifecycle** (new doc PLATFORM-P1-03): explicit trial, active,
  grace, suspended and cancelled subscription states with defined entitlement
  impact per state — today `subscriptions.status` only models
  `active`/`past_due`/`cancelled`.
- **Release Management** (new doc PLATFORM-P1-05): feature rollout, staged release,
  rollback and tenant-cohort management, building on the existing feature-flag
  infrastructure (PLATFORM-P0-02.3).
- **Platform API Administration** (new doc PLATFORM-P1-06): manage platform API
  clients, scopes, rotation and audit for any platform-level API access (distinct
  from customer-facing API clients, which are out of this module's scope).

## P2 (strategic, after P0/P1 proven)

New in the 2026-09-14 requirements refresh — no existing P2 section previously
existed for this module.

- **Regional Control Planes** (new doc PLATFORM-P2-01): future architecture may
  support regional data/control planes while preserving global tenant identity and
  policy semantics. Overlaps with, and expands on, the already-tracked P1 item
  "Multi-region tenant placement" above — that item is about placement, this is
  about full regional control-plane architecture; kept as a distinct, later-stage
  concept rather than merged.
- **Customer-Managed Keys** (new doc PLATFORM-P2-02): optional enterprise
  encryption-key management with rotation and recovery procedures, layered on top
  of Foundation's `encryptSecret()`/`decryptSecret()` primitive rather than
  replacing it.
- **Advanced Operator Roles** (new doc PLATFORM-P2-03): separate support, billing,
  security, release and platform-owner responsibilities within the platform-admin
  boundary, without creating any customer-role escalation path.

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. No new
Platform-owned story found. One connection noted, not a new gap: the
document's P0-22 "AI-Assisted Investigation" (open ownership decision) is
the first concrete use case that would need `PLATFORM-P0-05.2` (AI Provider
Configuration), already `Deferred` here as a genuine open product/
architecture question. Not re-opened or re-scoped unilaterally — still
waiting on the same answer it was waiting on before.

## DO NOT IMPLEMENT

- Any customer-facing domain logic (agents, access, risk, etc.) — Platform Agent
  treats tenants as opaque billing/lifecycle records, never reaching into their
  domain data.
- Any change to the customer-facing navigation shell (Experience Agent).
