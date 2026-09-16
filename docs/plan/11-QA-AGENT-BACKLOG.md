# 11 — QA Agent Backlog

**Agent name:** `QA Agent`
**Module:** Final Integration, QA & Security Hardening
**Branch:** `module/qa`
**Status:** DORMANT — do not start until the user says "Run QA Agent". This agent
should generally be the **last** one run, after the other ten modules (or as many as
the user has chosen to build) have reached a stable state.

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
| QA-P0-01.1 | Repository & contract inventory | Done — `INTEGRATION_STATUS.md` §1, cross-referenced from every module's own Progress Tracker/audit log |
| QA-P0-01.2 | Route map & permission matrix | Done — `INTEGRATION_STATUS.md` §2; found and fixed a stale route-prefix drift in `docs/design/ownership-map.md` (Compliance/Runtime/Risk) |
| QA-P0-02.1 | Full cross-tenant sweep | Partial — DB/API/search/reports/jobs layers all verified live; `tests/operations/tenant-isolation.sql` and (2026-09-16) `tests/compliance/governance-attestation-tenant-isolation.sql` (new — closes `COMPLIANCE-P0-08`'s missing isolation test) both run live and passing; `platform_config_versions`/`platform_announcements` confirmed to have zero client-facing policies at all (no customer-session isolation test needed — no customer session can read them), see `INTEGRATION_STATUS.md` §3/§9 |
| QA-P0-02.2 | RBAC boundary sweep | Partial — orphaned-permission check clean (0 found); negative-permission proof is generic (the shared gate function itself), not per-permission-key enumerated; SSO JIT mapping unit-tested, real IdP round-trip unverified (sandbox) |
| QA-P0-02.3 | Platform-admin isolation sweep | Done — live smoke test against every current `/platform-admin/*` page and `/api/platform/v1/*` route, all correctly denied unauthenticated |
| QA-P0-03.1 | The FinanceBot acceptance scenario, executed live | Partial — 6 of 8 steps pass live against the real fixture; step 6 (remediation) honestly partial and step 7 (simulated removal + re-evaluation) not exercised end-to-end this pass, both for reasons already recorded in Risk Agent's own audit log — see `INTEGRATION_STATUS.md` §4 |
| QA-P0-04.1 | Pipeline sweep | Done — re-verified 2026-09-16: typecheck/lint/214 tests/cold-cache build all green repo-wide, `npm audit --production` 0 vulnerabilities, contrast-check all pairs pass both themes; see `INTEGRATION_STATUS.md` §9 |
| QA-P0-04.2 | Migration validation | Done — re-verified 2026-09-16: 56 migrations, no duplicate prefixes; found and fixed one real gap (`governance_attestations_agent_id_fkey` unindexed, migration `0056`), re-checked advisors clean; see `INTEGRATION_STATUS.md` §9 |
| QA-P0-04.3 | Responsive & performance spot-check | Partial — responsive not re-verified (sandbox); found a real, named, cross-module pagination gap (~22 unbounded `list*()` functions across 6 modules) — see `INTEGRATION_STATUS.md` §5 |
| QA-P0-04.4 | Regression fixes only, smallest safe change | Done — both fixes this pass were minimal, logged in Foundation's audit log, re-verified |
| QA-P0-05 | Clean install verification | Partial — lockfile/env-example present, cold-cache build verified; true from-scratch clone+install+fresh-DB not attempted this pass (sandbox/cost constraint) |
| QA-P0-06 | Authentication suite (SAML/OIDC/session) | Partial — role-mapping and session-expiry unit-tested; real IdP exchange, wrong-tenant/domain and logout paths not covered |
| QA-P0-07 | Connector contract tests | Partial — Generic REST connector partially covered across existing unit tests; not all 8 named properties independently tested per connector; Saviynt/MCP contract tests not built |
| QA-P0-08 | Runtime test corpus | Partial — live fixture data covers some categories incidentally; no versioned, explicitly-enumerated `tests/**` corpus covering all 6 named event categories exists as its own artifact |
| QA-P0-09 | SHOULD/CAN/DID reproducibility | Done — `compare.test.ts` directly asserts identical repeated output and evaluator-version stability |
| QA-P0-10 | Risk regression suite | Partial — 1 positive + 1 negative test exist, covering 3 of 8 categories; the full 5-kind × 8-category matrix is not built (deferred to Risk Agent's own further work, not duplicated here per non-negotiable #18) |
| QA-P0-11 | Certification regression | Partial — reviewer authorization/SoD live-verified, snapshot reproduction unit-tested; no dedicated escalation regression test or fast self-review unit test |
| QA-P0-12 | Security scanning | Partial — live advisor scan run, one real finding fixed (security-definer over-grant); `npm audit` now run (prod + full scope), 0 vulnerabilities either way; no static-analysis pass beyond ESLint, `auth_leaked_password_protection` still disabled (dashboard-only setting, flagged for follow-up) |
| QA-P0-13 | Failure recovery (retry/idempotency) | Partial — dedupe-key idempotency unit-tested; no end-to-end forced-failure-and-retry test built |
| QA-P0-14 | Observability sweep | Partial — schema-level correlation/status/timestamp fields confirmed present; no field-by-field checklist run against every async operation type |
| QA-P1-07 | Release record completeness standard | Not Started — `INTEGRATION_STATUS.md` does not currently record a commit/version identifier for the release snapshot, nor does it give an explicit P1/P2 status summary alongside its existing P0 detail |

---

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

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`11_INTEGRATION_QA_HARDENING.md`) that expands this module's P0/P1/P2 scope
beyond what was already tracked above. The new doc uses a flat numbering
scheme (`QA-P0-01`...`QA-P0-15`) that is unrelated to this backlog's existing
epic/story numbering (`QA-P0-01.1`, `QA-P0-02.1`, etc.) and happens to reuse
`QA-P0-01`–`QA-P0-04` for different content than this file's existing epics of
the same number — reconciliation below is by actual content, not by ID match.
Nothing already tracked was reopened or renumbered; new stories below are
given fresh sequential IDs (`QA-P0-05`–`QA-P0-14`) to avoid colliding with the
existing epic numbers, with each new story's source ID from the new doc noted
in parentheses.

### QA-P0-05 — Clean install verification (source: QA-P0-01)

Verify a clean checkout (no cached `node_modules`, no local `.env.local`
carried over from a prior run) can `npm install`, apply every module's
migrations to a fresh database, and `npm run build` successfully — proving the
repository doesn't secretly depend on some engineer's local machine state.
Distinct from QA-P0-04.1 (which re-runs the pipeline on the existing checkout
for cross-module drift): this story specifically exercises a from-scratch
environment. **Acceptance:** a documented from-scratch run (fresh clone, fresh
dependency install, fresh migration apply, production build) succeeds with no
manual undocumented steps.

### QA-P0-06 — Authentication suite (source: QA-P0-05)

Test SAML/OIDC success and failure paths, session expiry, logout, invalid
assertions/tokens, wrong tenant/domain, and unauthorized roles — beyond the
JIT-provisioning-only check already in QA-P0-02.2. **Acceptance:** each case
above has at least one automated test exercising Foundation's real
auth/session code paths (no UI-only mocking).

### QA-P0-07 — Connector contract tests (source: QA-P0-06)

For every connector Integration Agent has shipped by QA time: test
authentication, discovery, pagination, partial failure, retry, rate limiting,
idempotency, credential rotation, and source-record traceability.
**Acceptance:** each shipped connector has a passing contract-test suite
covering all eight properties above, or a documented gap if the connector
doesn't yet support one (e.g. no rotation support).

### QA-P0-08 — Runtime test corpus (source: QA-P0-07)

Maintain a deterministic fixture set of runtime events covering: an allowed
action, CAN-only excessive access (access exists but wasn't used),
DID-only unexpected behavior (used but not approved), unauthorized-resource
access, sensitive-data access, and unknown/unmappable events. **Acceptance:**
the fixture set exists under `tests/**`, is versioned, and is reused (not
re-authored per test) by QA-P0-09 and Risk Agent's own regression tests.

### QA-P0-09 — SHOULD/CAN/DID reproducibility (source: QA-P0-08)

Given an identical agent contract, effective-access snapshot, and runtime
event set, `compareShouldCanDid` must produce byte-identical output across
repeated runs, and that output must reference the specific
policy/evaluator version(s) used. **Acceptance:** a test re-runs the same
inputs twice (and once more after an unrelated code change) and asserts
identical SHOULD/CAN/DID results and stable version references.

### QA-P0-10 — Risk regression suite (source: QA-P0-09)

For every rogue/finding category Risk Agent implements: a positive test (the
condition fires), a negative test (it doesn't fire when it shouldn't), a
duplicate-event test (no duplicate finding from replayed/duplicate events), an
exception test (an approved exception suppresses the finding), and a
resolution test (finding resolves when the underlying condition clears).
**Acceptance:** each shipped risk category has all five test kinds passing.

### QA-P0-11 — Certification regression (source: QA-P0-10)

Test reviewer authorization (only assigned/eligible reviewers can decide),
self-review restrictions (an owner cannot certify their own agent's access
unless explicitly permitted), decision evidence capture, overdue-campaign
escalation, and that a historical certification snapshot reproduces the exact
Access/Approved/Used/Risk data it was decided against. **Acceptance:** each
of the five behaviors above has a passing test against Compliance Agent's
real certification flow.

### QA-P0-12 — Security scanning (source: QA-P0-11)

Enable (or document the chosen tool for) dependency vulnerability scanning,
secret scanning, static analysis where available, secure-HTTP-headers
checks, and production configuration validation (e.g. no debug flags,
no service-role key reachable client-side — extending FOUNDATION-P0-01.3's
bundle check). **Acceptance:** each scan type runs at least once against the
current codebase with results recorded in `INTEGRATION_STATUS.md`, and any
finding is triaged (fixed or explicitly accepted with rationale).

### QA-P0-13 — Failure recovery (source: QA-P0-12)

Prove that retrying a failed connector sync or failed job never produces
duplicate imported records or duplicate findings (idempotency holds under
retry), and that partial failures remain visible in the UI/status record
rather than silently succeeding or silently disappearing. **Acceptance:** a
test forces a mid-sync failure, retries, and asserts row counts and finding
counts are unchanged by the retry.

### QA-P0-14 — Observability sweep (source: QA-P0-13)

Verify every async operation (connector sync, runtime ingestion, risk
evaluation, certification campaign actions) already carries a correlation
ID, status, duration, tenant context, and a safe (non-leaking) error
classification, and that basic metrics are recorded — this is a verification
story against other modules' existing job/audit plumbing, not a new
observability system owned by QA. **Acceptance:** a checklist per async
operation type confirming these fields are present and populated in real
runs; gaps are logged against the owning module's audit log per
"smallest safe change," not fixed inside QA's own files.

### Already covered, no new row needed

- New doc's **QA-P0-02** (Type/Lint/Build Gate) — content-identical to
  existing **QA-P0-04.1** (Pipeline sweep: typecheck/lint/test/build across
  the repo). The new doc's "documented non-blocking baseline defect"
  exception is a minor clarification, not new scope.
- New doc's **QA-P0-03** (Tenant Isolation Suite: UI/API/RPC/DB/search/
  reports/exports/jobs/caches) — content-identical to existing **QA-P0-02.1**
  (Full cross-tenant sweep), which already enumerates the same surfaces.
- New doc's **QA-P0-04** (Platform Isolation Suite) — content-identical to
  existing **QA-P0-02.3** (Platform-admin isolation sweep).
- New doc's **QA-P0-14** (End-to-End Golden Scenario: Saviynt + FinanceBot +
  MCP) — content-identical to existing **QA-P0-03.1** (The FinanceBot
  acceptance scenario, executed live).
