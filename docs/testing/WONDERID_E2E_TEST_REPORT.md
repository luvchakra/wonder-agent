# WonderID — End-to-End QA Report

**Date:** 2026-10-01 · **Commit tested:** `acbdc0f` (`main`, also live in production) · **Branch:** `ccr-65a6a8d6-heyo97`
Companion files: [`E2E_TEST_EXECUTION.md`](E2E_TEST_EXECUTION.md) (live log and coverage matrix) · [`E2E_DEFECTS.json`](E2E_DEFECTS.json)

## 1. Executive summary

**Overall QA status: NOT RELEASE-READY. One CRITICAL and three HIGH findings are open, and most write-path browser journeys could not be executed in this run.**

*Round 2 (same day):* signed-in, read-only testing ran against the local production build. It covered:
- a cross-tenant sweep of 97 GET API routes, in both directions, as admin, READ_ONLY and REQUESTER, substituting the other tenant's real record ids: **0 leaks**;
- cross-tenant direct URLs and Agent 360 tabs in the browser: **no foreign data rendered**;
- a page, accessibility and responsive sweep of 52 pages × 3 viewports;
- READ_ONLY/REQUESTER UI controls with server-side refusal checks.

Four new defects came out of it, all LOW (E2E-015 to E2E-018).

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
| *Round 2* — cross-tenant GET sweep, 97 routes × 4 sessions (A→B admin, B→A admin, READ_ONLY→B, REQUESTER→B) | 388 | 388 | 0 | 0 | 0 | 0 |
| *Round 2* — server refusal of create calls by READ_ONLY/REQUESTER (agents, policies, campaigns; empty body) | 6 | 6 | 0 | 0 | 0 | 0 |
| *Round 2* — **new** `tests/e2e/cross-tenant-pages.spec.ts` | 5 | 3 | 2 (E2E-015, E2E-016; recorded as expected failures) | 0 | 0 | 0 |
| *Round 2* — page/a11y/responsive sweep (52 pages × desktop 1440, tablet 768, mobile 375) | 156 | 152 | 1 (E2E-017) | 0 | 0 | 3 (browser→Supabase TLS through sandbox proxy) |
| *Round 2* — READ_ONLY/REQUESTER UI controls (52 pages × 2 users) | 104 | 100 | 4 (E2E-018) | 0 | 0 | 0 |
| *Round 2* — Agent 360 requested tabs (Identity, Policies, Governance, Evidence, Timeline) | 5 | — | — | 0 | 5 | 0 |
| **Total** | **2257** | **1886** | **18** | **344** | **5** | **4** |

Defects: **18** (CRITICAL 1, HIGH 3, MEDIUM 5, LOW 9).

## 3. Coverage by area

| Area | What was actually exercised | Result |
|---|---|---|
| Authentication | Anonymous access to 87 protected pages and 236 API methods; proxy session handling; callback redirect; timeout design | PASS for anonymous refusal; FAIL E2E-004, E2E-005; sign-in/out/reset journeys BLOCKED |
| Tenancy | Live two-session PostgREST isolation (44 tables, both directions, PK lookup, cross-tenant writes rejected, anon sweep); RLS enabled on every table; tenant cookie selection; **round 2:** 97 GET routes with the other tenant's real ids in both directions, `tenant_id`/`tenantId` query injection, and 8 detail URLs in the browser | PASS (0 leaks); FAIL E2E-002 (inspection); E2E-012 fixture gap; LOW E2E-015/016 |
| RBAC | Policy and grant catalog; SECURITY DEFINER exposure; self-assignment paths; assignment/group ceilings; **round 2:** READ_ONLY (12 × 403) and REQUESTER (44 × 403) across 97 GET routes, every 200 consistent with the role's permissions; create calls refused server-side | FAIL E2E-001 (CRITICAL), E2E-003; API RBAC PASS; LOW E2E-018 (UI shows forms the role can't use) |
| Discover | Not executed (existing specs BLOCKED) | BLOCKED |
| Understand | Not executed | BLOCKED |
| Govern | Code review of certification decisions | FAIL E2E-008; journeys BLOCKED |
| Protect | Gateway routes refuse anonymous callers; decision paths not executed. E2E-001 lets any member flip `agents.status`, which undermines suspension. | PARTIAL / BLOCKED |
| Assure | Not executed | BLOCKED |
| Agent 360 | **Round 2:** Overview, Access (CAN), Runtime (DID) and Risk & Findings render on the tenant's own agent with the tab bar, one active tab and no page error; the same four routes for a foreign agent redirect to the list or show not-found | PASS; Identity/Policies/Governance/Evidence/Timeline are not separate tabs (NOT_IMPLEMENTED); journeys that mutate state BLOCKED |
| Integrations | Webhook HMAC and MCP bearer verification reviewed; anonymous refusal executed | PASS; LOW E2E-009; E2E-001 integration-config exfiltration path |
| Administration | Users/groups/roles code paths reviewed | FAIL E2E-003, E2E-006 |
| API | 236 anonymous probes; 5 routes validate before auth | PASS; LOW E2E-010 |
| Security | Headers (CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy), secrets handling, service-role tenant re-checks (13 sites sampled, all verify tenant first) | PASS except findings above |
| Accessibility | **Round 2** DOM checks on 52 pages × 3 viewports: no visible button/link without an accessible name, no visible input without a label, no `<img>` without `alt`, exactly one `<h1>` per page. Keyboard traps, focus order and contrast were not tested (no axe). | PASS (basic); full audit NOT_TESTABLE |
| Responsive | **Round 2:** horizontal overflow at 1440/768/375 on 52 pages | PASS except E2E-017 (`/settings/authorization-policies`, +125 px at 375 px) |

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

