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

---

## 2026-09-14 — PLATFORM-P0-05.1, PLATFORM-P0-05.3, PLATFORM-P0-05.4 (2026-09-14 requirements refresh; PLATFORM-P0-05.2 deferred)

**Agent:** Platform Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Per the user's explicit "continue automatically" instruction, picked up
the four Not Started rows the requirements-refresh pass added to this
backlog's Progress Tracker, auto-chained from Experience Agent.

**Built:**

- **PLATFORM-P0-05.1 — Usage & Limits.** New `modules/platform-admin/
  usage.ts`: `checkUsageLimit(tenantId, resource)` (the story's own named
  contract, mirroring `isFeatureEnabled()`'s shape) measures actual usage
  against `subscriptions`' existing limit columns for four resources —
  `users` (active `tenant_memberships`), `agents`, `integrations`,
  `runtime_events_per_month` (counted from the start of the current UTC
  month) — and classifies the result as `ok`/`soft_warning`/`hard_block`/
  `unlimited` (no subscription row). Thresholds (soft warning at 90% of
  the limit, hard block at 100%+) are a documented business decision, not
  an architecture one, same framing PLATFORM-P0-02.1's own
  `PLAN_DEFAULTS` used — extracted into a pure `classifyUsage(current,
  limit)` function so the banding logic itself is unit-tested in
  isolation from the DB queries. `getUsageSummary(tenantId)` returns all
  four resources' status at once for the platform-admin UI surface (new
  `/platform-admin/tenants/:id/usage` page, linked from the tenants
  list). No cross-tenant aggregation anywhere — every query is scoped to
  the one `tenantId` passed in, per CLAUDE.md §14. **Not measured**:
  storage and AI-consumption usage — no module in this build tracks
  either yet (flagged, not silently assumed, same treatment Risk Agent
  gave its own unmeasured severity factors). **Not wired**: no other
  module's create path calls `checkUsageLimit()` yet — publishing the
  contract is this story's job; wiring each module's own create path is
  that module's, exactly the same situation `isFeatureEnabled()` is
  already in per the prior entry above.
- **PLATFORM-P0-05.3 — Global Configuration Versioning.** New
  `platform_config_versions` table (migration `0047`) records every write
  to branding or a feature flag's platform-wide default, with
  `old_value`/`new_value`/`actor_id`/`created_at`. New `modules/
  platform-admin/configVersions.ts` (`recordConfigVersion`,
  `listConfigVersions`, `getConfigVersion` — leaf-level, no dependency on
  `branding.ts`/`featureFlags.ts`, to avoid a circular import) and
  `modules/platform-admin/configRollback.ts` (`rollbackConfigVersion`,
  which sits *above* `branding.ts`/`featureFlags.ts` in the import graph
  specifically so it can call back into their real `updateBranding()`/
  `updateFeatureFlagDefault()` update functions — reapplying a prior
  version's `oldValue` through the same validation/versioning/audit path
  the original change went through, never a raw table write, so a
  rollback is itself versioned and audited exactly like any other config
  change). `updateBranding()` (already `Done`, PLATFORM-P0-03.1) now
  calls `recordConfigVersion()` in addition to its existing
  `writePlatformAudit()` call — both are kept, per the story's own
  acceptance criterion that `platform_audit_logs` "continues to record
  before/after as it already does for branding changes." New
  `updateFeatureFlagDefault()` (`featureFlags.ts`) — no path existed
  before this story to change `platform_feature_flags.default_enabled`
  at all, only per-tenant overrides; adding it is what makes the catalog
  default itself change-controlled rather than a one-time migration-0038
  seed. Both the branding page and the features page gained a version-
  history list with a "roll back to before this change" button.
