# WonderID — End-to-End QA Report

**Date:** 2026-10-01 · **Commit tested:** `acbdc0f` (`main`, also live in production) · **Branch:** `ccr-65a6a8d6-heyo97`
Companion files: [`E2E_TEST_EXECUTION.md`](E2E_TEST_EXECUTION.md) (live log and coverage matrix) · [`E2E_DEFECTS.json`](E2E_DEFECTS.json)

## 1. Executive summary

**Overall QA status: NOT RELEASE-READY. One CRITICAL and three HIGH findings are open, and most browser journeys could not be executed in this run.**

- **Cross-tenant read isolation holds.** Two real GoTrue sessions exercised 44 tenant tables in both directions over PostgREST, plus an anonymous sweep: 150 checks passed. The single failure is a missing fixture row, not a leak. Every one of 236 API method/route pairs and 87 protected pages refuses an anonymous caller.
- **The database does not enforce RBAC on writes (E2E-001, CRITICAL).** 47 RLS write policies on 25 tables check only "is a member of this tenant". The app's permission checks run in server code, but every signed-in user holds a Supabase session that can call PostgREST directly with the public publishable key. A READ_ONLY user can therefore:
  - reactivate a suspended agent;
  - disable policies;
  - zero risk weights;
  - file access requests in someone else's name;
  - rewrite an integration's `baseUrl`, so the next sync sends the decrypted connector secret to an attacker host.

  None of this leaves an audit event.
- **Privilege escalation through delegation (E2E-003, HIGH).** Role assignment and group membership have no ceiling. A delegated admin with `roles.assign`, or a group manager with only `groups.manage_members`, can make someone a Tenant Super Admin. Only self-assignment is blocked.
- **Multi-org row move (E2E-002, HIGH).** `tenant_id` is client-updatable, so a member of two organizations can move rows from one to the other.
- **Environment risk (E2E-013, HIGH).** CI's E2E suite, the SQL fixtures and production share one Supabase project. That is also why exploit-style tests could not be run safely here.

**Major blockers in this run**

1. No server secrets at session start. Vercel stores them as write-only "sensitive" variables. The user supplied them mid-run.
2. The session's permission classifier refused two actions:
   - the live direct-write RBAC probe against the shared (production) database;
   - starting the app with `OUTBOUND_ALLOW_PRIVATE_NETWORKS=true`, which the existing Playwright config sets for its MCP stubs.

   The existing 340-test Playwright suite was therefore **not run**, and E2E-001/002 are proven by live catalog inspection rather than by a performed exploit.
3. There is no test IdP, email provider or AI key: SSO/MFA, email delivery and AI summaries are `BLOCKED_EXTERNAL_DEPENDENCY`.

**Environment:** Linux container, Node 22, Next 16.3.5 production build served by `next start` on :3100, Playwright 1.63 with Chromium 1194, Supabase project `ekgyjwoenteadaaqakmd` (ap-southeast-1).

## 2. Test statistics

Counted at the level of individual executed checks:

| Suite | Total | Passed | Failed | Blocked | Not implemented | Not testable |
|---|---|---|---|---|---|---|
| Unit (`npm test`, vitest) | 746 | 746 | 0 | 0 | 0 | 0 |
| Lint / build | 2 | 2 | 0 | 0 | 0 | 0 |
| Typecheck (fresh clone) | 1 | 0 | 1 (E2E-011; passes after `next typegen`) | 0 | 0 | 0 |
| Live PostgREST tenant isolation (`tests/live-client-tenant-isolation.mjs`) | 151 | 150 | 1 (E2E-012 fixture) | 0 | 0 | 0 |
| **New** anonymous API sweep (`tests/e2e/api-unauthenticated.spec.ts`) | 237 | 237 | 0 | 0 | 0 | 0 |
| Anonymous page sweep (curl, 96 routes) | 96 | 96 | 0 | 0 | 0 | 0 |
| DB security inspection (RLS on, policies, grants, SECURITY DEFINER exposure, triggers) | 6 | 3 | 3 (E2E-001, -002, -014) | 0 | 0 | 0 |
| Code-level authorization review (routes, actions, service-role writes) | 9 | 3 | 6 (E2E-003 ×2, -004, -005, -006, -008) | 0 | 0 | 0 |
| Existing Playwright suite (48 files) | 340 | — | — | 340 | 0 | 0 |
| SSO / MFA / email / AI | 4 | — | — | 4 (external) | 0 | 0 |
| Accessibility (axe) | 1 | — | — | 0 | 0 | 1 (no axe tooling; suite not run) |
| **Total** | **1593** | **1237** | **11** | **344** | **0** | **1** |

