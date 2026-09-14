# Foundation Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-13 — FOUNDATION-P0-01 through P0-06 (initial implementation)

**Agent:** Foundation Agent · **Branch:** `claude/wonderagent-setup-lasmly` (this
session develops directly on the harness-assigned branch rather than a separate
`module/foundation` worktree branch — see note under "Deviations" below).

**Built:**

- **FOUNDATION-P0-01** — Next.js 16 (App Router) + TypeScript (strict) + Tailwind
  v4 + ESLint scaffold, via `create-next-app` in a scratch directory then merged
  into the repo (`app/`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`,
  `postcss.config.mjs`). Added `@supabase/supabase-js`, `@supabase/ssr`, `zod`,
  `recharts`, `reactflow`, Radix UI primitives, `server-only`, and a Vitest +
  Testing Library dev toolchain. `.env.local.example` committed;
  `.gitignore` fixed to exclude `.env*.local` while explicitly un-ignoring
  `.env.local.example` (the stock Next.js `.gitignore` ignores `.env*`
  unconditionally, which would have silently excluded the example file too).
  `lib/db/env.ts` centralizes env var access with a hard runtime guard
  (`typeof window`) on the service-role key and the secret-encryption key.
  `lib/db/supabaseBrowser.ts` / `supabaseServer.ts` provide the two sanctioned
  client factories (`supabaseServer()` request-scoped/RLS-respecting,
  `supabaseServiceRole()` trusted-only). Verified the service-role key does not
  reach the client bundle by grepping `.next/static` after a production build.
  Renamed `middleware.ts` → `proxy.ts` (Next 16 deprecated the old convention).
- **FOUNDATION-P0-02** — Full schema applied to the live dev Supabase project
  (`ekgyjwoenteadaaqakmd`, the only Supabase project this app may use) via the
  Supabase MCP `apply_migration` tool, as
  `supabase/migrations/0001`–`0008_foundation_*.sql`: `tenants`,
  `tenant_settings`, `users` + `handle_new_user()` trigger, `tenant_memberships`,
  `roles`/`permissions`/`role_permissions`/`user_roles` with the full P0
  permission catalog and all 11 system roles seeded and mapped per the backlog's
  worked table, RLS on every table via `current_tenant_ids()`, and the
  `create_tenant_with_owner()` self-service RPC (solves the tenant-creation
  chicken-and-egg problem under RLS).
- **FOUNDATION-P0-03** — Email/password sign-up/sign-in pages
  (`app/sign-up`, `app/sign-in`), self-service tenant creation and tenant
  picker (`app/onboarding`, `app/actions/tenant.ts`) backed by the RPC above.
  **Deferred**: SAML/OIDC SSO (03.3) and MFA enrollment (03.4) — the
  `sso_connections` table and its RLS exist, but the actual IdP handshake
  wiring was not started this session; flagging per the backlog's own
  instruction to stop rather than fabricate a SAML implementation. No open
  question yet since no story time was spent guessing at it — this is a
  straightforward "not started," to be picked up in a follow-up run.
- **FOUNDATION-P0-04** — `requirePermission()` and `requirePlatformAdmin()`
  guards (`lib/rbac/`), exercised by `app/api/v1/tenant` (no permission
  required beyond an active tenant) and `app/api/v1/users` (requires
  `user.manage`, used to prove RBAC denial). **Deferred**: the role-management
  UI (04.3) — no screen yet to assign/revoke roles through the app; the RPC/DB
  layer supports it, only the UI is missing.
- **FOUNDATION-P0-05** — `lib/audit/writeAudit.ts` (service-role-only writer,
  matching `audit_logs`' RLS which grants no client insert policy at all).
  `lib/security/encryptSecret.ts`/`decryptSecret.ts` implemented with Node's
  built-in AES-256-GCM rather than pgcrypto or Supabase Vault — see the
  rationale in that file's docblock (no project-tier-dependent feature, no
  extra DB round trip, standard authenticated-encryption construction). This
  resolves the backlog's "stop and report if unclear" flag without needing to
  actually stop, since a clean, dependency-free standard option existed.
  Baseline HTTP security headers/rate limiting (05.3) — **deferred**, not
  started.
- **FOUNDATION-P0-06** — `platform_admins` table (zero RLS policies —
  intentionally unreachable by any client role), `requirePlatformAdmin()`,
  `app/platform-admin/layout.tsx` (denial renders a bare 404 via `notFound()`,
  never a "no permission" page that leaks structure). Verified via a running
  `next start` server: unauthenticated hits to `/platform-admin` return 404,
  `/api/v1/tenant` and `/api/v1/users` return 401 `NO_TENANT`, `/` redirects to
  `/sign-in`. No platform admin has been seeded yet in the dev project (no user
  exists to seed against) — first real seeding happens when the user actually
  signs up.
- **FOUNDATION-P0-07 (critical acceptance test)** — Ran the full tenant
  isolation proof directly against the live dev database via the Supabase MCP
  `execute_sql` tool (this sandbox's plain outbound network is blocked by an
  organization egress allowlist — confirmed by a direct `curl`/`fetch` test to
  `*.supabase.co` failing with `connect_rejected`, so a JS-client-based
  integration test could not run from this session; simulating the JWT via
  `set_config('request.jwt.claims', ...)` + `set role authenticated`/`anon`
  exercises the identical RLS policies a real client session would). Fixture:
  two tenants, two users, one membership/role/audit row each. Result, acting
  as Tenant A's user: every tenant-scoped table returned only Tenant A's rows;
  Tenant B was invisible even by direct primary-key lookup (0 rows, no error);
  a direct `UPDATE` targeting Tenant B affected 0 rows; inserts into
  `tenant_memberships` (claiming Tenant B), `audit_logs`, and `platform_admins`
  were all rejected with an explicit RLS policy-violation error, not silently
  dropped. As `anon`: every tenant-scoped table returned zero rows; the
  `permissions` catalog and system `roles` rows (both non-sensitive catalog
  data) remained readable. Fixture data was deleted afterward — the dev
  project is clean. The reusable script (with the exact commands and observed
  results) is committed at `tests/foundation/tenant-isolation.sql` for
  re-running by a future session or the QA Agent. Also added Vitest unit tests
  for the pure logic that doesn't require a live database or Next's request
  context: `lib/security/encryptSecret.test.ts` (round-trip, random IV,
  tamper detection, malformed-payload rejection) and
  `lib/rbac/requirePermission.test.ts` (401/403/success paths against a
  mocked tenant context).

**Self-inflicted issue found and fixed during this session:** an early
"harden the security advisories" pass revoked `EXECUTE` on
`current_tenant_ids()` from `authenticated`/`anon` in response to a
`get_advisors` WARN about the function being callable via REST RPC — but RLS
policies invoke that function *as the querying role*, so this broke RLS
entirely (`permission denied for function current_tenant_ids`) until
`0011_foundation_fix_current_tenant_ids_grant.sql` restored the grant. Left as
a reviewed, intentional exception (same treatment as
`create_tenant_with_owner`): the function only ever returns the caller's own
tenant memberships, so REST-RPC exposure carries no cross-tenant risk.
`get_advisors(security)` and `get_advisors(performance)` are clean after
`0009`–`0011` other than that one accepted WARN and the intentional
"no-policy" INFO on `platform_admins`. `rls_auto_enable()`, a Supabase-managed
function neither created nor owned by this module, also still shows in the
advisories and was left untouched.

**Verification run:** `npm run lint`, `npm run typecheck`, `npm run test`
(7/7 passing), `npm run build` — all clean. Confirmed no leak of the
service-role key into `.next/static`. Confirmed via a locally-started
production server (`next start`) that every route above returns the expected
status code without a live Supabase network call being required for the
unauthenticated paths tested.

**Deviations from the backlog's stated workflow (flagging for the user,
not guessing silently):**

1. This session develops directly on the harness-assigned branch
   (`claude/wonderagent-setup-lasmly`) rather than creating a separate
   `module/foundation` git worktree/branch — the calling environment's own
   instructions pin all work to that one branch and forbid pushing elsewhere
   without explicit permission, which supersedes `docs/ORCHESTRATION.md`'s
   default multi-worktree convention for *this* environment. Future sessions
   that do run as genuinely separate Claude Code consoles should follow
   `docs/ORCHESTRATION.md` as written.
2. `.env.local` contains the real Supabase credentials the user pasted in
   chat, so this session could exercise the Supabase MCP tools and read the
   env-var names correctly; it is gitignored and was never committed.

**Not started this session (still open for a future Foundation Agent run,
not blocking other agents):** SSO handshake wiring (03.3), MFA enrollment
UI (03.4), role-management UI (04.3), baseline security headers/rate
limiting (05.3). None of these block Identity/Integration/Access/etc. from
starting, since the schema, RLS, RBAC guards, tenant context, audit writer,
and secret encryption they all depend on are in place and tested.

---

## 2026-09-14 — CRITICAL gap flagged by Platform Agent: `current_tenant_ids()` doesn't check `tenants.status`

Platform Agent's own run (docs/design/platform-agent-backlog-audit.md, same
date) discovered and verified live that `current_tenant_ids()` (this
file's own `0004_foundation_rls.sql`) filters only on
`tenant_memberships.status = 'active'` and never checks `tenants.status` —
so every RLS policy in the entire system that relies on it (every module
built so far) continues granting full access to a tenant's active members
even after that tenant is suspended. `tenants.status` becomes a label with
no enforcement effect. Platform Agent did not patch this itself (correctly,
per non-negotiable #14/#18 — this is Foundation's shared authentication-
model function, not Platform Agent's to change), and recorded a proposed,
minimal, additive fix in its own audit log:

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

**Not applied yet** — left as an explicit open question for the user
(per the stop-and-report rule) rather than guessed past, since a change to
this function has system-wide blast radius (every module's RLS policies
call it) and deserves a dedicated Foundation Agent verification pass across
every other module's own tenant-isolation tests once applied, not a
same-turn patch made while building Platform Agent's console. Whoever runs
Foundation Agent next should apply this fix and re-run
`tests/foundation/tenant-isolation.sql` plus spot-check one or two other
modules' isolation scripts against a suspended-tenant fixture (a case none
of them tested, since every existing isolation test only ever checks
cross-tenant access between two *active* tenants, never a suspended
tenant's own members).
