# Access Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — ACCESS-P0-01 through P0-02 (initial implementation)

**Agent:** Access Agent · **Branch:** `claude/wonderagent-setup-lasmly` (same
environment-pinned-branch deviation Foundation/Identity/Integration recorded).

**Built — full P0 backlog in one pass:**

- **ACCESS-P0-01.1** — `applications`/`accounts` (migration `0026`,
  client-facing tenant-scoped RLS, the manual-entry fallback path the
  backlog explicitly allows when Integration data isn't wired up),
  `entitlements`/`access_grants` (migration `0027`). **Deviation flagged
  up front, not silently decided**: the backlog's "Owned entities" list
  names `access_paths`, but ACCESS-P0-01.2's actual epic never defines a
  schema for it — `explainAccessPath()` is described purely as a computed
  function over the other tables. No `access_paths` table was created;
  `explainAccessPath()` is a pure read/join, matching the epic's literal
  content rather than inventing an unspecified materialization.
- **ACCESS-P0-01.2 (higher bar)** — `getEffectiveAccess()` and
  `explainAccessPath()` in `modules/access-governance/grants.ts`. Both
  read via `supabaseServer()` since `access_grants` grants a client-facing
  SELECT policy; only writes (`createManualAccessGrant`/
  `revokeAccessGrant`) go through the service-role client. **Security
  design decision, extending Identity's own precedent**: `access_grants`
  grants NO client-facing INSERT/UPDATE policy at all (migration `0027`'s
  comment) — this is the CAN evidence Risk Agent's core SHOULD-vs-CAN-vs-DID
  judgment depends on, and a forgeable grant would undermine the product's
  central security claim the same way a forgeable `agent_lifecycle_events`
  row would have for Identity. Same reasoning applied to
  `policy_evaluations` (migration `0030`) — evidentiary integrity for the
  policy engine's output.
- **ACCESS-P0-01.3** — `access_requests` (migration `0028`), plus four new
  Foundation permission-catalog rows (`access.read`, `access.request`,
  `access.approve`, `access.manage`) inserted via this module's own
  migration — per the story's explicit instruction ("add this permission
  key... via a migration note in the audit log") and Foundation's own
  migration comment inviting exactly this ("grow this list as other
  modules need new permissions"). No existing Foundation migration file
  was edited; this only adds new catalog rows. Same
  WITH-CHECK-pins-the-default pattern as Integration's
  `integration_sync_jobs`: a client may INSERT a request only in
  `status='pending'` with no decision fields populated — approval/
  rejection/fulfillment goes through `decideAccessRequest()`
  (service-role). Fulfillment does **not** auto-create an `access_grants`
  row, per non-negotiable #7/#15 — the customer's IAM remains system of
  record; the resulting grant is expected to arrive via the next
  Integration sync or a separate manual grant.
- **ACCESS-P0-02.1 (higher bar)** — `policies`/`policy_rules`/
  `policy_exceptions` (migration `0029`). `policies` uses ordinary
  tenant-scoped client RLS (admin-configured business data, same
  treatment as Foundation's `roles`); `policy_rules`/`policy_exceptions`
  have no `tenant_id` column of their own, so isolation is enforced via a
  join to `policies.tenant_id` — the same pattern Integration used for
  `integration_mappings`.
- **ACCESS-P0-02.2 (higher bar)** — `evaluateCondition()`
  (`modules/access-governance/conditions.ts`): a small, deliberately
  non-Turing-complete leaf/`all`/`any` condition-tree interpreter — no
  scripting engine, no LLM, per non-negotiable #9. `evaluatePolicies()`
  loads every active, in-scope policy, evaluates `abac`/`time` rule types
  against agent-level facts and `resource` rule types against each
  effective-access row, checks for a matching non-expired
  `policy_exceptions` row (→ `exempted` instead of `violation`), and
  writes one `policy_evaluations` row per policy. Both of the backlog's
  worked examples (PII+external_communication ABAC; PayrollDB resource
  rule) are covered by unit tests reproducing the exact conditions.
  **Known, documented limitation** (per the backlog's own instruction not
  to fabricate): `agent.external_communication` and
  `agent.days_since_last_certification` are always `undefined` in the
  facts object — no module models the former yet, and Compliance Agent
  (the latter's source) doesn't exist yet. `evaluateCondition()` treats an
  unknown field as "cannot evaluate" (returns `undefined`, never coerced
  to `false`), so a rule depending on either field never fires a false
  "pass" — it simply can't conclude a violation yet, which is the
  behavior the backlog asked for.
- **ACCESS-P0-02.3** — `checkSoD()` (`modules/access-governance/sod.ts`):
  a plain two-action conflict check, not a conflict-graph solver, per the
  backlog's explicit DO-NOT-IMPLEMENT. Reuses Foundation's own
  `audit_logs` as the "who did what" history rather than inventing a
  second tracking table — a `rule_type: 'rbac'` policy rule's `condition`
  is shaped `{ conflictingActions: string[] }`, and `checkSoD` looks for a
  prior audit entry by the same user against the same agent for any other
  action in that set. Advisory by default; blocking only if the owning
  policy's `action` is `'block'`. Not yet called by any consumer (Compliance
  Agent doesn't exist), but exported from the service contract for when it
  does.

**Verification run:**
- `npm run lint`, `npm run typecheck`, `npm run build` — all clean.
- `npm run test` — 34/34 passing across 7 files (new:
  `conditions.test.ts`, 9 cases covering every operator, `all`/`any`
  short-circuit and unknown-propagation semantics, and both of the
  backlog's worked examples verbatim).
- Live smoke test against a locally started production server: all five
  new pages (`/access`, `/access/requests`, `/access/agents/:id`,
  `/policies`, `/policies/:id`) correctly redirect to `/sign-in` when
  unauthenticated (learned from Integration Agent's earlier bug — checked
  proactively this time, no fix needed).
- **The module's critical acceptance test, executed live against the dev
  Supabase project** (via the Supabase MCP `execute_sql` tool — same
  network-egress constraint as every prior module): built the exact
  FinanceBot scenario (Snowflake account with both the approved
  `Financial_Reporting_READ` entitlement and the unapproved
  `CustomerDB_READ` entitlement) and ran the same join
  `getEffectiveAccess()`/`explainAccessPath()` perform. Result:
  effective access correctly returned `{CustomerDB_READ,
  Financial_Reporting_READ}` — CAN includes the unapproved entitlement,
  exactly as the scenario requires — and the explained path reproduced
  the full chain (account → grant → entitlement → application →
  data classification) matching the backlog's worked JSON example
  structurally. Tenant isolation and forgery-rejection were proven in the
  same run: cross-tenant reads/updates returned nothing/0 rows, and
  same-tenant forgery attempts against `access_grants`, `access_requests`
  (pre-set to `'approved'`), and `policy_evaluations` were all rejected by
  RLS. Fixture data deleted afterward; script committed at
  `tests/access/financebot-scenario-and-tenant-isolation.sql`.
  `get_advisors` (security and performance) clean beyond the same
  previously-reviewed exceptions every prior module already accepted.

**Not started this session:** nothing in the P0 backlog was skipped.
ACCESS-P0-02.2's two unknown-field gaps (external_communication,
certification age) are inherent to modules that don't exist yet, not
deferred work within this module's own scope.

**Dependencies consumed:** Foundation's `requirePermission()`,
`writeAudit()`, `supabaseServer()`/`supabaseServiceRole()`; Identity's
`getAgent()` (via `modules/agent-identity/service`) for policy-evaluation
facts — all used exactly as published, no modification to any Foundation
or Identity file beyond the new Foundation permission-catalog rows
described above (which is data, not schema).

**Published this session, for Runtime/Risk/Compliance/Experience to
consume once dispatched:** `modules/access-governance/service.ts` (barrel)
and `lib/shared/types/access-governance.ts`. Most relevant to near-term
dependents: `getEffectiveAccess()`/`explainAccessPath()` are what Runtime
Agent's SHOULD-vs-CAN-vs-DID comparison and Risk Agent's excessive-access
detection both need; `evaluatePolicies()`'s output (`policy_evaluations`
rows) is the evidence Risk Agent turns into findings — Access Agent
deliberately never assigns a severity or creates a finding itself, per
its own DO-NOT-IMPLEMENT list.

---

## 2026-09-14 — ACCESS-P0-03 (Access Graph), ACCESS-P0-04 (Contract Comparison), ACCESS-P0-05 (Policy Versioning)

**Agent:** Access Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Auto-chained after Integration Agent's own P0 completion, per the user's
"operate like before, focus on P0 only, continue automatically"
instruction. All three of this module's new requirements-refresh stories.

### ACCESS-P0-03 — Access Graph

`modules/access-governance/graph.ts` — `getAccessGraph(tenantId, agentId)`.
A pure *view* over `getEffectiveAccess()`'s already-canonical data plus a
fresh accounts/applications query for node construction — no new table,
reaffirming ACCESS-P0-01.1's original decision not to materialize
`access_paths`. Returns `{nodes, edges, rows}`: nodes typed
agent/account/entitlement/application; edges carry the real `GrantType`
(direct/inherited/group/role/delegated/token_scope/oauth_scope/api_scope/
mcp_tool_permission/service_account_relationship) plus `has_account`/
`belongs_to` structural edges; `rows` is the same flat `AccessGrant[]`
`getEffectiveAccess()` already returns, for non-graph consumers. New route:
`GET /api/v1/access/agents/:agentId/graph`.

### ACCESS-P0-04 — Contract Comparison (also covers ACCESS-P0-10)

`modules/access-governance/comparison.ts` —
`compareAccessToContract(tenantId, agentId)`, classifying every effective-
access row as `approved`/`excessive`/`missing`/`unknown` against Identity's
active Agent Contract, each row carrying `sourceIntegrationId`, the
`explainAccessPath()` chain, `lastSyncedAt` and `agentContractId`
(ACCESS-P0-10's traceability requirement, folded in as the new doc's own
Requirements Refresh section instructed). Distinct from `evaluatePolicies()`
(rule-based, not a raw diff) and from Runtime Agent's future
`compareShouldCanDid()` (adds DID; this function never touches runtime
data). Access Agent still never writes a `risk_findings` row itself.

**A real correctness issue caught before committing, not after:** the
first implementation classified purely at the *application* level (any
grant on an approved application → `approved`). Manually tracing it against
the live FinanceBot fixture's actual data (queried via Supabase MCP —
`approvedApplications: ["SAP","Snowflake"]`, `approvedData: ["financial
reporting"]`, and real grants `Financial_Reporting_READ` (financial),
`CustomerDB_READ` (pii), `SAP_READ` (financial)) showed this would call
`CustomerDB_READ` "approved" — exactly backwards from CLAUDE.md §11's
central acceptance scenario ("SHOULD = financial data only, CAN = financial
data + CustomerDB", i.e. CustomerDB is supposed to be the *excessive* one).
Fixed by making approval data-classification-scoped, not merely
application-scoped: an entitlement is `approved` only if its application is
approved **and** (the contract declares no `approvedData` restriction at
all, or the entitlement's `data_classification` overlaps at least one
`approvedData` term via the same substring heuristic Runtime Agent's
`classificationsCompatible()` uses, reimplemented independently here since
that function isn't published via `modules/runtime-assurance/service.ts` —
flagged, not silently assumed identical). The classification logic was
extracted into a pure, exported `classifyAccessGrant()` specifically so
this exact fixture scenario could be unit-tested directly
(`comparison.test.ts`) rather than only exercised indirectly.

### ACCESS-P0-05 — Policy Versioning, Priority & Change History

Migration `0042`: `policies.version`/`policies.priority` (both `not null
default`), an append-only `policy_versions` history table (client-facing
SELECT+INSERT only — no UPDATE/DELETE policy at all, so history can be
added but never rewritten, live-verified), and
`policy_evaluations.policy_version`. New `updatePolicy()` (`policies.ts`)
snapshots the full prior row into `policy_versions` before applying a
patch and bumps `version`; runs as the calling user (not service-role) —
`policies` already had a client-facing UPDATE policy from
ACCESS-P0-02.1, so this is a normal RLS write, not a new privileged path.
`evaluatePolicies()` now stamps `policy_version: policy.version` on every
inserted `policy_evaluations` row, closing part of ACCESS-P0-02.2's
`Partial` reproducibility gap (a stored evaluation is now traceable to the
exact rule-set version that produced it) — ACCESS-P0-02.2 itself is left
`Partial` as before, since this alone doesn't close every gap that story
documented. New routes: `PATCH /api/v1/policies/:id`,
`GET /api/v1/policies/:id/versions`.

**Verified live** (Supabase MCP, FinanceBot fixture tenants): created a
throwaway policy in Tenant A5, ran the exact `updatePolicy()` write
sequence (insert into `policy_versions`, then update `policies` with
`version = 2`) as the Tenant A5 authenticated user — succeeded; Tenant A5
sees its own version history (1 row), Tenant B5 sees zero; a direct client
UPDATE against `policy_versions` (attempting to tamper with history)
affects 0 rows, since no UPDATE policy exists. Cleaned up the throwaway
policy afterward (cascade-deleted its version row).

**Verification run**: `npm run typecheck`/`lint`/`build` clean, `npx
vitest run` — 106/106 passing (17 new: 5 `classificationsOverlap` +
7 `classifyAccessGrant` including the exact fixture-reproducing case).
`get_advisors(security)` re-checked after migration `0042` — identical
accepted-exception set, no new WARN/ERROR.

**Not done, flagged rather than silently assumed**: `getAccessGraph()`/
`compareAccessToContract()` were not exercised through a live authenticated
HTTP request (same real-browser-session constraint this whole session has
worked around) — verified via `npm run build`'s route generation plus the
fixture-data-driven unit tests above, which is what actually caught and
fixed the classification bug; a full end-to-end request-level check
remains open for a future QA Agent pass.

## 2026-09-14 — ACCESS-P0-02.2: `agent.days_since_last_certification` resolved

**Agent:** Access Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Picked up as part of a full sweep of every module's Partial/Deferred
items, starting from the first agent in run order.

Compliance Agent's `getCertificationHistory(tenantId, agentId)`
(`modules/certification-compliance/decisions.ts`) is a real published
contract — its own comment explicitly names Access/Identity/Risk as
intended consumers — returning every decided certification item for an
agent, most recent first, each carrying `decidedAt`. `evaluatePolicies()`
now calls it and computes `agent.days_since_last_certification` as whole
days since the most recent decision; an agent with zero certification
history stays `undefined` (unknown, never guessed as 0 or Infinity),
same "cannot evaluate" semantics `evaluateCondition()` already applies to
every other unknown fact.

**Architectural note, checked deliberately, not glossed over:** this
creates a two-file cycle in the module import graph —
`certification-compliance/decisions.ts` already imports
`revokeAccessGrant` from `access-governance/service.ts`, and
`access-governance/evaluate.ts` now imports `getCertificationHistory`
from `certification-compliance/decisions.ts`. Both call sites invoke the
imported function only inside an `async function` body, never at module
top level, so the cycle resolves safely under Node/Next.js ESM (no
"cannot access before initialization" risk) — confirmed, not assumed: a
full cold-cache `npm run build` (`.next` deleted first) completed with no
errors. Access (CAN/policy) referencing a fact that only exists after
Certification runs is an intentional case where the layered SHOULD → CAN
→ DID → Risk → Certification model (CLAUDE.md §9) still needs a read-back
edge for one ABAC condition — the PRD's own worked example
(`agent.days_since_last_certification > 90`) treats certification
recency as a policy input, which only Compliance's data can supply. The
import goes through Compliance's own published contract, never its
internals, per non-negotiable #6.

**`agent.external_communication` deliberately NOT resolved** — checked
first, not skipped: grepped the entire schema and every module's shared
types for any "external"-facing concept and found none. This isn't a
missing contract from an otherwise-existing module (unlike
`days_since_last_certification` above); it would require inventing a new
boolean field on either Identity's `agents` table or Access's own
`applications` table, with no existing product decision on what it means
(external network communication? data egress? a specific integration
type?) or which module should own it. Per CLAUDE.md §3 ("if unsure
whether something is a required extension point or genuine scope creep,
treat it as scope creep and stop"), this stays `undefined` and open for
the user to decide, not guessed.

**Verified:** `npm run typecheck`, `npm run lint`, `npx vitest run`
(139/139, unchanged — no existing unit test asserted the old
always-`undefined` behavior, so nothing needed updating), `npm run
build` with `.next` deleted first (specifically to prove the cyclic
import resolves cleanly) — all green. `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` — no match.

## 2026-09-14 — RUNTIME-P0-13's dependency note resolved: `getEffectiveAccessAsOf()`

**Agent:** Access Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Runtime Agent's own backlog explicitly recorded a dependency note asking
Access Agent to publish a point-in-time effective-access contract, per
non-negotiable #18 ("if Access Agent's backlog does not already plan
this, that should be raised with the user rather than guessed at"). No
guessing was needed: `access_grants` already carries `granted_at`/
`revoked_at`, and `revokeAccessGrant()` (this module) has always
soft-deleted via `revoked_at`, never hard-deleted a row — the historical
data already exists, it just had no read contract over it.

Added `getEffectiveAccessAsOf(tenantId, agentId, asOf)` to
`modules/access-governance/grants.ts` (exported from `service.ts`),
sharing its row-mapping logic with the existing `getEffectiveAccess()`
via a new private `queryEffectiveAccess()` helper — same shape, same
`AccessGrant[]` return type, differing only in the WHERE clause: `revoked_at
is null` for "now" vs. `granted_at <= asOf and (revoked_at is null or
revoked_at > asOf)` for a specific point in time. `getEffectiveAccess()`
itself is unchanged behavior (delegates to the same helper with `asOf =
null`).

**Verified:** `npm run typecheck`, `npm run lint`, `npx vitest run`
(141/141 — see Runtime Agent's own audit log for the 2 new tests this
enabled there), `npm run build` with `.next` deleted first, `grep -rl
SUPABASE_SERVICE_ROLE_KEY .next/static` (no match) — all green.

## 2026-09-14 — Round-2 requirements re-check (expanded doc re-upload): no new content found

**Agent:** Access Agent (documentation-only pass, no code/migration/test
changes). Requested re-check of this module's backlog against a freshly
re-uploaded copy of the module requirements doc
(`04_ACCESS_GOVERNANCE.md`), on the premise that it might be a newer/
expanded version containing detail not present at the time of the first
2026-09-14 refresh (see "Requirements Refresh — 2026-09-14" in
`docs/plan/04-ACCESS-AGENT-BACKLOG.md`).

**Method, not assumption:** rather than trust the "newer/expanded" framing
at face value, the re-uploaded doc was diffed line-for-line against (a)
the "Original Master PRD Requirements" text already embedded verbatim in
the backlog (sections 11/18/19/28 — Effective Access Graph, Policy
Management, Policy Evaluation, Segregation of Duties) and (b) the
"Expanded Requirements — Access Governance P0/P1/P2" list
(`ACCESS-P0-01` through `ACCESS-P2-03`) that the existing "Requirements
Refresh — 2026-09-14" section already reconciled item-by-item.

**Finding: no genuinely new requirement, story, or acceptance criterion.**
The re-uploaded doc's substantive content — sections 11/18/19/28 and the
full `ACCESS-P0-01`..`ACCESS-P2-03` expanded list — is textually identical
(confirmed via `diff`, not skimming) to what the first 2026-09-14 refresh
already reconciled: every ID from `ACCESS-P0-01` through `ACCESS-P2-03` in
the re-uploaded doc is either (a) already mapped onto a `Done` epic story
in the "Already covered, no new tracker row needed" list, (b) already
added as its own tracker row (`ACCESS-P0-03`, `ACCESS-P0-04`,
`ACCESS-P0-05` — all now `Done` per the Progress Tracker, consistent with
this file's own entries above for those stories, plus the follow-on
`getEffectiveAccessAsOf()` entry), or (c) already named by ID in the `##
P1`/`## P2` sections (`ACCESS-P1-02`, `ACCESS-P1-03`, `ACCESS-P1-04`,
`ACCESS-P2-01`, `ACCESS-P2-02`, `ACCESS-P2-03`) or described in the P1
section's lead prose (`ACCESS-P1-01` — access simulation — present as "what
would happen if we changed policy X", just not ID-tagged there). The doc's
own front matter (Purpose, Shared Product Contract, Engineering rules,
Module Ownership Boundary, Dependencies, Definition of Done) is the same
standalone-execution-brief boilerplate already reflected in the backlog's
own header/Dependencies/Definition-of-Done sections and CLAUDE.md itself —
process scaffolding, not a product requirement.

One sub-word-level difference was noted and deliberately **not** turned
into a new row: the doc's `ACCESS-P1-02` (Advanced ABAC) example attribute
list includes "owner" (`environment, data classification, geography, time,
owner and agent type`), while the backlog's existing P1 paraphrase omits
it. This is an example attribute inside an already-tracked story
(`ACCESS-P1-02` already exists), not a new story or a materially different
acceptance criterion — noted here rather than silently dropped, but not
promoted to a tracker row per the task's "do not re-add anything already
tracked, even if worded slightly differently" instruction.

**No Progress Tracker changes made** (no row added, no existing row's
status touched) and **no new dated "round 2" reconciliation narrative was
needed beyond a short pointer**, since there was nothing to reconcile — see
the short "Requirements Refresh — 2026-09-14 (round 2, expanded doc)"
section added at the bottom of `docs/plan/04-ACCESS-AGENT-BACKLOG.md`
recording this same conclusion for anyone reading the backlog directly.

**Codebase sanity-check (per the task's step 3):** confirmed live in
`modules/access-governance/` and `supabase/migrations/` that
`ACCESS-P0-03`/`ACCESS-P0-04`/`ACCESS-P0-05` are in fact implemented
(`graph.ts`, `comparison.ts`, migration `0042_access_policy_versioning.sql`)
and the Progress Tracker already correctly shows them `Done` — no
tracker/reality mismatch found for those. `getEffectiveAccessAsOf()`
(`grants.ts`, recorded above under the 2026-09-14 RUNTIME-P0-13 entry) is
also live but is a dependency-contract addition rather than its own
`ACCESS-P#-xx` story, consistent with how it was previously logged.

No code, migration, or test files were changed in this pass — documentation
only, per the task's explicit scope.

---

## 2026-09-15 — ACCESS-P0-07: Broaden `policy_exceptions` (built)

**Agent:** Access Agent.

**Task:** continuing "start on p0 items" now that the user resolved the
Governance Exceptions consolidation question via `AskUserQuestion`
("broaden Access's `policy_exceptions`").

**Built:** migration `0053_access_governance_exception_model.sql`. Added a
real `tenant_id` column (backfilled from the joined `policies` row, then
set `NOT NULL`) since exceptions no longer always reference a policy —
isolation previously depended entirely on a join through
`policies.tenant_id`, which can't work for a `scope_type` other than
`'policy'`. Made `policy_id` nullable, added `scope_type` (`policy` /
`attestation` / `certification` / `control_mapping` /
`contract_requirement`) + `scope_id`, `business_justification`,
`compensating_control`, `residual_risk`, `status` (`active`/`revoked`),
`start_date`. A CHECK constraint (`scope_type <> 'policy' or policy_id is
not null`) keeps the existing policy-scoped path's data integrity. RLS
policies rebuilt on `tenant_id` directly (simpler and correct for
non-policy scopes) — still no client UPDATE policy; revocation is a new
service-role function (`revokeException()`) with a manual tenant check,
matching this codebase's pattern for every other integrity-sensitive
write.

`modules/access-governance/policies.ts`: `addPolicyException()` now takes
`tenantId` and a structured input object (existing callers updated, not
left broken); new `createGovernanceException()` (the general, any-scope-
type entry point other modules will call once they have a real exception
to record — e.g. Compliance's planned `CERT-P1-04`), `listGovernanceExceptions()`
(filterable by scope), and `revokeException()`. `lib/shared/types/access-
governance.ts`'s `PolicyException` gained every new field.
`app/api/v1/policies/[id]/exceptions/route.ts` and a new
`addPolicyExceptionAction`/`revokeExceptionAction` pair in
`app/actions/access.ts` wired through. UI: the policy detail page's
Exceptions card now shows status/residual-risk/justification/compensating-
control and a real "Add exception"/"Revoke" flow (previously read-only
display with no add form at all — this closes that gap too, not just the
schema).

**Deliberately not built here:** the full async request/approval/expiry/
renewal workflow remains `ACCESS-P1-04`, correctly un-promoted — every
exception here still requires an approver at creation time (P0's existing
"minimal, manually-approved" scope, unchanged). Compliance Agent's own
`CERT-P1-04` story (referencing this table) is that module's to build, not
started here.

**Verified:** `npx tsc --noEmit` clean; `npx eslint .` clean; `npx vitest
run` — 148/148 passing (unchanged, no new pure-function surface); `npm run
build` succeeds. Migration applied to the live dev Supabase project via the
Supabase MCP tool; `get_advisors(security)` re-checked — no new findings,
same accepted-exception set as before.

---

## 2026-09-15 — ACCESS-P0-06: Action Governance 4-state enforcement (built)

**Agent:** Access Agent.

**Task:** the Access-half of the resolved Human Oversight / Autonomy Model
decision ("Identity + Access"), now that `IDENTITY-P0-07` (the contract
fields this reads) is built.

**Built:** `modules/access-governance/actionGovernance.ts` — a pure,
deterministic `classifyAction(contract, action)` (prohibited beats
requires-approval beats approved; anything the contract never mentions
defaults to `restricted`, never silently `allowed` — an unmentioned action
was never authorized) and `classifyActionsForAgent(agentId, actions?)`,
which fetches the agent's active contract and classifies either a supplied
action list or, when omitted, every action the contract itself names.
`lib/shared/types/access-governance.ts` gained `ActionGovernanceState`
(`allowed`/`allowed_with_approval`/`restricted`/`prohibited`) and
`ActionGovernanceResult`. Exposed via `GET /api/v1/access/agents/:agentId/
action-governance?actions=a,b,c`. No migration needed — reads
`IDENTITY-P0-07`'s already-shipped `agent_contracts` columns only, through
Identity's published `getAgentContract()` contract (never queries
`agent_contracts` directly — non-negotiable #6).

**Deliberately not built here:** this is classification, not enforcement in
the "block the call" sense — the governance requirements doc itself scopes
"full real-time enforcement gateway" to P1, and this codebase has no
runtime interception point to enforce against yet (Product Boundary #6:
WonderAgent is not a PAM/enforcement gateway). No UI was added either —
`ACCESS-P0-04`'s own `compareAccessToContract()` API (built 2026-09-14) has
the same characteristic (API-complete, no consuming UI page yet); Experience
Agent owns surfacing both, not this story.

**Verified:** `npx tsc --noEmit` clean; `npx eslint .` clean; `npx vitest
run` — 154/154 passing (6 new: allowed/allowed-with-approval/prohibited/
default-restricted/case-insensitivity/prohibited-beats-approved-when-
contradictory); `npm run build` succeeds. No migration, no advisory
re-check needed (no schema touched).

---

## 2026-09-16 — pagination pass (QA-P0-04.3 follow-up, user-prioritized "what's left before launch")

Capped 5 previously-unbounded queries with the new shared
`DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`, 200): `applications.ts`'s
`listApplications()`, `policies.ts`'s `listPolicies()` and
`listGovernanceExceptions()`, `evaluate.ts`'s `listPolicyEvaluations()`
(ordered `evaluated_at desc` — the existing-violation check
`evaluateAgentRisk()` runs against it stays correct: the most recent
evaluations are exactly what a "most recent 200" cap keeps), `requests.ts`'s
`listAccessRequests()`. Per-parent child-record lookups
(`listAccountsForAgent`, `listEntitlementsForApplication`,
`listPolicyVersions`, `listPolicyRules`, `listPolicyExceptions(policyId)`)
were judged genuinely bounded and left untouched, same reasoning as
Identity's equivalent per-agent lookups.

Verification covered as part of the full cross-module pass — see
`INTEGRATION_STATUS.md` §5's update note for the shared pipeline run.

---

## 2026-09-16 — ACCESS-P0-02.2 fully resolved: applications.is_external

Previously `Partial`: `agent.external_communication` had no owning
concept anywhere in the codebase — not a missing cross-module contract,
a genuinely undecided new field/owner. Resolved via `AskUserQuestion` as
part of the user's "any P0 item open to work?" pass: modeled as an
application-level attribute, `applications.is_external` (migration
`0059`, plain boolean column, default `false`, no RLS change needed —
same client-facing policies as every other column on that table).

**Built:**
- `applications.is_external` — settable at creation via `createApplication()`'s
  new optional parameter, surfaced as a checkbox on `/access`'s "Add an
  application" form and a new "External" column on `ApplicationsTable`.
  No `updateApplication()` exists yet in this codebase (out of scope to
  add here) so an existing application's flag can't be edited after
  creation — a real, small, documented limitation, not silently glossed
  over.
- `lib/shared/types/access-governance.ts`'s `Application` type and
  `mappers.ts`'s `toApplication()` carry the new field.
- Risk's `evaluateAgentRisk()` (`modules/risk/rules.ts`) now fetches
  `listApplications(tenantId)` alongside its other parallel reads, builds
  a lowercase name set of external applications, and triggers the
  "External communication capability" factor when any of the agent's CAN
  entries touch one — a capability check (CAN), matching the sibling
  "Production environment access" factor's own CAN-based shape rather
  than a DID/actual-usage one.

**Verification:** `modules/risk/rules.test.ts` gained 2 new tests (the
factor fires when CAN touches an external app; stays silent when it only
touches non-external ones), plus the mock for
`@/modules/access-governance/service` extended with `listApplications`.
Full pipeline: `npm run typecheck` clean, `npm run lint` clean, `npx
vitest run` 234/234 (up from 232), migration applied live to the dev
Supabase project. No new RLS finding (column addition to an
already-policied table).

---

## 2026-09-16 — published request_type + getAccessGrant()/getEntitlement() (unblocks COMPLIANCE-P0-01.3)

Small, paired addition — the story is tracked under Compliance's own
backlog as `COMPLIANCE-P0-01.3`; full account in that module's audit log.
`access_requests` gained a `request_type` column (migration `0060`,
`'grant'`/`'modify'`, defaulting to `'grant'` — fully backward compatible
with every existing row and caller). `createAccessRequest()` gained an
optional `requestType` parameter (default `'grant'`). Two new published
lookups so a consuming module can resolve a grant's entitlement/
application without querying Access's own tables directly
(non-negotiable #6): `getAccessGrant(tenantId, grantId)` and
`getEntitlement(tenantId, entitlementId)`, both exported from
`modules/access-governance/service.ts`.

**Verification:** full pipeline (typecheck/lint/`npx vitest run` 239/239/
build/secret-leak check) run as part of Compliance's own pass — see that
module's audit log entry for the complete record. Migration applied live;
no RLS policy change (the column has a default, and `access_requests`'
existing client-facing INSERT policy already constrains every column it
cares about — `status`/`decided_by`/`decided_at` — unaffected by this
addition).

---

## 2026-09-16 — published hasOpenPolicyViolation() (unblocks COMPLIANCE-P0-02.2); agent.external_communication resolved

Small, paired addition — the story is tracked under Compliance's own
backlog as `COMPLIANCE-P0-02.2`; full account in that module's audit log.
`hasOpenPolicyViolation(tenantId, policyId)` published from
`modules/access-governance/evaluate.ts`, exported via `service.ts`.

Also resolved in the same file, using the `applications.is_external` data
`ACCESS-P0-02.2` added earlier the same day:
`evaluatePolicies()`'s `agentFacts["agent.external_communication"]` fact
— previously always `undefined`, silently untestable by any policy rule
condition — now computed from whether the agent's effective access
touches any external-marked application. This is a distinct use from
Risk's own scoring factor (same underlying flag, different consumer:
Access's deterministic policy-rule engine vs. Risk's weighted score).

**Verification:** full pipeline (typecheck/lint/`npx vitest run` 248/248/
build/secret-leak check) run as part of Compliance's own pass — see that
module's audit log entry for the complete record.

## 2026-09-16 — AccessGrant.applicationId / privilegeLevel published (unblocks COMPLIANCE-P0-01.2's 4 remaining scope types)

Small, paired addition — the consuming story is tracked under Compliance's
own backlog as `COMPLIANCE-P0-01.2`; full account in that module's audit
log. `AccessGrant`'s existing denormalized-at-read-time field set
(`application`, `entitlementName`, `dataClassification`) is extended with
two more fields from the same `entitlements` join, populated by
`getEffectiveAccess()`/`getEffectiveAccessAsOf()`/`getAccessGrant()` in
`modules/access-governance/grants.ts`: `applicationId` (so a caller can
filter grants to one specific application without a second lookup by
name) and `privilegeLevel` (`standard`/`elevated`/`admin`, so a caller can
identify privileged access without re-deriving it). Neither is a new
persisted column — both are joined at read time exactly like the
pre-existing denormalized fields.

**Verification:** full pipeline (typecheck/lint/`npx vitest run` 255/255/
build/secret-leak check) run as part of Compliance's own pass — see that
module's audit log entry for the complete record. No schema/migration
change, no RLS change.

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

## 2026-09-19 — Tenant-wide entitlement read published for Operations' global search

Same cross-module dependency as Identity Agent's matching entry today
(`docs/design/identity-agent-backlog-audit.md`): Operations' `search()`
names "entitlement" as one of the nine named object types, but
`listEntitlementsForApplication(tenantId, applicationId)` was the only
read this module published, scoped to one application (the entitlement-
management UI's own need).

**Published `listEntitlementsForTenant(tenantId)`**
(`modules/access-governance/entitlements.ts`) — same RLS-protected
`entitlements` table, no `application_id` filter. Embeds
`applications(name)` via the real FK so a search result gets a
human-readable subtitle without Operations querying `applications`
itself (non-negotiable #6); the returned `EntitlementWithContext` type is
`Entitlement` plus exactly that one extra field. Exported from
`modules/access-governance/service.ts` alongside the existing
application-scoped function, unchanged.

**Verified:** typecheck, lint clean (same narrowed-row-type fix as
Identity's two functions, not `any`). No dedicated unit test in this
module (matches this module's existing pattern for thin query wrappers)
— covered by `modules/operations/search.test.ts`'s new tests. `npm run
build` clean. No schema/migration change.

## 2026-09-19 (later) — OPERATIONS-P0-02.2: lifecycle_expiry wired

The third of Operations' three previously-unwired notification triggers
(see `docs/design/identity-agent-backlog-audit.md`'s matching entry for
`certification_due`/`ownership_missing`, picked up in the same pass at
the user's explicit direction to pick reasonable, clearly-documented
defaults rather than leave these unbuilt).

**Interpreted `lifecycle_expiry`** as: a governance exception
(`policy_exceptions`) whose `expires_at` has passed while it is still
`status: 'active'` — i.e. a temporary allowance in an agent's access
lifecycle whose own lifecycle has ended, but nobody has revoked or
renewed it. This is a genuine judgment call, recorded explicitly rather
than assumed: `policies.expiry_date` (the *policy's* own scheduled
expiry) was the other real candidate in this schema, but "lifecycle" in
this codebase's own vocabulary ties to an *agent's* governance state
(SHOULD/CAN/DID, `AgentLifecycleState`), which an agent-scoped exception
expiring matches more literally than a tenant-wide policy expiring.

**Unlike the other two triggers, this one genuinely has no discrete
write event to hook** — an `expires_at` timestamp elapsing is a passive
condition nobody writes anything when it happens. Built
`sendExpiredExceptionReminders(tenantId)` /
`sendExpiredExceptionRemindersForAllTenants()`
(`modules/access-governance/policies.ts`), the same isolate-per-tenant-
failure shape as Compliance's `escalateOverdueItemsForAllTenants()`, and
a new cron entry point (`app/api/cron/access-exception-expiry-
reminders/route.ts`, added to `vercel.json`'s `crons` array alongside
the existing `compliance-escalate-overdue` job — same bearer-secret
auth pattern, scheduled at 07:00 UTC, staggered an hour after the
existing 06:00 job). Deduped via a new shared
`wasRecentlyNotified(tenantId, type, referenceId, withinDays)` helper
(Operations Agent's own audit log has the full detail) with a 7-day
window — my own judgment call on cadence, flagged as such rather than
silently picked: frequent enough that an unactioned expiry doesn't go
unmentioned for weeks, infrequent enough not to read as spam. Targeted
at the exception's `approvedBy` user, who is positioned to decide
whether to renew it or let the underlying policy resume enforcement.

**Vercel Cron plan-limit note, flagged rather than assumed:** this is
now 2 scheduled jobs total. Historically Vercel's Hobby tier has limited
cron jobs (commonly to 2), and this session cannot confirm which plan
tier this project is on — kept the increment to exactly one new job
rather than adding a separate one per trigger, and flagging this here in
case the user's actual plan needs the count checked against Vercel's
current limits.

**Verified:** typecheck, lint clean. New `modules/access-governance/
policies.test.ts` (8 cases): notifies the approver for an expired,
still-active, not-recently-notified exception; respects the dedup
window; ignores an exception with no expiry date, an already-revoked
one, and one not yet expired; the all-tenants sweep sums counts across
tenants, isolates one tenant's failure from the rest, and no-ops
cleanly with no active tenants. Full vitest suite 342/342. `npm run
build` (fresh `.next`) clean — confirmed both cron routes compile
(`/api/cron/compliance-escalate-overdue`,
`/api/cron/access-exception-expiry-reminders`). No schema/migration
change — reads the same `policy_exceptions` table `listGovernanceExceptions()`
already reads, via the service-role client (consistent with every other
cron-triggered sweep in this codebase, which has no user session to run
as).

---

## 2026-09-25 — Fix: revoked or not-yet-started policy exceptions suppressed violations

Found while writing `docs/implementation/codebase-map.md` (defect D1) and
re-read at the cited lines before changing anything.

- **Bug.** `evaluatePolicies()` (`modules/access-governance/evaluate.ts`)
  decided whether an exception applied by looking only at `expires_at`. It
  ignored the `status` and `start_date` columns migration `0053` added.
  A **revoked** exception with a future expiry therefore kept turning a
  violation into `exempted`, and so did an exception whose start date had
  not arrived.
- **Fix.** A new exported pure function, `isExceptionInForce(row, now)`,
  requires `status = 'active'`, `start_date <= now` and an unexpired or null
  `expires_at`. Anything else is not in force, so the violation is reported
  (fail-safe, §17.4). Rows from before 0053 carry the backfilled defaults
  and behave as before.
- No schema change and no contract change.
- **Verified.** Six new cases in `evaluate.test.ts` (11/11 in the file):
  active, no expiry, revoked with future expiry, revoked with no dates, not
  yet started, expired, and a pre-0053 row. The full vitest suite passes
  (352/352).
- **Still open** (codebase-map D5): `checkSoD()` has no callers.

---

## 2026-09-25 — ACCESS-P0-11: the deterministic runtime decision

This is master stories P0-28 to P0-32. The user decided on 2026-09-25 that
Access owns the decision and Runtime owns the gateway endpoint that calls it.

**`decideRuntimeRequest(facts)`** (`runtimeDecision.ts`) is a pure function
with no I/O and no model (#9). It evaluates in the master order, and every
step is recorded as PASS, SKIPPED or an outcome, so each decision explains
itself:

1. **Tenant**: an inactive tenant gives DENY.
2. **Identity**: an unknown agent gives DENY, and so does an `identityId`
   not linked to this agent.
3. **Lifecycle**: an agent may act only in ACTIVE, CERTIFICATION_DUE or
   RESTRICTED. A RESTRICTED agent is read-only: a read gets
   ALLOW_WITH_RESTRICTIONS `{readOnly}`, a state change gets DENY.
4. **Emergency controls**: kill switch or a suspended tool gives DENY.
   Their storage comes with RUNTIME-P0-18; the loader passes "none" until
   then.
5. **Approved access (SHOULD)**, reusing `classifyAction()`:
   - No active contract gives DENY.
   - DENY for a prohibited action or data, autonomy level 0, or an
     unapproved application, tool or data.
   - An action the contract never names gives DENY: it is never silently
     allowed.
   - REQUIRE_APPROVAL for an action that requires approval, or for
     autonomy levels 1–2.
6. **Effective access (CAN)**: DENY if the agent holds no access to the
   named application. It is also DENY if effective access could not be
   established. The gateway never grants beyond IAM.
7. **Context**: a request environment different from the agent's
   registration gives DENY.
8. **Risk** (master P0-31) gives REQUIRE_APPROVAL for:
   - a critical-risk agent making any state change
   - a high-risk agent making a state change in production
   - a risk band above the contract's `maximumRisk`

   "State change" is a deterministic verb list that handles snake_case
   tool names such as `delete_customer`.
9. **Runtime policies**: active `runtime` policies are evaluated through the
   existing `evaluateCondition()` against `request.*` and `agent.*` facts.
   - block gives DENY.
   - restrict means read-only: a read gets ALLOW_WITH_RESTRICTIONS and a
     write gets DENY.
   - flag records only.
   - A block policy that cannot be evaluated gives REQUIRE_APPROVAL, never
     ALLOW.

The final decision is the most restrictive step. `policyId` and
`policyVersion` are reported when a policy set it.

**`evaluateRuntimeRequest(principal, request, gateway)`**
(`runtimeDecisionLoader.ts`) gathers the facts. The principal is the
tenant and agent from a **verified agent API key**. A gateway call has no
user session, so the reads use the service role, filter by `tenant_id`,
and re-check every row (§14):

- agent, contract and identities via Identity's new published
  `getAgentRuntimeProfile()`
- effective applications from `accounts` and `access_grants`
- active runtime policies with their rules

**Any load failure gives DENY `EVALUATION_FAILED`.** The failure is logged
and never swallowed (§17.4 and §17.5). Operating mode is not decided here:
OBSERVE_ONLY versus ENFORCE is the gateway's (RUNTIME-P0-15).

**Verified**

- `runtimeDecision.test.ts`, 28 cases:
  - the allow path, with all nine steps in order
  - case-insensitivity
  - the master §21 fail-safe table: unknown identity, unknown resource,
    suspended agent or tool, explicit deny, approval required, inactive
    tenant with later steps skipped
  - contract edge cases and autonomy levels 0–4
  - **CLAUDE.md §11 FinanceBot**: a Snowflake CustomerDB (PII) read is
    DENIED by the contract, even though effective access passes
  - RESTRICTED read and write
  - environment mismatch
  - all three risk rules
  - block, restrict, flag and unevaluable policies
  - the strongest outcome winning
- `runtimeDecisionLoader.test.ts`, 6 cases: every read is filtered to the
  key's tenant; another tenant's grants never count; a foreign identity
  and an unknown agent are denied; a load failure fails closed; a tenant
  runtime policy applies.
- Full vitest 54 files / 405 tests; lint clean.

**Not in scope**

- Intent (master P0-29) is enforced deterministically through the approved
  action list. Free-text `intent.requestPurpose` is accepted but not
  interpreted; semantic intent analysis is master P2-01.
- New policy targets (TOOL, MCP_*, DATA_*) are ACCESS-P0-12.

## 2026-09-25 — ACCESS-P0-13: data sources inventory feeding CAN (master P0-11)

User decision (2026-09-25): Access owns data sources beside `applications`.

**What changed:**

- **Migration 0070** (`0070_access_data_sources.sql`, applied live) is
  additive.
  - A new `data_sources` table: kind, classification, owner, optional
    application, `active | retired`.
  - Tenant-scoped RLS matching `applications` (select, insert, update).
    There is **no delete policy**: a source is retired, never removed,
    because findings and evidence reference it.
  - A nullable `entitlements.data_source_id`.
  - **Same-tenant references are enforced by the database.** Composite
    foreign keys `(application_id, tenant_id)` and
    `(data_source_id, tenant_id)` (Postgres 17 `ON DELETE SET NULL (col)`,
    with a new `unique (id, tenant_id)` on `applications`) mean a row can
    never point across tenants, even one the member is allowed to write.
- **Service** (`dataSources.ts`, exported from `service.ts`):
  - `createDataSource`, `updateDataSource` (reclassify, re-own, retire)
    and `linkEntitlementToDataSource` run as the user and are audited.
    The update audit records the classification before and after.
  - `validateDataSourceInput` validates at the boundary and drops unknown
    fields.
  - `listDataSources` returns each source with its **reach**: how many
    entitlements open it, and which agents currently hold one (revoked
    grants excluded). It makes two parallel queries.
- **CAN.** `getEffectiveAccess`, `getEffectiveAccessAsOf` and
  `getAccessGrant` now carry `dataSource { id, name, classification }`.
  An entitlement with no classification of its own takes its data
  source's, so an unclassified entitlement on a restricted warehouse is
  not read as unclassified. The entitlement's own classification still
  wins.
- **API:**
  - `GET/POST /api/v1/access/data-sources` (`access.read` /
    `access.manage`)
  - `PATCH /api/v1/access/data-sources/:id`
  - `PUT /api/v1/access/entitlements/:id/data-source` (UUIDs validated)
- **UI.** `/access/data-sources` ("Data Sources" under Access
  Intelligence):
  - Metrics: sources, sensitive, unclassified, reachable by agents.
  - A table with classification (editable inline by managers), the
    agents that can reach each source (CAN), entitlements, application
    and owner.
  - Add and link forms that show the real result or error (§17.5). A
    read-only user sees the table only.

**Tests:**

- `dataSources.test.ts` (4): validation, reach, and the
  classification-fallback rule.
- SQL `tests/access/data-sources-isolation.sql`, run live, **9/9**:
  - own sources visible 1, other tenant's 0;
  - reclassifying the other tenant's source changes 0 rows;
  - delete affects 0 rows (no policy);
  - inserting into the other tenant is denied (42501);
  - pointing at the other tenant's application, and linking an
    entitlement to the other tenant's source, are both denied by the
    composite keys (23503);
  - an own-tenant link succeeds;
  - the other tenant's row is unchanged.
  - Fixtures were cleaned up. Security advisories show no new findings.
- E2E `data-sources.spec.ts`: add and link through the forms, then 1
  agent reaches the source and effective access carries it; a duplicate
  is refused with its reason; read-only gets no forms and a 403 from the
  API; the other tenant sees nothing and gets a 404 linking to the
  entitlement.

**Left out:**

- Importing data sources from connectors: a mapping for Integration's
  objects is a follow-up.
- Using data sources in runtime decisions: Access's `DATA_SOURCE` policy
  target is ACCESS-P0-12.

**Verified:**

- eslint clean; vitest 488/488.
- Full Playwright run: **180/181**. The one failure was `access.spec`'s
  "adding an external-facing application shows it in the table". That
  spec adds an "E2E App …" every run, and Tenant One had reached 28
  applications, so the newest sorted onto the table's second page (it
  pages at 25). This was not caused by this story.
  - The spec now types the name into the table's filter before
    asserting.
  - Pruning those applications at setup was tried and dropped:
    `access_requests` reference applications without cascading.
  - Rerun of `access.spec` + `data-sources.spec`: **13/13**.
- `/access/data-sources` was added to the design-review sweep and is
  under Access Intelligence in the nav.
- One design fix: the application name broke mid-word at desktop width;
  it no longer does.

## 2026-09-25 — ACCESS-P0-14: separation-of-duties checks wired (codebase-map D5, master P0-25)

- **Before.** `checkSoD()` (ACCESS-P0-02.3) had no callers. Even if
  called, it could not have caught the classic conflict, "requested, then
  approved, by the same person". It matched prior audit rows only by
  `object_id = agentId`, but requests and grants are audited against their
  own ids.
- **Changes to `checkSoD()`:**
  - It matches a prior action whether the agent is the audit row's object
    or its `metadata.agentId`.
  - It reads with the **service role**, filtered by tenant and re-checked,
    because a security control must not depend on whether the acting user
    can read the audit log (§14).
  - It considers only `rbac` rules, and never builds a filter from a
    malformed id.
- **New `enforceSoD()`** is the one call made at the decision points.
  - Every conflict is audited as `access.sod_conflict`.
  - A **blocking** policy (`action: block`) refuses the action with 409
    `SOD_CONFLICT`, audited as a failure. It runs before anything is
    written, so nothing changes.
  - A **flag** policy lets the action proceed and records the conflict.
- **Wired into:**
  - `createAccessRequest()` (submission);
  - `decideAccessRequest()` (every decision: approve, reject, fulfil);
  - `createManualAccessGrant()`.
  - Their audit rows now also carry `metadata.agentId`, so later checks
    can see them.
- **No change for tenants without an SoD policy.** SoD rules are opt-in:
  active `identity` policies with an `rbac` rule of
  `{ conflictingActions: [...] }`.

**Tests:**

- `sod.test.ts` (new, 6): conflict matched by object or metadata with
  tenant, actor and action filters; non-rbac rules, other-tenant policies
  and unrelated actions ignored; malformed ids never reach a filter;
  blocking → 409 plus an audited failure; flag → proceeds plus an audited
  conflict; no conflict → nothing recorded.
- E2E `sod.spec.ts` (Tenant Two; policy disabled in `finally`): with a
  blocking policy the requester's approval gets 409 `SOD_CONFLICT` and the
  request stays pending; switched to flag, the same approval goes through.
- Live: both `access.sod_conflict` rows were checked, one failure and one
  success, with the right actions.

**Left out.** Turning a flagged conflict into a Risk finding. Risk's
finding writer is not a published contract, so the audit event is the
record for now. It is flagged to Risk as a candidate signal.

**Verified:** eslint clean, vitest **519/519**, Playwright **188/188**
(8.6 min, a fresh build containing this story).

## 2026-09-25 — ACCESS-P0-12: policy targets, priority, and a publish step (master P0-23)

- **Targets.** A policy's `scope.targets` lists what it applies to:
  `TOOL`, `MCP_SERVER`, `MCP_TOOL` (`server:tool`), `DATA_SOURCE`
  (matched against the request's resource or application), `DATA_RESOURCE`
  (the resource, with a trailing `*` as prefix match), and `ACTION`.
  - No targets means every request in the category, as before.
  - Matching is pure (`policyTargets.ts`) and case-insensitive.
  - Stored targets that are malformed never match.
  - Input is validated at the boundary: at most 50 targets; `MCP_TOOL`
    must be `server:tool`.
  - No migration was needed: `scope` is existing jsonb.
- **Runtime.** The gateway's loader now reads `priority` and `scope`.
  - Step 9 evaluates only the policies whose targets match the request.
  - Policies run highest priority first, stable for ties. Among equally
    severe outcomes the higher priority decides the reported policy.
  - Priority never lets a milder outcome override a more severe one.
  - When active policies exist but none targets the request, the step
    says so.
- **Publish:**
  - `createPolicy()` accepts `status: draft | active`. The default stays
    `active` so existing callers are unchanged.
  - The API and the form require `policy.publish` to create an active
    policy, and `PATCH` requires it to set `status: active`.
  - New `publishPolicy()` (`POST /api/v1/policies/:id/publish`,
    `policy.publish`): draft or disabled → active as a **new version**.
    The prior state is snapshotted, there is a lost-update guard, and it
    is audited as `policy.published`. Publishing an active policy is
    409.
  - Roles: today `policy.create` and `policy.publish` belong to the same
    three roles (IAM_ARCHITECT, SECURITY_ADMIN, TENANT_SUPER_ADMIN), so
    nobody loses a capability. A custom role can now separate authoring
    from publishing.
- **Fixed on the way.** `createPolicy()` wrote no audit event (#11). It
  now writes `policy.created`.
- **UI:**
  - The create form gains "Applies to" and "Target", "Priority", and
    "Status". Users without `policy.publish` can only save a draft.
  - The detail page shows "In effect" / draft / disabled, the version,
    the priority, and what the policy applies to, plus a Publish button
    that shows the real result.

**Tests:**

- `policyTargets.test.ts` (5): every target type, any-of matching,
  malformed stored targets, boundary validation.
- `runtimeDecision.test.ts` +3: a targeted policy applies only to its
  target; the higher priority decides regardless of load order; priority
  never downgrades severity.
- E2E `policy-publish.spec.ts`:
  - a draft runtime policy on a unique tool leaves the gateway's policy
    step at `NO_POLICY_FIRED`;
  - read-only gets 403 publishing;
  - publishing through the UI gives "Published as version 2" and "In
    effect";
  - the gateway step becomes `POLICY_BLOCK` for that tool only, with
    another tool still `NO_POLICY_FIRED`;
  - publishing again is 409;
  - the policy is disabled in `finally`.
- `policies.spec` still passes.

**Verification (2026-09-25):**

- `tsc`, `eslint` clean; `vitest run modules/access-governance` passes.
- Full Playwright suite: 185 passed, 4 failed. All four failures were in
  `agents.spec.ts` (list, tabs, sections nav, posture panel). They fell in
  the ~5-minute window when Identity's migration 0073 made the
  `agent_owners` → `users` embed ambiguous (recorded in the Identity audit
  log, fixed by 0074). Rerun afterwards: all four pass. None touch
  policies.

---

## 2026-09-25 — Tenant filters and same-tenant keys (with QA-P0-17)

QA-P0-17's sweep changed this module's code and schema. It added
explicit `tenant_id` filters to reads that relied on RLS alone, required
`tenantId` on by-id reads that lacked it, and checked parents on by-id
writes. Migration 0076 (or 0075 for Identity) gave this module's
agent/parent references `(col, tenant_id)` foreign keys under their
existing names. For a member of two organizations, RLS alone admitted
both. The full list, tests and live SQL verification are in the QA audit
log's QA-P0-17 entry.

---

## 2026-09-26 — ACCESS-P0-15 (Done): application catalog model and inventory

WonderID Phase 3 (`docs/plan/WONDERID-ROADMAP.md`; spec H3). The
existing `applications` table stays the one application registry. The
access graph, policies, risk and runtime already use it, so it is
extended rather than duplicated.

### Schema (migration 0086; applied live)

- **New columns** on `applications`:
  - display name, description, type (saas, on_prem, custom,
    cloud_platform, database, directory, ai_service, api, other), vendor;
  - https-only URL (a check constraint);
  - business and technical owners, as same-tenant composite FKs to
    WonderID `identities`, `on delete set null`;
  - environment, risk level, criticality, data classification;
  - discovery source;
  - onboarding status with the spec's ten states (DISCOVERED …
    ACTIVE/SUSPENDED/RETIRED);
  - `updated_at`.
- **`source_integration_id`** got the same-tenant FK it lacked (QA-P0-17's
  note). It was checked first: no row pointed elsewhere.
- **Covering indexes** for the three new FKs, plus (tenant, status, name).
- **Backfill.** The 79 existing applications became ACTIVE: they are
  already in use by grants, policies and runtime decisions. Their
  discovery source is `integration` where linked (4), otherwise `manual`.
  New registrations start DISCOVERED.

### Rules, service, API, UI

- **`applicationCatalogRules.ts`** (pure, 5 unit tests). It validates
  every field and returns the columns to write. It never takes the tenant,
  onboarding status, discovery source or integration link from input.
  Status changes belong to ACCESS-P0-16's governed transitions.
- **`catalog.ts`:**
  - list with search, status, type, risk and missing-owner filters, paged
    at the database, with account and entitlement counts embedded in the
    same query (§15);
  - head-count summary in parallel;
  - detail;
  - register and update. Owners must be active people of this
    organization, read through Identity's published service (#6).
  - Audit events: `application.registered` and `application.updated`
    (changed field names).
- **API:** `POST /api/v1/access/applications` registers into the catalog;
  the integration-linked path is unchanged. There is a new
  `/api/v1/access/applications/:id` (GET, PATCH).
- **UI:**
  - `/access` was rebuilt as the inventory: KPIs (total, active,
    onboarding, missing an owner, high risk), URL-driven filters, database
    paging, owners and status per row;
  - `/access/applications/new` to register;
  - `/access/applications/:id` with details, owners linked to their
    identities, the connector, entitlements, and an edit form.
  - The old in-page "Add an application" form and `ApplicationsTable` were
    removed; the two `access.spec` tests now cover the new flow.
- **Demo data:** `seed-demo-data.mjs` now gives demo applications a type,
  vendor, risk and classification, and makes them ACTIVE. WonderArk's ten
  were updated the same way in the database.

### Verified

- `tsc` and `eslint .` clean; vitest **587/587** (5 new catalog rules tests).
- Live SQL (`tests/access/application-catalog-checks.sql`):
  - a cross-tenant owner is 23503;
  - a non-https URL is 23514;
  - forged rows 0.
  - The integration case was skipped because the second tenant had none;
    the same key pattern is proven in the identity-sources check.
- E2E `application-catalog.spec.ts`:
  - validation (http URL, unknown type);
  - registration as DISCOVERED even when `onboardingStatus: ACTIVE` is
    sent;
  - a duplicate name is 409;
  - an owner must be an active person (a service account is 400);
  - update;
  - inventory filters (the high filter shows the application, low shows
    none);
  - the detail page edit;
  - another organization gets 404 on read, patch and the page, and cannot
    borrow a Tenant One person as owner (404);
  - read-only reads (200) but gets 403 on register and patch.
- `access.spec` 10/10 and navigation-smoke pass.
- Screenshots: inventory (light), detail (dark), inventory at 390 px. One
  fix came from them: the KPI label is now "High risk".

- Full Playwright suite (§17.8: migration and shell changed): **233/233 passed** (13.2 min).

**Left to ACCESS-P0-16:** onboarding transitions, checklist, validate,
simulate, approve and promote.

## 2026-09-26 — ACCESS-P0-16: application onboarding (WonderID Phase 3)

Spec §8: every application is onboarded through Configure → Validate →
Simulate → Approve → Promote. One record per application holds a
versioned, hashed configuration. Validation, simulation and approval each
record the hash they ran against, so any change invalidates them (§8.6).

### Schema (migration 0088; applied live)

- `application_onboardings`:
  - one row per application (`unique(application_id)`); same-tenant
    composite key to `applications`;
  - `mode` (quick_start / assisted / advanced) and `status` (the spec's ten
    states);
  - `config`, `config_version`, `config_hash` (canonical sha256, key order
    never matters);
  - validation and simulation results with the hash they ran against;
  - `submitted_by` (who ran the passing simulation);
  - `approved_hash`, `approved_config`, `approved_by`, `decision_note`;
  - `promoted_config`, `promoted_hash`, `promoted_at`.
- Four-eyes is also a table check: `approved_by <> submitted_by` (23514,
  even for the service role).
- **RLS: members can only read.** There is no insert, update or delete
  policy: approval records must be tamper-resistant (§17.4). The service
  writes with the service role, after checking `access.manage`, the stage
  and four-eyes, and every write is filtered by the tenant resolved from
  the session.

### Rules (`onboardingRules.ts`, pure; 15 tests)

- `validateOnboardingConfig`: validates and merges a partial configuration.
- `configHash`: the canonical hash.
- `evaluateChecklist`: the §8.5 checklist, 15 items (disable and delete are
  one item, as in the spec).
  - Blocking items stop promotion: schema, correlation, entitlement model,
    reconciliation (when connected), owners, risk, access model, request
    and certification policy, provenance.
  - The operations decide only "automation ready". An operation the
    connector does not declare is fulfilled by hand, so it warns but does
    not block (§8.6: a failed deprovision is not automation ready).
- `simulateOnboarding`: plays the configuration against the accounts the
  connector imported:
  - correlated, orphan and ambiguous counts;
  - an account without the identifier fails the simulation.
- `blockReason`: which step may follow which, and four-eyes.

### Service (`onboarding.ts`)

- The steps: start, configure, validate, simulate, decide (approve or
  reject; a rejection needs a note), promote.
- `setApplicationLifecycle`: suspend, resume and retire a live application.
  Taking one out needs a reason.
- Every step is a conditional update on the state and hash it expects, so
  concurrent steps get a 409; each is audited
  (`application.onboarding_*`).
- **Simulation only reads.** It reads the integration's objects through
  Integration's published `getNormalizedObjects`, and identities through
  Identity's `listIdentitiesForCorrelation`.
- **Promotion** copies exactly `approved_config`, only while the record
  still holds the approved hash. It then makes the application ACTIVE and
  links the approved integration.
- The catalog status follows the onboarding stage (CONFIGURING / CONNECTED
  → VALIDATING → READY_FOR_APPROVAL → APPROVED). It never demotes a live
  application.

### API and UI

- `GET` and `POST /api/v1/access/applications/:id/onboarding`
  (`{ action: start | configure | validate | simulate | approve | reject |
  promote }`).
- `POST /api/v1/access/applications/:id/lifecycle`.
- The server actions in `app/actions/applications.ts` return the real
  outcome (§17.5).
- `/access/applications/:id/onboarding`:
  - a five-step progress bar (done, next and failed are announced to
    screen readers);
  - the configuration form (read-only without `access.manage`);
  - a record card: version and hash, submitter, decision, what is live;
  - the checklist with pass, fail, warning and not-applicable icons;
  - simulation counts;
  - approval, disabled with the reason for the submitter;
  - promote, disabled until the configuration is approved and unchanged.
- The application detail page gains an Onboarding card and a Lifecycle
  card (suspend, resume, retire).

### Test support

- A new E2E identity, `iamAdminOne` (IAM_ADMIN in Tenant One). It is the
  second person who can manage access, which four-eyes needs.

### Verified

- **Checks:** `tsc` and `eslint .` are clean. Vitest **623/623** passes,
  including 15 onboarding rules tests.
- **Live SQL** (`tests/access/application-onboarding-isolation.sql`):
  - A member sees their own onboarding (1) and none of another tenant's
    (0).
  - A member's direct self-approval and promotion each updated 0 rows.
  - A member's direct insert was refused (42501); their delete removed 0
    rows.
  - Onboarding another tenant's application was refused (23503).
  - The submitter approving, even with the service role, was refused
    (23514).
  - The fixtures were cleaned up.
- **E2E `application-onboarding.spec.ts`** (17 passed with setup). It covers:
  - start;
  - a missing identifier fails validation, and simulation and promotion
    are 409;
  - undeclared operations are not automation ready but do not block;
  - simulation changes no entitlements and submits for approval;
  - the submitter's own approval is 409, and a rejection without a note is
    400;
  - a second person (IAM admin) approves;
  - a change after approval drops the approval and blocks promotion;
  - a second round, then promotion of exactly the approved hash, which
    makes the application ACTIVE;
  - suspend and resume, with a reason;
  - the screens, from start to a failed validation, then a save that
    invalidates the check;
  - another organization gets 404 on every step and on lifecycle;
  - read-only reads, but gets 403 on changes.
- **Screenshots:** the promoted onboarding (light, 1440), a failed
  validation (dark), and 390 px. One fix came from them: "1 entitlement(s)"
  pluralisation.
- **Full Playwright suite** (§17.8: a migration and a test identity
  changed):
  - **First run: 240/244.**
    - Two design-review width sweeps timed out on their last routes. They
      pass alone; the sweep had outgrown one test's 300 s budget. It now
      runs in two halves per width (QA note in the QA audit).
    - `shadow-ai` passed on its own re-run.
    - `sod` failed on a real bug, recorded below.
  - **Second run, with the split sweep and the fix below: 254/254 passed**
    (14.0 min).

## 2026-09-26 — ACCESS-P0-14 fix: an advisory SoD policy could hide a blocking one

`checkSoD` returned the first matching policy. In the first ACCESS-P0-16
full run, the `sod` spec timed out in its `finally` and left its flag-only
policy active in E2E Tenant Two. On every later run, that advisory policy
matched first, so the blocking policy never refused the requester's own
approval (200 instead of 409).

That is a real hole, not only test pollution: any advisory SoD policy
could weaken a blocking one.

- **Fix:** every matching policy is checked. The first blocking conflict
  wins; an advisory one is reported only when nothing blocks.
- **Unit test:** a new `sod.test.ts` case (flag and block both match →
  block; flag alone → advisory). 7/7 pass.
- **E2E:** re-run with the leftover advisory policy still active, `sod`
  passed (409 as designed). The leftover E2E policy was then disabled.
