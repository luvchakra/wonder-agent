# WonderID — E2E Test Execution Log

Live log for the 2026-10-01 end-to-end QA run. The final report is
[`WONDERID_E2E_TEST_REPORT.md`](WONDERID_E2E_TEST_REPORT.md) and the defects
are in [`E2E_DEFECTS.json`](E2E_DEFECTS.json).

- **Commit tested:** `acbdc0f` (`main`). Production (`agent.wonderapps.biz`) runs the same commit.
- **Branch:** `ccr-65a6a8d6-heyo97`
- **Database:** Supabase project `ekgyjwoenteadaaqakmd`. The CI E2E suite and the production deployment both use this one project (see E2E-013).
- **Runner:** Node 22, Next 16.3.5 production build (`next build && next start -p 3100`), Playwright 1.63 with the pre-installed Chromium.

## Constraints of this run (read first)

| Constraint | Effect |
|---|---|
| The container started with no server secrets. The Vercel copies are "sensitive" (write-only). The user pasted them mid-run into a gitignored `.env.local`. | Phases 1–4 ran without the service-role key. |
| The permission classifier refused the in-tenant direct-write probe against the shared database ("Modify Shared Resources"). | Live RBAC-bypass exploitation was **not executed**. E2E-001/002 rest on policy and grant inspection of the live database, not on a performed write. |
| The permission classifier refused starting the server with `OUTBOUND_ALLOW_PRIVATE_NETWORKS=true` (the SSRF-guard bypass `playwright.config.ts` sets for the MCP stub specs). | The existing 340-test Playwright suite was **not run** in this session, so every browser journey that depends on it is `BLOCKED`. |
| No test IdP, no Resend, no AI provider keys. | SSO/MFA, email delivery and AI summaries are `BLOCKED_EXTERNAL_DEPENDENCY`. |

Only read-only or anonymous traffic went to the shared database: the existing
live-client isolation script (its cross-tenant writes are designed to be
rejected, and they were), `SELECT` catalog queries through the Supabase MCP,
and anonymous HTTP to the local server.

## Phase log