- **PLATFORM-P0-05.4 — Maintenance Mode & Platform Announcements
  (Platform-side).** New `platform_announcements` table (migration
  `0047`: `scope` global/tenant, `type` maintenance/notice, `starts_at`/
  `ends_at`, `created_by`) and `modules/platform-admin/announcements.ts`:
  `createAnnouncement()` (audited), `listAnnouncements()` (admin
  surface), and `getActiveAnnouncements(tenantId)` — the published read
  contract this story's own cross-module note calls for: Platform Agent
  owns the admin-side data model and management UI (new
  `/platform-admin/announcements` page); rendering a notice inside
  customer-facing UI is Experience Agent's ownership per the existing
  UI-ownership split in the ownership map, so this module never reaches
  into `app/(customer)/*` itself (non-negotiable #6/#18) — it only
  publishes the read contract for Experience Agent to consume once
  dispatched again. Added both new tables to
  `docs/design/ownership-map.md` directly (owned outright by Platform
  Agent, same as every other new table this session added by its own
  owning module — not treated as requiring a separate user sign-off
  cycle, since neither table duplicates or reaches into another module's
  concept).
- **PLATFORM-P0-05.2 — AI Provider Configuration — deliberately NOT
  built this session.** Unlike PLATFORM-P0-05.4's ownership-map flag
  (purely mechanical, resolved directly per the paragraph above), this
  story's own text leaves genuinely open questions with real security
  stakes: which AI providers to support, what "allowed capabilities"
  means, what a budget-control model looks like — none of which the
  backlog's acceptance criteria actually specify beyond generic words.
  Guessing at these (e.g. hardcoding a specific provider list, inventing
  a budget semantics) would be exactly the kind of unspecified
  architecture/security decision CLAUDE.md §4's stop-and-report rule
  exists for, especially given credentials are involved
  (non-negotiable #10). Recorded here as an open question for the user
  rather than guessed; Progress Tracker marked `Deferred`, not
  `Not Started`, to distinguish "stopped on purpose" from "not reached
  yet."

**Verification run:**
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean. New
  routes/pages confirmed present in the build output:
  `/api/platform/v1/tenants/[id]/usage`, `/api/platform/v1/announcements`,
  `/api/platform/v1/config-versions`, `/api/platform/v1/config-versions/
  [id]/rollback`, `/platform-admin/tenants/[tenantId]/usage`,
  `/platform-admin/announcements`.
- `npx vitest run` — 132/132 passing across 21 files. New:
  `usage.test.ts` covers `classifyUsage()`'s three bands at each boundary
  plus the zero-limit edge case (always `hard_block`, even at zero usage
  — there's no room at all).
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match.
- Live-verified against the dev Supabase project (Supabase MCP, project
  `ekgyjwoenteadaaqakmd`), after applying migration `0047`: a customer-
  authenticated session (FinanceBot's Tenant A5 fixture user) sees zero
  rows in both new tables and cannot forge an `INSERT` into
  `platform_announcements` (both rejected — no client-facing policy at
  all, same vendor-only-boundary pattern as every other `platform_*`
  table). Replicated `getActiveAnnouncements()`'s exact query against
  four throwaway announcements (a global active notice, a B5-only
  tenant-scoped one, an already-expired one, and a future-scheduled one)
  and confirmed only the still-active global notice is returned for
  Tenant A5 — the tenant-scoped-to-a-different-tenant, expired, and
  not-yet-started rows are all correctly excluded. Confirmed the real
  agent count for Tenant A5 (1, FinanceBot itself) against a throwaway
  `max_agents: 1` subscription row, matching `classifyUsage(1, 1)`'s
  unit-tested `hard_block` result. Confirmed `platform_config_versions`
  accepts both config types (`branding` with a null `config_key`,
  `feature_flag_default` with a real flag key) per its check constraint.
  All throwaway rows cleaned up. `get_advisors` (security) re-checked
  after the migration — the only new findings are the expected
  `rls_enabled_no_policy` INFO entries for the two new tables (by design,
  same as every other `platform_*` table), nothing beyond that.

**Not started this session / still open:**
- PLATFORM-P0-05.2 (AI Provider Configuration) — deferred, open question
  recorded above for the user.
- PLATFORM-P0-05.4's Experience Agent half (rendering active
  announcements in the customer shell) — not built; `getActiveAnnouncements()`
  is published and ready for Experience Agent to consume next time it
  runs.
- `checkUsageLimit()` is not yet called by any other module's create
  path — same situation as `isFeatureEnabled()`, a follow-up for
  whichever module owns each gated create action.
- Every item already open from the prior entry (PLATFORM-P0-02.2's
  tenant-suspension-enforcement note, PLATFORM-P0-04.2's deferred
  support-access story) is unchanged and carries forward; the
  tenant-suspension gap this module originally surfaced was resolved by
  Foundation Agent the same day via migration `0039` (see Foundation's
  own audit log and `docs/RUN_ORDER.md`), but this module's own Progress
  Tracker row for PLATFORM-P0-02.2 is left as this module last verified
  it, per each module owning only its own tracker entries.

**Dependencies consumed:** everything from the prior entry — no new
dependency on another module's file.

**Published this session:** `checkUsageLimit()`, `getUsageSummary()`,
`classifyUsage()`, `updateFeatureFlagDefault()`, `listConfigVersions()`,
`rollbackConfigVersion()`, `createAnnouncement()`, `listAnnouncements()`,
`getActiveAnnouncements()` (all exported from `modules/platform-admin/
service.ts`) — `getActiveAnnouncements()` most relevant to Experience
Agent next time it runs.

---

## 2026-09-14 — Round-2 requirements re-check (expanded doc, no changes)

**Agent:** Platform Agent (documentation-only pass, no application code
touched, per this task's explicit constraints — no migrations, no tests,
no build/lint/typecheck run).

**Task:** the user re-uploaded a second copy of this module's requirements
document, framed as an updated/expanded version of the doc already
reconciled earlier the same day (see the "Requirements Refresh —
2026-09-14" entries above), and asked for a fresh, thorough re-check in
case it contained additional detail, new stories, or refined acceptance
criteria.

**Method:** read the full new document (281 lines) end to end; read the
full current backlog (`docs/plan/09-PLATFORM-AGENT-BACKLOG.md`), including
its Progress Tracker and its existing "Requirements Refresh — 2026-09-14"
section; read this audit log in full; and spot-checked the actual codebase
(`modules/platform-admin/*.ts`, `app/platform-admin/**`,
`supabase/migrations/0038_platform_admin.sql` and
`0047_platform_usage_config_versioning_announcements.sql`,
`docs/design/ownership-map.md`'s Platform-Agent rows) to confirm the
backlog's own record of what's built still matches reality before treating
anything as "missing."

**Finding: no genuinely new requirement, story, or acceptance criterion.**
Direct comparison shows the newly uploaded document is content-equivalent
to the smaller doc already reconciled earlier today — same "Original
Master PRD Requirements" text (Platform Administration Console §4,
Platform Admin UI §38) verbatim, and the same 11 P0 / 6 P1 / 3 P2 expanded-
requirements items (PLATFORM-P0-01 through PLATFORM-P0-11, PLATFORM-P1-01
through PLATFORM-P1-06, PLATFORM-P2-01 through PLATFORM-P2-03), same
numbering, same titles, same body wording. Nothing in it falls outside
what the existing backlog (including the P0-05.1–.4 stories added by the
first pass, and the pre-existing P1/P2 sections) already captures. The
codebase check confirmed the backlog's own status claims still hold —
`usage.ts`, `configVersions.ts`, `configRollback.ts`, and
`announcements.ts` exist exactly as described, `platform_config_versions`/
`platform_announcements` are already in the ownership map, and no
AI-provider-config table or module file exists anywhere (consistent with
PLATFORM-P0-05.2 remaining a deliberately deferred open question — not
re-flagged as newly missing, per this task's explicit instruction).

**Action taken:** added a "## Requirements Refresh — 2026-09-14 (round 2,
expanded doc)" section to the backlog documenting this finding and the
evidence for it, in place of the tracker-row additions the task
anticipated might be needed. **No Progress Tracker row was added, and no
existing row's status was changed** — PLATFORM-P0-02.2 (`Partial`),
PLATFORM-P0-04.2 (`Deferred`), and PLATFORM-P0-05.2 (`Deferred`) all stand
exactly as the prior pass left them. Also re-confirmed non-negotiable #3
(Platform Administration as a strictly separate vendor-only boundary) is
not blurred anywhere in the new document — nothing to flag on that front
either. This entry documents a genuine "nothing new" outcome rather than
manufacturing a gap to appear thorough.

---

## 2026-09-16 — Stale-row fix (PLATFORM-P0-02.2) and unblock (PLATFORM-P0-05.4)

**Agent:** Platform Agent, per the user's standing authorization to fix
any stale Progress Tracker rows and check for buildable unblocks.

**PLATFORM-P0-02.2 (Tenant lifecycle actions) — was stale, now `Done`.**
This row still read "Partial — ... a CRITICAL cross-module finding means
suspension does not yet block data access (Foundation's
`current_tenant_ids()` gap)." That gap was actually fixed by Foundation
back on 2026-09-14 (`supabase/migrations/0039_foundation_fix_current_
tenant_ids_status_check.sql`, whose own header comment says exactly
"Foundation Agent — critical fix, flagged by Platform Agent... verified
live") — the Progress Tracker row simply never got updated to reflect it.
Re-verified today via `mcp__Supabase__list_migrations` that
`foundation_fix_current_tenant_ids_status_check` is applied to the dev
project, and read the function body directly: it now filters on both
`tm.status = 'active' and t.status = 'active'`, so a suspended tenant's
members lose RLS access via every policy that calls this function
(i.e. every table in the system) — exactly the enforcement
`suspendTenant()` was always missing. No code changed; only the stale
Progress Tracker text was corrected.

**PLATFORM-P0-05.4 (Maintenance Mode & Platform Announcements) —
unblocked, now `Done`.** The Platform-side half (schema, management,
`getActiveAnnouncements()`) was already built; the customer-facing
rendering was explicitly Experience Agent's half, per this row's own note
and the file header comment in `modules/platform-admin/announcements.ts`
("Platform Agent owns the admin-side data model... Experience Agent owns
rendering a notice inside customer-facing UI"). Built it: `modules/ui/
AnnouncementsBanner.tsx` (a small, presentation-only Server Component —
no dismiss/mutation, since announcements are platform-authored and
already time-windowed via `startsAt`/`endsAt`, not a per-viewer
preference) wired into `app/(customer)/layout.tsx`'s existing parallel
`Promise.all()` data fetch (CLAUDE.md §15 — no sequential waterfall added)
and rendered once, above `<main>`, for every customer page.

**Verification:**
- `modules/ui/AnnouncementsBanner.test.tsx` — 3 tests (empty state
  renders nothing; a single announcement's title/body render; several
  announcements all render).
- `npm run typecheck` — clean, including confirming the `import type`-only
  reference to `modules/platform-admin/service.ts` (which has its own
  `import "server-only"`) compiles cleanly out of the `modules/ui/index.ts`
  barrel that client components also import from.
- `npm run lint` — clean.
- `npx vitest run` — 207/207 passing (up from 204).
- `npm run build` (with `.next` deleted first) — clean; the customer
  layout compiles for every route that uses it.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).

**Published this session:** none from this module — `AnnouncementsBanner`
is Experience-owned (`modules/ui/index.ts`); see that module's own audit
log for its entry.

---

## 2026-09-16 — PLATFORM-P0-05.2 (AI Provider Configuration), resolved and built

Previously `Deferred` per this row's own stop-and-report note: the story text
left "which providers" and "what capability/budget model" genuinely open, and
the ownership-map addition it needed was explicitly flagged for the user
rather than guessed. Resolved today via `AskUserQuestion` (in the context of
the user picking this up as one of 3 "not fully done P0" gaps to fix): provider
= OpenAI; key scope = both — a tenant may bring its own OpenAI key (BYOK) or
rely on a platform-wide default key, chosen per tenant.

**Built:**
- `supabase/migrations/0057_platform_ai_provider_config.sql` — new `ai.manage`
  permission, granted only to `TENANT_SUPER_ADMIN` (same restriction as
  `sso.manage` — no other role gets it by default). New
  `platform_ai_provider_configs` table: `tenant_id` primary key (one row per
  tenant, BYOK override only), `use_own_key`, `encrypted_api_key` (nullable —
  null until BYOK is enabled), `model`, `updated_by`/timestamps. RLS enabled,
  zero client-facing policies at all — same lockdown as
  `integration_credentials` (0021). The platform-wide default key is
  deliberately NOT a row in this table (which would need a `tenant_id null`
  special case with fragile nullable-uniqueness semantics) — it's the
  `PLATFORM_OPENAI_API_KEY` server-only env var instead, consistent with how
  `SUPABASE_SERVICE_ROLE_KEY`/`SECRET_ENCRYPTION_KEY` are handled (CLAUDE.md
  §16). Applied live to the dev project; re-checked `get_advisors` after —
  only the expected `rls_enabled_no_policy` INFO finding (same as every other
  zero-client-policy table) plus an initially-missing FK index on
  `updated_by`, fixed in the same migration (`platform_ai_provider_configs_
  updated_by_idx`) before commit, matching the `governance_attestations_
  agent_id_idx` precedent.
- `modules/platform-admin/aiProviderConfig.ts` — `getAiProviderConfig`,
  `setAiProviderConfig`, `resolveAiProviderKey`. Service-role client, manual
  tenant-ownership verification, `encryptSecret()`/`decryptSecret()` (never a
  module-invented scheme, per the story's own instruction), `writeAudit()`
  (Foundation's tenant `audit_logs`, not `platform_audit_logs` — this is a
  tenant-scoped customer setting, not a vendor-console action) with metadata
  that excludes the key itself. `resolveAiProviderKey()` is BYOK-first, else
  platform-wide fallback via `getPlatformOpenAiApiKey()` (new getter in
  `lib/db/env.ts`, deliberately not using the `required()` helper since the
  platform-wide key is legitimately optional), else `null`. Exported from
  `modules/platform-admin/service.ts`.
- `lib/ai/summarize.ts` (Foundation-owned, FOUNDATION-P0-16) rewritten:
  `summarize(tenantId, request)` now calls `resolveAiProviderKey(tenantId)` —
  a published Platform contract call, the same "a shared primitive consumes
  another module's already-published service function" pattern used
  repeatedly elsewhere this build (e.g. Compliance calling Operations' export
  primitive) — and, when a key resolves, calls OpenAI's chat-completions API
  directly via `fetch()` (no new npm dependency, matching this codebase's
  minimal-dependency ethos). Still throws `AiNotConfiguredError` when nothing
  resolves; a real OpenAI-side failure now throws a distinct error instead
  (never disguised as "not configured"). `app/api/v1/ai/summarize/route.ts`
  updated to pass `ctx.tenantId!` through.
- `/settings/ai` (bare functional page, gated by `requirePermission("ai.manage")`,
  401→`/sign-in`/403→`/settings`) + `app/actions/ai.ts`
  (`setAiProviderConfigAction`) — mirrors `/settings/sso` + `app/actions/sso.ts`
  exactly. Shows active key source (BYOK / platform default / not configured)
  and whether a platform default is even available, without ever rendering a
  key value; the form's API-key field is `type="password"`, left blank keeps
  the existing stored key. Linked from `/settings`'s index page.
- `.env.local.example` documents the new optional `PLATFORM_OPENAI_API_KEY`.

**Verification:**
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npx vitest run` — 217/217 passing (up from 210 going into this story).
  `lib/ai/summarize.test.ts` rewritten: not-configured (mocked
  `resolveAiProviderKey` → `null`), BYOK-path OpenAI call shape/headers,
  platform-fallback path, a non-OK OpenAI response producing a distinct
  (non-`AiNotConfiguredError`) error, plus the pre-existing no-DB-import and
  exported-surface structural tests (both still pass unmodified).
- `npm run build` (with `.next` deleted first) — clean; `/settings/ai` present
  in the route list.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).
- `mcp__Supabase__get_advisors(security)` / `(performance)` re-checked after
  applying the migration — no new findings beyond the expected
  `rls_enabled_no_policy` INFO (fixed the FK-index gap before commit).

**Deliberately not built:** budget/spend limits, per-capability allow-lists,
and the `ai_assistant` feature-flag gate mentioned in the story's original
text — no user direction to add spend controls specifically, and no existing
route currently checks an `ai_assistant` flag before calling `summarize()`
(EXPERIENCE-P0-14's route only checks the domain `*.read` permission for the
data being summarized). Left for a future story if the user wants
budget/safety controls.

**Published this session:** `modules/platform-admin/aiProviderConfig.ts`'s
three functions, re-exported from `modules/platform-admin/service.ts` — the
contract Foundation's `lib/ai/summarize.ts` now consumes.

---

## 2026-09-16 — Gemini added as a second AI provider (follow-up to PLATFORM-P0-05.2)

Mid-turn follow-up request from the user right after PLATFORM-P0-05.2
(OpenAI-only) shipped: also support a Gemini API key. Extended the same
platform-wide-default-or-BYOK model to a second provider rather than
building a parallel concept.

**Built:**
- `supabase/migrations/0058_platform_ai_provider_gemini.sql` — widens
  `platform_ai_provider_configs.provider`'s check constraint from
  `openai`-only to `openai`/`gemini`. Plain `ALTER TABLE ... DROP/ADD
  CONSTRAINT`, no data migration needed (every existing row was already
  `'openai'`). Applied live; `get_advisors(security)`/`(performance)`
  re-checked — no new findings.
- `getPlatformGeminiApiKey()` added to `lib/db/env.ts` (same
  deliberately-optional, no-`required()` shape as
  `getPlatformOpenAiApiKey()`), plus `PLATFORM_GEMINI_API_KEY` documented
  in `.env.local.example`.
- `modules/platform-admin/aiProviderConfig.ts`: `setAiProviderConfig()`
  now takes an explicit `provider` field. The key correctness property
  this needed: an API key is provider-specific (an OpenAI key is not a
  valid Gemini key), so switching provider must never silently carry the
  old provider's encrypted key forward as if it were the new provider's.
  Implemented via a `providerChanged` check — switching provider without
  supplying a fresh key throws the same `API_KEY_REQUIRED` error as
  configuring BYOK for the first time, and the previously stored
  `encrypted_api_key` is discarded (set to `null`), never reused, when
  provider changes without a fresh key being rejected outright first.
  `resolveAiProviderKey()` resolves the platform-wide fallback strictly for
  the tenant's configured provider (`PLATFORM_GEMINI_API_KEY` for Gemini,
  `PLATFORM_OPENAI_API_KEY` for OpenAI) — never the other provider's key.
- `lib/ai/summarize.ts` gained `callGemini()` (Gemini's `generateContent`
  REST endpoint, still no new npm dependency) alongside the existing
  `callOpenAi()`; `summarize()` picks the call based on
  `resolved.provider`. `AiProviderName` widened to `"openai" | "gemini"`
  in `lib/shared/types/platform.ts`.
- `/settings/ai` gained a provider `<select>` (OpenAI / Google Gemini);
  the model field's default now depends on the selected provider
  (`gpt-4o-mini` vs. `gemini-2.0-flash`); the page explicitly tells the
  user switching provider never reuses a previously stored key.
  `app/actions/ai.ts` validates `provider` is one of the two values.

**Verification:**
- New `modules/platform-admin/aiProviderConfig.test.ts` (5 tests, mocked
  service-role client mirroring `modules/integrations/credentials.test.ts`'s
  existing pattern) — directly covers the provider-switch/key-isolation
  logic: first-time BYOK requires a key; switching provider without a
  fresh key is rejected even though an old key is stored; switching with a
  fresh key discards the old encrypted key and stores the new one with the
  new provider's default model; re-saving the same provider without a new
  key keeps the existing key; `resolveAiProviderKey()` resolves BYOK,
  falls back to the same provider's platform default only (asserted the
  other provider's getter is never called), and returns `null` when
  neither exists.
- `lib/ai/summarize.test.ts` gained a Gemini-path test asserting the
  Gemini `generateContent` URL (not OpenAI's) is called with the right
  model and key.
- Full pipeline: `npm run typecheck` clean, `npm run lint` clean, `npx
  vitest run` 226/226 (up from 217), `npm run build` (with `.next` deleted
  first) clean, `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` no match.

No Progress Tracker row change beyond PLATFORM-P0-05.2's existing `Done`
entry, which was updated in place to mention Gemini.

---

## 2026-09-16 — pagination pass (QA-P0-04.3 follow-up, user-prioritized "what's left before launch")

Capped 3 previously-unbounded queries with the new shared
`DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`, 200): `tenants.ts`'s
`listTenants()` (the platform-admin console's tenant list — genuinely
grows without bound as the platform's customer base grows, the highest-
real-risk one of the three), `announcements.ts`'s `listAnnouncements()`
(the platform-admin UI's history view — its separate,
already-independently-bounded `getActiveAnnouncements()` read contract for
the customer shell banner is unaffected), and `configVersions.ts`'s
`listConfigVersions()` (branding/feature-flag-default version history).

Verification covered as part of the full cross-module pass — see
`INTEGRATION_STATUS.md` §5's update note for the shared pipeline run.

---

## 2026-09-16 — Egress caveat in this log is obsolete; isolation re-proven with a real client

This log's tenant-isolation entry records that the proof was run through the
Supabase MCP with a server-side simulated JWT "because this sandbox's network
egress cannot reach Supabase directly." That restriction has lifted for HTTPS.
The deferred half has now been done once, centrally, rather than re-run
per module: `tests/live-client-tenant-isolation.mjs` drives two genuinely
authenticated Supabase JS client sessions over HTTPS across **all 44
tenant-scoped tables** — this module's included — in both directions, plus
cross-tenant read/update/delete/insert attempts and an unauthenticated anon
sweep. Every check passed, and the live result agrees with this module's
earlier simulated proof.

No code in this module changed. See
`docs/design/foundation-agent-backlog-audit.md` and
`docs/design/qa-agent-backlog-audit.md` (both dated 2026-09-16) for the full
account, including what remains blocked (raw Postgres; a complete Playwright
E2E run, which needs credentials this environment does not have).

---

## 2026-09-25 — PLATFORM-P0-12: feature flags are enforced (Partial)

Codebase-map defect D8: `isFeatureEnabled()` had no callers, so flags were
stored but meant nothing.

**Migration `0065_platform_master_rollout_flags.sql`** (applied live)
seeds the 13 flags from master stories §26 with its "initial safe rollout"
defaults. On: `agent_discovery`, `access_graph`, `runtime_observe`,
`tool_filtering`. Off: `runtime_enforce`, and every flag for a capability
not built yet (NHI, shadow AI, runtime approvals, JIT, credential
brokering, data authorization, behavioural detection, simulation), so
switching one on early changes nothing. It is additive; existing flags and
overrides are untouched.

**Contract**

- `getFeatureFlags(tenantId, keys)` reads several flags in **one parallel
  round trip** (overrides and catalog together) and is tenant-filtered.
- `resolveFlags()` (pure): an override wins, else the catalog default,
  else off.
- `requireFeature()` throws 403 `FEATURE_DISABLED`.
- `isFeatureEnabled()` now delegates to them.
- A failed flag read throws, and callers treat that as not enabled, never
  as permission.

**Now enforced**

- **Runtime Gateway** (user decision, 2026-09-25):
  - `runtime_observe` lets a tenant's agents use the gateway at all.
    Without it: 403 `GATEWAY_DISABLED` and no record.
  - `runtime_enforce` switches the tenant to **ENFORCE**, where
    `effectiveDecision` is the real decision and the tool filter really
    hides tools.
  - `tool_filtering` gates `/tools/filter`.
  - The flags are read inside the gateway's existing parallel wave, so
    there is no added round trip.
- The existing default-on flags are now honoured where their capability
  lives: `runtime_monitoring` (runtime ingestion), `remediation`
  (`remediateFinding`), `saviynt_connector` / `custom_api_connector` /
  `mcp_integration` / `sailpoint_connector` (creating that connector
  type), and `certifications` (`launchCampaign`). Every one defaults on,
  so no current tenant loses anything.

**Deliberately not enforced (why Partial)**

- `ai_assistant` defaults **off**, yet AI summaries and the help
  assistant are live. Enforcing it would silently switch them off for
  every tenant. It needs a platform decision: flip the default on and
  then enforce, or keep the AI features ungated. It is recorded, not
  guessed.
- `agent_governance`, `compliance_mappings` and `advanced_analytics` gate
  broad existing areas with no single entry point. Enforcing them is a
  follow-up with its own UI states.

**Hardening found on the way.** `PUT/GET
/api/platform/v1/tenants/:id/features` passed an unvalidated id to the
database, so a malformed id produced a 500 (`invalid input syntax for
type uuid`). It now answers 400 through `assertUuid`.

**Verified**

- Unit: `featureFlags.test.ts`, 3 cases (default, override either way,
  unknown flag off). Gateway flag cases: ENFORCE tells the caller DENY;
  enforce without observe means off (403, no record); tool filtering in
  ENFORCE hides; disabled filtering gives 403.
- Existing unit suites gained a default-flags mock; 440/440.
- E2E `tests/e2e/gateway-enforcement.spec.ts`, 2/2. A platform admin
  turns `runtime_enforce` on for **E2E Tenant Two only**: that tenant's
  agent is told DENY (`mode ENFORCE`) while Tenant One's agent still gets
  observe-only ALLOW. After the reset Tenant Two is observe-only again.
  With `runtime_observe` off the gateway gives 403 `GATEWAY_DISABLED`,
  never ALLOW. Flags are restored in `finally`.
- Full pipeline on the final build (§17.8: flags gate ingestion,
  connectors, certifications and remediation, so the whole suite ran):
  eslint clean, vitest 440/440, Playwright **164/164** (7.7 min).
- Migration 0065 applied to the live project. Its 13 flag rows were
  checked; no tenant has an override row, so every tenant runs on the
  defaults.

---

## 2026-09-26 — Global announcement renamed for WonderID (data change, no code)

With the product renamed WonderID (user decision), the one global notice
`d6469d00-…`, created by the platform administrator on 2026-09-15, still said
"Welcome to WonderAgent". Its title and body were changed to "Welcome to
WonderID" / "Thanks for trying WonderID — your governance data is seeded and
ready to explore." The change used a service-role SQL update scoped to that id
and guarded on the old title. It was **not** written to
`platform_audit_logs`: that table requires a human `actor_id`, and attributing
the change to the administrator would record an action they did not take.
This entry is its record.

---

## 2026-10-01 — PLATFORM-P1-04 Billing: Stripe and Razorpay (brought forward by explicit user request)

**Finding.** No billing existed. `subscriptions` was assigned by hand in the
console, with no payment, invoice or provider link.

**Built.**
- `0102_platform_billing.sql`:
  - `subscriptions` gains the provider link and adds statuses
    trialing/incomplete/paused.
  - New tables: `billing_prices` (12 seeded list prices for pro/max ×
    month/year × USD/EUR/INR; INR includes GST), `billing_profiles`,
    `billing_checkouts`, `billing_invoices` (immutability trigger),
    `billing_invoice_sequences` + `next_invoice_number()` (gapless
    `WID/2026-27/000001`), `billing_webhook_events` and
    `billing_adjustments` (four-eyes check constraint).
  - New notification types `billing_alert` and `privacy_deadline`.
- `modules/billing/`:
  - `rules.ts`: provider routing (INR→Razorpay, else Stripe), status mapping,
    GST CGST/SGST/IGST/export, GSTIN check character, EU/UK VAT format,
    profile validation, Indian FY.
  - `signatures.ts`: Stripe v1 with 5-minute tolerance; Razorpay webhook and
    checkout signatures.
  - `stripeClient.ts` and `razorpayClient.ts`: fetch, no SDK. The Stripe API
    version is pinned to 2024-06-20, with idempotency keys.
  - `http.ts`: timeout, one retry on idempotent calls only, redacted errors.
  - `service.ts`: overview, profile, checkout, portal, cancel at period end,
    resume (Stripe).
  - `webhooks.ts`: intake persisted before processing, the tenant resolved only
    from WonderID's own records, stale-event guard, invoice ledger, refunds,
    billing alerts to `billing.manage` holders.
  - `adjustments.ts`: maker-checker refunds, plan overrides and immediate
    cancellation; price management.
- Routes:
  - `/api/v1/billing/*`, with webhooks at `/api/v1/billing/webhooks/{stripe,razorpay}`.
  - `/api/platform/v1/billing/{adjustments,prices,events}`.
- Screens:
  - `/settings/billing`: plan, usage, plan picker, billing details, invoices.
    It shows the truthful "payment submitted, the plan changes when the
    provider confirms" state.
  - `/platform-admin/billing`: adjustment queue, price catalogue, webhook log.
    It is in the platform nav.

**Decisions recorded.**
- List prices are a business default, editable in the console.
- An ended subscription drops to Free limits. Nothing is deleted.
- Customer cancellation is always at period end. Immediate cancellation is a
  four-eyes platform adjustment.
- INR prices are tax-inclusive.

**Verification.**
- `rules.test.ts` and `signatures.test.ts`, 30+ cases: GST arithmetic sums
  exactly, known-valid GSTINs (27AAPFU0939F1ZV, 29AAGCB7383J1Z4), tampered /
  replayed / mis-signed webhooks rejected, form encoding.
- Rolled-back live isolation test: invoices and profiles are invisible without
  `billing.view` and invisible cross-tenant; client inserts and
  `next_invoice_number()` are refused; an invoice amount change or delete is
  refused; self-approval is refused.
- On the built server, the unconfigured Stripe webhook answers 503.
- typecheck, eslint, vitest 797/797, `next build` all pass.

**Not done.** No real Stripe or Razorpay account or key is available here, so
checkout, portal and webhooks were not exercised end to end against the
providers. Setup steps are in `docs/security/SECURITY-CONTROLS.md` §1. A Stripe
test-mode run plus a Razorpay test-mode subscription is the next verification
step once keys are set.

### 2026-10-01 (later) — self-review fixes: gapless numbering under concurrency, in-flight webhooks, double checkout

A by-hand review of the billing code found three defects. All are fixed.

1. **Invoice numbers could have a gap.** `upsertInvoice()` drew
   `next_invoice_number()` before writing, so the losing write in a race
   discarded its number, and GST rule 46 needs a consecutive series. Migration
   `0106_platform_billing_concurrency.sql` adds `assign_invoice_number(invoice)`,
   which locks the invoice row and draws a number only when it will be stored.
   The application now inserts or updates first, then calls it.
2. **Concurrent deliveries could both process one event.** An event whose
   status was `received` was re-processed by any redelivery.
   `billing_webhook_events.claimed_at` (0106) is now checked: a fresh claim
   answers "retry later" (HTTP 500 so the provider retries), and only a failed
   event or a claim older than 2 minutes is reclaimed, conditionally on the
   claim time just read.
3. **Double checkout.** A second checkout was allowed while the first was
   still open, which could open two paid subscriptions. `startCheckout()` now
   refuses with 409 `CHECKOUT_IN_PROGRESS` when the organization opened a
   checkout in the last 10 minutes.

**Verification.**
- `assign_invoice_number` was tested live in a rolled-back transaction:
  - A repeat call on the same invoice returns the same number
    (`WID/2026-27/000001`).
  - The next invoice gets `…000002`, and the counter is 2: no number wasted.
  - An open invoice gets none, and a missing id is refused.
  - Verified clean afterwards.
- typecheck, eslint and vitest 797/797 pass.

## 2026-10-09 — `listPublicPrices()` for the public landing page

- Added `listPublicPrices()` to `modules/billing/service.ts`, so the
  signed-out landing page can show the real price list.
- `billing_prices` is WonderID's own global catalogue and holds no
  customer data, but its RLS policy admits `authenticated` only.
- The function reads with the service role and returns only the public
  columns (plan, interval, currency, amount, tax behaviour) of **active**
  prices. It never returns the Stripe or Razorpay price and plan ids.
- No RLS or schema change. The anon role still cannot read the table
  through PostgREST.
- The landing page caches the result for an hour (ISR). A price changed
  in the console reaches the page within the hour.
- Covered by the welcome spec's pricing test.

---

## 2026-10-09 — "Welcome to WonderID" announcement ended

User request: remove the banner "Welcome to WonderID — Thanks for trying
WonderID — your governance data is seeded and ready to explore."

- **What it was.** A global `platform_announcements` row of type `notice`
  (`d6469d00-…`), seeded on 2026-09-15 with no end date, so it showed to
  every organization. Since sign-up now creates an empty organization
  automatically, its "your governance data is seeded" was also untrue for
  new customers (CLAUDE.md §19.2).
- **What changed.** The row's `ends_at` was set to now (20:09 UTC), and a
  `platform.announcement_ended` event was written to `platform_audit_logs`
  with the old and new values.
  - The row is kept rather than deleted: it is announcement history, and it
    can be restored by clearing `ends_at`.
  - The platform console can create announcements but has no "end" action
    yet, so this was done in SQL under the platform administrator account.
    Adding that action is a candidate follow-up.
- **Verified.** No announcements are active for any organization.
- **Code.** None changed. `AnnouncementsBanner` renders nothing when there is
  no active announcement.

### 2026-10-10 — Record provenance columns (Foundation migration 0115, owner request)

Foundation's migration 0115 added `created_at`, `updated_at`, `created_by`
and `updated_by` (where missing) and the `record_provenance` trigger to this
module's object tables: `billing_profiles`, `feature_flags`. Additive; no service changed. The rule is
CLAUDE.md §19.10; the mechanism and its verification are in the Foundation
log, the page work in the Experience log. A new object table of this module
follows the same pattern and joins `lib/provenance/tables.ts`.

### 2026-10-10 — PLATFORM-P0-13 first slice: Global Configuration (owner request)

The customer-facing Configuration Studio starts as Admin › Global
Configuration: versioned organization settings with history and restore,
built on Foundation's `tenant_settings` (migration 0116, `lib/config`).
Detail and verification are in the Foundation and Experience logs. The
vendor-only `/platform-admin` boundary is unchanged. Still to do: the
declarative configuration objects the spec lists (identity types,
templates, workflows, terminology, navigation visibility), draft, simulate,
approve and environment promotion.

### 2026-10-12 — Audit retention defaults (WID-H07, owner decision)

The owner chose, in the findings decision sheet: 1 year on Free and Pro, 3
years on Max, 7 years on Enterprise.
- `PLAN_DEFAULTS` (`modules/platform-admin/subscriptions.ts`) changed:
  Free 30 to 365 days, Pro 90 to 365, Max 365 to 1095; Enterprise stays
  2555. The pricing page and the billing page read these values.
- Migration 0143 (applied):
  - raises each existing subscription below its plan's new default (one
    row: a Pro subscription already at 365, so unchanged);
  - adds `subscriptions_audit_retention_floor` (at least 365 days).
- Why: the purge never removes audit rows younger than 365 days (0104),
  so the old Free and Pro values promised a retention the system did not
  apply.

Verified:
- a live insert with 30 days is refused by the new constraint;
- `npm run typecheck` and eslint on the changed file: clean.

### 2026-10-12 — WID-H07, identifiers only

WID-H07 identifiers only: `platform.admin_granted` records the user's id, no longer their email.

### 2026-10-13 — WonderApps dashboard access: an audited on/off switch (owner decision)

**What was there.** The `wonderapps_dashboard` database role was noted on
2026-10-11. It was created outside this repository and belongs to the
WonderApps dashboard (the owner's company platform):
- it can sign in;
- it has `wonderapps_dashboard_read` policies (`USING (true)`) on 27 tables;
- `pg_stat_statements` showed read-only, cross-organization aggregate
  queries run under it (`BEGIN READ ONLY`, an 8 s statement timeout,
  counts per tenant);
- by today it held no table grants, so it read nothing.

**Owner decision.** It is required. Keep it, with a switch to turn it off
later.

Built:
- **Migration `0155_platform_wonderapps_dashboard_access.sql`** (applied):
  - `wonderapps_dashboard_access()` reports the state;
  - `set_wonderapps_dashboard_access(enabled)` grants SELECT on every
    table that has the policy, or revokes it.
  - On the AI provider settings table, only the non-secret columns are
    granted, never `encrypted_api_key` (#10).
  - Both functions are callable by the service role only.
- **Service:** `modules/platform-admin/wonderappsAccess.ts`. Each change
  is written to `platform_audit_logs` with the state before and after; a
  failure is audited and never reported as done (§17.5).
- **Console:** a section "WonderApps dashboard access" on
  `/platform-admin/health` shows on, off or unavailable, with one button
  to turn it on or off (`requirePlatformAdmin`).

Not done by Claude: turning it on. The safety check refused a
service-role grant of cross-organization read access, so the owner turns
it on, in the console or in the SQL editor
(`select set_wonderapps_dashboard_access(true)`).

Verified:
- `npm run typecheck`; eslint on the changed files.
- Vitest `wonderappsAccess.test.ts` 3/3: reads the state; turns it off
  and audits it; never claims a change the database did not confirm.

Recorded in `docs/WonderID/progress/PROGRESS.md` (the open owner action
is closed).

## 2026-10-13 — The platform console gets the product's design system (owner report: "looks weird")

**What changed.** Every `/platform-admin` page was bare HTML (inline styles, `border={1}` tables, unlabelled inputs). Now:
- the layout has its own light/dark sidebar (`app/platform-admin/PlatformNav.tsx`, active page highlighted, a scrolling row on phones) with the WonderID logo and a "Platform" tag; still never the customer shell (non-negotiable #3), and still a bare 404 for anyone else;
- every page uses the shared primitives (`Card`, `TableContainer`/`Th`/`Td`/`Tr`, `Button`, `StatusBadge`, `fieldInputClass`) and one heading (`app/platform-admin/PageHeading.tsx`, which also renders the health signals as labelled badges);
- Tenants: labelled create form; status as a badge; only the applicable action shows (Suspend or Activate, Decommission unless decommissioned) instead of three buttons with two disabled;
- Feature Flags: one table of defaults; per-organization overrides show only the flags actually overridden, with one compact "Set" form; the per-flag and per-tenant reads now run in parallel (§15);
- Billing: approvals queue and price catalogue in cards; the adjustment request form, recent adjustments and webhook intake folded into disclosures (§19.5);
- Platform Admins also lists the addresses from `PLATFORM_ADMIN_EMAILS` (marked as such);
- Global Configuration, Announcements, Health and Usage restyled; version history folded.

No action, form field name or authorization changed.

**Roadmap.** `docs/WonderID/ROADMAP-PROGRESS.md` gains "Vendor platform console" (done); `npm run roadmap` (`scripts/roadmap-progress.mjs`) now recomputes its percentages from the marks, and CLAUDE.md §19.6 requires updating it on every merge (owner rule, 2026-10-13).

**Verified.** `npm run typecheck`; eslint on `app/platform-admin`; `next build`; local E2E `platform-admin.spec.ts` + the platform part of `navigation-smoke.spec.ts`: 23 passed. Screenshots checked at 1440 px light and dark and at 390 px.

## 2026-10-13 — Roadmap stories page (owner request)

`docs/WonderID/ROADMAP-STORIES.md` lists every roadmap story (the F1–F10 phase stories and the product-base stories of every module backlog, 318 in all) with its progress. At the top it shows what was completed recently, what is up next and what is blocked. It is generated by `scripts/roadmap-stories.mjs`, which `npm run roadmap` now runs after `roadmap-progress.mjs`, and it reads:
- the module Progress Trackers, which are the source of truth;
- `run-order/RUN-ORDER.md`, for the phases and their order;
- `progress/PROGRESS.md`, for stories not yet in a backlog or being finished by a phase, and for open decisions and owner actions;
- git history, for the tracker rows that became Done.

Blocked means one of three things: a phase story that needs a decision still open (D7, D8, D9), a backlog row marked deferred or "(blocked: …)", or an open owner action. CLAUDE.md §19.6 requires regenerating it in every merge.

While building it, the live phase doc's INTEGRATION-P0-22 row was found stale ("Not started"; the backlog says Partial since #107/#112). It is corrected, and its "Next story" line is updated.

**Verified.**
- `npm run roadmap` regenerates both files.
- `roadmap-progress.mjs` reproduces the existing ROADMAP-PROGRESS.md byte for byte.
- eslint is clean on both scripts.

## 2026-10-13 — Story priorities (owner request)

**What changed.** Every story on `docs/WonderID/ROADMAP-STORIES.md` now has a priority (High, Medium or Low), shown in each table and in the up next and blocked lists.
- The priorities come from a new **Priorities** table in `docs/WonderID/progress/PROGRESS.md`. The rows are read top to bottom and the first match wins. A row can name story IDs, a module prefix with an optional `(unfinished)`, phases, `Deferred` or `Product base`. `scripts/roadmap-stories.mjs` applies the table and refuses a priority it does not know.
- The owner decided that unfinished INTEGRATION stories are **Low**, for later implementation: SCIM, the relay, Entra ID, HR, ServiceNow, and the others still open.
- The tenant-isolation, RBAC and sign-in QA sweeps are High.
- Phases are weighted as follows: F1–F4 and the F10 release gate High, F5–F7 Medium, F8–F9 Low. Deferred stories are Low, and the rest of the product base is Medium.
- "Up next" is now ordered by priority first, then by work already under way, then by plan order. It covers the product base as well and shows 10 stories.
- The page states how many unfinished stories are low priority.
- The live phase doc's "Next story" line and CLAUDE.md §19.6 follow the priorities.

**Result.** The unfinished stories are 17 High, 51 Medium and 26 Low; all 11 unfinished INTEGRATION stories are Low. Up next: RISK-P0-13, F4 lifecycle and certification, and the High QA sweeps.

**Verified.** `npm run roadmap` regenerates both pages; eslint is clean.

**2026-10-13, restored.** A concurrent commit on main (a0145a4, the findings-register audit) was made from a base older than #142 and reverted this change: the Priorities table, the script, the CLAUDE.md note and this entry. All four were restored from #142 and the page regenerated.

## 2026-10-13 — PLATFORM-P0-16: organization addresses and environments (owner request)

**Owner decisions (asked directly).**
- Each environment is its own organization (tenant) with its own data, users and connections, linked to the production one.
- Only platform administrators create environments.
- Vercel manages the DNS for wonderapps.biz, so the owner said to configure everything.

**Built.**
- **Addresses.** `*.id.wonderapps.biz` was added to the Vercel project (verified at once, since Vercel holds the wonderapps.biz nameservers), and `BASE_APP_HOST=id.wonderapps.biz` was set for production.
  - The FOUNDATION-P0-22 routing that was already built (`lib/tenant/host.ts`, `proxy.ts`, `resolve_tenant_host`) now serves `https://<slug>.id.wonderapps.biz` from the next production deploy.
  - On an organization's address, only that organization is reachable, and still only through an active membership: the host narrows, it never grants.
- **Migration 0156.**
  - `platform_tenants.environment` gains development, test and staging.
  - New column `parent_tenant_id`, with checks: not self, and production has no parent.
  - One environment of each kind per organization (unique index).
- **`create_tenant_environment(parent, kind)`.** Security definer, service role only, one transaction:
  - creates the tenant `<slug>-dev` (or `-test`, `-staging`), named "<Org> (Dev)";
  - creates its settings and platform record;
  - its platform subdomain comes from the 0095 trigger;
  - copies the production organization's active administrators (TENANT_SUPER_ADMIN) as its administrators.
  - It refuses an inactive organization, an environment of an environment, an unknown kind and a second environment of the same kind.
- **Console.**
  - `createTenantEnvironment()` (audited `platform.tenant_environment_created`, success or failure), with an action behind `requirePlatformAdmin()`.
  - Tenants shows each organization's address as a link, and its environments under it.
  - "Add" offers only the missing Dev, Test or Staging for an active production organization.
- **Incident, fixed.** As first written, the migration put a foreign key on `parent_tenant_id`. Applied to the shared database, that made PostgREST's `tenants(...)` embed from `platform_tenants` ambiguous, and the vendor console returned 500 in production.
  - Found by the local E2E run minutes after applying.
  - The constraint was dropped at once; the migration file now has no foreign key and says why.
  - The console's embeds now name `tenants!platform_tenants_tenant_id_fkey`, so a later key cannot break them.

**Verified.**
- `tests/platform/tenant-environments.sql` (live, rolled back), 9 checks:
  - slug `<org>-dev`, name, platform record (development and parent) and subdomain;
  - only the active administrator is copied;
  - a second dev environment (23505), an environment of an environment (22023) and an unknown kind (22023) are refused;
  - a member cannot call the function (42501) or see the new organization (0 rows).
- Vitest `tenantEnvironments.test.ts` 4/4 (`modules/platform-admin` 22/22).
- Typecheck and eslint clean; `next build` succeeds.
- Local E2E, with `BASE_APP_HOST=localhost`: platform-admin, tenant-address, risk and the platform navigation smoke, 34 passed.

**Owner action.** For Google, Microsoft and LinkedIn sign-in on an organization's address, add `https://*.id.wonderapps.biz/**` under Supabase → Authentication → URL Configuration → Redirect URLs. Until then those sign-ins return to id.wonderapps.biz. Password sign-in works on every address.

**Left out.**
- Promoting configuration between environments (the configuration bundles of PLATFORM-P0-13).
- Self-service environments.
- Plan limits on environments.

## 2026-10-13 — Choose the prefix and environment; platform admins change them; colours; switching (owner requests)

**Owner requests, all on 2026-10-13.**
1. The organization setup chooses the address prefix and the environment.
   - The owner then said not to build a new wizard and to add the options to the existing "Create a new organization" card on `/onboarding`.
   - The automatic first organization at sign-up is unchanged.
2. A platform administrator changes the environment later.
3. A platform administrator changes the prefix at any time.
4. Each environment has a designated colour, the same for every organization.
5. There is an easier way to switch between an organization's environments.

**Built.**
- **Migration 0157.**
  - The slug guard of 0095 now allows a change only inside `rename_tenant_slug()`, through a transaction-local flag. That function, service role only, moves the slug and the platform subdomain together; the old address stops resolving.
  - `set_tenant_environment()`, service role only.
  - Three-argument `create_tenant_with_owner` and `create_first_tenant_for_current_user`, which record the chosen environment. The two-argument versions are kept.
  - `tenant_slug_available()` answers only true or false.
- **Migration 0158.** `my_tenant_environments()`.
- **Migration 0159.** `my_organization_environments()`: environment plus the linked production organization, for the caller's own active memberships only. It was added because changing 0158's return type needed a drop, which waits on an approval that times out.
- **Create card.** The prefix follows the name until edited, the address preview follows the prefix and environment, and the environment is one of four coloured choices. A taken or invalid prefix is refused in words (`setUpOrganizationAction`, audited `tenant.created` with environment and slug).
- **Console.**
  - New `/platform-admin/tenants/[id]` page: change the address, change the environment, add environments, and links to the organization's environments.
  - `renameTenantSlug` and `setTenantEnvironment` are audited (`platform.tenant_address_changed`, `platform.tenant_environment_changed`, success or failure, with old and new values).
  - The Tenants list links each name to that page and shows the environment as its coloured badge.
- **Colours.** `modules/ui/environment.tsx`, theme tokens only, always with the name next to the colour:

  | Environment | Colour |
  |---|---|
  | Production | green |
  | Development | blue |
  | Test | amber |
  | Staging | violet |
  | Sandbox | grey |

  The organization switcher shows a coloured dot and badge for the current organization and a badge per organization in its menu.
- **Switching.** Under the organization's name, coloured chips (Production · Dev · Test · …) switch between the person's environments of that organization in one click. They are grouped by the platform's link, or by a shared address prefix (`environmentSiblings`, pure). Switching uses the existing `selectTenantAction`, which goes to the other organization's own address when on one.

**Verified.**
- `tests/foundation/org-prefix-environment.sql` (live, rolled back), 17 checks:
  - prefix availability before and after creation, and a reserved word;
  - the first organization created only once;
  - an unknown environment refused;
  - a member cannot change the slug, call the rename, or set the environment (42501);
  - the rename moves the slug and subdomain, and the old address no longer resolves;
  - an invalid prefix (22023), a taken prefix (23505) and a direct slug update (23514) are refused;
  - the environment change.
- Vitest: `lib/tenant` and `modules/platform-admin` 49 passed; `environmentFamily` 3 passed.
- Typecheck, eslint and `next build` clean.
- Local E2E (`BASE_APP_HOST=localhost`): first-organization, platform-admin, tenant-address and shell, 37 passed. The new test covers:
  - a chosen prefix and the Test environment;
  - a taken prefix refused;
  - the same prefix in Production, then switching in one click;
  - a platform administrator changing the address and environment, checked in the database.

**Left out.**
- Renaming an organization does not rename its environments (each has its own address). A platform administrator renames them one by one.
- Configuration promotion between environments (PLATFORM-P0-13).

## 2026-10-13 — Tenants: every organization, a simpler table, plan changes, test organizations apart (owner reports)

**Reports.**
- "I don't see any URL having this name": self-service organizations were missing from Tenants, because the list read only `platform_tenants`.
- "I don't see rename option": the name was a link, but nothing showed it.
- "Once a plan is assigned there is no option to change it, also table layout is not great."
- "If you create any environment, keep it separate": read as keeping test organizations apart from real ones, to be confirmed with the owner.

**Built.**
- **Every organization.** `listTenants()` and `getTenant()` now read `tenants`, with the platform record embedded (no record counts as production). Decommissioned organizations are hidden unless "Show decommissioned" is chosen.
- **The table.**
  - Columns are now: Organization (name, with the address under it as a link), Environment (coloured), Status, Plan, and one "Manage" link per row.
  - Address, environment, plan, status, adding environments and usage all moved to the organization's Manage page.
  - Badges and buttons no longer wrap: `whitespace-nowrap` added in Badge, EnvironmentBadge and the shared Button.
  - "Create an organization" is folded at the bottom.
- **Plan changes.** `changePlan()` changes a plan the platform assigned by hand (or assigns one) with that plan's limits, audited `platform.subscription_plan_changed` with from and to. A plan billed through Stripe or Razorpay is refused with the way to do it: a Billing plan override that a second administrator approves (§18.2.6).
- **Test organizations apart.** `testTenantIds()` marks an organization as a test one when its slug starts `e2e-` or `fixture-`, or when all its members are test accounts (`@e2e.wonderagent.test`, `@example.test`). Two leftover "Wonderagent" organizations from interrupted E2E runs fall into this group. Test organizations are listed in a collapsed "Test organizations" section. This is for display only, never for access.

**Verified.**
- Vitest: `subscriptions.test.ts` 3/3; `modules/platform-admin` 28 passed.
- Typecheck and eslint clean; `next build` succeeds.
- Local E2E:
  - platform-admin 16 passed; the spec now opens the Test organizations section to find E2E Tenant One;
  - first-organization and the platform navigation smoke passed in the earlier run (26).
- Screenshots of Tenants and of a Manage page checked.

## 2026-10-13 — The console is organized by organization, each holding its environments (owner request)

**Request.** "One organization should have multiple environments; this should reflect in platform console. See one organization, its owner details etc., option to manage each env of that org, option to add or remove each env."

**Built.**
- **Organizations list** (nav item renamed from "Tenants"). There is one row per organization, from the pure `groupOrganizations()`, which reuses the shell's grouping rule: the platform link, or a shared address prefix. Each row shows:
  - name and address;
  - owner, meaning the first active administrator, with "+n" for more and all of them in the tooltip;
  - its environments as coloured chips, each linking to that environment;
  - plan and status;
  - Manage.

  Test organizations stay in their collapsed section. "Create an organization" now creates the production environment; Dev, Test and Staging are added from the organization.
- **Organization page.** This is the production environment's page:
  - **Owners:** the active TENANT_SUPER_ADMINs, each name with a mailto link (`organizationOwners()`, service role, those tenants only).
  - **Environments:** a table with each environment's address, plan and status, Manage, and "Remove…". Remove shows an inline confirmation and is offered for linked non-production environments only.
  - **Add environment**, offering only the kinds missing.
  - **Production settings:** address, environment, plan and status.
- **Environment page.** "← <Organization>", the heading "<Organization> · <Environment>", and that environment's own settings.
- **Migration 0160, `remove_tenant_environment()`.** Service role only, one transaction:
  - decommissions the environment, keeping its data;
  - moves its address and subdomain to `<slug>-removed-<6>`, so the address is free again;
  - moves its link into notes, so the same kind can be added again.
  - It refuses production and anything not linked. `removeTenantEnvironment()` audits `platform.tenant_environment_removed`.

**Verified.**
- `tests/platform/remove-environment.sql` (live, rolled back), 8 checks:
  - after removal the slug is `<slug>-removed-…`, the environment is decommissioned and unlinked, and its old address no longer resolves;
  - the same environment can be added again at the same address;
  - removing production is refused (22023);
  - a member cannot call the function (42501).
- Vitest: `groupOrganizations` 2/2.
- Typecheck and eslint clean; `next build` succeeds.
- Local E2E:
  - platform-admin and first-organization 20/20. The new test opens E2E Tenant One, sees its owner, adds Dev, manages it, goes back, and removes it.
  - One onboarding assertion changed. A rename that takes an unlinked environment out of its prefix group re-renders the page as that organization's own, so the spec checks the saved address rather than the transient message.

## 2026-10-13 — Manage organizations (owner request)

**What changed.** The organization switcher's "Create new organization" is now "Manage organizations" (`/organizations/manage`). An organization's owner (TENANT_SUPER_ADMIN of the organization) can:
- rename the organization; its environments follow ("<name> (Test)");
- disable or enable the organization, which takes its environments with it, or disable or enable one environment;
- add a development, test or staging environment, which is paid for. Owner decisions: organizations stay free, environments are paid at a plan's price, and until Stripe or Razorpay keys are set, payment is a test payment (no money moves, recorded as `payment_mode = 'test'`).

Owner feedback the same day: an organization set up as development, with no production organization above it, could not add environments. Any top-level organization can now, both here and in the platform console; its own kind can't be added twice.

**Database (migration 0161).**
- `tenants.disabled_by_owner` tells an owner's disable from a platform suspension. Only an owner's disable can be lifted by an owner. A platform suspension clears the flag (`setTenantStatus`).
- `is_organization_owner()`, `my_managed_organizations()`, `owner_rename_organization()` and `owner_set_organization_disabled()`: SECURITY DEFINER, run as the caller, and the ownership check is in the database.
- `environment_orders` (Platform): RLS on, read by `billing.view` holders, written only by the service role. It holds one open order per organization and environment.
- `create_tenant_environment()` now accepts any top-level organization.

**Security.** Disabling is the existing suspension, which `current_tenant_ids()` already refuses (0152), so a disabled organization's data is unreachable to every member. The page sits outside the product shell, so an owner can still enable an organization they disabled. The no-access page links to it. Each change is audited (`tenant.renamed`, `tenant.disabled_by_owner`, `tenant.enabled_by_owner`, `billing.environment_ordered`, `billing.environment_setup`). The order is written before set-up; a failure marks it failed and is reported, never shown as success.

**Verified.**
- Live SQL (`tests/foundation/manage-organizations.sql`, rolls back), every expected result:
  - another organization's owner sees none of it, can't rename or disable it, and can't read its orders;
  - a client insert of an order is refused;
  - the owner renames it, and its environments follow;
  - a disabled organization is unreachable but still listed for its owner;
  - an environment can't be enabled while its organization is disabled;
  - a platform suspension can't be lifted by the owner;
  - a development organization adds Test, but not Development, and an environment can't have environments.
- Vitest: `environmentOrders` 7/7 (test mode only without a provider, ownership, disabled organization, wrong currency, double click, failed set-up recorded), `manage` grouping 2/2, platform-admin 30/30.
- Typecheck and eslint clean; `next build` succeeds.
- Local E2E: manage-organizations (new), first-organization and platform-admin, 21/21. The new test: rename, buy Test, disable and enable it. It caught a UI bug, a confirm step that survived Enable, which is fixed.

**Left out.** Real checkout for environments through Stripe or Razorpay: once keys are set, test payments stop and the page says online payment isn't available yet. That checkout is the follow-up. The address prefix stays the platform console's to change.

## 2026-10-13 — Organization shown wrongly after adding Test to a development organization (owner feedback)

**What was wrong.** Kunal's organization is set up as development, with no production organization above it. After a Test environment was added to it, the console grouped the two correctly but picked the organization by environment rank (production, staging, test, development). So it showed "Kunal's organization (Test)" as the organization, and the original development organization as one of its environments.

**Fix.** `groupOrganizations()` now takes as the organization the tenant its environments link to, whatever its own environment. Without links it still takes the production one first.

**Verified.** `organizations.test.ts` 3/3. The new case fails without the fix. Typecheck and eslint clean.

## 2026-10-13 — Organizations list trimmed (owner request)

The Organizations list no longer shows each organization's address under its name, or the Environments column. Both stay on the organization's own page (its Environments table). The list keeps name, owner, plan, status and Manage, which is one control fewer per row (§19.5).

**Verified.** Typecheck and eslint clean. The platform-admin E2E only uses the organization's own page for environments, which is unchanged.

## 2026-10-13 — Organization and environment pages; one plan per organization (owner requests)

**What changed.**
- **The organization's page** shows the organization only:
  - its environments, each with Manage and Remove. On the organization's own environment, Remove takes away the whole organization (`removeOrganization`: every environment is decommissioned, data kept), with a confirm;
  - its owners;
  - its plan;
  - **Organization details**: name (renaming it renames its environments, through `platform_rename_organization`), description, contact person (name, email, phone), company (name, email, phone), industry, user base size, country and website (`platform_organization_profiles`, migration 0162; vendor-only, no client policies).
- **Each environment's page**, reached from Manage, including the organization's own environment (`?view=environment`):
  - says it is an environment and shows its badge and status;
  - shows counts of users, identities, applications, accounts, AI agents, connections, access requests and risk findings;
  - shows load: runtime events in the last 30 days and last activity. These are counts only, scoped to that tenant, and "Unavailable" when a count can't be read (`getEnvironmentStats`);
  - its configuration: address, environment type, the organization's plan (read-only), features (per-environment flags), platform notes, and status (suspend, activate, remove).
- **One plan per organization** (owner decision):
  - `setOrganizationPlan` sets it on the organization and every environment;
  - a new environment inherits it (`inheritOrganizationPlan`);
  - customers buying an environment buy it on the organization's plan;
  - migration 0163 gave existing environments without a plan their organization's (insert only).
  - A plan billed through a payment provider is never overwritten; that is reported instead.
- **Environment addresses** no longer stack suffixes. An organization at `planet-express-dev` now adds `planet-express-staging`, not `planet-express-dev-staging` (migration 0164). Existing addresses are unchanged.
- **The onboarding list** groups environments under their organization: each organization once, its environments below it.
- **The switcher button** shows the organization's name only. The badge and address line are gone; the coloured dot and environment chips stay.

**Verified.**
- Live SQL (`tests/platform/organization-profiles.sql`, rolls back): a bad email or size is refused; the new environment's address has no stacked suffix; renaming the organization renames its environments, and an environment can't be renamed on its own; a member can't read the details or call the rename.
- Vitest: profile rules 3/3, organization plan 4/4, environment orders 8/8, platform-admin 42 overall.
- Typecheck, eslint and `next build` pass.
- Local E2E 34/34: platform-admin (new test for saving details and managing the organization's own environment), first-organization, manage-organizations, tenant-address and multi-org-isolation.

## 2026-10-13 — End a notice by hand (owner request)

Announcements now has **End now** on every notice still running. It sets the notice's end to the current time; the record stays, and the row then reads "Ended". This is `endAnnouncement()`, audited as `platform.announcement_ended`; a notice that has already ended is left as it is.

**Verified.** Typecheck and eslint clean. Local E2E platform-admin, including a new test that publishes a notice scoped to E2E Tenant One and ends it. That run and first-organization and users came to 30/30.

## 2026-10-13 — Production can be added as an environment (owner feedback; migration 0165 approved by the owner)

**Problem.** Planet Express is set up as development and had added test and staging. There was then nothing left to add, so neither the console nor Manage organizations showed Add environment. Production was never addable.

**Change.**
- Migration 0165 (the owner approved the schema change) drops `platform_tenants_production_has_no_parent`: it held only while every organization was its production tenant.
- It widens `environment_orders`' environment check to include production.
- `create_tenant_environment` now creates production at the organization's bare prefix (`planet-express`, from `planet-express-dev`).
- `ADDABLE_ENVIRONMENTS` and `ENVIRONMENT_KINDS` include production, so both pages offer it whenever the organization lacks it.

**Verified.**
- Live SQL (`tests/platform/production-environment.sql`, rolls back):
  - production is created at the bare prefix, linked, with the owner as a member;
  - a second production is refused;
  - an organization that is production can't add production;
  - a production environment order is accepted.
- Vitest 106/106; typecheck, eslint and `next build` clean.
- Local E2E platform-admin and manage-organizations 20/20.

**Noted, not changed.** Changing an environment's type to production in the console (`set_tenant_environment`, 0157) still clears its link to the organization. That is now unnecessary; it's left for a follow-up if wanted.

## 2026-10-14 — Platform Admins is the bootstrap page (WID-H10)

Owner decision: the console is for `platform_admins` entries only. The
Platform Admins page also serves a `PLATFORM_ADMIN_EMAILS` session (the
bootstrap): the navigation shows only that page, a short line explains
it, and the grant form fills in the session's own id. Every other console
page moved into `app/platform-admin/(console)` (same URLs) behind a
table-only layout. Detail and verification: Foundation audit log, same
date.

## 2026-10-14 — FOUNDATION-P0-34: organizations in the console by number

`/platform-admin/tenants/<ref>` (and `/usage`) take the organization's
global number (`platformTenantRef`); an old UUID link redirects, keeping
`?view=`. Both pages now check `isPlatformAdmin()` themselves before the
lookup (a page renders alongside its layout, so the layout's check alone
does not order it). The organizations list, environment rows and the
remove-environment redirect link by number (`PlatformTenant.ref`,
`Organization.ref`). Detail and verification: Foundation audit log, same
date.