- New doc's **QA-P0-15** (Responsive UI Gate) — same core topic as existing
  **QA-P0-04.3** (Responsive & performance spot-check); the new doc adds more
  granular acceptance detail (long names/tags, empty states, dense tables,
  accessibility keyboard paths) which QA-P0-04.3's existing acceptance
  criteria already implicitly covers via "reuse Experience Agent's critical
  acceptance test path" — no new row, but note the expanded detail when
  executing that story.

No new database tables, API routes, or shared types are introduced by this
module's expanded P0 scope — every new story above is test/verification work
against other modules' existing or planned contracts, consistent with this
module owning no new domain tables (per "Owned entities" above). No
ownership-map addition is needed for this module's refresh.

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## P1 (do not build ahead of P0)

- **QA-P1-01 — Performance Baseline.** Define measurable targets for page
  load, API latency, search latency, sync throughput, and runtime event
  processing under representative tenant sizes.
- **QA-P1-02 — Load Testing.** Test large agent/access/event datasets,
  concurrent users, concurrent sync jobs, and burst runtime events.
- **QA-P1-03 — Chaos/Resilience.** Test database transient failure, connector
  outage, expired credentials, queue delay, duplicate webhook delivery, and
  partial upstream responses.
- **QA-P1-04 — Compatibility Matrix.** Validate supported browsers, IdPs,
  connector versions, and API versions.