| # | Phase | Scenario | Result | Defect | Severity | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Discovery | Repo, docs, 168 API routes, 96 pages, 100 migrations, RBAC/tenant libs, proxy, 48 Playwright specs, 30 SQL isolation fixtures | PASS | — | — | this file, §Coverage matrix | |
| 2 | Existing tests | `npm test` (vitest) | PASS 746/746 (98 files) | — | — | `npm test` output | |
| 2 | Existing tests | `npm run lint` | PASS | — | — | exit 0 | |
| 2 | Existing tests | `npm run typecheck` on a fresh clone | FAIL (8 × TS2307 image imports) | E2E-011 | LOW | `app/welcome/page.tsx` image module types missing until `next typegen` | PASS after `npx next typegen` |
| 3 | Startup | `npm run build` | PASS | — | — | exit 0, 0 warnings | |
| 3 | Startup | `next start` (publishable key only, then with server secrets) | PASS | — | — | `/welcome` 200 | |
| 3 | Startup | Full Playwright suite (340 tests) | BLOCKED | — | — | classifier refusal above | Not run |
| 4 | Smoke | 96 page routes, anonymous | PASS | — | — | 87 protected → 307 `/sign-in`; 9 public → 200 | |
| 4 | Smoke | Security headers on `/sign-in` | PASS | — | — | CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy present | CSP keeps `'unsafe-inline'` for scripts (noted, not a defect) |
| 5 | Auth | Every API route anonymous (236 method×route) — new spec `api-unauthenticated.spec.ts` | PASS 236/236 | E2E-010 (5 routes validate before auth) | LOW | Playwright line reporter: `236 passed (4.5s)` | |
| 5 | Auth | Session idle/absolute timeout | FAIL (design) | E2E-005 | MEDIUM | `proxy.ts` backfills `wa_session_started_at` when absent | Code inspection |
| 5 | Auth | Post-auth redirect `next` param | FAIL | E2E-004 | MEDIUM | `isSafeRelativeNextPath("/\\evil.example")` → `https://evil.example/` | Node URL check |
| 5 | Auth | Valid/invalid login, logout, password reset, MFA | BLOCKED | — | — | Covered by existing `auth.spec.ts`, not run | |
| 5 | Auth | SSO / JIT provisioning | BLOCKED_EXTERNAL_DEPENDENCY | E2E-007 (code review) | MEDIUM | `app/auth/callback/route.ts` claim merge order | |
| 6 | Tenancy | Live PostgREST isolation, two real GoTrue sessions, 44 tables both directions + anon sweep | PASS 150 / FAIL 1 | E2E-012 | LOW | `node tests/live-client-tenant-isolation.mjs` | The one FAIL is a fixture-reality check (Tenant Two has no applications), not a leak |
| 6 | Tenancy | RLS enabled on every public table | PASS | — | — | `pg_class.relrowsecurity` = true for all; 16 platform/secret tables have zero policies (deny-all to clients) | |
| 6 | Tenancy | Multi-org member moving rows between their tenants via `tenant_id` update | FAIL (inspection) | E2E-002 | HIGH | `tenant_id` column UPDATE granted to `authenticated`; `WITH CHECK tenant_id IN current_tenant_ids()` | Not executed live |
| 6 | Tenancy | `wa_tenant` cookie forged to a non-member tenant | PASS (code) | — | — | `getTenantContext()` picks only among DB memberships | Live check is in `multi-org-isolation.spec.ts` (not run) |
| 7 | RBAC | SECURITY DEFINER functions callable by `authenticated`/`anon` | PASS | E2E-014 | LOW | only `current_tenant_ids`, `has_tenant_permission`, `create_tenant_with_owner`, `resolve_tenant_host` exposed; all use `auth.uid()` | |
| 7 | RBAC | Direct PostgREST writes by READ_ONLY/REQUESTER to governance tables | FAIL (inspection) | E2E-001 | CRITICAL | 47 INSERT/UPDATE/DELETE policies on 25 tables gated on tenant membership only | Live probe refused by classifier |
| 7 | RBAC | Self-assign role / self-insert `platform_admins` / self-update membership | PASS (policy) | — | — | no client write policy on `user_roles`, `platform_admins`; trigger `tenant_memberships_guard_self_change` | |
| 8 | Priv-esc | Role assignment ceiling | FAIL | E2E-003 | HIGH | `lib/rbac/roles.ts:118` has no check that the actor holds the role's permissions | Custom-role *design* does check (`escalationIn`) |
| 8 | Priv-esc | Group membership ceiling | FAIL | E2E-003 | HIGH | `lib/users/groups.ts:318`: `groups.manage_members` adds anyone to a group carrying TENANT_SUPER_ADMIN | |
| 8 | Priv-esc | Last-admin demotion | PASS (DB) | — | — | triggers `user_roles_last_admin`, `tenant_memberships_last_admin` | Group-derived admin rights are not counted by the guard (Remaining risk) |
| 8 | Priv-esc | Self-edit of public profile (`users.email`, `display_name`) | FAIL | E2E-006 | MEDIUM | policy `users_update_self`, no column restriction | |
| 10 | Integrations | Webhook HMAC (timing-safe, fail-closed with no secret) | PASS (code) | E2E-009 | LOW | `modules/integrations/webhooks.ts` | No replay window; DB error text echoed |
| 10 | Integrations | MCP ingest bearer auth before validation | PASS (code) | — | — | `modules/integrations/mcpEvents.ts:138` | |
| 11 | Govern | Certification delegate target validation | FAIL | E2E-008 | MEDIUM | `modules/certification-compliance/decisions.ts:187` | |
| 12 | Protect | Gateway routes require agent API key | PASS | — | — | 401 anonymous (new spec) | Decision paths: existing `gateway-enforcement.spec.ts` (not run) |
| 17 | Security | Service-role writes keyed by id only | PASS (sampled) | — | — | 13 hits; all pre-verify tenant ownership | `sso.ts`, `controls.ts`, `duplicates.ts`, `policies.ts`, `decisions.ts` read |
| 17 | Security | Secrets in repo / client bundle | PASS | — | — | `.env.local` gitignored; `lib/db/env.ts` throws on client read of the service key | |
| 18 | Environment | E2E fixtures and production share one database | RISK | E2E-013 | HIGH | Vercel production env → same `NEXT_PUBLIC_SUPABASE_URL`; real tenants present | |

## Coverage matrix

Status uses the requested classes. "Existing" means a spec or fixture already
in the repository; "New" means added in this run.

