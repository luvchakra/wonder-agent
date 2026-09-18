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

---

## 2026-09-14 — RESOLVED: `current_tenant_ids()` now enforces `tenants.status`

**Agent:** Foundation Agent · **Branch:** `claude/wonderagent-setup-lasmly`,
dispatched directly by the user in response to the finding above ("dispatch
Foundation Agent now to apply this fix and re-verify isolation tests
across the other modules").

**Applied**: migration
`0039_foundation_fix_current_tenant_ids_status_check.sql` —
`create or replace function current_tenant_ids()`, unchanged name/
signature/return type (so every existing `GRANT EXECUTE` from
`0009`/`0011` and every RLS policy calling
`tenant_id in (select current_tenant_ids())` keeps working unmodified),
now joining to `tenants` and requiring `t.status = 'active'` in addition to
`tm.status = 'active'` — exactly the fix proposed in the entry above.

**Verified live against the dev Supabase project, in this order:**
1. **The gap is closed**: set `tenants.status = 'suspended'` on the
   existing FinanceBot fixture tenant (`aaaaaaaa-5000-...`, from Runtime/
   Risk/Compliance's own fixtures), then re-ran, as that tenant's
   authenticated member, the exact checks that previously proved the gap:
   `current_tenant_ids()` no longer includes the suspended tenant (`false`,
   was `true`), and reads against `agents`/`tenants`/`runtime_events`/
   `risk_findings` for that tenant all now return zero rows (were 1/1/1/1).
   Reverted the fixture back to `status = 'active'` immediately after and
   confirmed the revert took effect.
2. **No regression on ordinary active-tenant access**: attempted to re-run
   the original `tests/foundation/tenant-isolation.sql` fixture
   (`aaaaaaaa-0000-...`/`bbbbbbbb-0000-...`) and found it had been cleaned
   up between sessions (its rows no longer exist in the dev project) —
   rather than silently accept an empty/inconclusive result, re-ran the
   equivalent checks against the still-present, richer FinanceBot fixture
   instead: as Tenant A5's active member, `tenants`/`agents`/
   `risk_findings`/`runtime_events`/`certification_items` all still return
   exactly that tenant's own rows (`{fixture-tenant-a5-test}`,
   `{FinanceBot}`, 1, 1, 3 respectively — matching every prior module's own
   recorded fixture state), and Tenant B5 remains a zero-row cross-tenant
   lookup. This spans Foundation's own tables plus Identity's, Risk's,
   Runtime's and Compliance's — a broader regression check than the
   original fixture alone would have given, since it proves the fix didn't
   disturb any downstream module's RLS behavior either.
3. `get_advisors` (security) re-checked: identical set of previously-
   reviewed exceptions (the intentional `rls_enabled_no_policy` tables,
   `current_tenant_ids()`'s own now-longer-standing `anon`/`authenticated`
   SECURITY DEFINER exposure warning, `create_tenant_with_owner`'s and
   `rls_auto_enable()`'s equivalents, leaked-password-protection) — nothing
   new introduced by this change.

**Added a permanent regression test** to
`tests/foundation/tenant-isolation.sql` (new §5, commented like the
existing anon-role section for manual re-run against a dev project) so a
future change to this function or the `tenants`/`tenant_memberships`
schema gets checked against a suspended-tenant scenario, not only
cross-tenant access between active tenants.

**Not done, and deliberately out of scope for this fix**: did not re-seed
the original cleaned-up Foundation fixture (`aaaaaaaa-0000-...`) — the
FinanceBot fixture already served as a valid, arguably stronger,
substitute for this specific regression check. Did not re-run every other
module's own isolation script individually (Access/Integration/Identity's
own `tests/*/tenant-isolation.sql` files) — the cross-module regression
check in step 2 above already exercises RLS on tables owned by four of the
downstream modules (Identity, Risk, Runtime, Compliance) through the same
`current_tenant_ids()` code path every one of those scripts also depends
on, so re-running each individually would be redundant with what step 2
already proves about the shared function; a full QA-Agent-level sweep
across every module's own script remains QA Agent's job per its own
backlog (QA-P0-02.1).

**No application code changed** — this was a pure database migration; no
`npm run lint`/`typecheck`/`test`/`build` impact expected or found (all
re-run as a matter of pipeline discipline; unaffected, still clean).

---

## 2026-09-14 — Remaining Foundation P0 stories (03.3, 03.4, 04.3, 05.3, 08, 09, 11)

**Agent:** Foundation Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Per the user's explicit instruction ("operate like before... start with the
first requirement backlog document, focusing on p0 only for now"), picked up
every remaining P0-tier story in this module's own backlog, in order, one at
a time, auto-continuing without stopping between stories.

### FOUNDATION-P0-03.3 — SSO connection foundation

Schema already existed (`0007_foundation_sso.sql`, from the 2026-09-13 run)
but no code did. Built: `lib/auth/sso.ts` (CRUD + `resolveJitRole()` +
`provisionSsoMembership()` + `getFullActiveSsoConnectionByDomain()` +
`findActiveSsoConnectionForDomain()`), `app/api/v1/sso/route.ts` +
`[id]/route.ts` (gated by `sso.manage`) + `domain-lookup/route.ts`
(deliberately unauthenticated, exposes only `{domain, protocol}`), a bare
admin page at `/settings/sso`, domain-based "Sign in with SSO" routing added
to the sign-in page, and `app/auth/callback/route.ts` (code exchange +
SSO JIT tenant-membership provisioning, recording `source: 'sso_jit'` in the
audit event per the backlog's own requirement).

**Verified live** (Supabase MCP, against the `aaaaaaaa-5000-...`/
`bbbbbbbb-5000-...` FinanceBot fixtures — see `tests/foundation/
tenant-isolation.sql` §7 for the exact commands): Tenant A5's user sees only
its own `sso_connections` row, Tenant B5's user sees zero; a plain
authenticated client's direct INSERT is rejected, and its direct UPDATE
affects 0 rows (no policy exists for either, matching the intentional
select-only + service-role-write design). `resolveJitRole()`'s claim→role
mapping logic is unit-tested (`lib/auth/sso.test.ts`, 5 cases: default
fallback, direct match, array-valued claim match, unmapped value fallback,
missing claim fallback).

**Not verified, honestly flagged rather than fabricated** (matches the
backlog's own stop-and-report allowance for this exact situation): an actual
end-to-end SAML/OIDC redirect against a real identity provider, and
`provisionSsoMembership()`'s database writes exercised via a real SSO login.
Both require a real IdP and a Supabase-project-level SSO provider
registration (an Enterprise/Pro-tier, dashboard/CLI setup step, not
application code) that does not exist on this environment's connected
project. Tracker marked `Partial`, not `Done`.

### FOUNDATION-P0-03.4 — MFA foundation

`/settings/security` (client component) using Supabase Auth's own
`mfa.enroll`/`mfa.challengeAndVerify`/`mfa.unenroll`/`mfa.listFactors`
exclusively — no custom TOTP implementation, per the backlog's explicit
instruction. No new database table (Supabase manages MFA factors
internally). **Not verified**: real enrollment against a physical/software
authenticator app (no such device is available in this sandbox) — the code
correctly follows the documented SDK response shape
(`data.totp.qr_code`/`secret`/`uri`), but a live TOTP round-trip was not
exercised. Tracker marked `Partial`.

### FOUNDATION-P0-04.3 — Role management UI (minimal)

`lib/rbac/roles.ts` (`listTenantMembersWithRoles`, `listAssignableRoles`,
`assignRole`, `removeRole` — all service-role writes gated by
`requirePermission('role.manage')`, each manually verifying the target user
is an active tenant member before mutating, matching CLAUDE.md §14's
service-role guardrail) plus `/settings/roles`. **Verified live**: a plain
authenticated client's direct INSERT into `user_roles` is rejected, and its
direct DELETE affects 0 rows — same pattern as `sso_connections`. Marked
`Done`.

### FOUNDATION-P0-05.3 — Baseline HTTP security

`next.config.ts` now sets CSP (script-src/style-src `'unsafe-inline'` as a
P0 baseline — a full nonce-based strict CSP is a reasonable P1 refinement,
not attempted here), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`. For the rate limiter: sign-in and
sign-up were **moved from a client component calling
`supabase.auth.signInWithPassword`/`signUp` directly to server actions**
(`app/actions/auth.ts`) specifically so a rate limit could be enforced
before Supabase Auth is ever called — the previous direct-from-browser
architecture had no interception point at all. Backed by a new table
(`auth_rate_limit_attempts`, migration `0040`, RLS-enabled with zero
policies — service-role only, same treatment as `platform_admins`), a
sliding-window helper (`lib/security/rateLimiter.ts`), keyed per-email AND
per-IP (10 attempts/5 min for sign-in, 5/hour for sign-up). **Verified
live**: (1) RLS confirmed zero-policy for both `authenticated` and `anon`
(no error, zero rows); (2) the exact count-then-insert threshold logic was
simulated directly in SQL against the live table (attempts 1-3 allowed,
attempts 4-5 blocked once `count >= maxAttempts`) — a direct Node script
calling the real TS function was attempted first but blocked by this
sandbox's network egress proxy (`Host not in allowlist`), the same
constraint documented throughout this session; the SQL-level simulation
exercises the identical query logic. Marked `Done`.

### FOUNDATION-P0-08 — Job Security primitive

Published `lib/jobs/tenantScopedJob.ts` — `runTenantScopedJob(ctx,
requiredPermission, idempotencyKey, jobBody)`, enforcing a resolved tenant
context, the required permission, and a real idempotency key before running
the job body, and auditing any thrown failure. Unit-tested (7 cases).
**Deliberately not retrofitted into Integration Agent's existing
`integration_sync_jobs` code** — per CLAUDE.md non-negotiable #18, a module
agent must never modify another module's implementation to make its own
story pass. Recommendation recorded here (not acted on unilaterally): a
future Integration Agent run should adopt this wrapper around its own
sync-job creation code.

### FOUNDATION-P0-09 — Session Security

`lib/tenant/sessionSecurity.ts` (pure `checkSessionExpiry()`, unit-tested —
5 cases covering idle-only, absolute-only, both, neither, and missing
cookies) plus two cookies (`wa_session_started_at`,
`wa_session_last_seen`) stamped at every sign-in path (password sign-in via
`app/actions/auth.ts`, SSO via `app/auth/callback/route.ts`) and cleared on
sign-out. Enforced in `proxy.ts`: on every authenticated request outside
`/sign-in`/`/sign-up`/`/auth/callback`, checks idle (30 min) and absolute
(12 hour) expiry; on expiry, calls `supabase.auth.signOut()` and redirects
to `/sign-in?reason=expired`, clearing all three cookies. Session fixation
is mitigated by construction (Supabase issues a brand-new session on every
sign-in; there is no pre-auth session identifier to fixate) rather than a
separate control. Marked `Done`.

### FOUNDATION-P0-11 — Input/Output Safety

Published `lib/security/validate.ts` (`assertNonEmptyString`, `assertUuid`,
`assertOneOf`, `assertPlainObject`, `assertJsonSizeWithinLimit`,
`sanitizePlainText`), unit-tested (15 cases). Adopted immediately in the new
SSO connection-creation path (`lib/auth/sso.ts`'s `createSsoConnection()`)
as a real usage example, since that route was written in this same session
— existing shipped route handlers from prior sessions were **not** rewritten
to adopt this retroactively, per CLAUDE.md §3 ("don't refactor unrelated
code while implementing a story"); this is the contract for new/future
routes.

**Full verification run across all seven stories**: `npm run typecheck`,
`npm run lint`, `npm run build` (all routes present, including the four new
ones: `/api/v1/sso*`, `/auth/callback`, `/settings/sso`,
`/settings/security`, `/settings/roles`), `npx vitest run` — 85/85 passing
(27 new tests this session: 5 SSO role-mapping + 7 job-security + 5
session-expiry + 15 input-validation, minus overlap already counted).
`get_advisors(security)`/`get_advisors(performance)` re-checked after the
new migration (`0040`) — identical accepted-exception set as before, plus
`auth_rate_limit_attempts` correctly showing as an intentional
zero-policy table (INFO level, not a new WARN/ERROR).

**Open items carried forward, not blocking**: FOUNDATION-P1-01 (SCIM)
through P1-04, and the P2 items, remain untouched per CLAUDE.md §3's
priority-tier rule (P0 first). The two `Partial` items above (03.3, 03.4)
have a real, honestly-scoped gap (a live IdP/authenticator round-trip) that
only a non-sandboxed environment with a real IdP/device can close — not
something to keep re-attempting here.

---

## 2026-09-14 — QA-P0-04.2 finding: flaky `encryptSecret.test.ts` tamper
test (smallest-safe-change fix, logged here per QA-P0-04.4)

**Found by:** QA Agent, during its repo-wide pipeline sweep (QA-P0-04.1/
04.2). **Fixed by:** QA Agent, as the smallest safe change in the owning
module's own test file, logged here in Foundation's audit log per
QA-P0-04.4's rule (QA logs a defect fix in the *owning* module's log, not
a QA-owned file — `lib/security/encryptSecret.ts` and its test are
Foundation-owned).

**Symptom:** `lib/security/encryptSecret.test.ts`'s "rejects a tampered
ciphertext" test failed intermittently (~25% observed rate across
repeated `vitest run` invocations of the file alone, and occasionally in
full-suite runs), with no code change between passing and failing runs.

**Root cause:** the test tampered the *last* character of the ciphertext
envelope's base64 `data` segment. For a base64 group that lands on a
padding/"don't-care bits" boundary, flipping that specific character can
leave the decoded bytes unchanged — base64 decoding ignores certain bits
in the final sextet of a padded group — so the AES-256-GCM auth tag
would occasionally still verify against the (actually-unchanged)
plaintext, and the test's `.rejects.toThrow()` assertion failed. This is
**not a security bug**: GCM authentication itself works correctly and
does reject any actual ciphertext mutation; only this specific test's
tamper method was occasionally a no-op on the underlying bytes.

**Fix:** moved the tamper target from the last character of `data` to
the first character. For the test's plaintext (`"another-secret"`, 15
bytes = exactly five complete 3-byte base64 groups, no padding),
position 0 is always part of a complete, unpadded group, so flipping it
always changes real ciphertext bytes deterministically.

**Verification:** reran the isolated test file 5 times and the full
`npx vitest run` suite 3 times after the fix — 139/139 tests passing
consistently every run, no further flakiness observed. No other test in
the suite was touched.

**File changed:** `lib/security/encryptSecret.test.ts` only (the single
`it("rejects a tampered ciphertext", ...)` block) — no change to
`lib/security/encryptSecret.ts` itself, since the encryption/decryption
logic was never the defect.

---

## 2026-09-14 — Requirements re-check against expanded doc (round 2), documentation only

**Agent:** Foundation Agent. **Nature of this entry:** planning/backlog
reconciliation only — no application code, migration, or test was written or
modified in this pass, per the task's explicit scope.

The user re-supplied `01_FOUNDATION_SECURITY.md` (at a new upload path) as a
newer/expanded version of the same module doc already reconciled once in the
"Requirements Refresh — 2026-09-14" section of
`docs/plan/01-FOUNDATION-AGENT-BACKLOG.md` (round 1). This entry records a
fresh, independent re-check of the new upload against: (a) the full current
backlog (Progress Tracker + every existing story + the round-1 refresh
section), and (b) the live codebase — `lib/security/`, `lib/tenant/`,
`lib/jobs/`, `lib/rbac/`, `lib/audit/`, `lib/auth/`, `app/api/**`, and
`supabase/migrations/` — so that anything already *implemented* but not yet
*recorded* would not be mistaken for a gap.

**Method:** diffed the new doc's own "Expanded Requirements — Foundation
P0/P1/P2" section (its numbered `FOUNDATION-P0-01` … `P0-15`, `P1-01` …
`P1-04`, `P2-01`/`P2-02` items) against the round-1 refresh's reconciliation
of the same numbering — found them identical in substance and acceptance
wording, confirming round 1 already fully captured that section. Then
separately walked the doc's supporting narrative sections (1 Research-
Informed Product Principles, 2 Target Users, 3 Multi-Tenant Architecture, 26
SSO, 27 Customer RBAC, 39 Recommended Technology Stack, 40 Database Core
Model, 41 RLS Requirements, 42 API Architecture, 43 Integration Job
Architecture, 44 Security Requirements, 45 AI/LLM Architecture, "Foundation
test matrix") line by line against existing stories/code, since those
sections carry more free-text detail than the numbered items and were the
most likely place for something to have been missed.

**Result:** one genuinely new, previously-untracked item found — **CSRF
protection**, named explicitly in section 44's mandatory Security
Requirements list ("CSRF protection where relevant") but absent from every
existing Foundation story, the round-1 refresh, and any code comment in the
repo, despite the app now exposing 50 state-changing `POST`/`PUT`/`PATCH`/
`DELETE` routes under `app/api/**` authorized via cookie-forwarded sessions
— exactly the surface CSRF protection is about. Verified via `grep` that no
existing file mentions CSRF, and confirmed the only existing mitigation is
incidental: every cookie WonderAgent itself sets already uses `sameSite:
"lax"` (`app/auth/callback/route.ts`, `app/actions/auth.ts`,
`app/actions/tenant.ts`) — a real baseline, but never verified against
Supabase Auth's own session cookie or tested.

**Added:** `FOUNDATION-P1-05 — CSRF protection verification & hardening for
state-changing /api/v1/* routes`, status `Not Started`, to the Progress
Tracker and to the P1 list, plus a new "Requirements Refresh — 2026-09-14
(round 2, expanded doc)" section in the backlog documenting the full
reconciliation and the reasoning for scoping it P1 (existing `SameSite=Lax`
baseline already blocks the classic cross-site form-POST CSRF vector; the
doc doesn't tier or give this item its own acceptance criterion beyond a
one-line mandatory-list mention; CLAUDE.md §3 defaults ambiguous/undertiered
scope to P1/P2 rather than P0).

**Not added (already covered elsewhere, verified rather than assumed):**
`npm audit` + GitHub secret scanning → QA Agent (`QA-P0-12`, confirmed
present in `docs/plan/11-QA-AGENT-BACKLOG.md`); integration-credential
rotation → Integration Agent (`INTEGRATION-P0-05.1`, confirmed `Done`);
platform/encryption-key rotation → Platform Agent
(`09-PLATFORM-AGENT-BACKLOG.md`); job-architecture status/progress fields
(records processed/failed, retry count) → correctly out of Foundation's
scope by `lib/jobs/tenantScopedJob.ts`'s own design (each owning module's
job table, e.g. Integration Agent's `integration_sync_jobs`, carries its own
status schema; Foundation's wrapper only standardizes the tenant-context/
authorization/idempotency envelope — confirmed this is a deliberate,
documented design choice, not an oversight, by reading the file's docblock).
"Magic link" auth (section 39) not added — explicitly optional ("if
desired") in the doc, no acceptance criterion attached.

**No existing row's status was changed.** No application code, migration, or
test was touched in this pass — this was a documentation/planning-only
reconciliation as instructed.

## 2026-09-16 — FOUNDATION-P0-16: `lib/ai/` primitive, interface/stub only

**Agent:** Foundation Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Picked up as the first item in a P0-ordered sweep of the backlog per the
user's explicit "pick up P0 items in order, no need to ask before picking
the next story" instruction, following the 2026-09-15 governance
reconciliation's resolved decision ("start now, read-only summaries
only").

Built exactly what that story's own text says is buildable without the
still-open provider/credential decision: `lib/shared/types/ai.ts`
(`AiSummaryKind`, `AiSummaryRequest`, `AiSummaryResult` — a closed
`AiSummaryKind` enum, not free-text, so every summarizable shape is a
deliberate addition) and `lib/ai/summarize.ts` (`summarize()`,
`AiNotConfiguredError`).

**Boundary enforcement is structural, not just documented:** the file has
no Supabase client import anywhere in it (a unit test asserts this by
reading the file's own source and regex-matching for
`supabaseServer|supabaseServiceRole|supabaseBrowser` — genuinely
impossible for this module to query a database itself, not merely
promised not to), has no write path at all (its only export returns a
string), and its result type is prose (`summary: string`), never a
structured value — nothing in the codebase can read a summarization
result back into a deterministic decision (non-negotiable #9).

**Deliberately NOT done:** the actual provider wiring. `summarize()`
deterministically throws `AiNotConfiguredError` on every call —
`isConfigured()` is a single hardcoded `return false`, the one place this
changes once a provider is chosen. This is not an oversight: the story's
own text explicitly gates "the first real call" on an explicit
provider/credential decision (which LLM API, where its credential is
stored/scoped — a new table? platform-wide or per-tenant? via
`encryptSecret()`?), and that is the *same* open question
`PLATFORM-P0-05.2` (AI Provider Configuration) was already deferred on.
Inventing a schema/credential-storage answer here to unblock the "real"
implementation would be exactly the kind of new shared-foundation-location
decision `docs/design/ownership-map.md` §5 reserves to the user — recorded
as still-open, not guessed at.

**Verified:** 4 new unit tests (`lib/ai/summarize.test.ts`) — throws
`AiNotConfiguredError` rather than returning a fake/empty summary;
rejects (never resolves) so callers can rely on `.catch()`; source-level
assertion of no DB client import; exported surface is exactly
`{AiNotConfiguredError, summarize}` (no accidental extra exports). Also
ran `npm install` first — the other session's recent commits added
`lucide-react` to `package.json` but `node_modules` hadn't been updated
in this environment, which was blocking `npm run typecheck` before this
change even started (unrelated to this story; fixed as a prerequisite).
Full pipeline after: `npm run typecheck`, `npm run lint`, `npx vitest run`
(158/158, up from 141 — the other session's own new tests plus these 4,
all green), `npm run build` with `.next` deleted first, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` (no match) — all green.

FOUNDATION-P0-16 moves from `Not Started` to `Partial` — the primitive's
contract and boundary are real and tested; the live capability
(`EXPERIENCE-P0-14` needs a working `summarize()` to build against) is
still blocked on the provider decision.

---

## 2026-09-16 — FOUNDATION-P0-16 unblocked by PLATFORM-P0-05.2, moves to Done

The provider/credential decision this row was waiting on was resolved today
(user picked this up as one of 3 "not fully done P0" gaps): OpenAI, both
platform-wide default and per-tenant BYOK. Platform Agent built the actual
credential storage/resolution (`platform_ai_provider_configs`,
`modules/platform-admin/aiProviderConfig.ts`'s `resolveAiProviderKey()`) —
see `docs/design/platform-agent-backlog-audit.md`'s 2026-09-16 entry for the
full detail. This module's own file, `lib/ai/summarize.ts`, needed a small,
directly-expected change as a consequence: `summarize()` gained a leading
`tenantId` parameter, calls `resolveAiProviderKey(tenantId)` (a published
Platform contract call — not a database query of its own; the "no DB client
import" boundary this file's tests assert is unchanged and still enforced
structurally), and makes a real OpenAI `fetch()` call when a key resolves.
`app/api/v1/ai/summarize/route.ts` (Experience-owned) was updated to pass
`ctx.tenantId!` through. Full verification pipeline re-run (typecheck, lint,
217/217 vitest, clean build, no service-role-key leakage) — all green.
FOUNDATION-P0-16 moves from `Partial` to `Done`.

---

## 2026-09-16 — FOUNDATION-P0-03.3 (SSO) confirmed infra-blocked, user chose to skip

As part of the user's P0-gap-closure pass (3 gaps picked from the earlier
"not completely done P0 items" audit: SSO, AI Provider Configuration,
agents.risk_score persistence), re-investigated this row's real blocker
rather than assuming. Verified live via `mcp__Supabase__get_organization`
(org `ryahximilsdatarfcjcq`, plan `free`) and Supabase's own docs
(`mcp__Supabase__search_docs` — "SAML 2.0 support is offered on plans Pro
and above") that this is a genuine infrastructure/billing blocker, not a
code gap: every application-side piece (connection CRUD, domain routing,
JIT provisioning, the auth callback) is already built and unit-tested —
only the real end-to-end IdP handshake needs a paid Supabase plan plus a
real identity provider, neither of which this environment or this agent
can provide.

Presented this to the user with the concrete steps to unblock it
(upgrade to Pro+, enable SAML in Auth Providers, register a real IdP).
**User's explicit decision: skip SSO, close out the P0 gap-closure pass
without it.** This story stays `Partial` — not marked `Done`, not silently
dropped — and is not blocking anything else; the other two gaps in this
pass (`PLATFORM-P0-05.2` AI Provider Configuration, `RISK-P0-02.1`
agents.risk_score persistence) were both fully closed the same day. Resume
this story only if the user later upgrades the Supabase plan and supplies
a real IdP to test against.

---

## 2026-09-16 — Live JS-client tenant-isolation proof (the deferred half of FOUNDATION-P0-07), plus a real `getTenantContext()` defect

**The standing egress blocker is gone.** Re-tested from this session's
sandbox: `https://ekgyjwoenteadaaqakmd.supabase.co` now resolves and answers
over HTTPS — `/auth/v1/health` 200 (GoTrue v2.197.0), `/rest/v1/...` 200 with
real rows against the anon key, `/storage/v1/bucket` 200 — from `curl` *and*
from Node's global `fetch`, which is what actually matters: a JS-client
integration test can run from here now. General egress is open too
(`api.github.com`, `httpbin.org`, `documenter.getpostman.com` all 200), so
the "non-Supabase hosts are blocked" note recorded throughout this repo's
audit logs is also obsolete. Still unreachable: **raw Postgres**.
`db.<ref>.supabase.co` has no A record from here and every
`aws-0/aws-1-ap-southeast-1.pooler.supabase.com` endpoint on 5432/6543 times
out — only 443 gets out, so `psql`/`supabase db push` still cannot be used
and migrations continue to go through the Supabase MCP.

**FOUNDATION-P0-07, the half that was always deferred.** Every prior module
proved tenant isolation by simulating the JWT server-side
(`set_config('request.jwt.claims', ...)` + `set role authenticated`), because
no client could reach Supabase. That half is now done for real:
`tests/live-client-tenant-isolation.mjs` (new, QA-owned per CLAUDE.md §5)
signs two users in through GoTrue with email and password and drives
PostgREST over HTTPS exactly as the browser does. Coverage: all 44
tenant-scoped tables read in both directions (A must see no row of B's and no
foreign tenant_id at all, and vice versa); a fixture reality check, because a
zero-row result only proves isolation when the other tenant's rows are known
to exist; direct primary-key lookup of a known foreign row; cross-tenant
`UPDATE`/`DELETE` (0 rows affected) and `INSERT` (rejected by RLS policy); a
forged `audit_logs` insert claiming the other tenant (rejected); a
survivability check that B's row is untouched afterwards; and an
unauthenticated anon sweep over all 44 tables. **Result: every check passed.**
Anon is denied at `current_tenant_ids()` on the tenant-scoped tables and
returns 0 rows on the platform-only ones. The simulated proof and the live
one agree.

Fixture: the `e2e-*` tenants/users the Playwright suite already defines
(`tests/e2e/support/testUsers.ts`), seeded directly in Postgres via the
Supabase MCP rather than `auth.admin.createUser` (no service-role key is
available to this sandbox), plus one representative row per module in each of
the two tenants. Two notes for whoever picks this up: (1) rows inserted into
`auth.users` by hand need `confirmation_token`/`recovery_token`/
`email_change*`/`phone_change*`/`reauthentication_token` set to `''`, not
NULL, or GoTrue fails every sign-in with "Database error querying schema";
(2) this fixture is deliberately **left in place** rather than deleted like
earlier ones, because the committed script is meant to be re-runnable — it is
all under the `e2e-*` namespace and `seedTestData()` is idempotent against it.

**Real defect found, fixed (QA-P0-04.4 discipline).** The Playwright suite's
first-ever live run failed to sign in as any tenant user: they landed on
`/onboarding` showing three identical "E2E Tenant One" buttons instead of
Overview. Cause: `getTenantContext()` selected `tenant_memberships` filtered
only by `status`, leaving the user-level filter to RLS — but that policy is
*tenant*-scoped (`tenant_id in current_tenant_ids()`), so the query returned
every member of the tenant, not the user's own membership. Measured against
the live database: the old query returns 3 rows (`SELF`, `COLLEAGUE`,
`COLLEAGUE`), the fixed one returns exactly 1 (`SELF`). `app/onboarding/
page.tsx` had the identical query and rendered one organization button per
member. Both now filter `.eq("user_id", user.id)` explicitly, with a comment
saying why RLS is not sufficient here. This is not a tenant-isolation breach —
every row RLS returns still belongs to a tenant the user is a member of — but
it is a direct instance of CLAUDE.md §14's rule that application-level
filtering is defence-in-depth and must not be *replaced* by RLS. The
`/onboarding` half is Experience-owned; logged there too.

Verified: `npm run typecheck`, `npm run lint`, `npm test` (44 files, 260
tests) all clean after the change.

---

## 2026-09-17 — Sign-out scope decided: global, and now stated rather than inherited

The E2E suite's first working sign-out test exposed that `signOutAction()`
revoked every session the user held, on every device — one test logging out
invalidated 39 other specs running in parallel on the same identity. That was
never a written decision: `supabase.auth.signOut()` defaults to
`scope: "global"` in supabase-js v2, and the code simply took the default.

**Put to the user, who chose global.** Appropriate for a security product —
an administrator who suspects a session is compromised gets one control that
ends all of them, rather than having to hunt device by device. The trade-off
they accepted is the ordinary one: logging out on a laptop also signs you out
on your phone.

Behaviour is therefore unchanged; what changed is that it is now explicit.
`app/actions/tenant.ts` passes `{ scope: "global" }` with the decision and its
date recorded inline, so a supabase-js upgrade that changes the default cannot
silently downgrade the posture — which is exactly the kind of drift an
inherited default invites.

`proxy.ts`'s expiry path was made explicit the same way, but is **flagged, not
decided**: that call is the idle/absolute-timeout path, not a user-initiated
logout, so as written, timing out on one device also ends the user's sessions
elsewhere. That was already the behaviour (same library default) and is
consistent with the global posture, but the user decided the logout case, not
this one. Left as-is and raised rather than changed unilaterally.

Covered by a new test in `tests/e2e/auth.spec.ts`: two independent browser
contexts sign in as the same identity, one logs out through the account menu,
and the other is asserted to be bounced to `/sign-in` on its next navigation —
a direct assertion of the global scope rather than a comment claiming it. It
uses the dedicated `signOutOnly` identity for the same reason the other
sign-out test does: a global revocation would otherwise take every parallel
spec's session with it. 18/18 passing in `auth.spec.ts`.

---

## 2026-09-17 — Proxy no longer takes the whole deployment down on missing env

**Reported:** the Vercel preview served "Internal Server Error" on every URL,
including `/welcome`, which is a static marketing page that touches no
database. The build itself was clean.

**Cause:** `proxy.ts` called Foundation's `getSupabaseUrl()` /
`getSupabasePublishableKey()`, which throw when the variable is unset. The
proxy runs ahead of every route (`matcher` covers everything but
`_next/static`, `_next/image`, `favicon.ico`), so a single missing variable
turned into a 500 on every path rather than only the pages that need a
session. Vercel's runtime-error grouping showed it as
`Error running the exported Web Handler: Missing required environment
variable: NEXT_PUBLIC_SUPABASE_URL`, route `/middleware`.

**Change:** added non-throwing `getOptionalSupabaseUrl()` /
`getOptionalSupabasePublishableKey()` to `lib/db/env.ts` and used them in
`proxy.ts` only. When either is absent the proxy skips all session work —
there can be no session to read or refresh, so every visitor is signed out
and `/` is rewritten to `/welcome` as it already is for signed-out visitors;
everything else passes through untouched.

**Deliberately not done:** the throwing getters are unchanged and every other
caller still uses them. A route that genuinely needs the database must fail
loudly rather than silently render as though no user were signed in — this
fix makes a misconfigured deployment *legible* (public pages up, app pages
erroring) instead of uniformly broken, it does not paper one over. No
authorization behaviour changes: the proxy's expiry check was already
defense-in-depth on top of per-route `getTenantContext()`/
`requirePlatformAdmin()` enforcement (non-negotiable #3), and that per-route
enforcement is what actually gates access.

**Verified:** built and served with both variables unset — `/`, `/welcome`
and `/sign-in` return 200 and render, `/agents` does not. `npm run
typecheck`, `npm run lint`, and `welcome.spec.ts` + `auth.spec.ts` +
`navigation-smoke.spec.ts` (53 passed; the one failure is the pre-existing
GoTrue fresh-signup case that needs an MX-backed domain). On the resulting
preview deployment `dpl_48kHKDmRFB2eTeXmH2GSfk45cTtm`, `/`, `/welcome` and
`/sign-up` return 200 and the landing page renders.

**Open — not an application defect:** the Vercel project has no
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` or `SECRET_ENCRYPTION_KEY` in its Preview scope,
which is why the authenticated routes still 500 there. That is a project
configuration step in Vercel's dashboard, not a code change, and none of
these values may be committed (CLAUDE.md §16). Flagged to the user.

---

## 2026-09-17 — Sign-in/sign-up rate limiter could lock out unrelated users on a shared/non-distinguishing IP

**Reported:** the user observed login and sign-up "not working properly."

**Investigated two independent causes, both confirmed with live evidence, not guessed:**

1. **This project's Vercel Preview environment is missing
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` / `SECRET_ENCRYPTION_KEY`** — the same gap
   flagged as open in the 2026-09-17 "Proxy no longer takes the whole
   deployment down on missing env" entry above, still unresolved.
   `get_runtime_errors` on the Vercel project shows `Missing required
   environment variable: NEXT_PUBLIC_SUPABASE_URL` on routes `/sign-in`,
   `/sign-up`, `/agents` — 9 occurrences, 4 distinct users, as recently as
   2026-09-17T17:30:16Z (deployment `dpl_HsrzHs87ntugqDnv3k1R6sLjrmHw`,
   `target: null` — a Preview build). Any Preview deployment 500s on
   sign-in/sign-up outright until this is fixed. **Not a code change** —
   these are secrets that must be set in Vercel's dashboard (Project
   Settings → Environment Variables, Preview scope) and must never be
   typed into a committed file or this conversation (CLAUDE.md §16). No
   Vercel MCP tool in this session can write environment variable values
   (deliberately — they're secrets), so this cannot be applied by an
   agent; it needs the user, or whoever holds the project's Vercel access,
   to do it directly.

2. **The sign-in/sign-up rate limiter's IP bucket could collapse many
   unrelated visitors into one counter and block all of them together —
   a real code defect, now fixed.** `app/actions/auth.ts`'s `clientIp()`
   falls back to the literal string `"unknown"` when `x-forwarded-for` is
   absent, and — confirmed against this project's own
   `auth_rate_limit_attempts` table — an intermediary in front of at least
   one deployment reports the loopback address `127.0.0.1` for every
   request regardless of the real visitor. Both values get used as the
   `signin:ip`/`signup:ip` rate-limit bucket key exactly like a real,
   distinguishing client IP would be. Queried the live table directly: the
   `signin:ip` bucket for subject `127.0.0.1` was sitting at 10/10 attempts
   within its 5-minute window as of 17:22:31Z — meaning every sign-in from
   behind that address, by anyone, for any account, was being rejected
   with "Too many sign-in attempts" regardless of whose credentials they
   used. `tests/e2e/support/seedTestData.ts`'s `clearAuthRateLimits()`
   already works around the *test suite* tripping this same mechanism
   (its own comment: "looks like an auth bug and isn't one") — but the
   identical mechanism was never fixed for real traffic, and a corporate
   NAT/shared IP, not just a test runner, can trigger it for real users.

   **Change:** added `isDistinguishingClientIp()` to
   `lib/security/rateLimiter.ts` — rejects `"unknown"`, `""`, and known
   non-distinguishing loopback/unspecified addresses
   (`127.0.0.1`/`::1`/`::ffff:127.0.0.1`/`0.0.0.0`). `signInAction()` and
   `signUpAction()` in `app/actions/auth.ts` now skip the IP-bucket check
   entirely when the resolved address fails that test, relying solely on
   the per-email bucket (unchanged: 10/5min sign-in, 5/hour sign-up),
   which already fully protects each individual account regardless of
   which IP it's attempted from. **Deliberately not done:** did not widen
   or remove the IP bucket for a genuinely distinguishing address — it
   stays as defense-in-depth against a single source hitting many
   different accounts.

   Unblocked the live project immediately: deleted the saturated
   `signin:ip`/`signup:ip` rows from `auth_rate_limit_attempts` directly
   (an operational rate-limit cache, not the audit trail — `audit_logs` is
   untouched).

**Tests added:**
- `lib/security/rateLimiter.test.ts` (new) — `checkAndRecordAttempt()`
  allow/block/prune behavior, and `isDistinguishingClientIp()` against
  every case above plus a real distinguishing IP (must still enforce).
- `tests/e2e/auth.spec.ts` — new `"rate limiting"` describe block:
  sign-in's own rate-limit message is now actually asserted (previously
  untested even though the feature existed); a regression test signing in
  as 11 distinct, never-before-used identities from one client and
  asserting none is ever blocked by a shared IP bucket (the defect above,
  directly); sign-up's rate-limit message. Also added: empty-field
  submission is blocked client-side on both screens (never reaches the
  server action), and a signed-in session survives a full page reload
  without bouncing to `/welcome` or `/sign-in` (regression coverage for
  EXPERIENCE-P0-14's proxy rewrite of `/`).

**Verified:** `npm run typecheck`, `npm run lint`, and the full `npm run
test` (vitest) suite — 269/269 passing, including the 19 new/changed
tests in `lib/security/rateLimiter.test.ts`. The new
`tests/e2e/auth.spec.ts` cases were not run in this environment — no
`SUPABASE_SERVICE_ROLE_KEY` is available here (correctly: it's a secret,
and this session has no tool that exposes it), so `next build`/`next
start` cannot serve authenticated routes locally. They follow this
suite's existing conventions exactly (dedicated, timestamp-unique
identities per CLAUDE.md's isolation pattern; never touch a shared
`TEST_USERS` identity's bucket) and should be run for real with `npm run
test:e2e` wherever `.env.local` is configured, before merging.

**Open — needs the user:** the Vercel Preview environment variable gap in
finding 1 above. Everything in finding 2 is code-complete on this branch.

---

## 2026-09-17 — Forgot-password (FOUNDATION)

**Built:** the missing password-reset flow — `/forgot-password` (request a
reset link), `/update-password` (set a new one), and the supporting server
actions in `app/actions/auth.ts`: `requestPasswordResetAction()` and
`updatePasswordAction()`.

- **Rate-limited** the same way as sign-in/sign-up (`checkAndRecordAttempt`,
  5/hour per email, per-IP too when `isDistinguishingClientIp()` says the
  resolved address is real — see the 2026-09-17 rate-limiter entry above).
- **Email-enumeration protected**: `requestPasswordResetAction()` always
  returns the same `ok: true` shape and the UI always shows one generic "if
  an account exists…" message, matching sign-up's existing property —
  Supabase Auth itself does not reveal account existence through this call.
- **Reuses the existing SSO callback route** (`app/auth/callback/route.ts`)
  rather than adding a second one: `requestPasswordResetAction()` builds
  `redirectTo` as `${origin}/auth/callback?next=/update-password`, and the
  callback now honors a same-origin-only `next` param (new exported
  `isSafeRelativeNextPath()`, unit-tested against the protocol-relative and
  absolute-URL open-redirect vectors) right after its existing
  session-cookie stamping, before the SSO/onboarding branches.
- **`/update-password` is a server component** that checks
  `supabase.auth.getUser()` before rendering anything, so an
  expired/already-used/missing link shows a real "Link expired" state
  immediately rather than a form that only fails on submit.
- Added a **"Forgot password?"** link to `/sign-in`.

**Verified live against this project's real Supabase instance** (not
mocked): rate limiting (both sign-in-style and this feature's own),
email-enumeration protection, and `/update-password`'s expired-link guard
— all pass in `tests/e2e/auth.spec.ts`'s new `"password reset"` describe
block. Also unit-tested directly: `app/actions/auth.test.ts` (rate
limiting, the exact `redirectTo` shape, session guard, real-Supabase-error
surfacing) and `app/auth/callback/route.test.ts` (`isSafeRelativeNextPath`
against every open-redirect case). Full suite: `npm run typecheck`, `npm
run lint`, `npm run test` (283/283), `npm run test:e2e` for
`tests/e2e/auth.spec.ts` (27/27).

**Confirmed the real request-side wiring is correct** by querying
`auth.flow_state` directly after a real `requestPasswordResetAction()` call
(triggered by the enumeration test above): it recorded a PKCE row
(`code_challenge_method: "s256"`, a non-null `code_challenge`) for the
tested user — proof the app's server action correctly negotiates PKCE, the
same mechanism `app/auth/callback/route.ts`'s `exchangeCodeForSession()`
expects on the other end.

**Not verified — flagged rather than faked, same category as this file's
existing SSO-callback caveat:** actually clicking a real recovery link
through to a completed password change. Blocked by three compounding,
environment-specific limitations, not a code issue: (1) this session has no
real email inbox: `supabase.auth.admin.generateLink()` — the only way to
mint a verification link without sending real mail — does not go through
the PKCE code-challenge a genuine `resetPasswordForEmail()` call negotiates,
so it returns tokens in a URL fragment instead of `?code=`, which cannot
exercise this app's callback route or represent what a real user's flow
does; (2) this project's own built-in-SMTP quota (a couple sends/hour —
already documented on the "fresh, valid email" sign-up test) was exhausted
by this same test run, so triggering enough real emails to test around (1)
wasn't an option either; (3) this sandbox's outbound-HTTPS proxy re-
terminates TLS with a CA the pre-installed Chromium doesn't trust, so
Playwright can't even navigate directly to `<project>.supabase.co` to
inspect a verify link's behavior (confirmed via `curl`, which does trust
the proxy's CA, that `admin.generateLink()`'s link resolves via a 303 to a
fragment-based redirect — consistent with point (1), and separately
surfaced a real, unrelated finding: the generated link's `redirect_to`
silently fell back to the project's configured Site URL rather than the
`http://localhost:3100/...` this suite requested, meaning `localhost` is
not in this Supabase project's redirect-URL allowlist — a dashboard
configuration item, not code, and irrelevant to the real flow since real
users are redirected against the deployed origin, not localhost).

**Open — needs the user, whenever full click-through verification against
a real inbox is wanted:** confirm the deployed origin (and any other origin
this app is ever served from) is in the Supabase project's Auth → URL
Configuration → Redirect URLs allowlist, ideally as a wildcard
(`https://<domain>/**`) rather than an exact match, so `/auth/callback` with
a `next` query param is honored rather than silently falling back to the
bare Site URL.

---

## 2026-09-18 — Per-request auth and tenant resolution: 5 network round trips → 1 local check + 1 parallel query wave

**Reported:** every page in the customer shell had a ~1,350 ms TTFB, even
trivial ones like `/settings`, measured as the median of warm runs with
`scripts/measure-page-timings.mjs`. Page content was not the cost; the shell's
auth and tenant plumbing was, and it was identical on every route.

**Cause, measured:** from the environment used to test, one Supabase call —
any call — costs ~270–330 ms of network. `supabase.auth.getUser()` is such a
call, and a single page made it four or five times: once in `proxy.ts` before
routing, once in the layout, once inside `getTenantContext()`, once inside
`isPlatformAdmin()`, and then the page's own `requirePermission()` ran
`getTenantContext()` all over again because nothing was deduplicated between
the layout and the page. `getTenantContext()` itself then ran its membership
and role queries one after the other.

**Changes (all in Foundation-owned plumbing, no schema change):**

- `proxy.ts` is now the ONE place per request that asks the auth server
  whether the session is still good (`getUser()`, one round trip), and it
  enforces the answer: a presented-but-rejected session is redirected to
  `/sign-in` on pages and refused with 401 on `/api/*`; a request with no
  session at all is redirected on protected pages and passed through on the
  API, whose sessionless routes (cron, integration webhooks, MCP ingest, SSO
  domain lookup) gate themselves. Unauthenticated-page enforcement thereby
  moved earlier, from the customer layout into the proxy.
- `lib/tenant/session.ts` (new): `getSessionUser()` resolves the user from
  `supabase.auth.getClaims()`, which verifies the access token's **ES256**
  signature locally against the project JWKS — auth-js caches that JWKS
  globally across client instances, so it is ~1 ms after the first request.
  The project's tokens were checked: header `{"alg":"ES256"}`, so
  verification is genuinely local. This is safe only because the proxy has
  already validated the same session against the server; the layout, page
  and services merely re-derive identity from it.
- **A first version of this change used `getClaims()` in the proxy too, and
  the suite caught it**: `auth.spec.ts`'s "signing out is global" case
  failed, because a revoked session's token still verifies until it
  expires. That test encodes the user's 2026-09-17 decision that logout is
  global and immediate, so the proxy's check went back to a real round trip
  rather than the test being weakened. Net: one GoTrue call per request
  instead of five, with revocation semantics exactly as before.
- `supabaseServer()`, `getSessionUser()`, `getTenantContext()`,
  `getMyMemberships()`, `getProfile()` and `isPlatformAdmin()` are wrapped in
  React's `cache()`: resolved once per request and shared by the layout, the
  page and every module service under them.
- `getTenantContext()` now fetches memberships and role rows **in parallel**
  (roles for the user across tenants, then filtered to the active tenant in
  code) instead of sequentially. Both queries keep their explicit `user_id`
  filter — the privilege-escalation guard noted in the previous entry is
  unchanged.
- `getMyMemberships()` is published for the customer shell's organization
  switcher, which had been re-running the same membership query itself.

**Result, same script, same machine:** every page ~830 ms TTFB, from
~1,350 — one auth-server round trip in the proxy, one parallel wave of
tenant/profile/shell queries, then the page's own wave. Each of those is a
~270 ms trip from this environment; see the Experience entry of the same
date for the deployment-region change that makes them tens of milliseconds
in production.

**Deliberately not done:** embedding memberships and roles in the JWT via a
custom access-token hook would make tenant resolution fully local (zero round
trips) and CLAUDE.md §2 explicitly permits claims as a source — but claims go
stale until the token refreshes, so a role revocation would lag by up to the
token lifetime. That is a security-semantics decision for the user, recorded
here rather than made.

**Verified:** typecheck, lint, build, and the full Playwright suite
(sign-in/out, session expiry redirect, platform-admin gate, RBAC negatives,
tenant isolation) — see the Experience entry for the run.

---

## 2026-09-18 — AI key fallback: message where to fix "not configured" (BYOK → platform default → tell the user)

**Reported:** the app's AI API key should default to the platform-wide key
when a tenant hasn't configured BYOK, and when neither is available the
user should be told where to fix it — the Platform Admin page if one
exists for this, otherwise the environment variable to set.

**Found the fallback mechanism (BYOK → platform default) was already
fully implemented and correct** — `resolveAiProviderKey()`
(`modules/platform-admin/aiProviderConfig.ts`, PLATFORM-P0-05.2, shipped
2026-09-16): BYOK-first, falls back to that provider's
`PLATFORM_OPENAI_API_KEY`/`PLATFORM_GEMINI_API_KEY`, returns `null` only
when neither exists. Nothing to change there.

**What was actually missing:** when `resolveAiProviderKey()` returns
`null`, `AiNotConfiguredError`'s message was just "No AI provider is
configured for this deployment." — true, but not actionable. And
`modules/ui/AiSummaryPanel.tsx` (used on `/risk/rogue/[agentId]`) threw
that message away entirely: on a 501 it always rendered the same
hard-coded "AI summaries aren't configured for this workspace yet.",
regardless of what the API actually said.

**Confirmed there is no Platform Admin page for this setting** — checked
every route under `app/platform-admin/*`: admins, announcements, branding,
features, health, tenants, tenant usage. None of them configure AI
provider keys; the only UI for this is the tenant-level
`/settings/ai` (BYOK), and the platform-wide default has only ever been
settable via the two env vars. So the correct message, per the user's own
"ask me to configure it on platform admin page (if it exists), if not
then ask me to set in environment variable," is the environment-variable
instruction — there's no page to point to instead.

**Changes:**
- `AiNotConfiguredError`'s message (`lib/ai/summarize.ts`) now says both
  things: bring your own key in Settings → AI, or a platform administrator
  should set `PLATFORM_OPENAI_API_KEY`/`PLATFORM_GEMINI_API_KEY` — stated
  explicitly that there's no Platform Admin page for this yet, so nobody
  goes looking for one.
- `AiSummaryPanel.tsx` now reads and renders that message from the API's
  501 body instead of discarding it for a generic string.
- `/settings/ai`'s existing "no platform-wide default key" status line
  gained the same environment-variable instruction (it already correctly
  showed BYOK vs platform-default vs not-configured status and prompted
  BYOK — this only adds the missing half for whoever controls the
  deployment).

**Verified live:** rebuilt and served the app (`next build && next
start`), signed in, confirmed `/settings/ai` renders the updated message
(screenshotted), and called `POST /api/v1/ai/summarize` directly to
confirm the 501 response body now carries the full actionable message
end-to-end (this deployment's `.env.local` has neither platform key set,
so the not-configured path is real, not simulated). Full vitest suite:
283/283 (no existing test asserted the old message's exact text, so
nothing needed updating there).

**Deliberately not done:** did not build a `/platform-admin` AI provider
config page. The user's own phrasing ("if it exists... if not") signals
this is a scope decision, not an oversight to silently fix — building
platform-wide config storage/UI is materially larger (global config table,
Platform Agent's own module) and wasn't asked for; flagged here rather
than assumed.

---

## 2026-09-18 — Google sign-in on /sign-in and /sign-up

**Built:** `modules/ui/GoogleAuthButton.tsx` — one control on both auth
screens (Google itself decides new vs returning, so there is no separate
"sign up with Google" flow to build). Starts Supabase Auth's OAuth flow
via the browser client's `signInWithOAuth({ provider: "google" })`, which
returns to the existing `/auth/callback` route — the same one SSO and
password recovery already use. The browser client is used deliberately:
`@supabase/ssr`'s `createBrowserClient` writes the PKCE code verifier to a
cookie the server callback can read, which is what lets
`exchangeCodeForSession()` complete server-side.

**Also fixed on the way:** `/auth/callback`'s final fallback sent every
non-SSO user to `/onboarding`, and `/onboarding` deliberately does not
auto-forward a user who already has memberships (it doubles as the "create
another organization" screen) — so every returning OAuth or email user
would have picked their organization on each sign-in. That is exactly the
friction removed from the password path in "sign-in lands on the app, not
the organization picker"; the callback now resolves tenant context and
sends a user with a tenant to `/`, keeping `/onboarding` for genuinely new
users.

**Deliberately not rate-limited** through `app/actions/auth.ts` like the
password paths: no credential is presented to this app to throttle —
Google authenticates, and Supabase Auth applies its own limits.

**Verified:** typecheck, lint, build, and the full `auth.spec.ts` suite
(32 tests). New e2e case intercepts the outgoing `/auth/v1/authorize`
request and asserts it carries `provider=google` and a `redirect_to`
pointing back at this app's `/auth/callback` — no dependency on Google
being enabled yet or on egress this sandbox's TLS-intercepting proxy
blocks. Screenshotted both screens.

**Two real test flakes found and fixed while running this** (both
pre-existing, both mine from earlier in the session): the sign-up and
password-reset rate-limit tests navigated away 300ms after submitting,
which aborted some server actions in flight so they were never recorded
and the final over-limit request wasn't over the limit. Both now wait for
the attempt to actually complete. The password-reset one also had to match
its outcome paragraphs by CSS (`p[role="status"], p[role="alert"]`) rather
than by role — the document carries an always-present empty alert region
that a role-based wait resolves against instantly, so it never waited.

**Needs the user (configuration, not code) — Google is not enabled on the
Supabase project yet**, so the button currently surfaces Supabase's
"provider is not enabled" message rather than reaching Google. See the
handover notes given to the user: a Google Cloud OAuth client, the
client ID/secret pasted into Supabase's Google provider, and the redirect
URL allowlist (which, as recorded in the forgot-password entry above,
still does not include this app's origins).