### E2E-015 — LOW — Sub-resource routes answer 200/empty for another tenant's id
- **Steps:** as Tenant One admin, GET `/api/v1/agents/<Tenant Two agent>/owners`, `/policies/<T2 policy>/rules` or `/compliance/campaigns/<T2 campaign>/items`, or open `/compliance/campaigns/<T2 campaign>` in the browser.
- **Expected:** 404 / not-found, as the parent routes give. **Actual:** 26 sub-resource GET routes return `200 {"data":[]}`, and the campaign page renders an empty campaign shell. No foreign data is returned.
- **Fix:** resolve the parent in the tenant first and 404 when it is not there.

### E2E-016 — LOW — Not-found detail pages are served with HTTP 200
- **Steps:** open `/agents/<unknown id>` or `/policies/<unknown id>`.
- **Actual:** the generic Next.js "404 This page could not be found." text inside the shell, with status 200. `notFound()` runs after the segment's `loading.tsx` has started streaming. The not-found page is also the unstyled framework default (§13).
- **Fix:** resolve existence before the streamed boundary (or move the check into `generateMetadata`/layout), and add a designed `not-found.tsx` in `app/(customer)`.

### E2E-017 — LOW — Horizontal scroll on `/settings/authorization-policies` at 375 px
- **Actual:** the "Permissions it applies to" `<fieldset>` (default `min-width: min-content`) is 500 px wide, so the page scrolls 125 px sideways.
- **File:** `app/(customer)/settings/authorization-policies/PolicyForm.tsx:105`. **Fix:** `min-w-0` on the fieldset.

### E2E-018 — LOW — Forms offered to roles that cannot use them
- **Actual:** READ_ONLY sees the Register form on `/agents/new`, Create on `/policies` and Launch on `/compliance/campaigns`. REQUESTER sees Register on `/agents/new`. The server refuses each (403 `Missing permission: agent.create` / `policy.create` / `compliance.manage`), so this is UX, not a bypass.
- **Fix:** gate the forms on the same permission the action checks.

## 5. Security findings summary

| Topic | Finding |
|---|---|
| Tenant isolation (reads) | **Holds.** Live two-session proof across 44 tables; anon denied everywhere; round 2: 388 cross-tenant API checks and 8 browser detail URLs, 0 leaks. |
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

- Agent 360 has four tabs (Overview, Access (CAN), Runtime (DID), Risk & Findings), plus the rogue-agent view at `/risk/rogue/[agentId]`. The Identity, Policies, Governance, Evidence and Timeline tabs listed in the QA brief don't exist as separate tabs; some of that content is on Overview.
- No automated accessibility tooling (axe) in the repo.
- No dedicated non-production Supabase project or branch for E2E (see E2E-013).
- `docs/testing/WonderID-Feature-Test-Plan.pdf` lists 109 manual tests. They were not mapped one-to-one in this run.

## 8. Automated tests added

| File | Purpose | Result |
|---|---|---|
| `tests/e2e/cross-tenant-pages.spec.ts` | Discovers Tenant Two's real ids from its own session, then as Tenant One opens every detail URL (no foreign data: hard check), checks not-found UX (E2E-015, expected failure) and HTTP 404 (E2E-016, expected failure), the `tenant_id` query injection, and the Agent 360 tab bar on the tenant's own agent | 12/12 with setup (`E2E_SKIP_SEED=1 npx playwright test cross-tenant-pages`) |
| `tests/e2e/api-unauthenticated.spec.ts` | Discovers every `app/api/**/route.ts` handler and asserts anonymous callers get 400/401/403/404/405 (public-by-design allowlist), never 5xx, never stack traces or DB error text | 237/237 PASS (`npx playwright test api-unauthenticated --project=chromium --no-deps`) |

The live RBAC write probe was written but not added: running it was refused, and it must only target a non-production database. Defect E2E-001's steps describe it.

## 9. Code changes made during testing

None to application code. Added: the spec above and these three documents, plus the QA audit-log entry. The local `.env.local` (gitignored, not committed) holds the secrets the user supplied.

## 10. Remaining risks

1. **Most write-path product journeys are unverified in this run** (read-only signed-in coverage was added in round 2). Discover, Understand, Govern, Protect, Assure, Agent 360, administration UI flows and responsive/dark-mode checks all depend on the blocked Playwright suite. Last recorded full run, from the QA audit log: 156/156 on 2026-09-25.
2. E2E-001/002 are proven from the live catalog but not by an executed exploit. Treat them as confirmed until a non-production run shows otherwise.
3. The last-admin guard counts direct `user_roles` only. A tenant whose sole Super Admin holds the role through a group can lose it by group deletion or membership removal. Not tested.
4. The secrets pasted into the chat should be rotated (Supabase service-role key, `SECRET_ENCRYPTION_KEY`). Rotating `SECRET_ENCRYPTION_KEY` needs re-encryption of stored integration credentials.
5. CSP `'unsafe-inline'` for scripts reduces XSS defence in depth. A stored-XSS sweep through the UI was not executed.
