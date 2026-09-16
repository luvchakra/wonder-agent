# QA Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — First dispatch: full P0 backlog, run last per `docs/RUN_ORDER.md`

**Agent:** QA Agent · **Branch:** `claude/wonderagent-setup-lasmly` (same
environment-pinned-branch deviation every prior module recorded).

QA Agent is the last module in the run order — this dispatch runs after all ten
domain/platform/experience/operations modules reached their P0 `Done`/`Partial`
state. Full detail for every story is in the new `INTEGRATION_STATUS.md` at the
repository root (this document's own §1–8); this entry summarizes what was built,
fixed, and left open, and does not duplicate that detail.

**Done outright:** QA-P0-01.1 (repository & contract inventory), QA-P0-01.2 (route
map & permission matrix — found and fixed a stale route-prefix drift in
`docs/design/ownership-map.md`), QA-P0-02.3 (platform-admin isolation sweep, live),
QA-P0-04.1 (repo-wide pipeline sweep), QA-P0-04.2 (migration validation), QA-P0-04.4
(regression-fix discipline), QA-P0-09 (SHOULD/CAN/DID reproducibility — already
directly proven by `modules/runtime-assurance/compare.test.ts`).

**Two real defects found and fixed, both logged in Foundation's own audit log per
QA-P0-04.4's rule (fix lives in, and is logged by, the owning module):**

1. `lib/security/encryptSecret.test.ts`'s tamper test was intermittently flaky
   (base64 padding-boundary non-determinism in the *test's* tamper method, not a
   GCM authentication defect). Fixed by moving the tamper target to an always-
   unpadded byte position. Verified deterministic across 5 isolated + 3 full-suite
   reruns.
2. Two `SECURITY DEFINER` functions (`current_tenant_ids()`, `rls_auto_enable()`)
   were executable by roles with no legitimate reason to call them (`anon` for both;
   `authenticated` too for `rls_auto_enable()`, an event-trigger function never
   meant to be called via RPC). Applied migrations `0049`/`0050` revoking the
   unnecessary `EXECUTE` grants, while deliberately *keeping* `authenticated`'s grant
   on `current_tenant_ids()` since every tenant-scoped RLS policy in this database
   depends on it — revoking that one would have broken RLS entirely. Re-verified
   live post-fix: an authenticated Tenant-A5 session still sees exactly its own
   agent row, no regression. `get_advisors(security)` re-run clean of both findings
   afterward (only the already-accepted `create_tenant_with_owner()` exception and
   the dashboard-only `auth_leaked_password_protection` setting remain).

**Backlog reconciliation (separate from the P0 work above, but same dispatch):**
the user separately uploaded a more detailed module-08 requirements document
(`08_UI_UX.md`) mid-session; its new §38 ("Locked Product Design System") was
reconciled into `docs/plan/08-EXPERIENCE-AGENT-BACKLOG.md` as a new, explicitly
flagged-not-implemented row (`EXPERIENCE-P0-09`) rather than silently built, since
it materially conflicts with already-shipped, widely-depended-upon shell/token/nav
work — see that backlog's own Requirements Refresh addendum and
`docs/design/experience-agent-backlog-audit.md`'s matching entry. Not QA's own
story, recorded here only because it happened in the same dispatch window.

**Real, named gap found and not fixed (QA-P0-04.3):** grepped every module's list-
style service function for `.range(`/`.limit(` usage. Only 4 files (Runtime's
`events.ts`/`quarantine.ts`, Operations' `audit.ts`/`notifications.ts`) bound their
result set — roughly 22 other `list*()` functions across Identity, Access,
Compliance, Integration, Platform, and Operations' own `savedReports.ts` fetch an
unbounded full table scan, violating CLAUDE.md §15's mandatory pagination rule.
**Not fixed here** — rewriting ~22 files across 6 modules' own service layers is
not a "smallest safe change" and would make QA a second implementation pass inside
other modules' owned files (non-negotiable #18; this backlog's own "DO NOT
IMPLEMENT — sweeping refactors"). Recorded in `INTEGRATION_STATUS.md` §5 as a named
release-gate item for each owning module.

**Partial, with specific documented gaps (not fabricated as complete):**
QA-P0-02.1 (cross-tenant sweep — DB/API/search/reports/jobs layers verified live;
no dedicated isolation fixture yet for Operations'/Platform's newest tables),
QA-P0-02.2 (RBAC sweep — orphaned-permission check clean, but the negative-
permission proof is generic rather than per-key-enumerated), QA-P0-03.1 (the
FinanceBot scenario — 6 of 8 steps confirmed live against the real fixture; step 6
honestly partial and step 7 not exercised end-to-end, both already recorded as
cross-module blockers in Risk Agent's own audit log, not new QA findings), QA-P0-05
(clean install — lockfile/env-example present and a cold-cache build verified;
a true from-scratch clone+install+fresh-database run was not attempted, judged out
of scope for a verification pass given the cost/quota implications of a second
Supabase project), and QA-P0-06 through QA-P0-14 (the requirements-refresh's
extended hardening epics — authentication suite, connector contract tests, runtime
test corpus, risk regression suite, certification regression, security scanning,
failure recovery, observability sweep). Each of these carries existing, real partial
test coverage (cited specifically in `INTEGRATION_STATUS.md` §7) rather than zero
coverage, but none is a complete suite — building the full versions (e.g. QA-P0-10's
40-case risk-category matrix) responsibly requires the kind of deep domain
familiarity that belongs to each owning module's own further work, not a QA
dispatch attempting to fabricate shallow passes or silently duplicate another
module's implementation logic.

**Verification:** full pipeline (`npm run typecheck`, `npm run lint`, `npx vitest
run` — 139/139 passing, `npm run build` with `.next` deleted first) green;
`grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match; live smoke test
against a locally built production server for platform-admin isolation (torn down
after); `get_advisors(security)` re-run clean of both fixed findings; live SQL
queries against the FinanceBot fixture and the RLS/policy catalog, both re-run
after this dispatch's own migrations to confirm no regression.

**Open questions for the user:** none new from QA's own P0 work — every gap above
is either blocked on a specific cross-module contract already recorded by its
owning module, or a sandbox/infrastructure constraint already accepted elsewhere
in this session (real SSO/MFA IdP round-trip, real-browser visual verification,
a genuinely fresh install environment). The one open question from this dispatch
window is EXPERIENCE-P0-09 (the Locked Design System v2 addendum), already raised
separately in Experience Agent's own audit log.

**Release Gate:** per `docs/plan/11-QA-AGENT-BACKLOG.md`'s own Release Gate section
and `INTEGRATION_STATUS.md` §8 — not yet a clean pass. No defect was found in any
deterministic security/isolation/authorization logic itself; the gate is held open
by the pagination gap, FinanceBot step 7, the QA-P0-06–14 partial epics, and the
already-accepted sandbox constraints, each named and owned rather than silent. This
is the last module in `docs/RUN_ORDER.md` — with this dispatch, the full run order
has been exercised at least once; no further module remains to auto-chain into.

## 2026-09-14 — Second dispatch: dependency vulnerability scan, Operations
isolation fixture

**Agent:** QA Agent · **Branch:** `claude/wonderagent-setup-lasmly`. Picked
up after Experience Agent's own follow-on dispatch closed its remaining
named gaps; this session closes two of QA's own previously-recorded
release-gate items rather than re-opening the full P0 backlog.

**QA-P0-12 (security scanning):** ran `npm audit` at both `--omit=dev`
(production-only) and full scope (including dev dependencies) — **0
vulnerabilities** either way. Closes the "dependency vulnerability
scanning... not run" half of this story's previously-recorded gap. The
other half (a static-analysis pass beyond ESLint, and
`auth_leaked_password_protection` — a Supabase Auth dashboard-only toggle)
remains open, unchanged.

**QA-P0-02.1 (full cross-tenant sweep):** built `tests/operations/
tenant-isolation.sql` (new), closing the specific gap this backlog's own
audit already named — no `tests/**` fixture existed for Operations
Agent's newest tables (`notifications`, `notification_preferences`,
`reports`). Before building anything, re-checked
`platform_config_versions`/`platform_announcements` (the other two tables
named in that same gap) directly against `pg_policies`, not just the
earlier advisor-level "11 tables, RLS enabled, no policies" count — both
have genuinely zero policies for any role. Correctly excluded them from
this fixture: a "does tenant A's session see only tenant A's rows"
property has nothing to test on a table no customer session can read at
all; that absence is itself what one of the fixture's own checks proves
directly for `platform_config_versions`.

The new fixture (Tenant A6/B6, a fresh pair distinct from every existing
fixture ID range) proves, run live via the Supabase MCP `execute_sql`
tool against project `ekgyjwoenteadaaqakmd` (same tool used throughout
this session for direct DB verification — this sandbox's plain network
egress cannot reach Supabase directly, a hard constraint confirmed
empirically earlier this session, distinct from this MCP tool's own
separate/privileged channel):

- Tenant A6's authenticated session sees exactly its own direct
  notification, its own tenant-wide broadcast notification (`user_id
  is null`), its own notification preferences row, and its own saved
  report — never Tenant B6's rows, whether queried by list or by direct
  lookup (`B6_notification_by_pk_row_count` → 0).
- Attempting to mark another tenant's notification as read affects 0
  rows (RLS silently filters the `UPDATE` target, doesn't throw — same
  "check row_count, not just absence of an exception" lesson this
  session's earlier fixtures already established).
- A direct client-side `INSERT` into `notifications` (bypassing the
  real app's only writer, `notify()`, which uses the service-role
  client) is rejected by RLS — no client-facing insert policy exists
  on this table by design.

All results matched the fixture's own documented expected values exactly
on first live run. Fixtures cleaned up afterward (this A6/B6 pair is not
a shared "central scenario" fixture reused across modules, unlike the
FinanceBot aaaaaaaa-5000-.../bbbbbbbb-5000-... pair, so there was no
reason to leave it seeded). `get_advisors(security)` re-run clean
afterward — no new finding introduced, same three already-accepted
exceptions as every prior pass (11 vendor-only RLS-enabled-no-policy
tables, the two intentional `SECURITY DEFINER` grants, the dashboard-only
leaked-password-protection setting).

**Verification:** `npm audit` (both scopes, above); live SQL fixture
insert → verify → cleanup cycle against the dev Supabase project, all
three phases executed and all results matched expectations;
`get_advisors(security)` re-run post-fixture, clean.

**Updated `docs/RUN_ORDER.md`:** the Experience Agent row was also
refreshed in this same session window (not a QA action, but recorded
here since it happened in this dispatch's timeframe) — it had gone stale,
still describing Experience Agent's pre-Locked-Design-System-v2 state
from an earlier pass, and now reflects the actual current 9-of-12-`Done`
state with the three remaining `Partial` rows' real, narrow causes.

**Release Gate — still not a clean pass**, for the same reasons named in
`INTEGRATION_STATUS.md` §8, now with two of the four blocking categories
partially narrowed rather than eliminated: the pagination gap (§5) and
the QA-P0-06–14 extended epics (§7, apart from QA-P0-12's now-closed
`npm audit` sub-item) are unchanged from the first dispatch; FinanceBot
step 7 and the sandbox-only constraints are unchanged and unchangeable
from this environment. Not claiming a release-gate pass this dispatch —
recording concrete, verified progress against two specific named items
instead.

## 2026-09-14 — Third dispatch: documentation-only re-check against the
expanded requirements doc (round 2), no application/test code touched

**Agent:** QA Agent. Documentation/planning pass only, per this dispatch's
explicit scope: read the newly re-uploaded, expanded
`11_INTEGRATION_QA_HARDENING.md` in full, re-checked it against the current
`docs/plan/11-QA-AGENT-BACKLOG.md` (including its existing Requirements
Refresh section), `INTEGRATION_STATUS.md`, and this audit log's own two
prior entries, to find anything genuinely new that the first Requirements
Refresh pass missed. No migration, service code, route, or test file was
touched; the verification pipeline (typecheck/lint/test/build) was not run,
per this dispatch's explicit instruction.

**Finding: the doc is almost entirely already reconciled.** The uploaded
doc's structure is a header/Purpose/Engineering-rules block, the full
original master PRD (§46–§55 — P0/P1 feature lists, the P0 acceptance
scenario, development order, Claude Code operating instructions, Definition
of Done, Non-Goals, final product definition, implementation guardrails,
first commercial wedge, final-pass procedure, release gate), and then the
same "Expanded Requirements" flat list (`QA-P0-01`–`QA-P0-15`,
`QA-P1-01`–`06`, `QA-P2-01`–`03`) the first Requirements Refresh pass already
fully reconciled (mapped to `QA-P0-05`–`QA-P0-14`, marked "already covered,"
or copied verbatim into this backlog's own `## P1`/`## P2` sections). The
master-PRD sections restate `CLAUDE.md` §9–§16 almost verbatim and add no
new scope.

**Three specific re-checks performed before concluding "no gap," rather than
trusting the first pass's mapping claims at face value:**

1. Doc's `QA-P0-03` (Tenant Isolation Suite) names "RPC" and "caches" as
   surfaces distinct from what `QA-P0-02.1`'s own text enumerates. Grepped
   the whole codebase for `.rpc(` — only `create_tenant_with_owner`
   (already audited, intentionally `authenticated`-executable) and the MCP
   connector's own outbound JSON-RPC client method (an unrelated meaning of
   "RPC"). Grepped for cache/memoization patterns — none exist anywhere;
   reports and computed views are explicitly built and commented "never
   cached." Both surfaces are genuinely non-issues: nothing exists to leak
   cross-tenant data through, not an untested gap.
2. Doc's `QA-P0-11` (Security Scanning) names "secure headers checks."
   Confirmed `next.config.ts` (FOUNDATION-P0-05.3) sets
   `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
   `Permissions-Policy`, and a `Content-Security-Policy` repo-wide. This
   detail wasn't itself named in `INTEGRATION_STATUS.md` §7's `QA-P0-12`
   write-up, but it is a sub-detail of that already-tracked `Partial` story,
   not a new requirement — no new row added for it.
3. Diffed the doc's full "Expanded Requirements" wording against every
   corresponding backlog story's own wording line by line (not just ID
   matching) — no material wording differences found; the first pass's
   reconciliation is accurate, not just superficially ID-matched.

**One genuinely new item found and added: `QA-P1-07` — Release record
completeness standard.** After the doc's `QA-P2-03` entry sits an unlabeled
closing paragraph the first Requirements Refresh pass's own summary
(which explicitly stopped at "`QA-P2-03`") read past: *"The release record
must include commit/version, migration status, test summary, known
limitations, connector compatibility and security findings and explicit
P0/P1/P2 status."* Checked each named field against the current
`INTEGRATION_STATUS.md` directly: migration status, test summary, known
limitations, and security findings are all present; connector compatibility
is present inline (the dedicated matrix is already tracked as `QA-P1-04`,
not duplicated); but **no commit/version identifier appears anywhere in the
document, and it never gives an explicit P1/P2 status summary** — only
exhaustive P0 detail. This is real, scoped entirely to a file QA already
owns (`INTEGRATION_STATUS.md`), requires no new table/route/type, and was
missed by the first pass for an identifiable reason (it sits outside the
numbered list that pass was reconciling). Classified `P1` per `CLAUDE.md`
§3's "when genuinely unsure, prefer P1/P2 over P0" — it is a
documentation-completeness requirement on the release record's own
contents, not itself a security/isolation gate. Added as a new Progress
Tracker row (status: Not Started), a new bullet in `## P1`, and a full
"Requirements Refresh — 2026-09-14 (round 2, expanded doc)" section in
`docs/plan/11-QA-AGENT-BACKLOG.md` documenting the reasoning above.

**Explicitly not touched:** no row already `Done`/`Partial` was reopened or
changed; `INTEGRATION_STATUS.md` itself was read but not edited (its
release-gate conclusion is a live-verification artifact, out of scope for
this documentation-only pass, per this dispatch's own instruction); no other
module's backlog, ownership map, or application code was touched; none of
this task's named "known existing tracked gaps" (pagination, FinanceBot step
7, `QA-P0-06`–`14` partial coverage, sandbox-only constraints) were
re-added.

**Verification:** documentation cross-referencing only (`grep`/`diff`
against the doc, the backlog, `INTEGRATION_STATUS.md`, both prior audit
entries, and `next.config.ts`) — no build/test/typecheck/lint run, per this
dispatch's explicit scope.

**Open questions for the user:** none new. The doc's "Modular Execution
Guide" process-model note already flagged in the first Requirements Refresh
(manual-dispatch-only vs. this repo's standing autopilot policy) remains
open and unchanged by this pass.

---

## 2026-09-16 — Final re-verification pass (post governance-requirements build-out)

**Agent:** QA Agent, per the user's standing authorization, after the
session completed the entire pending P0 backlog (Foundation's `lib/ai/`
primitive, Risk's Governance Drift, Compliance's Posture/Attestation/
Evidence Pack, Operations' evidence export, Experience's four UI gaps,
Risk/Compliance unblocks, Platform's stale-row fix and unblock,
Operations' `notify()` wiring and job-status page — see
`INTEGRATION_STATUS.md` §9 for the full list).

**Approach:** a single repo-wide pipeline sweep plus targeted advisor/
isolation checks, rather than re-deriving every `QA-P0-*` story from
scratch — every new story this session already carried its own
module-level verification (typecheck/lint/tests/build/secret-leak, and
live Supabase checks where schema changed), recorded in each module's own
audit log. This pass's job was to catch anything those per-story checks
individually couldn't: cross-cutting drift (migration counts, advisor
state) and gaps a single module's own pass wouldn't think to check for
itself (a missing isolation test on another module's new table).

**Findings, both real and fixed, not just re-confirmations:**
1. `mcp__Supabase__get_advisors(performance)` — `governance_attestations_
   agent_id_fkey` (Compliance's migration `0055`) had no covering index.
   The composite `(tenant_id, agent_id)` index that migration already
   added doesn't cover a lookup on `agent_id` alone (not the leading
   column), which is exactly what the FK-constraint check needs on an
   agent delete. Fixed via `supabase/migrations/0056_compliance_
   governance_attestation_fk_index.sql`
   (`governance_attestations_agent_id_idx`), applied live; re-checked —
   the finding cleared (`unindexed_foreign_keys` count 14→13, the
   remaining 13 all pre-existing from before this session).
2. `governance_attestations` (`COMPLIANCE-P0-08`, built earlier this
   session) had no tenant-isolation SQL fixture — a real violation of
   CLAUDE.md §14's "new tables/routes without an isolation test are not
   Done" that COMPLIANCE-P0-08's own audit entry didn't catch at the
   time. Added `tests/compliance/governance-attestation-tenant-isolation.sql`,
   reusing the existing FinanceBot fixture (Tenant A5/agent/User A5,
   Tenant B5's User B5) rather than a new one. Ran live against the dev
   project via `execute_sql`: visible to Tenant A5's user (1 row),
   invisible to Tenant B5's user (0 rows), a client-role insert correctly
   rejected by RLS (no client INSERT policy exists, per the table's own
   design), a client-role update affects 0 rows (immutability). Fixture
   row deleted after the run — the script itself is left in `tests/` for
   future re-runs, consistent with every other isolation script in this
   repo.
3. `mcp__Supabase__get_advisors(security)` — re-checked across every
   migration applied this session (`0054`, `0055`, `0056`): no new
   findings; the 3 pre-existing ones (Platform's own 11
   `rls_enabled_no_policy` rows, 2 known security-definer functions, the
   dashboard-only leaked-password-protection setting) are unchanged.
4. Migration count/prefix check: 56 files, no duplicate numeric prefixes
   (`ls | sed -E 's/^([0-9]{4})_.*/\1/' | sort | uniq -d` — empty).

**Full pipeline, re-run clean:** `npm run typecheck`, `npm run lint`,
`npx vitest run` (214/214, up from 139 at this doc's last full-sweep
entry), `npm run build` with `.next` deleted first, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` (no match), `node scripts/
contrast-check.mjs` (every pair passes, both themes — confirms the new
`AiSummaryPanel`/`AnnouncementsBanner`/job-status page's reused `info`/
`warning` tones didn't regress anything), `npm audit --production` (0
vulnerabilities).

**Not attempted this pass** (unchanged sandbox/scope constraints already
named in `INTEGRATION_STATUS.md` §8, not re-litigated here): real
SSO/MFA IdP round-trip, real-browser authenticated visual verification, a
true from-scratch clean-room install, full coverage of the extended
`QA-P0-06`–`14` epics, `QA-P1-07`.

**Updated:** `docs/plan/11-QA-AGENT-BACKLOG.md`'s `QA-P0-04.1`,
`QA-P0-04.2` (re-verified, counts updated), `QA-P0-02.1` (new isolation
test referenced). `INTEGRATION_STATUS.md` §9 added as this pass's full
account.

## 2026-09-16 — QA-P0-05: genuine from-scratch clean-install run attempted

**Trigger:** the standing "any P0 item open to work?" sweep, bucket A
(pure-code, no product decision needed).

**Done:** a real from-scratch verification, not the existing checkout's
cold-cache build this story's `Partial` status previously relied on.
`git clone --branch main --depth 1 https://github.com/luvchakra/wonder-agent.git`
into a scratch directory (no shared `node_modules`, no `.env.local`
carried over from this working checkout), then:
- `npm ci` (lockfile-driven install, not `npm install`) — 598 packages,
  0 vulnerabilities, ~30s.
- A `.env.local` synthesized purely from `.env.local.example`'s own
  documented variable names (placeholder values) — proving the app
  builds from documented env vars alone, not some undocumented local
  override.
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npx vitest run` — 260/260, matching the working checkout's count
  exactly (proves the test suite has no dependency on anything outside
  the committed repo + documented env vars).
- `npm run build` — clean production build, ~25s. The client bundle
  correctly inlines the `NEXT_PUBLIC_*` placeholder values (expected —
  those are meant to be public) and does not contain
  `SUPABASE_SERVICE_ROLE_KEY` (confirmed via the same `grep -rl` check
  this pipeline always runs).

**Deliberately still not attempted:** applying every migration to a
genuinely fresh database (rather than the existing dev Supabase
project). `mcp__Supabase__create_branch` requires a `confirm_cost` step
first — the tool's own description says to "always repeat the cost to
the user and confirm their understanding before proceeding," since
branch creation is real, hourly-billed infrastructure spend on the
user's Supabase organization, not a free/local action. Asked the user
directly (check the cost and proceed if small, vs. skip the paid step);
the user chose to skip it. This is a documented, informed scoping
decision, not a silently-abandoned acceptance criterion — the code-level
half of QA-P0-05's acceptance criteria (fresh clone, fresh install,
build) is now genuinely verified; the fresh-migration-apply half remains
`Partial` for a real, named cost reason rather than a "sandbox
limitation" excuse.

**Verification:** as described above, run entirely in an isolated
scratch directory separate from the working checkout, output captured
in this session's transcript. No files in the working checkout were
touched by this story (verification-only, no code change) — Progress
Tracker updated to reflect the narrower, honest scope of what's still
open.

## 2026-09-16 — QA-P0-16: full Playwright E2E suite (user-requested, browser-driven, real Supabase Auth)

**Request and scoping:** user asked for "a full qa suite based on
playwright." No Playwright/E2E infrastructure existed at all beforehand —
every prior `tests/**` fixture was a SQL-level RLS/session-claims
simulation, never a real browser login. Asked 3 scoping questions before
starting: (1) run against the existing dev Supabase project with
namespaced test tenants, vs. a paid fresh branch — user chose the existing
project; (2) framework-only vs. deep per-module coverage — user chose deep
coverage; (3) CI-wired vs. local-only — user chose CI-wired. Full detail on
what was built is in `docs/plan/11-QA-AGENT-BACKLOG.md`'s own `QA-P0-16`
section; this entry covers the build/verification trail and the one real
blocker hit along the way.

**Genuine mid-build blocker, reported not routed around:** after building
the framework, seed script and auth-setup project, running the setup
project against a real `next start` server failed with "Host not in
allowlist" from a Node fetch, then a direct `curl` to the same host
confirmed a `403 CONNECT tunnel failed... organization policy` from this
session's own agent proxy — this sandbox cannot reach the dev Supabase
project's host at all, for any process, regardless of how the code is
written. Per this environment's own proxy documentation ("do not retry or
route around it — report the blocked host"), stopped and asked the user
how to proceed rather than silently downgrading scope or fabricating a
"tests pass" claim. User chose to have the full suite built anyway, with
CI as the real validation gate — recorded here so a future reader
understands why this story shipped `Partial` with zero live executions,
not because the work is incomplete but because this specific sandbox
cannot run it.

**Built** (see `docs/plan/11-QA-AGENT-BACKLOG.md`'s `QA-P0-16` for the full
file-by-file account): `playwright.config.ts`; `.gitignore` additions for
`test-results/`/`playwright-report/`/`tests/e2e/.auth/` (the last holds
real session tokens — never committed); `package.json` gains
`test:e2e`/`test:e2e:ui`/`test:e2e:report`; `@playwright/test` added as a
devDependency; `tests/e2e/support/testUsers.ts`, `seedTestData.ts`,
`seedFinanceBotAccess.ts`; `tests/e2e/auth.setup.ts`; 9 spec files
(`auth`, `navigation-smoke`, `agents`, `access`, `runtime`, `risk`,
`compliance`, `integrations`, `platform-admin`,
`financebot-central-scenario`); `.github/workflows/e2e.yml`.

**A real product gap this work surfaced, not fixed (non-negotiable #18 —
recorded, not silently patched into another module's code):** there is no
UI path anywhere in this codebase to create an `accounts` row for an
agent — they only ever arrive via an integration sync. This blocked a
pure-UI FinanceBot central-scenario spec; `seedFinanceBotAccess.ts` seeds
that one piece directly via the Supabase Admin API instead, mirroring the
shape `tests/access/financebot-scenario-and-tenant-isolation.sql` already
uses at the SQL level. Worth Access/Experience Agent's attention if a
"manually connect an account" flow is ever wanted as a P1/P2 story — not
raised as a bug against this pass, since manual account creation was never
an acceptance criterion of any existing Access Agent story.

**Verification:** `npm run typecheck` clean, `npm run lint` clean, `npx
vitest run` unaffected — 260/260, confirming zero collision between
Playwright's `*.spec.ts` naming and vitest's `*.test.ts` include glob.
`npm run build` (with `.next` deleted first) clean, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` no match. Every Playwright spec
was written against the actual source (page components, server actions,
the shared `Field`/`Table`/`ConfirmActionDialog` primitives, exact
migration schemas) rather than guessed selectors — including catching and
correcting, before commit, two selector-locality traps a naive read would
have missed: the campaign-launch page's `<details>` element whose
`<summary>` text collides with its own submit button's text, and
`ConfirmActionDialog`'s trigger and in-dialog confirm button sharing an
identical accessible name. **Not run live** — see the blocker note above;
first real execution is the CI workflow's first run once the 4 required
Supabase secrets are added to the repo (the user's own action, not
performed here).

Progress Tracker: `QA-P0-16` added (`Partial`); `QA-P0-06` and
`QA-P0-03.1` both updated to reference the new real browser coverage
without being marked `Done`, since neither has a confirmed live pass yet.

---

## 2026-09-16 (later) — QA-P0-16 taken as far as available credentials allow; live cross-module isolation proof added

The sandbox's Supabase egress blocker that this log, and every other module's,
recorded as a hard constraint is **gone** for HTTPS (see
`docs/design/foundation-agent-backlog-audit.md`'s entry of this date for the
full re-test, including what is still blocked: raw Postgres on 5432/6543).
So this pass retried everything that had been deferred to "when the network
allows it."

**Done, and passing: `tests/live-client-tenant-isolation.mjs` (new,
QA-owned).** Cross-module tenant isolation proven through two genuinely
authenticated Supabase JS client sessions over HTTPS rather than server-side
JWT simulation — all 44 tenant-scoped tables both directions, a fixture
reality check, foreign primary-key lookup, cross-tenant update/delete/insert,
a forged `audit_logs` insert, and an anon sweep. Every check passed. Details
and the `auth.users` seeding gotcha are in the Foundation entry.

**QA-P0-16 (Playwright E2E): the framework is now proven against a real
server, the suite itself is still not fully run — and the reason has changed
from "network" to "credentials."** What actually happened:

- Config gained three optional env hooks so the suite can target something
  other than a local build: `E2E_BASE_URL` (run against a deployment, skipping
  the local `webServer`), `E2E_BOOTSTRAP_URL` (visit a deployment-protection
  bypass link first so its cookie lands in the saved storage state),
  `E2E_SKIP_SEED=1` (fixtures seeded out of band, no service-role key in the
  process), and `E2E_CHROMIUM_PATH`/`E2E_CHROMIUM_ARGS`. All unset in normal
  local and CI runs, so nothing about the default path changed.
- Pointed at the **production** deployment (the only one with environment
  variables configured), the setup project reached the real app and **signed
  in for real through Supabase Auth** — `authenticate as platformAdmin`
  passed end to end, landing on `/onboarding` and saving storage state. That
  is the first time any part of this suite has executed against a live server.
- The four tenant-user logins failed, and the failure was **a genuine product
  bug, not a test defect** — `getTenantContext()` returning every colleague's
  membership row. Fixed (Foundation + Experience); see their audit logs.
- Re-running against a **preview** deployment of the fix is not possible: the
  Vercel project's Supabase environment variables are scoped to Production
  only, so every preview 500s with `Missing required environment variable:
  NEXT_PUBLIC_SUPABASE_URL` (confirmed in the deployment's runtime logs).
  That is a real deployment-configuration gap in its own right — every PR
  preview of this project is broken — and it is the user's Vercel setting to
  change, not a code fix.
- The CI path is equally blocked: both `E2E (Playwright)` workflow runs to
  date failed, and the job log shows all five secrets resolving **empty**
  (`NEXT_PUBLIC_SUPABASE_URL:` with no value, and the same for
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SECRET_ENCRYPTION_KEY`, `CRON_SECRET`). The repo secrets named in the
  previous entry still have not been added.

**Stop-and-report, per CLAUDE.md §4.** A complete run needs
`SUPABASE_SERVICE_ROLE_KEY` (and `SECRET_ENCRYPTION_KEY`) somewhere this
process can read them — as GitHub Actions repo secrets, as Vercel Preview
environment variables, or handed to a session directly. No key is inferable
from anything this environment can reach, and inventing a degraded substitute
(pointing the service-role client at the anon key) would produce confidently
wrong results, which is worse than an honest gap. `QA-P0-16` therefore stays
`Partial`, with its blocker restated accurately rather than left as the
now-false "network egress blocks the Supabase host."