- **QA-P1-05 — Migration Rehearsal.** Run migrations against production-like
  snapshots and verify rollback/recovery procedures for non-destructive
  migration failures.
- **QA-P1-06 — Security Penetration Readiness.** Prepare endpoint inventory,
  threat model, authorization matrix, test accounts, and evidence for
  external security testing.
- **QA-P1-07 — Release Record Completeness Standard.** The release record
  (`INTEGRATION_STATUS.md`) must explicitly carry a commit/version identifier
  for the snapshot it describes, and an explicit P0/P1/P2 status summary
  (not just P0 story-level detail), in addition to the migration status, test
  summary, known limitations, connector compatibility and security findings
  it already records — see Requirements Refresh (round 2) below.

## P2 (strategic, after P0/P1 proven)

- **QA-P2-01 — Continuous Synthetic Monitoring.** Periodically execute safe
  synthetic tenant workflows to detect broken auth, integrations, search, and
  critical UI paths.
- **QA-P2-02 — Automated Security Regression.** Run authorization/RLS/
  security suites continuously in CI for changed modules.
- **QA-P2-03 — Capacity Forecasting.** Track growth of tenants, agents,
  access edges, runtime events, and audit records, and recommend scaling
  thresholds.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded this module's requirements doc
(`11_INTEGRATION_QA_HARDENING.md`) in a newer/expanded form. Read in full
against the current backlog, `INTEGRATION_STATUS.md`, and both existing
audit-log entries (per this refresh's own dispatch instructions) to check for
anything not already reflected. The doc's structure is: a header/Purpose/
Engineering-rules block, the full original master PRD (§46–§55, matching
`CLAUDE.md` §9–§16 and this backlog's own Purpose/Ownership Boundary/Release
Gate content almost verbatim — no new scope there), then the same
"Expanded Requirements" flat list (`QA-P0-01`–`QA-P0-15`, `QA-P1-01`–`06`,
`QA-P2-01`–`03`) already fully reconciled by the first Requirements Refresh
pass above (mapped to `QA-P0-05`–`QA-P0-14`, or marked "already covered", or
copied verbatim into this file's own `## P1`/`## P2` sections) — re-checked
item by item this pass and confirmed still accurate, including specific
checks that were not obviously already covered:

- **"RPC" as a tenant-isolation surface** (doc's `QA-P0-03`, already mapped
  to `QA-P0-02.1`): grepped the whole codebase for `.rpc(` — only
  `create_tenant_with_owner` (an already-audited, intentionally
  `authenticated`-executable tenant-provisioning function) and the MCP
  connector's own JSON-RPC client method (a different, unrelated meaning of
  "RPC" — an outbound protocol call, not a Supabase database RPC). No
  untested Supabase RPC surface exists.
- **"Caches" as a tenant-isolation surface** (same story): grepped for
  cache/memoization patterns across `lib/`, `modules/`, `app/` — no
  in-memory or persisted cache exists anywhere in the codebase; reports and
  computed views are explicitly built and commented "never cached"
  (`modules/operations/reports.ts`, `app/(customer)/reports/page.tsx`).
  Nothing to isolation-test because the feature doesn't exist — not a gap.
- **"Secure headers checks"** (doc's `QA-P0-11`, mapped to `QA-P0-12`):
  confirmed `next.config.ts` (FOUNDATION-P0-05.3) sets
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and a `Content-Security-Policy` on every route. This
  wasn't itself called out in `INTEGRATION_STATUS.md` §7's `QA-P0-12`
  write-up, but it's a sub-detail of that already-`Partial` story (security
  scanning), not a new requirement — no new row added for it.

### QA-P1-07 — Release record completeness standard (source: doc's unlabeled
closing "Final release evidence" paragraph)