Defects: **14** (CRITICAL 1, HIGH 3, MEDIUM 5, LOW 5).

## 3. Coverage by area

| Area | What was actually exercised | Result |
|---|---|---|
| Authentication | Anonymous access to 87 protected pages and 236 API methods; proxy session handling; callback redirect; timeout design | PASS for anonymous refusal; FAIL E2E-004, E2E-005; sign-in/out/reset journeys BLOCKED |
| Tenancy | Live two-session PostgREST isolation (44 tables, both directions, PK lookup, cross-tenant writes rejected, anon sweep); RLS enabled on every table; tenant cookie selection | PASS; FAIL E2E-002 (inspection); E2E-012 fixture gap |
| RBAC | Policy and grant catalog; SECURITY DEFINER exposure; self-assignment paths; assignment/group ceilings | FAIL E2E-001 (CRITICAL), E2E-003; self-assignment and platform-admin self-insert correctly impossible |
| Discover | Not executed (existing specs BLOCKED) | BLOCKED |
| Understand | Not executed | BLOCKED |
| Govern | Code review of certification decisions | FAIL E2E-008; journeys BLOCKED |
| Protect | Gateway routes refuse anonymous callers; decision paths not executed. E2E-001 lets any member flip `agents.status`, which undermines suspension. | PARTIAL / BLOCKED |
| Assure | Not executed | BLOCKED |
| Agent 360 | Not executed | BLOCKED |
| Integrations | Webhook HMAC and MCP bearer verification reviewed; anonymous refusal executed | PASS; LOW E2E-009; E2E-001 integration-config exfiltration path |
| Administration | Users/groups/roles code paths reviewed | FAIL E2E-003, E2E-006 |
| API | 236 anonymous probes; 5 routes validate before auth | PASS; LOW E2E-010 |
| Security | Headers (CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy), secrets handling, service-role tenant re-checks (13 sites sampled, all verify tenant first) | PASS except findings above |
| Accessibility | Not executed | NOT_TESTABLE this run |

## 4. Defects

Full machine-readable detail is in `E2E_DEFECTS.json`. Reproduction steps for each defect:

### E2E-001 — CRITICAL — Any tenant member can write governance tables directly through PostgREST
- **Preconditions:** a signed-in member with any role (e.g. `e2e-readonly@e2e.wonderagent.test`, READ_ONLY in E2E Tenant One). Use a non-production copy of the database.
- **Steps:**
  1. `createClient(SUPABASE_URL, PUBLISHABLE_KEY).auth.signInWithPassword(...)`.
  2. `from('agents').update({ status: 'active' }).eq('id', <suspended agent>)`. Repeat for `policies.status`, `risk_severity_weights.weight` and `integrations.config`.
- **Expected:** 0 rows or a permission error; only `requirePermission()`-guarded server actions change these.
- **Actual (from the live catalog):** the policies admit the write. Each has `WITH CHECK tenant_id IN current_tenant_ids()`, INSERT/UPDATE/DELETE is granted to `authenticated`, and there are no guard triggers. The live probe was refused by the session's permission classifier, so it has not been run.
- **Root cause:** RLS write policies were written for tenant isolation only. RBAC lives in application code (`lib/rbac/requirePermission.ts`), which a direct PostgREST call never passes through.
- **Files:** RLS policies for the 25 tables listed in the JSON; `modules/integrations/integrations.ts:70` (the SSRF check that is bypassed); `modules/integrations/connectors/saviynt.ts:117`.
- **Fix:** remove client write policies (server services already write) or gate them with `has_tenant_permission()`; revoke `UPDATE(tenant_id)`.

