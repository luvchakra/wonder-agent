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