The one genuinely new item found this pass. After its `QA-P2-03` entry, the
doc adds a closing paragraph not present anywhere in the already-reconciled
flat list: *"The release record must include commit/version, migration
status, test summary, known limitations, connector compatibility and
security findings and explicit P0/P1/P2 status. Never mark a release
'production ready' when a mandatory P0 gate fails."* The "never mark
production ready" half is already covered by this backlog's own Release
Gate section. The rest names a specific checklist for what the release
record itself (`INTEGRATION_STATUS.md`, QA-owned per "Owned entities") must
contain — checked field by field against the current document:

| Required field | Present in `INTEGRATION_STATUS.md` today? |
|---|---|
| Migration status | Yes — §5 (QA-P0-04.2) |
| Test summary | Yes — §5 (QA-P0-04.1, 139/139) |
| Known limitations | Yes — throughout |
| Connector compatibility | Partially — §1's table notes Saviynt/MCP status inline; no dedicated section (the dedicated compatibility matrix is already tracked separately as `QA-P1-04`, not duplicated here) |
| Security findings | Yes — §5/§7 |
| Explicit P0 status | Yes — extensively, this is most of the document |
| **Commit/version identifier** | **No — not present anywhere in the document** |
| **Explicit P1/P2 status** | **No — the document only ever states P0 story status; P1/P2 items exist in each module's own backlog but the release record itself never summarizes where the platform stands against them** |

