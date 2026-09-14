# 11 — QA Agent Backlog

**Agent name:** `QA Agent`
**Module:** Final Integration, QA & Security Hardening
**Branch:** `module/qa`
**Status:** DORMANT — do not start until the user says "Run QA Agent". This agent
should generally be the **last** one run, after the other ten modules (or as many as
the user has chosen to build) have reached a stable state.

## Dependencies

All modules 01–10. This agent reads and tests across all of them but does not own
their domain logic.

## Owned entities

None new. Owns repository-wide integration tests
(`tests/**`), regression fixes, and `INTEGRATION_STATUS.md`. If a domain defect must
be fixed, make the smallest safe change inside the owning module's existing files
and note it in that module's own audit log (not a QA-owned file) — QA does not
become a second architecture pass or a place to accumulate unowned code.

## Consumed entities

Everything, via each module's published contracts and routes — never a module's raw
internals, even for testing (call the API/service layer, not private table access
patterns other modules didn't intend to expose).

---

## Higher-bar stories

Every story in this backlog is inherently higher bar — this module's entire purpose
is verifying the security/isolation guarantees every other module claimed to
satisfy. Do not soften a failing test to make it pass; fix the underlying module (per
"smallest safe change," coordinating via that module's audit log) or report the gap
to the user.

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. This
agent is dormant; every story is Not Started until "Run QA Agent" is issued,
which should generally be last, per `docs/RUN_ORDER.md`.

| Story | Title | Status |
|---|---|---|
| QA-P0-01.1 | Repository & contract inventory | Not Started |
| QA-P0-01.2 | Route map & permission matrix | Not Started |
| QA-P0-02.1 | Full cross-tenant sweep | Not Started |
| QA-P0-02.2 | RBAC boundary sweep | Not Started |
| QA-P0-02.3 | Platform-admin isolation sweep | Not Started |
| QA-P0-03.1 | The FinanceBot acceptance scenario, executed live | Not Started |
| QA-P0-04.1 | Pipeline sweep | Not Started |
| QA-P0-04.2 | Migration validation | Not Started |
| QA-P0-04.3 | Responsive & performance spot-check | Not Started |
| QA-P0-04.4 | Regression fixes only, smallest safe change | Not Started |

---

## Epic QA-P0-01 — Cross-Module Integration Verification

### QA-P0-01.1 — Repository & contract inventory

Inspect all implemented module directories and their published
`lib/shared/types/*`/`modules/*/service.ts` contracts. Produce (or update)
`INTEGRATION_STATUS.md` listing: which modules are implemented, which P0 stories
within each are done vs. deferred (cross-reference each module's own audit log —
don't re-derive this from scratch), and which contracts are published vs. still
stubbed/missing.

### QA-P0-01.2 — Route map & permission matrix

Enumerate every `app/api/**/route.ts` and every `app/(customer)/**`/
`app/platform-admin/**` page, and for each: required permission (customer) or
`requirePlatformAdmin()` (platform), and which module owns it (cross-check against
`docs/design/ownership-map.md` — flag any route not accounted for there).

---

## Epic QA-P0-02 — Tenant Isolation & RBAC/SSO Hardening

### QA-P0-02.1 — Full cross-tenant sweep

Extend Foundation's tenant-isolation fixture (FOUNDATION-P0-07.1) to cover every
tenant-scoped table that exists across *all* implemented modules by the time QA
runs (not just Foundation's own tables). For each table: prove Tenant A cannot
read/write/enumerate Tenant B's rows via (a) direct Supabase client query, (b) every
API route that touches that table, (c) search (Operations Agent), (d) any
report/export path, and (e) any background/sync job path (Integration Agent).

### QA-P0-02.2 — RBAC boundary sweep

For each permission in Foundation's catalog, verify at least one negative test: a
user lacking that permission is denied by the corresponding API route(s). For SSO
(if implemented), verify JIT-provisioned users land in the correct tenant with the
correct mapped role and that a mismatched/unmapped claim does not silently default
to an elevated role.

### QA-P0-02.3 — Platform-admin isolation sweep

Re-run Foundation's platform-admin denial test (FOUNDATION-P0-06.2) against every
`/api/platform/v1/*` route and `/platform-admin/*` page that exists by QA time
(Platform Agent will have added more than Foundation's original set) — not just the
routes Foundation itself created.

---

## Epic QA-P0-03 — End-to-End Product Scenario

### QA-P0-03.1 — The FinanceBot acceptance scenario, executed live

Run the full scenario from `CLAUDE.md` §11 against a real (dev) environment, module
by module, and record pass/fail at each step:

1. Import FinanceBot identity/access from Saviynt (or a test double connector if the
   real Saviynt connector isn't available in this environment).
2. Register FinanceBot, assign owners, define the SAP/Snowflake financial-reporting
   contract.
3. Ingest the Snowflake→CustomerDB runtime event.
4. Verify `compareShouldCanDid` produces SHOULD=financial-only, CAN=financial+CustomerDB,
   DID=CustomerDB.
5. Verify a CRITICAL finding is generated with evidence and a recommendation.
6. Assign the finding; initiate remediation; confirm it reaches an
   access-request/removal path a human can action.
7. Simulate the access change (remove the entitlement) and verify re-evaluation
   resolves the finding.
8. Verify a certification campaign can present this agent's access with correct
   Access/Approved/Used/Risk/Recommendation columns.

Any step whose owning module isn't implemented yet is marked "not yet buildable" in
`INTEGRATION_STATUS.md`, not faked or skipped silently.

---

## Epic QA-P0-04 — Production Hardening

### QA-P0-04.1 — Pipeline sweep

Run typecheck, lint, full test suite, and a production build across the whole
repository (not per-module) — catches cross-module type drift a single module's own
pipeline wouldn't see.

### QA-P0-04.2 — Migration validation

Apply every module's migrations in order to a clean database and confirm no
conflicts, no missing RLS on any tenant-scoped table (a scripted check: every table
with a `tenant_id` column has `relrowsecurity = true` and at least one policy), and
no two modules claiming the same migration prefix.

### QA-P0-04.3 — Responsive & performance spot-check

Verify no layout overlap/clipping at desktop and mobile breakpoints on the core
navigated path (reuse Experience Agent's critical acceptance test path). Spot-check
that list/table endpoints paginate rather than returning unbounded result sets.

### QA-P0-04.4 — Regression fixes only, smallest safe change

Where this sweep finds a real defect, fix it with the minimal change inside the
owning module's own files, log it in that module's audit log (name the QA finding
that prompted it), and re-run the specific failing check. Do not use a QA finding as
license to refactor a module beyond the specific defect.

---

## Release Gate

Do not declare WonderAgent production-ready until tenant isolation, RBAC, SSO,
platform-admin isolation, agent lifecycle, Saviynt sync, MCP runtime ingestion,
effective access, SHOULD/CAN/DID, risk findings, certification, remediation,
audit/evidence, reports/search and responsive UI all pass their critical tests, and
`INTEGRATION_STATUS.md` reflects the true state (including any P1-deferred or
not-yet-buildable items) rather than an aspirational one.

## DO NOT IMPLEMENT

- New product features of any kind — this module fixes and verifies, it does not
  extend scope.
- Sweeping refactors "while I'm in there" — every change here is the smallest safe
  fix for a specific, named defect.