### E2E-002 — HIGH — Multi-org member can move rows between their organizations
- **Steps:** as a user who belongs to Tenant One (READ_ONLY) and Tenant Two (admin), run `from('policies').update({ tenant_id: <Tenant Two> }).eq('id', <Tenant One policy>)`.
- **Expected:** rejected. **Actual (catalog):** `tenant_id` UPDATE is granted and the WITH CHECK accepts any of the caller's tenants. Composite foreign keys from migration 0076 protect only rows with cross-referenced children.
- **Fix:** revoke `UPDATE(tenant_id)` or add an immutability trigger. Confirm with a rolled-back SQL fixture.

### E2E-003 — HIGH — No privilege ceiling on role assignment or group membership
- **Steps:**
  1. As Tenant Super Admin, create custom role "Delegated Admin" with `users.invite` and `roles.assign`, and assign it to user D.
  2. As D, invite a second address and assign it `TENANT_SUPER_ADMIN` (`/settings/users/[id]`, or `POST /api/v1/users/[id]/roles`).
  3. Variant: a holder of only `groups.manage_members` adds user X to a group carrying `TENANT_SUPER_ADMIN`.
- **Expected:** refused, because the actor does not hold the role's permissions.
- **Actual:** `assignRole()` (`lib/rbac/roles.ts:118`) and `addGroupMember()` (`lib/users/groups.ts:318`) check only `actor !== target`.
- **Fix:** apply `escalationIn()` from `roleRules.ts` to assignment, invite-with-roles and group membership.

