# Platform Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — CRITICAL, cross-module finding: tenant suspension does not block data access (open question for the user)

**Discovered while implementing PLATFORM-P0-02.2** ("Foundation's RLS/
authorization must already deny active use of a suspended tenant — verify
this holds rather than duplicating the check here"). **It does not hold.**
Verified live against the dev Supabase project:

```sql
update tenants set status = 'suspended' where id = '<tenant>';
-- as an active member of that tenant:
select exists(select 1 from current_tenant_ids() t where t = '<tenant>');
-- -> true
select count(*) from agents where tenant_id = '<tenant>';
-- -> 1 (full read access retained)
```

`current_tenant_ids()` (Foundation, migration `0004_foundation_rls.sql`) is
the single function every RLS policy in this codebase calls to determine
which tenants the current user may access. It filters only on
`tenant_memberships.status = 'active'` — it never checks `tenants.status`
at all. The practical consequence: **every "suspend tenant" action this
module implements changes the `tenants.status` column correctly, but has
*zero* actual enforcement effect** — a suspended tenant's members retain
full read/write access to every tenant-scoped table (agents, access grants,
runtime events, risk findings, certifications — everything) exactly as
before suspension. The `status` column becomes a label, not a control.

**This is not a Platform Agent implementation gap** — `suspendTenant()`/
`activateTenant()`/`decommissionTenant()` (`modules/platform-admin/tenants.ts`)
correctly write to `tenants.status`, audited, exactly as specified. The gap
is entirely inside Foundation's shared `current_tenant_ids()` function,
which every other module's RLS policies also depend on.

**Why this isn't patched here**: `current_tenant_ids()` is Foundation's
shared authentication-model function (non-negotiable #14: "No module may
silently change a shared database schema, authentication model, RBAC model
or integration contract owned by another module"; non-negotiable #18: a
module must record a required contract change and stop rather than
silently reaching into another module's file to make its own story pass).
The fix itself would be small and additive — join to `tenants` and require
`status = 'active'` there too:

```sql
create or replace function current_tenant_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select tm.tenant_id from tenant_memberships tm
  join tenants t on t.id = tm.tenant_id
  where tm.user_id = auth.uid() and tm.status = 'active' and t.status = 'active';
$$;
```

— but changing it is Foundation Agent's call, not this module's, both
because of ownership and because this function is invoked by every RLS
policy in the system (Foundation, Identity, Integration, Access, Runtime,
Risk, Compliance) — a change here has system-wide blast radius that
deserves Foundation Agent's own verification pass across every module's
isolation tests, not a unilateral one-line patch made in passing while
building the Platform Agent console.

**Recorded as an explicit open question for the user, not guessed past**:
this is exactly the kind of "real architecture/security decision the
backlog doesn't fully specify" `CLAUDE.md`'s stop-and-report rule exists
for — surfaced here and directly in this session's summary to the user,
with the fix above proposed and ready, pending a decision on who applies it
(recommended: dispatch **Foundation Agent** specifically for this fix, so
its own re-verification pass covers all dependent modules' isolation
tests) and whether to pause other work until it lands, given every prior
module's own "tenant isolation" acceptance tests only ever tested
cross-tenant access by *different* tenants, never a *suspended* tenant's
own members — so this gap was never caught by any of them.

---

## 2026-09-14 — PLATFORM-P0-01 through P0-04 (full P0 backlog, minus the deferred item below)

**Agent:** Platform Agent · **Branch:** `claude/wonderagent-setup-lasmly`
(same environment-pinned-branch deviation every prior module recorded).

**Built:**

- **PLATFORM-P0-01.1 (higher bar)** — Foundation had already built the
  authorization gate itself (`app/platform-admin/layout.tsx` calling
  `requirePlatformAdmin()`, denying with a bare 404, never a partial
  render) — this module's job was the separate navigation shell, added to
  that same layout file per its own comment ("Platform Agent owns the
  actual console UI; Foundation only owns this authorization gate"), never
  extending `app/(customer)` layout. Verified zero references to
  `platform-admin` anywhere under customer-facing `app/` outside
  `app/platform-admin/*`/`app/api/platform/*` themselves (`grep`, zero
  matches).
- **PLATFORM-P0-01.2** — `grantPlatformAdmin()`/`revokePlatformAdmin()`/
  `listPlatformAdmins()` (`modules/platform-admin/admins.ts`), plus
  `POST /api/platform/v1/admins` and a bare admin-grant page. **How the
  first platform admin is granted** (this story's own explicit
  documentation requirement, since `platform_admins` starts empty and no
  route can grant the first one): outside this application entirely, via a
  one-time manual `insert into platform_admins (user_id) values (...)`
  run directly against the dev Supabase project (e.g. via the Supabase
  dashboard/SQL editor or the Supabase MCP `execute_sql` tool used
  throughout this build), by whoever controls the Supabase project itself.
  This is a deliberate, standard "break-glass" bootstrap for vendor-only
  systems — every subsequent admin is granted through this module's own
  audited API.
- **PLATFORM-P0-02.1** — `platform_tenants`/`subscriptions` (migration
  `0038`). Plan defaults chosen and documented (`modules/platform-admin/
  subscriptions.ts`'s `PLAN_DEFAULTS`): Free (3 users/5 agents/1
  integration/10k events per month/30-day audit retention), Pro (25/50/5/
  250k/90), Max (100/250/20/2M/365), Enterprise (effectively unlimited/
  2555-day retention) — a business decision per the backlog's own framing,
  adjustable without a schema change.
- **PLATFORM-P0-02.2** — `createTenant()` (platform-initiated, coexists
  with Foundation's self-service `create_tenant_with_owner()` RPC — mirrors
  its `tenants`/`tenant_settings` insert shape but doesn't create a
  membership/owner, since a vendor may provision a tenant before any
  customer user exists), `suspendTenant()`/`activateTenant()`/
  `decommissionTenant()` (soft only — sets `tenants.status`, never deletes
  data). **The verification this story asks for surfaced the critical
  cross-module finding recorded in the entry directly above** — `status`
  changes correctly but Foundation's RLS doesn't yet enforce it.
- **PLATFORM-P0-02.3** — `platform_feature_flags`/`feature_flags`
  (migration `0038`), seeded with all eleven PRD flags (documented default-
  enabled choices in the migration's own comment: the connector this build
  has no code for at all yet, `sailpoint_connector`, and the two
  inherently-opt-in/premium flags `ai_assistant`/`advanced_analytics`
  default off; everything this build has actually shipped defaults on).
  `isFeatureEnabled(tenantId, key)` — the published contract every other
  module is expected to call — falls back to the catalog's
  `default_enabled` when no per-tenant override row exists.
- **PLATFORM-P0-03.1** — `platform_branding` (migration `0038`, singleton
  row enforced by a `boolean primary key default true check (id)`).
  **Flagged, not silently assumed**: not listed in the backlog's literal
  "Owned entities" enumeration, but required to implement this story's own
  text — an additive, obviously-Platform-Agent-owned table, same reasoning
  Risk Agent used for `risk_findings.risk_score`/`reasons`.
- **PLATFORM-P0-03.2** — `getPlatformHealth()`: real signals where
  available (database reachability via a live query, API error rate from
  Foundation's `audit_logs` over the last 24h, integration sync-job failure
  count from Integration Agent's `integration_sync_jobs`) — every signal
  with no real source yet (runtime-ingestion lag, background-job queue
  depth — there is no queue infrastructure in this codebase, `next/server`
  `after()` is fire-and-forget and unobservable) reports
  `"not_instrumented"` rather than a fabricated number, per the backlog's
  explicit instruction.
- **PLATFORM-P0-04.1** — `platform_audit_logs` (migration `0038`), and
  `writePlatformAudit()` (`modules/platform-admin/auditLog.ts`) as the sole
  writer — every tenant lifecycle action, subscription change, flag
  toggle, branding change, and admin grant/revoke in this module calls it.
  Distinct from Foundation's tenant-scoped `audit_logs`; RLS-enabled with
  zero policies (verified live, below) so no customer role can ever read
  it.
- **PLATFORM-P0-04.2 (higher bar) — deliberately deferred to P1, per the
  backlog's own hard-line instruction**: no "view as tenant"/impersonation
  support-access feature was built. This build has no existing
  infrastructure for a time-bound, auto-expiring, fully-scoped-and-logged
  support session, and the backlog is explicit that shipping an unaudited
  or unbounded version "under any circumstance" is not a judgment call to
  make silently — so nothing was built rather than building an unbounded
  shortcut. Recorded here as the one deliberately-not-attempted P0 story.

**Verification run:**
- `npm run lint`, `npm run typecheck` — clean.
- `npm run build` — one real issue caught and fixed: `/platform-admin`'s
  overview page has no direct dynamic-API call of its own (the
  `requirePlatformAdmin()` check lives in the enclosing layout), so Next.js
  attempted to statically prerender it at build time and failed (no network
  path to Supabase outside a request context, in this sandbox and in any
  environment without egress at build time). Fixed by adding
  `export const dynamic = "force-dynamic"` to all six platform-admin pages
  — the same underlying cause across all of them, not six separate bugs.
  Clean build after the fix.
- `npm run test` — 53/53 (no new unit tests this story; nothing here is
  algorithmically complex enough to warrant one beyond what integration/
  live testing below already covers — `PLAN_DEFAULTS` and health-signal
  wiring are straightforward data, not logic).
- Live smoke test against a locally started production server: every one
  of the six `/platform-admin/*` pages returns a bare 404 when
  unauthenticated (not a redirect, not a partial render — matches
  Foundation's designed denial behavior exactly), and both
  `/api/platform/v1/tenants` and `/api/platform/v1/health` return 401.
  Structurally verified (not just smoke-tested) that **every** one of the
  8 `/api/platform/v1/*` route files calls `requirePlatformAdmin()` (grep,
  zero files missing it) — `requirePlatformAdmin()` itself never inspects
  any customer role or permission, only `platform_admins` table
  membership, so no customer role, however privileged, can ever satisfy
  it regardless of which specific route is hit.
- **The module's critical acceptance test, executed live against the dev
  Supabase project**: acting as an existing fixture customer user (Tenant
  A5's member, from Runtime/Risk/Compliance's own fixtures — a real,
  ordinary tenant member, not a platform admin), proved zero rows visible
  across `platform_tenants`/`subscriptions`/`platform_feature_flags`/
  `feature_flags`/`platform_branding`/`platform_audit_logs`, and a
  same-tenant client `INSERT` into `platform_tenants` was rejected by RLS
  (no policy exists at all on any of these six tables) — the database-
  level half of "a customer super admin receives a hard authorization
  denial for every platform-admin route," complementing the
  `requirePlatformAdmin()` code-path guarantee above. `get_advisors`
  (security and performance) clean beyond the same previously-reviewed
  exceptions every prior module already accepted plus the expected
  `rls_enabled_no_policy` INFO findings for these six new tables (by
  design, same as `platform_admins`/`integration_credentials`).

**Dependencies consumed:** Foundation's `requirePlatformAdmin()`,
`platform_admins` table (read via `listPlatformAdmins()`/written via
`grantPlatformAdmin()`), `supabaseServiceRole()`; Foundation's `tenants`
table (limited write — `status` only, per this module's own Consumed
entities scope); Integration's `integration_sync_jobs` (read-only, for the
health signal). No modification to any Foundation or Integration file.

**Published this session:** `modules/platform-admin/service.ts` (barrel)
and `lib/shared/types/platform.ts`. `isFeatureEnabled(tenantId, flagKey)`
is the function every other module is expected to call before exposing a
flag-gated feature — none of the shipped modules (Foundation through
Compliance) call it yet, since none of their stories asked for flag-gating;
wiring it into their routes, if wanted, is a follow-up story for whichever
module owns each gated feature, not something to retrofit here.