This was not caught by the first Requirements Refresh pass because that
pass's own summary of the doc's "Expanded Requirements" section stopped at
`QA-P2-03` — the closing paragraph sits outside the numbered list it was
reconciling and is easy to read past. It is real, scoped entirely to a file
QA already owns, and requires no new database table, route, or shared type.
Added to the Progress Tracker above as `QA-P1-07`, status Not Started, and to
`## P1` below. Classified P1 (enterprise readiness / release-process rigor)
rather than P0: it is a documentation-completeness requirement on the
release record's own contents, not itself a security or isolation gate: per
`CLAUDE.md` §3, "when genuinely unsure, prefer P1/P2 over P0."

### No other new items found

Every other requirement in the doc — including its full master-PRD
background sections (§46–§55) — is either already tracked by name in this
backlog (directly, via the first Requirements Refresh's mapping, or via
`INTEGRATION_STATUS.md`), or restates `CLAUDE.md`'s own binding sections
(§9 core model, §10 boundaries, §11 acceptance scenario, §12 Definition of
Done) without adding scope. None of this round's re-checks (RPC, caches,
secure headers, above) turned up a feature or test surface that doesn't
already exist or isn't already an accurately-tracked gap. The task's
"known existing tracked gaps" list (pagination, FinanceBot step 7,
`QA-P0-06`–`14` partial coverage, sandbox-only constraints) was not touched
or re-added.

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. This
was a documentation/planning reconciliation only — no code changed except
Identity Agent's own small Agent Discovery extension earlier the same day
(already covered by that module's own audit trail) and one new,
`Not Started` Identity tracker row (`IDENTITY-P0-06`, suspension
restoration path). Nothing new exists yet for QA Agent to test; the
document's larger open items (Governance Posture, Attestation, Exceptions,
Drift, Evidence Pack, AI-Assisted Investigation) are unresolved ownership/
architecture questions, not buildable stories, so no new acceptance
criteria were added here. Revisit once any of those land.

## DO NOT IMPLEMENT

- New product features of any kind — this module fixes and verifies, it does not
  extend scope.
- Sweeping refactors "while I'm in there" — every change here is the smallest safe
  fix for a specific, named defect.