### E2E-004 — MEDIUM — Open redirect via `/auth/callback?next=/\evil.example`
- **Steps:** complete a sign-in or password-reset flow whose callback carries `next=/%5Cevil.example` (raw backslash).
- **Expected:** stay on origin. **Actual:** `isSafeRelativeNextPath` accepts it and `new URL()` resolves it to `https://evil.example/` (reproduced with Node's WHATWG URL).
- **Fix:** compare the resolved origin with the request origin.

### E2E-005 — MEDIUM — Session timeouts are driven by client cookies
- **Steps:** keep the Supabase auth cookie and delete `wa_session_started_at` and `wa_session_last_seen` before each request.
- **Expected:** absolute and idle expiry still enforced. **Actual:** `proxy.ts` treats missing cookies as a fresh session and backfills them.
- **Fix:** anchor the clocks to server-side session data.

### E2E-006 — MEDIUM — Self-edit of `public.users.email` / `display_name`
- **Steps:** `from('users').update({ display_name: '<another admin>' , email: '<their email>' }).eq('id', auth.uid())`.
- **Actual (policy):** allowed. These columns feed holder lists, approval UIs and email notifications.
- **Fix:** column-level grant for `display_name` only; sync `email` from `auth.users`.

### E2E-007 — MEDIUM — SSO JIT role claim can come from user-editable `user_metadata`
- **Steps:** needs a test IdP. Set `user_metadata.<roleClaim>` with `auth.updateUser`, then complete SSO for a domain with an active connection.
- **Actual (code):** claims merge as `{...identity_data, ...user_metadata}`, so the metadata wins. **Status:** BLOCKED_EXTERNAL_DEPENDENCY for live confirmation.

### E2E-008 — MEDIUM — Certification delegate target not validated
- **Steps:** as the assigned reviewer, delegate an item to a random UUID, or to the agent's owner.
- **Actual (code):** `decisions.ts:187` writes `reviewer_id` unchecked.

### E2E-009 — LOW — Webhook replay and error echo
`modules/integrations/webhooks.ts`: there is no timestamp in the HMAC, events without an id get random ids (so replays duplicate), and `insertError.message` is returned to the caller.

### E2E-010 — LOW — Validation before authentication on 5 routes
Anonymous POST with an empty body returns 400 with schema hints. List in JSON.

### E2E-011 — LOW — `npm run typecheck` fails on a fresh clone
Eight TS2307 errors until `next typegen` has run. Fix: `"typecheck": "next typegen && tsc --noEmit"`.

### E2E-012 — LOW — Fixture drift
Live isolation's `applications visible to B` fails because Tenant Two has no applications. Leftover `fixture-tenant-a5/b5-test` tenants remain in the shared database.

### E2E-013 — HIGH — Production and E2E share one database
Vercel production env, `.github/workflows/e2e.yml` and `playwright.config.ts` all target project `ekgyjwoenteadaaqakmd`, which holds real tenants.

### E2E-014 — LOW — Anonymous tenant enumeration
`resolve_tenant_host` (anon-executable, SECURITY DEFINER) returns id, name and status for any slug.

## 5. Security findings summary

| Topic | Finding |
|---|---|
| Tenant isolation (reads) | **Holds.** Live two-session proof across 44 tables; anon denied everywhere. |
| Tenant isolation (writes) | Cross-tenant writes rejected for single-tenant users. **E2E-002** for multi-org users. |
| Authorization / RLS | **E2E-001**: the database is the tenant boundary but not the permission boundary; every write policy is membership-only. |
| Privilege escalation | Self-assignment, self-group-add, self-platform-admin and last-admin removal are all blocked. Delegated escalation is **open (E2E-003)**. |
| API protection | All 236 anonymous probes refused; no 5xx, no stack traces. Gateway routes require agent keys. |
| Runtime security | Gateway decisions not executed (suite blocked). E2E-001 lets a member change `agents.status`/`lifecycle_state` and `policies` underneath the gateway. |
| Secrets | Service key server-only (`lib/db/env.ts` throws client-side); `.env.local` gitignored. E2E-001's integration-config path is a secret-exfiltration route. |
| Session | E2E-004 open redirect; E2E-005 cookie-driven timeouts. |
| Headers | CSP, frame-ancestors none, XFO DENY, nosniff present. CSP allows `'unsafe-inline'` scripts (accepted risk, not filed). |

## 6. Blocked tests

| Test | Why it could not run |
|---|---|
| Existing Playwright suite (340 tests: auth, multi-org, RBAC, Discover/Understand/Govern/Protect/Assure, Agent 360, integrations, administration, design review) | The permission classifier refused starting the app with `OUTBOUND_ALLOW_PRIVATE_NETWORKS=true` against the shared production database. That flag is set by `playwright.config.ts` for the MCP stub specs. |
| Live RBAC direct-write probe (E2E-001/002 confirmation) | Refused by the classifier ("Modify Shared Resources"), because the only database available is production. |
| SSO, MFA enrolment against a real IdP | BLOCKED_EXTERNAL_DEPENDENCY: no test IdP. |
| Email notifications | BLOCKED_EXTERNAL_DEPENDENCY: no Resend credentials. |
| AI summaries / help assistant with a provider | BLOCKED_EXTERNAL_DEPENDENCY: no provider keys (retrieval-only path verified anonymously). |

## 7. Missing implementation (not defects)

- No automated accessibility tooling (axe) in the repo.
- No dedicated non-production Supabase project or branch for E2E (see E2E-013).
- `docs/testing/WonderID-Feature-Test-Plan.pdf` lists 109 manual tests. They were not mapped one-to-one in this run.

## 8. Automated tests added

| File | Purpose | Result |
|---|---|---|
| `tests/e2e/api-unauthenticated.spec.ts` | Discovers every `app/api/**/route.ts` handler and asserts anonymous callers get 400/401/403/404/405 (public-by-design allowlist), never 5xx, never stack traces or DB error text | 237/237 PASS (`npx playwright test api-unauthenticated --project=chromium --no-deps`) |

The live RBAC write probe was written but not added: running it was refused, and it must only target a non-production database. Defect E2E-001's steps describe it.

## 9. Code changes made during testing

None to application code. Added: the spec above and these three documents, plus the QA audit-log entry. The local `.env.local` (gitignored, not committed) holds the secrets the user supplied.

## 10. Remaining risks

1. **Most product journeys are unverified in this run.** Discover, Understand, Govern, Protect, Assure, Agent 360, administration UI flows and responsive/dark-mode checks all depend on the blocked Playwright suite. Last recorded full run, from the QA audit log: 156/156 on 2026-09-25.
2. E2E-001/002 are proven from the live catalog but not by an executed exploit. Treat them as confirmed until a non-production run shows otherwise.
3. The last-admin guard counts direct `user_roles` only. A tenant whose sole Super Admin holds the role through a group can lose it by group deletion or membership removal. Not tested.
4. The secrets pasted into the chat should be rotated (Supabase service-role key, `SECRET_ENCRYPTION_KEY`). Rotating `SECRET_ENCRYPTION_KEY` needs re-encryption of stored integration credentials.
5. CSP `'unsafe-inline'` for scripts reduces XSS defence in depth. A stored-XSS sweep through the UI was not executed.