| Area | Feature | User journey | Expected result | Existing test? | New test required? | Priority | Status |
|---|---|---|---|---|---|---|---|
| Authentication | Password sign-in/out, reset | sign in → app; wrong password → error; sign out → global | redirect / error / all sessions end | `auth.spec.ts` | No | P0 | BLOCKED (suite not run) |
| Authentication | Protected routes anonymous | open any app page signed out | 307 → `/sign-in` | partial (`navigation-smoke`) | Done this run (curl sweep, 87 pages) | P0 | PASS |
| Authentication | API anonymous | call every API route without a session | 401/403/404, no 5xx, no leakage | partial | **New** `api-unauthenticated.spec.ts` | P0 | PASS (236) |
| Authentication | Session idle/absolute expiry | stay idle / exceed max age | forced sign-out | unit `sessionSecurity` | Yes (cookie-tamper case) | P1 | FAIL (E2E-005) |
| Authentication | Post-auth redirect | `/auth/callback?next=` | same-origin only | unit only | Yes | P1 | FAIL (E2E-004) |
| Authentication | SSO/MFA | IdP sign-in, JIT role | mapped role only from IdP | no | needs a test IdP | P1 | BLOCKED_EXTERNAL_DEPENDENCY |
| Tenancy | RLS read isolation | A reads B (44 tables) | 0 rows | `live-client-tenant-isolation.mjs`, 30 SQL fixtures | No | P0 | PASS |
| Tenancy | Cross-tenant write | A updates/inserts B | rejected | live script | No | P0 | PASS |
| Tenancy | Multi-org row move | member of A+B moves A row to B | rejected | no | Yes (SQL fixture in a rolled-back txn) | P0 | FAIL by inspection (E2E-002) |
| Tenancy | Active-org switching | `wa_tenant` cookie, two memberships | only selected org visible | `multi-org-isolation.spec.ts` | No | P0 | BLOCKED |
| RBAC | UI/API permission checks | READ_ONLY hits admin APIs | 403 | `authorization.spec.ts`, `custom-roles.spec.ts` | No | P0 | BLOCKED |
| RBAC | DB-level permission enforcement | READ_ONLY writes via PostgREST | rejected | **no** | Yes (live probe; refused here) | P0 | FAIL by inspection (E2E-001) |
| RBAC | Privilege escalation via assignment/groups | delegated admin grants TENANT_SUPER_ADMIN | refused | self-escalation only | Yes | P0 | FAIL (E2E-003) |
| RBAC | Last admin | remove/demote final admin | refused | `users.spec.ts` | No | P0 | BLOCKED (DB guard present) |
| Discover | Agent discovery inbox, duplicates, shadow AI, MCP inventory, application discovery | sync → candidates → register/merge | normalized, deduped | `agents.spec.ts`, `shadow-ai.spec.ts`, `mcp-inventory.spec.ts`, `application-discovery.spec.ts` | No | P0 | BLOCKED |
| Understand | Effective access, access graph, accounts, entitlements, data sources | open agent access → paths | consistent with grants | `access.spec.ts`, `account-inventory.spec.ts`, `data-sources.spec.ts` | No | P0 | BLOCKED |
| Agent 360 | Agent detail tabs | open agent → every tab | consistent state | `agents.spec.ts`, `financebot-central-scenario.spec.ts` | Tabs: Policies/Evidence/Timeline consistency check | P0 | BLOCKED |
| Govern | Lifecycle, ownership, contracts, policies, approvals, certifications, SoD, exceptions | full lifecycle + illegal transitions | illegal ones rejected | `ownership-contract.spec.ts`, `policy-publish.spec.ts`, `approval-engine.spec.ts`, `compliance.spec.ts`, `sod.spec.ts` | Delegate-target validation | P0 | BLOCKED; E2E-008 by code |
| Protect | Runtime gateway ALLOW/DENY/REQUIRE_APPROVAL, emergency controls, kill switch | agent key → authorize | deterministic decisions | `runtime-gateway.spec.ts`, `gateway-enforcement.spec.ts`, `emergency-controls.spec.ts`, `outbound-guard.spec.ts` | Bypass via direct `agents.status` write (E2E-001) | P0 | BLOCKED; anonymous 401 PASS |
| Assure | Runtime events, risk, findings, investigations, evidence | event → finding → investigation | propagates | `runtime.spec.ts`, `risk.spec.ts`, `investigations.spec.ts` | No | P0 | BLOCKED |
| Integrations | Create, validate, sync, webhooks, MCP bridge, identity sources | create → sync → objects | normalized, idempotent | `integrations.spec.ts`, `mcp-bridge.spec.ts`, `identity-sources.spec.ts` | Webhook replay | P0 | BLOCKED; auth code review PASS |
| Administration | Users, groups, roles, permissions, authz policies, security, SSO | invite → assign → suspend → remove | effective permissions update | `users.spec.ts`, `groups.spec.ts`, `custom-roles.spec.ts`, `permission-catalog.spec.ts` | Ceiling tests | P0 | BLOCKED; E2E-003 by code |
| Search / Notifications / Reports / Audit | global search, notifications, reports, audit export | search → result → open | tenant-scoped | `navigation-smoke`, `compliance.spec.ts` | No | P1 | BLOCKED |
| Platform admin | vendor console | tenant user opens `/platform-admin` | refused | `platform-admin.spec.ts` | No | P0 | BLOCKED (anonymous → sign-in PASS) |
| Accessibility | names, labels, keyboard, dialogs | axe / keyboard pass | no criticals | `design-review.spec.ts` (partial) | Yes (axe not installed) | P1 | NOT_TESTABLE this run |
| Responsive | desktop/tablet/mobile | each viewport | no overflow | `design-review.spec.ts`, `shell.spec.ts` | No | P1 | BLOCKED |
