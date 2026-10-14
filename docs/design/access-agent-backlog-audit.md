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

## 2026-09-26 — ACCESS-P0-17: account inventory (WonderID Phase 3)

An account now belongs to any identity: a person, an external person, a
machine identity or an AI agent, not only an agent. The inventory shows
orphan, ambiguous, dormant, privileged and missing-from-source accounts. A
reconciliation run fills it from an onboarded application's connector.

### Schema (migration 0089; applied live)

- **`accounts`, extended and backward compatible (#13):**
  - `agent_id` is now nullable. Every existing reader filters by
    `agent_id`, so a person's account never appears in an agent's CAN.
  - New columns:
    - `identity_id`, a same-tenant key to `identities`;
    - `correlation` (correlated / manual / orphan / ambiguous);
    - `account_name` and `account_type` (standard / privileged / service /
      shared);
    - `last_used_at`, `last_seen_at` and `missing_from_source_at`;
    - `source` (manual / reconciliation), `source_integration_id` (a
      same-tenant key) and `updated_at`.
  - New key: `unique (tenant_id, application_id, external_account_ref)`.
    There were no live duplicates.
  - Backfill: all 18 live accounts were agent accounts. They took their
    agent's mirrored identity and are "correlated".
- **Trigger `accounts_identity_consistency`:**
  - it fills `identity_id` for an agent account written without one (the
    seed script, older callers);
  - it keeps `correlation` consistent with `identity_id`, including when
    the identity is deleted (the key sets it null, and the account becomes
    an orphan).
- **`account_reconciliation_runs`:** members can only read it; the service
  writes it.

### Rules and service

- **`accountRules.ts`** (pure; 6 tests):
  - dormant windows (30, 60, 90, 180 or 365 days; default 90). "Never
    used" counts as dormant once the account is older than the window;
  - case-insensitive correlation to exactly one identity. More than one
    match is ambiguous, never a guess (§17.6);
  - `planReconciliation`:
    - a person's manual link and an agent's ownership are kept (only last
      seen and last used move);
    - everything else is correlated afresh;
    - last use never moves backwards;
    - disabled and privileged are read from the source;
    - accounts it imported that the source dropped are listed, never
      deleted (#7, #15).
- **`accounts.ts`:**
  - `listAccountInventory` has six views and is paged at the database.
  - `getAccountSummary` runs its counts in parallel.
  - `linkAccount` links or unlinks by hand, audited, with optimistic
    concurrency. It never re-points an AI agent's account (that would
    silently change CAN), and never links to an agent.
  - `reconcileApplicationAccounts`:
    - runs only under the configuration onboarding **promoted**
      (ACCESS-P0-16), never a draft;
    - reads the connector's imported accounts through Integration's
      `getNormalizedObjects`, and identities through Identity's
      `listIdentitiesForCorrelation`;
    - upserts in batches and marks accounts missing from the source;
    - records the run (a failure is recorded truthfully, §17.5) and
      audits it;
    - caps a run at 5,000 source accounts;
    - runs synchronously: at that cap it is seconds. Moving it to a
      background job belongs with scheduled reconciliation.
- **Grants:** `createAccessGrant` refuses an account without an agent
  (409 NOT_SUPPORTED) rather than skip separation of duties. Grants to
  people's accounts come with human access governance (ACCESS-P0-20).

### API and UI

- API:
  - `GET /api/v1/access/accounts` (`view`, `applicationId`, `q`,
    `dormantDays`, `page`), which also returns the summary;
  - `GET` and `PATCH /api/v1/access/accounts/:id` (`{ identityId }`, null
    to unlink);
  - `GET` and `POST /api/v1/access/applications/:id/reconciliations`.
- `/access/accounts`:
  - KPI cards and view tabs with counts;
  - search and a dormant window;
  - a table of who each account belongs to, with type and last use.
  - Filtered to one application (`?app=`), it drops the application
    column.
- `/access/accounts/:id`:
  - details and how the account was matched;
  - an owner card with identity search and link / unlink. An agent's
    account links to the agent instead.
- The application page gains an Accounts card: counts, the last run, and
  "Reconcile accounts" (disabled until onboarding is promoted).
- The sidebar gains "Accounts" under Applications.

### Verified

- `tsc` and `eslint` clean; vitest **630/630**.
- **Live SQL** (`tests/access/account-inventory-isolation.sql`). Each
  expectation held:
  - a person's account (no agent) is correlated;
  - the trigger fills an agent account's identity;
  - an orphan is the default;
  - when the identity is deleted, the account is kept as an orphan;
  - another tenant's identity or integration is 23503;
  - a duplicate identifier is 23505;
  - a member sees 3 own accounts, 0 of another tenant's accounts and runs,
    and links 0 of another tenant's accounts;
  - a member's direct run write is 42501;
  - cleanup left 0 fixture rows, and 0 agent accounts without an identity.
- **E2E `account-inventory.spec.ts`: 13/13 with setup.** It covers:
  - a seeded connector with imported accounts (`seedIntegrationAccounts`,
    the same Admin-API pattern as `seedFinanceBotAccess`);
  - reconciliation is 409 before onboarding is promoted;
  - the first simulation fails on an account without an identifier; the
    source fixes it, and approval and promotion follow;
  - the first run gives 4 new accounts: 1 matched, 2 orphan, 1 ambiguous,
    1 privileged;
  - the dormant view holds exactly the account last used in 2025;
  - a manual link survives the next run;
  - an account the source dropped is marked, not deleted;
  - unlinking makes an orphan;
  - a grant to a person's account is 409 NOT_SUPPORTED;
  - linking to an AI agent is 400;
  - the screens: the list, the orphan tab, and link by search;
  - another organization gets 404 on the account, the link, and the
    reconciliation, and sees no accounts or runs;
  - read-only reads (200), but gets 403 on link and reconcile.
- **Screenshots:** the inventory (light, 1440), account detail (dark), the
  orphan view at 390 px, and the application's Accounts card.
  - Fix from them: two KPI labels truncated at 390 px and were shortened.
- The sweeps now include `/access/accounts` (`design-review` and
  `navigation-smoke`).
- **Full Playwright suite** (§17.8: migration and shell navigation
  changed): **260/261.**
  - The one failure was `risk.spec`'s agent registration. It did not
    redirect within 10 s: the page showed no error, and the submit was
    still pending.
  - It touches no account path. Re-run alone, `risk.spec` passed 10/10.

**Left out:**

- scheduled or background reconciliation (with INTEGRATION-P0-10 and
  -13's jobs);
- last use from runtime (DID) for agent accounts;
- a tenant-configured default dormant window (the query parameter covers
  P0);
- account-level certification (the Compliance module's extension).

## 2026-09-26 — Catalog contract additions for INTEGRATION-P0-10 (additive)

- `registerApplication(tenantId, actorId, input, origin?)`:
  - `origin` is `{ discoverySource, sourceIntegrationId? }`. It defaults
    to manual, as before;
  - an unknown source is 400, and another tenant's integration is 404
    (from the same-tenant key's 23503);
  - the audit metadata now carries both fields.
- `listApplicationsForMatching(tenantId)`:
  - returns id, name, display name and address for up to 5,000
    applications;
  - reads as the user, with the tenant filtered.
- Existing callers are unchanged. Verified by `application-discovery.spec`
  (registration through a discovery) and the catalog specs in the full run.

## 2026-09-26 — ACCESS-P0-18 (Done): self-service request catalog and request policies

**Built (WonderID Phase 4, spec §11).**

- **Migration 0092** (applied to the dev project):
  - `access_request_policies`: one policy per scope — the tenant default
    (no application), an application, or one of its entitlements (unique
    by scope). Each says:
    - whether the item is requestable;
    - whether people may request for themselves, and who may request for
      others (nobody / the subject's manager or an access manager / access
      managers only);
    - the longest and default duration;
    - whether a justification is required;
    - the risk threshold at or above which approval is always needed;
    - whether a request below it may be approved automatically;
    - the approval route (manager / owner / manager then owner), which
      ACCESS-P0-19 consumes.
    Same-tenant keys to applications and entitlements. Members read only;
    the service writes after `access.manage`.
  - `access_requests` grows to requests for identities (additive, #13):
    - `agent_id` is nullable; the new columns are subject identity,
      requester identity, policy and its result, risk level, duration,
      requested expiry and `cancelled_at`;
    - the status set adds `cancelled` and `expired`;
    - a check requires an agent or a subject;
    - a partial unique index allows one pending request per person and
      item.
    Every existing row is an agent request and keeps its meaning.
- **`requestRules.ts`** (pure):
  - the most specific active policy wins (entitlement > application >
    tenant default); no policy means nothing is requestable;
  - risk comes from the entitlement's privilege and classification and
    the application's risk;
  - `evaluateRequest` refuses with a reason in this order: the application
    is not live; not requestable; the subject is an AI agent (agents keep
    the ACCESS-P0-06 path); the subject is inactive; outside the
    self/others scope (`REQUEST_SCOPE`); duration over the maximum;
    justification missing or under 10 characters;
  - otherwise it returns the initial status: approved only when the
    policy auto-approves and the risk is below the threshold, else
    pending.
- **`requestCatalog.ts`:**
  - the paged catalog of live applications, with each entitlement's
    risk, whether it is requestable and who approves. `requestableOnly`
    narrows in the query to applications an active policy makes
    requestable (unless a requestable tenant default covers everything),
    so paging holds; the screen uses it by default;
  - policy save is an upsert per scope, audited;
  - submit applies the rules. An identical open request is returned, not
    duplicated (a race is caught by the unique index and resolved to the
    existing row). Submissions are audited as `access.request_submitted`
    or `access.request_auto_approved`, refusals as
    `access.request_refused`;
  - cancel is for the requester only, while pending;
  - lists: mine, waiting, all.
- **`requests.ts` decisions:**
  - for an identity request the requester can never approve or reject
    their own (409 `SELF_APPROVAL`);
  - the decision is conditional on the status it read (409 on a race);
  - SoD still applies to agent requests.
- **API:** `GET /api/v1/access/catalog` (`?q`, `?page`, `?requestable=1`);
  `GET|POST /api/v1/access/request-policies`;
  `POST /api/v1/access/requests` (no `agentId` means an identity request);
  `POST /api/v1/access/requests/[id]/cancel`;
  `GET /api/v1/access/requests?mine=1|view=all`.
- **Screens:**
  - `/access/catalog` (Request Access): cards per application with the
    risk and approval of each entitlement, and a "show every live
    application" toggle;
  - `/access/catalog/[applicationId]`: the request form, for yourself or
    a person found by search, with duration, justification and a live
    preview of risk and approval;
  - `/access/requests`: rebuilt with waiting, mine and all tabs;
    cancel, decide and mark fulfilled;
  - `/access/request-policies`: the policy table and scope form.
  - The sidebar's Access Governance group: Request Access, Access
    Requests, Request Policies.
- **Consumed:** Identity's new `getIdentityForUser` (recorded in the
  Identity audit).

**Verified.**

- `tsc`, `eslint`: clean. Vitest: 669/669 (88 files), including
  `requestRules.test.ts` 10/10.
- **SQL `tests/access/request-catalog-isolation.sql`** against the dev
  project:
  - a policy on another tenant's application is 23503;
  - a second policy for a scope is 23505;
  - a request for another tenant's identity is 23503;
  - a request for nobody is 23514;
  - a second identical pending request is 23505;
  - a member sees own policies 1 and another tenant's 0;
  - a member's direct policy update changes 0 rows, and a direct insert
    is 42501;
  - no request is left without an agent or subject;
  - the fixtures were deleted afterwards.
- **E2E `request-catalog.spec.ts`: 14/14 with setup.** It covers:
  - a request before the application is live is 409; live with no
    policy is 403; a bad threshold is 400; saving a scope again updates
    it;
  - the catalog shows low risk as automatic and admin as critical with
    manager-then-owner approval; an application never promoted is
    absent; requestable-only lists this application and only
    requestable ones;
  - for yourself: a short justification or too long a duration is 400;
    low risk is approved at once with a 30-day expiry; an identical
    request returns the open one (`meta.duplicate`);
  - critical waits: the requester's own approval is 409 `SELF_APPROVAL`;
    the IAM admin approves; a second decision is 409;
  - for others: an access manager may; a requester who is not the
    person's manager gets 403 `REQUEST_SCOPE`; only the requester can
    cancel (others 403), once (then 409);
  - the screens: catalog, form, duplicate message, my requests, policies;
  - another organization gets 404 on submit and policy save and sees no
    catalog items, policies or requests; read-only gets 403 on request
    and policy save.
- **Screenshots:** the catalog (light, 1440, and dark, 390), the form
  (light and dark 390), requests (light, dark, 390) and policies (light,
  dark 390). Fixes from them:
  - the catalog listed every live application, most "Not requestable";
    it now shows the requestable ones by default;
  - risk and status badges wrapped mid-word ("critic/al");
  - a cancelled request still showed its expiry.
- The sweeps now include `/access/catalog` and `/access/request-policies`
  (`design-review`, `navigation-smoke`).
- **Full Playwright suite** on this story's build (§17.8: migration and
  navigation changed): **282/282** in 17.3 minutes.
- It ships in the same commit as ACCESS-P0-19 (next entry), because the
  engine replaces this story's single-decision path for catalog requests.

**Left out:**

- multi-stage approval, approver scope and escalation — ACCESS-P0-19;
  the route is recorded on every request for it to consume;
- access packages in the catalog — ACCESS-P0-20;
- fulfilment into the target application (INTEGRATION-P0-13's write
  interface) and automatic expiry (a scheduled job);
- "their manager" is the subject identity's `manager_identity_id`
  (the directory field sources maintain), compared with the requester's
  identity; a signed-in user with no linked identity is never a manager,
  so only `access.manage` lets them request for others.

## 2026-09-26 — ACCESS-P0-19 (Done): the approval engine

**Built (WonderID Phase 4; spec §11.1 "see approval chain", §19.6, §37A.27
and invariant S4).** Committed together with ACCESS-P0-18.

- **Migration 0093** (applied to the dev project in four steps — the table,
  the open-step key, the revoke, the decided-check fix — all folded into
  the one file):
  - `access_request_approvals`: one row per step. Each step records:
    - the stage, and who it asks (`manager`, `entitlement_owner`,
      `application_owner` or `access_managers`) with the reason;
    - the approver identity and user;
    - the status (waiting, pending, approved, rejected, skipped, expired,
      invalidated);
    - the action fingerprint it is valid for, and the policy version;
    - the due time and escalation;
    - the decision: who, when, their roles, and a comment.

    Same-tenant keys to the request and identity. A partial unique key
    means the same open step cannot be inserted twice. Members read only;
    the service writes. Checks:
    - an access-manager step names nobody, and a named step names a
      person;
    - an approved or rejected step has a decision time;
    - an open step has no decision.

    Trigger `access_request_approvals_four_eyes` refuses a decision by the
    request's requester or by the subject's user, whatever path writes it,
    including the service role. Execution is revoked from public, anon
    and authenticated.
  - `access_request_policies` gains `approval_mode` (sequential or
    parallel), `approval_timeout_days` (1–60, default 5) and `on_timeout`
    (escalate or expire).
  - `entitlements` gains `owner_identity_id` (same tenant).
  - `access_requests` gains `action_fingerprint` and `approval_stage`,
    plus a `(id, tenant_id)` key for the steps' same-tenant reference.
- **`approvalRules.ts`** (pure; 9 new unit tests):
  - `planApprovalChain`:
    - routes: manager; owner (the entitlement owner, else the application
      owner); or both, in order or at once;
    - critical risk appends an access-manager review;
    - a step goes to access managers, with the reason, when nobody is
      recorded, the person is inactive or cannot sign in, or the person
      is the requester or the subject;
    - each approver is asked once (a later step resolving to someone an
      earlier stage already asks is dropped).
  - `actionFingerprint`: sha256 over tenant, request, subject,
    application, entitlement, privilege, duration, type and policy.
  - `chainOutcome`, `actionableStep`, `timeoutAction` (escalate a named
    step once, then expire).
- **`approvals.ts`:**
  - the chain starts when a catalog request is stored as waiting;
  - `decideApprovalStep`:
    - the requester and the subject are refused (`SELF_APPROVAL`), in code
      and again in the database;
    - the fingerprint is recomputed from what the request is now. A
      change (for example, the entitlement's privilege raised)
      invalidates every step, rebuilds the chain with the re-assessed
      risk, and answers 409 `APPROVAL_INVALIDATED`;
    - only the approver a pending step of the current stage names, or an
      access manager for a step open to access managers, may decide
      (`NOT_AN_APPROVER`). An access-manager review cannot be taken by
      someone who already decided an earlier stage (`ALREADY_DECIDED`);
    - the step update is conditional on it still being pending (409 on a
      race);
    - a rejection closes the request and skips the rest; the last
      approval approves it; otherwise the next stage opens with its due
      time;
    - every step and outcome is audited with the §37A.27 approval record:
      fingerprint, resource ids, stage, approver kind and roles, policy
      and version, comment.
  - `sweepApprovalTimeouts`: for one tenant (signed-in approval views) or
    all tenants (`/api/cron/access-request-approvals`, daily at 05:00 UTC
    in `vercel.json`, the existing `CRON_SECRET` bearer). A named step
    escalates once to access managers, per policy; otherwise the request
    expires. System actor, audited.
  - `repairApprovalChains`: waiting catalog requests without a chain
    (ACCESS-P0-18's, or a failed start) get one on the next waiting view.
  - `getRequestWithApprovals`, `listRequestIdsAwaiting`.
- **Decision path:**
  - `POST /api/v1/access/requests/[id]/decision` takes
    `{ decision, comment? }`. For a catalog request it goes to the engine
    and needs only `access.read`: the engine's approver scope is the real
    check, so a named owner or manager with a read-only role can decide
    their own step. An agent request, and marking any request fulfilled,
    still need `access.approve`.
  - `decideAccessRequest` now refuses approve or reject on a catalog
    request (`USE_APPROVAL_CHAIN`).
- **Other APIs:**
  - `GET /api/v1/access/requests/[id]`: the request with its chain;
  - `GET /api/v1/access/requests?view=waiting`: what the caller may
    decide now;
  - `PUT /api/v1/access/entitlements/[id]/owner`: `access.manage`; the
    owner must be an active person of the organization.
- **Screens:**
  - `/access/requests`: "Waiting for you" is the default when anything
    waits for the caller (always for approvers). Each row links to its
    detail and shows its stage.
  - New `/access/requests/[id]`: stages, each step with who and why, its
    due time, escalation, decision, comment and fingerprint prefix. Steps
    invalidated by a change are kept under a disclosure. Decide with a
    comment; the outcome stays on screen after the refresh.
  - The policy form gains the approval mode, the days each approver has,
    and what happens on timeout; the policy table shows them.
  - The catalog preview now reads "your manager and the owner", plus ",
    then an access manager" for critical risk.

**Verified.**

- `tsc`, `eslint`: clean. Vitest: 678/678 (89 files), including
  `approvalRules.test.ts` 9/9.
- **SQL `tests/access/approval-engine-isolation.sql`** against the dev
  project. Every expectation held (details and the one fixture correction
  are in the file):
  - a step on another tenant's request, or naming another tenant's
    identity, is 23503;
  - the requester deciding their own request, even as the service role,
    is 23514;
  - malformed steps are 23514; a duplicate open step is 23505;
  - an entitlement owner from another tenant is 23503;
  - a member sees 1 own and 0 of another tenant's steps; a direct
    reopen, insert or delete by a member is 0 rows or 42501.
- **Supabase advisors:**
  - security: the new trigger function was flagged as executable by
    anon and authenticated; execution was revoked, as 0089 does. Nothing
    else new.
  - performance: every new foreign key is indexed. The new indexes show
    as "unused" only because they are minutes old.
- **E2E `approval-engine.spec.ts`: 15/15 with setup.** It covers:
  - in order: the owner's turn has not come (`NOT_AN_APPROVER`); an
    access manager who is not named cannot decide; the requester is
    `SELF_APPROVAL`. The manager approves (stage 2), then the read-only
    owner approves from their waiting list (approved), and the comment
    is stored;
  - in parallel with critical risk: owner and manager at stage 1; the
    access-manager review refuses the manager (`ALREADY_DECIDED`); a
    rejection closes the request;
  - the entitlement owner comes ahead of the application owner; the
    manager's own request routes to access managers with the reason; the
    subject is `SELF_APPROVAL`;
  - raising the entitlement's privilege after an approval gives
    `APPROVAL_INVALIDATED`: two steps invalidated, a new chain, risk now
    high;
  - a due time in the past escalates once, then expires the request (the
    remaining step is skipped);
  - the approver's screen: the waiting tab, the chain, approving with a
    comment;
  - another organization gets 404 on the detail, the decision and the
    owner change, and sees none of it waiting.
- `request-catalog.spec.ts` still passes 14/14 on the engine: a critical
  self-request resolves to one access-manager step.
- **Fixes found on the way:**
  - steps opened together share a timestamp, so their order is now fixed
    (stage, then kind);
  - invalidating an approved step broke the first "approved ⇔ decided"
    check (0093d replaced it);
  - the decision message vanished when the refreshed page dropped the
    buttons (the actions stay mounted);
  - the read-only owner landed on "My requests" while a step waited for
    them;
  - the policy Status badge wrapped;
  - the request's policy checks are now labelled "when submitted" (risk
    can change after invalidation).
- **Screenshots:** the chain (light 1440; dark 390), the named owner's
  view with the comment box, waiting (read-only, 390), and the policy
  form (dark).
- **Full Playwright suite** on the final build (§17.8: migrations, RBAC path of the decision route, navigation): **290/290** in 18.8 minutes.
- **Observed, not introduced here:** two server-side `QUERY_FAILED`
  errors (`invalid input syntax for type uuid: "null"`, or empty) are
  logged during the Playwright auth setup, at the platform-admin
  sign-in, before any spec runs. The setup passes. Left to the Foundation
  or Platform owner to trace.

**Left out:**

- named approver groups (the spec's "named group" approver) — no group
  object exists yet; it arrives with ACCESS-P0-21 roles or a groups
  story;
- delegation of approvals (ACCESS-P0-23);
- reminders or notifications to approvers (Operations' notification
  channel);
- an authentication-strength field on the approval record: the session
  does not expose it yet;
- escalation to the approver's manager (it goes to access managers);
- a live chain preview on the request form (the preview is textual; the
  exact chain is on the request once submitted).

## 2026-09-26 — ACCESS-P0-20 (Done): access packages

**Built (WonderID Phase 4, spec §12).**

- **Migration 0094** (applied to the dev project):
  - `access_packages`:
    - name and description, an owner (an identity), and status (draft,
      active or retired);
    - discoverability: `requestable`, eligible identity types (people,
      external, machine, AI agents), and eligible departments (empty
      means all);
    - the approval route, mode, timeout and on-timeout action, the same
      terms as request policies;
    - the longest and default duration, extension allowed, and
      certification frequency.
  - `access_package_resources`: a live application's access, or one of
    its entitlements (unique per package).
  - `access_requests`:
    - `application_id` is nullable; the new `access_package_id` column
      holds a package instead;
    - a check requires exactly one of the two;
    - a partial unique index allows one waiting request per identity and
      package.
  - `access_package_assignments`:
    - who holds a package, where from (a request or a direct assignment),
      until when, and its state;
    - one live assignment per identity and package, and one assignment
      per request;
    - an ended assignment records when, by whom and why.
  - `access_package_assignment_items`: one work item per included
    resource.
  - `access_request_approvals` can ask the `package_owner`.
  - Every new table has same-tenant keys and RLS read-only for members;
    the service writes.
- **`packageRules.ts`** (pure; 9 unit tests):
  - eligibility, with every reason it fails (exact department match, the
    same comparison the catalog query makes, so paging and the
    explanation agree);
  - package risk (the worst included);
  - assignment state from its items: a failure shows as partially failed;
    all fulfilled is active; an end state is kept;
  - what ending does to each item: fulfilled becomes revoke-pending, the
    rest revoked;
  - the expiry (never past the maximum);
  - input validation;
  - the contents digest.
- **`packages.ts`:**
  - list: browse what the caller may discover, filtered in the query, or
    manage all;
  - detail, create, update, add and remove content, activate and retire.
    A package goes live only with contents on live applications and an
    owner;
  - request (for oneself; for others by their manager, a non-human's
    owner, or an access manager): an identical waiting request is
    returned; a package already held is refused (`ALREADY_ASSIGNED`); the
    approval chain follows;
  - `assignApprovedPackageRequest` is called by the approval engine on
    the final approval;
  - direct assignment by an access manager, to AI agents too, with a
    justification and eligibility enforced;
  - item outcomes (pending → fulfilled/failed, failed → fulfilled/pending,
    revoke-pending → revoked; a failure needs a detail), with the
    assignment state recomputed;
  - revocation (fulfilled items become revocation work);
  - expiry sweep;
  - all writes are service role, tenant-filtered, conditional and
    audited.
- **Approval engine (ACCESS-P0-19) extended:**
  - a package request follows the package's own terms, and "the owner" is
    the package owner;
  - the package id and contents digest are appended to the action
    fingerprint, only for package requests, so every earlier fingerprint
    is unchanged. Changing what a package includes invalidates waiting
    approvals;
  - a non-human's accountable owner stands in for a manager;
  - the final approval creates the assignment. If that fails, the failure
    is audited and the request stays approved.
- **APIs:**
  - `/api/v1/access/packages`: GET browse or `?view=manage`; POST create.
  - `/packages/[id]`: GET, PATCH. Outside access managers, only an
    active, requestable package the caller is eligible for is visible;
    otherwise 404.
  - `/packages/[id]/resources[/rid]`: add, remove.
  - `/packages/[id]/requests`: request.
  - `/packages/[id]/assignments`: list, direct assign.
  - `/package-assignments/[id]`: GET; `/revoke`.
  - `/package-assignment-items/[id]`: `access.approve`.
  - Holders are visible to access managers, fulfillers and the package
    owner; anyone else sees only their own.
- **Cron:** the approvals cron route, not yet used by any deploy, was
  renamed to `/api/cron/access-governance`. It sweeps approval timeouts
  and package expiry daily (`vercel.json`).
- **Screens:**
  - `/access/packages`: available to you, or manage (with status filter),
    as cards with contents, risk, approval and duration;
  - `/access/packages/new`;
  - `/access/packages/[id]`:
    - what it includes, with risk;
    - request panel: your eligibility and why, the approval preview, the
      expiry preview, the form, and "you hold this package";
    - manage: policy form, status, add content, assign directly;
    - assignments, with item outcomes and revoke.
  - Request lists and details show the package name.
  - Sidebar: Access Governance → Access Packages. Both new screens are
    in the design-review and navigation sweeps.

**Verified.**

- `tsc`, `eslint`: clean. Vitest: 688/688 (90 files); `packageRules` 9
  and `approvalRules` 10.
- **SQL `tests/access/access-packages-isolation.sql`** against the dev
  project. Every expectation held, and the fixtures were deleted
  afterwards:
  - cross-tenant application, package, owner, request, assignment or item
    references are 23503;
  - a request naming both or neither is 23514;
  - a duplicate waiting request or live assignment is 23505;
  - a direct assignment carrying a request, or ending without a time, is
    23514;
  - a member sees own rows 1/1/1/1 and 0 of another tenant's; direct
    writes are 0 rows or 42501.
- **E2E `access-packages.spec.ts`: 15/15 with setup.** It covers:
  - activation refused while empty (`PACKAGE_EMPTY`), with a non-live
    application (`APPLICATION_NOT_LIVE`) and without an owner;
  - policy-controlled discovery: of three packages the requester sees
    one; the Finance-only and agent-only ones are 404 and 403;
  - a request: a short justification and too long a duration are 400;
    risk high, 30 days; a duplicate is returned;
  - the chain: manager, then package owner (read-only role); the
    assignment then has two pending items; the package cannot be
    requested again;
  - holder visibility: own, and the owner sees them; not others';
  - a failed item makes the assignment partially failed; fixing it makes
    it active; read-only cannot record outcomes;
  - removing content invalidates a waiting approval;
  - direct assignment to an AI agent (read-only 403, an ineligible
    person `NOT_ELIGIBLE`);
  - an end date in the past means expired, with revocation work, then
    removed;
  - revoking the requester's assignment turns both items into removal
    work;
  - the screens;
  - another organization gets 404 or an empty list everywhere.
- `approval-engine`, `request-catalog` and `navigation-smoke` re-run:
  58/58.
- **Full Playwright suite** (§17.8: migration, the approval engine,
  navigation): **292 passed, 1 failed, 6 did not run** (20.3 minutes).
  - The failure was the approval-engine spec's first serial step, which
    timed out at the default 30 s during a slow run. The remaining steps
    of that serial group were skipped as a consequence.
  - That spec, like `access-packages.spec`, now allows 90 s per step. The
    step makes many sequential live calls; nothing in the product
    changed.
  - Re-run alone on the same build: **15/15**. Every spec in the suite
    therefore passed on this build.
- **Screenshots:** browse (light), manage (dark), detail (light 1440 and
  dark 390), new package.
  - Fix from them: every member could see every holder of a package.
    Holders are now limited as above.

**Left out:**

- provisioning into target systems: INTEGRATION-P0-13 takes over the work
  items;
- extension requests;
- package certification campaigns (the Compliance module);
- recommended packages, and packages containing roles (ACCESS-P0-21
  roles);
- birthright auto-assignment (with IDENTITY-P0-18's lifecycle).

### 2026-10-10 — CSV import into the Access pages (preview, then add and update)

**Why.** User decision (2026-10-10): importing a CSV on an object page adds
new records and updates existing ones, after a preview. Additive only:
nothing absent from the file is removed, revoked or deactivated.

**What changed.**
- Pure rules, `fileImportRules.ts` (#9): which existing record each row is,
  and what would change.

  | Kind | Matched by | Refused (invalid) when |
  |---|---|---|
  | application | WonderID id, then name | it would take another application's name |
  | entitlement | WonderID id, then application + name | the application does not exist; the privilege is unknown |
  | account | WonderID id, then application + external id | status, type or date is invalid |
  | access | account + entitlement | the account is not an AI agent's |

  - A second row for the same record goes to review.
  - An application is renamed only when the row names it by its id.
  - An account's `owner` links an unlinked account (`correlation:
    manual`); an account already linked keeps its owner.
  - Access is added only to an AI agent's account, the same rule as a grant
    made by hand; existing access is left as it is.
- Service, `fileImport.ts`: `previewAccessImport()` and
  `applyAccessImport()`, exported from `service.ts`.
  - It reads lookups a page at a time (PostgREST's 1,000-row cap) as the
    user under RLS, filtered on the tenant.
  - It re-plans at apply time, so a stale preview cannot write the wrong
    record.
  - Applications go through `registerApplication` / `updateApplication`
    (validated, audited per record).
  - Entitlements and accounts are inserted in batches of 500, falling back
    to one row at a time so each failure is reported against its row.
    Updates go row by row. Each import writes one audit event
    (`entitlement.imported`, `account.imported`) with the ids it touched.
  - Access goes through `createManualAccessGrant` (separation of duties and
    audit, as by hand).

**Verified.**
- `fileImportRules.test.ts`: 7 tests, passed.
- The Access suite is green within the 617-test run recorded in the
  Integration log.
- No migration: every column used exists (checked against the dev database).

**Left out.** Revoking access, deactivating accounts, or deleting anything
missing from a file. That is deliberately not part of an import.

## 2026-10-10 — ACCESS-P0-24: access ledger and provenance; people's access from files

Owner decisions: record people's access (yes); the go-live cut-off that
would classify access as ROGUE or LEGACY is deferred, so nothing is
labelled rogue yet (ACCESS-P0-25).

**What changed.**
- Migration `0114_access_ledger.sql` (applied to the dev database).
  - `access_ledger`: one row per account and per entitlement of an account
    (unique `(tenant_id, account_id, entitlement_id) nulls not distinct`).
    Same-tenant composite foreign keys to the account, entitlement,
    application, identity, request, package assignment and integration.
  - `access_ledger_events`: the history. It is append-only through a
    trigger; only the cascade of a deleted organization may delete from it.
  - RLS: members read their own organization's rows. There is no client
    write policy; the service writes.
- Rules, `ledgerRules.ts` (pure, deterministic, #9). Evidence is a WonderID
  record only:
  - an approved or fulfilled `grant` request for the same person or agent,
    application and entitlement (a request for an entitlement also
    explains the account);
  - a fulfilled item of an access-package assignment;
  - an administrator's grant, from `createManualAccessGrant`'s
    `access.grant_created` audit event. This counts only for access
    WonderID granted, never for access a connection reported.

  Status:

  | Status | When |
  |---|---|
  | VALID | the evidence is current |
  | EXPIRED | the request's expiry or the assignment has passed |
  | REVOKED | the access was revoked in WonderID, or its assignment was revoked |
  | UNPROVEN | there is no evidence; the source is IMPORT when a connection or file reported it, otherwise UNKNOWN |

  - Current evidence wins over ended evidence.
  - Missing evidence is never filled in.
  - History events: recorded, changed (status or source),
    missing_from_source, seen_again.
- Service, `ledger.ts`: `refreshAccessLedger(tenantId, { identityId? })`.
  - It uses the service role, with every query filtered on the tenant and
    every row checked against it (§14).
  - It pages past PostgREST's 1,000-row cap.
  - Inserts tolerate a concurrent refresh (`ignoreDuplicates`).
  - A row is updated only when a value changed, compared as instants and
    key-order-free JSON; a second run writes nothing.

  It runs:
  - after a file import of accounts or access;
  - after an account reconciliation;
  - on the daily `/api/cron/access-governance` sweep, for all
    organizations, after the expiry sweeps;
  - for one identity when its Access tab opens.

  A failed refresh never undoes the import that triggered it.
- View: an **Access** tab on the identity page (`access.read`) answers "why
  does this identity have this access?".
  - One line per account or entitlement, with the source, a link to the
    request, approval and end dates, and "not found in the source".
  - Status badges: Approved, Approval expired, Revoked, No approval found.
  - If the refresh fails, the tab says the list may be out of date
    (§17.5).
- **People's access from files.** A CSV of access is now recorded for any
  account (a person's or an agent's) as what the target system reports.
  - It is written to `access_grants` with `source_integration_id` set to the
    File imports connection, plus one `access_grant.imported` audit event.
  - It no longer goes through `createManualAccessGrant`: a file is not a
    grant someone made, so it carries no approval and the ledger shows it
    as UNPROVEN.
  - Separation of duties still guards grants made by hand.
  - New rule: an entitlement must belong to the account's application.

**Verified.**
- `npx vitest run modules/access-governance/ledgerRules.test.ts
  modules/access-governance/fileImportRules.test.ts`: 27 passed.
- `npm run typecheck`: clean. eslint on every changed file: clean.
- `tests/access/access-ledger-isolation.sql`: 12 of 15 checks run through
  execute_sql, all passed. It runs in one block that rolls itself back.
  - Uniqueness ×2.
  - Cross-tenant account, entitlement and identity refused.
  - Unknown status refused.
  - History update refused.
  - A member sees their own 2 rows and 1 event, and 0 of another
    organization's.
  - A member's update changes 0 rows; a member's insert into either table
    is refused (42501).
  - The 3 `[delete]` checks need the SQL editor: the tool refuses
    statements containing a delete.
- A live refresh of the demo organization (Northwind) recorded 3
  relationships, all UNKNOWN / UNPROVEN: the seed data has no approvals,
  which is the truthful answer. A second run changed nothing. The view's
  embedded select was checked against the same rows.
- Advisors: no new security or performance finding for the new tables
  (their indexes show as unused only because they are new).
- E2E: `file-import.spec.ts` has a new test that imports a person's
  application, entitlement, account and access, then checks that their
  Access tab shows "No approval found" twice.
  - Run locally, not on Vercel: Vercel's daily deployment limit was
    reached.
  - `file-import.spec.ts` + `identities.spec.ts`: **27 passed, 0 failed** in
    2.6 min.
  - The first local run failed 2 tests:
    - The new test hit the 30 s timeout. Four imports through the File
      imports connection take longer, so it is now `test.slow()`.
    - `identities.spec.ts`, "the overview … links to each list", did not
      find its machine identity on page one of the list. The shared E2E
      organization keeps every run's identities (77 machine identities), so
      the test now searches for its own.

**Left out / handed on.**
- ROGUE and LEGACY_EXCEPTION, and the drift findings, belong to
  ACCESS-P0-25, after the owner sets the cut-off.
- The role, lifecycle, emergency, legacy and agent-authorization sources
  wait for those features.
- Connectors reconcile accounts only (`reconcileApplicationAccounts`).
  Their entitlements and access reach the ledger once connector access
  reconciliation exists (Integration follow-up).

### 2026-10-10 — Record provenance columns (Foundation migration 0115, owner request)

Foundation's migration 0115 added `created_at`, `updated_at`, `created_by`
and `updated_by` (where missing) and the `record_provenance` trigger to this
module's object tables: `applications`, `accounts`, `entitlements`, `access_grants`, `access_requests`, `access_request_approvals`, `access_request_policies`, `access_packages`, `access_package_resources`, `access_package_assignments`, `access_package_assignment_items`, `data_sources`, `policies`, `application_onboardings`. Additive; no service changed. The rule is
CLAUDE.md §19.10; the mechanism and its verification are in the Foundation
log, the page work in the Experience log. A new object table of this module
follows the same pattern and joins `lib/provenance/tables.ts`.

## 2026-10-10 — ACCESS-P0-26: SoD rules and conflicts pages; organization-wide entitlement list

**Why.** Owner request: a SOD area with real pages, and Entitlements under
Admin. SoD rules lived only inside identity policies, and entitlements
were listed only per application.

**What changed.**
- `modules/access-governance/sodRules.ts`: `listSoDRules()` reads identity
  policies with their rules under RLS and by tenant, and `sodRulesFrom()`
  keeps exactly the rules `checkSoD()` enforces (an `rbac` rule with two or
  more distinct string `conflictingActions`), never another tenant's,
  ordered in effect, draft, then the rest. `toSoDConflict()` reads one
  `access.sod_conflict` audit entry (`SOD_CONFLICT_ACTION`); a refused
  conflict is `blocking: true` or a failed outcome.
- `modules/access-governance/entitlements.ts`: `listEntitlementInventory()`
  pages and counts at the database (50, at most 200), ordered by name then
  id, searching one escaped `ilike` on the name (no string-built `or()`
  filter, §18.3.8).
- Pages: `/sod` (`policy.read`), `/sod/conflicts` (`audit.read`, through
  Operations' `listAuditLogs()`, keyset on the audit time),
  `/access/entitlements` (`access.read`). Rules are still added on the
  policy's page; entitlements are still changed on the application's page.
- `modules/access-governance/sodRules.test.ts`: 6 tests.

**Security.** All reads run as the user under RLS with an explicit tenant
filter; no service role. The conflicts page needs `audit.read` because it
shows audit records. No schema change.

**Verified.** As in the Experience log for EXPERIENCE-P0-27.

### 2026-10-10 — Reads the organization's Global Configuration (owner request)

`modules/access-governance/accounts.ts` and `accountRules.ts`: the dormant threshold, when not given, is the organization's setting (`access.dormantDays`); `parseDormantDays()` takes a fallback; the Accounts page and `/api/v1/access/accounts` start from it. Defaults equal the previous constants. Cross-module change by explicit
owner request; the mechanism is Foundation's `lib/config` (CLAUDE.md §19.11,
Foundation log).

## 2026-10-11 — Account reconciliation run by the system (for INTEGRATION-P0-19)

Integration's post-sync chain (INTEGRATION-P0-19) reconciles accounts after
every full sync, in the background with no session, so Access publishes two
additions in `modules/access-governance/accounts.ts` (exported from
`service.ts`):
- `reconcileApplicationAccountsAsSystem(tenantId, applicationId)`: the same
  reconciliation as `reconcileApplicationAccounts()`, through one shared
  core. It uses the service role; every read and write names the tenant,
  which the caller reads from the connection's row (§14). Recorded with
  `triggered_by` null and audited as the system (`account.reconciled`).
- `listApplicationsReconciledFrom(tenantId, integrationId)`: the
  applications whose promoted configuration names the connection.

The user path is unchanged, except that the connector read it uses
(`getNormalizedObjects`) now pages past 1000 rows. Before, an application
with more than 1000 imported accounts had the rest marked "not in source".

**Verified.** Typecheck; `modules/access-governance` unit tests pass in the
484/484 run; the system path is exercised through `syncPipeline.test.ts`.

## 2026-10-11 — Entitlement and access-grant reconciliation from connectors (ACCESS-P0-27, F1, #44)

A connector's entitlements and who holds what now land in `entitlements`
and `access_grants` for an onboarded application whose live configuration
takes entitlements from the connector, and stay in step with the source.

**What changed.**
- Migration `0119_access_connector_entitlements.sql` (applied):
  - `entitlements.source_integration_id` (same-tenant FK) and `external_ref`,
    unique per application and connection; `missing_from_source_at` on
    entitlements and access grants;
  - `access_reconciliation_runs` (RLS: members read their own; only the
    service role writes), with counts, samples and the plan hash;
  - indexes covering every new foreign key (one follow-up migration added
    the FK-ordered ones the advisor asked for).
- `connectorAccessRules.ts` (pure):
  - an entitlement is matched by the connection's id; a hand- or file-made
    one with the same unique name is adopted; same-name ambiguity is refused;
  - a grant maps the connector's account id through the promoted identifier
    field (`accountRefOf`, shared with account reconciliation);
  - access held from elsewhere for the same account and entitlement counts
    as present (no duplicate);
  - a full run marks what the connection brought before and no longer lists;
    an incremental run never removes; anything listed again is restored;
  - `planFingerprint()` for the preview check.
- `connectorAccess.ts`:
  - `reconcileApplicationAccess()` (a person: a preview that changes
    nothing, or an apply that, given the preview's id, refuses with 409
    `PLAN_CHANGED` if the plan differs) and
    `reconcileApplicationAccessAsSystem()` (Integration's post-sync step);
  - service role with the tenant on every query and every row checked;
  - audited `access.reconciled` (user or system); the ledger refreshes after
    an apply.
- Ledger: a grant's own `missing_from_source_at` now drives its ledger row,
  so removal at the source and return are `missing_from_source` and
  `seen_again` events.
- `POST/GET /api/v1/access/applications/{id}/access-reconciliations`.
- Application page: "Preview access from the connector", then "Apply these
  changes", with counts and folded examples.
- The INTEGRATION-P0-19 chain gains an `access` step after the account
  steps, for applications whose entitlements come from the connector.

**Verified.**
- `tests/access/connector-access-isolation.sql`: 10/10.
- Vitest:
  - `connectorAccessRules.test.ts` 12;
  - `connectorAccess.test.ts` 8: a preview writes nothing; an apply equals
    its preview; a stale preview is refused and writes nothing; a re-run
    changes nothing; a removal is marked (not revoked or deleted) and
    restored; system audit; refusals;
  - pipeline tests +2;
  - `modules/access-governance`, `modules/integrations`,
    `tests/architecture` and `lib/config`: 498/498 before the service test.
- Typecheck, eslint and `next build` are clean. Advisors: the new FKs are
  covered and there are no new security findings.

**Left out.**
- Readers of current access (effective access, CAN, runtime decisions)
  still count a grant marked missing from the source, as they already do for
  accounts. Classifying it (unproven, removed, rogue) is ACCESS-P0-25.
- No pre-merge E2E run; the nightly suite covers it.

## 2026-10-11 — Imported access classification and drift findings (ACCESS-P0-25, F1, #45)

Every imported account and grant now says whether WonderID can prove it was
approved, and access that appeared on a target outside WonderID raises a
finding.

**What changed.**
- Migration `0120_access_classification_rogue_findings.sql` (applied):
  - `access_baselines`: one per application and scope (`accounts`, or
    `access` for entitlements and grants); members read, the service writes;
  - Risk's `risk_findings` widened for findings about an account (recorded
    in Risk's audit log).
- `ledgerRules.classifyUnproven()`: reported access with no evidence is
  LEGACY_EXCEPTION if first seen at or before the application's baseline,
  ROGUE if after, and UNPROVEN while there is no baseline. Access nobody
  reported stays UNPROVEN. Evidence (a request, package or administrator
  grant) still makes it VALID.
- `ensureAccessBaseline()`: the first applied account reconciliation, and
  the first applied entitlement and access reconciliation, record the
  baseline for their scope.
- `refreshAccessLedger()`: a whole-organization refresh hands the complete
  rogue set (still present at the source) to Risk's
  `syncRogueAccessFindings()`; a one-identity refresh leaves findings to the
  next full one.
- Account page: an Access card lists the account and each entitlement with
  its classification, its source and any open finding.
  `getAccountAccessLedger()` reuses the identity reader's query.
- CLAUDE.md §3: the owner's rules of 2026-10-11 (no speculative
  abstractions, no features outside the task, boring and simple, preserve
  working behavior, short specs).

**Verified.**
- `tests/access/classification-isolation.sql`: 12/12.
- Vitest: `ledgerRules.test.ts` +7 (legacy, rogue, authorized despite the
  baseline, unproven before a baseline, unreported never rogue, revoked
  wins, event); `accessFindings.test.ts` 6.
- Full suite 1185/1185.
- Typecheck, eslint and `next build` are clean.

**Left out.**
- No notification for a new rogue-access finding: Operations has no
  matching type yet, and the agent-only `rogue_agent` type does not fit.
  The finding is on the account page and in the audit trail.
- Risk's existing findings pages stay agent-only; listing access findings
  there belongs with RISK-P0-13 (remediation) in F3.
- Readers of current access (CAN, runtime decisions) are unchanged.

## 2026-10-11 — Non-human accounts and agent accounts in reconciliation (for IDENTITY-P0-20)

- `accountRules.planReconciliation()`:
  - links an account to the agent that declares one of its identifiers (the
    account key, or `clientId`, `appId`, `servicePrincipalId`, `objectId` or
    `externalId` in the source);
  - lists non-human accounts no person matches (`nonHumanTypeOf()`, from the
    source's `accountType`), with the source's `owner`, and types them
    service or shared.
- `reconcileAccounts()` loads the agents' identifiers, has Identity create or
  find each non-human identity (`ensureAccountIdentities`), and links the
  accounts to them (counted as correlated, not orphan).
- `requestRules.isUnownedNonHuman()`: the request catalog and access packages
  refuse an unowned machine, service account, workload, application or API
  subject (409 `SUBJECT_UNOWNED`), on the server.

**Verified.** `accountRules.test.ts` +3 (non-human listed with owner, and
service/shared types; a person match wins; agent linked by declared
identifier and never made a service identity); `requestRules.test.ts` +1;
full suite 1191/1191.

### 2026-10-11 — Two fixes found by QA-P0-23

- **Onboarding validation with connector entitlements.** "Entitlement model
  discovered" counted only the application's WonderID entitlements. With
  `entitlementSource: connector` those arrive only after promotion
  (ACCESS-P0-27 reconciles a promoted application), so validation could
  never pass. `onboarding.ts` now counts the larger of the application's
  entitlements and the connector's staged entitlements for it
  (`belongsToApplication`), read as the user under RLS. Simulation uses the
  same count.
- **Request refusal order.** `evaluateRequest` checks for an unowned
  non-human subject first, before the policy, so the refusal names the real
  reason.

**Verified.** `tests/e2e/f1-reconciliation.spec.ts` 14/14 locally;
`vitest run modules/access-governance` 222/222; typecheck clean.

### 2026-10-11 — ACCESS-P0-28: approved requests become pending grants, verified by reconciliation (#50)

**Decision (owner, asked directly).** The design's model was kept: an approved
request becomes an `access_grants` row with a fulfilment status, and a
placeholder account holds it when the subject has none yet. The alternative,
tracking state on the request alone, was not chosen.

**Migration 0121 (applied to dev).**
- `access_grants` gains:
  - `fulfilment_status`: `none` for recorded access (every existing row),
    `pending_fulfilment`, `fulfilled_unverified` or `verified`;
  - `request_id` and `access_package_assignment_item_id`, both same-tenant
    keys;
  - `verified_at`, required exactly when the status is `verified`.
- Unique keys: one grant per request and entitlement, and one per package
  item.
- `accounts` accepts `status 'pending'` and `source 'request'` for
  placeholders.
- No client write policy was added.

**Service** (`pendingGrants.ts`, rules in `pendingGrantRules.ts`).
- **On approval:**
  - `pendRequest()` runs at the final step of a catalog request's chain, on
    auto-approval, and on an agent request's approval.
  - `pendAssignment()` runs when a package assignment is created, whether
    from a request or directly.
  - Each line with an entitlement gets a pending grant on the subject's one
    real account. With no account, a placeholder `pending:<identity>` is
    created; with several real accounts, nothing is chosen and the case is
    audited as a failure.
  - If the access already exists, that grant is linked instead of
    duplicated.
  - Failures are audited (`access.grants_pending`) and never undo the
    approval.
- **Mark fulfilled** (a request, or a package item) makes the grant
  `fulfilled_unverified`. Fulfilling a request no longer overwrites
  `decided_by`/`decided_at`, which are the approval the ledger shows.
- **Ending an assignment** withdraws (revokes) the grants still pending.
- **Reconciliation:**
  - Account reconciliation leaves placeholders out of its plan, so they are
    never matched or marked missing. When the subject's one real account
    appears, the placeholder's grants move onto it and the placeholder is
    removed (`replacePlaceholders`, audited).
  - Access reconciliation (`planGrants().verified`) marks a pending or
    unverified grant the source lists as `verified`. From then on the grant
    belongs to that connection, so a later full run can mark it missing.
    Verified grants are part of the preview fingerprint and counts.
- **Readers of effective access** skip `pending_fulfilment`:
  - `getEffectiveAccess`, so SHOULD/CAN/DID and certification;
  - the agent and application grant lookup;
  - the runtime decision loader;
  - data-source reach;
  - the grants export.
- **Ledger:** a pending or unverified grant, and a placeholder account, is
  `PENDING_RECONCILIATION` (approved, not yet real), and becomes VALID once
  verified.
- **Request page and API:** the request page shows "Approved · waiting for
  fulfilment", "Fulfilled · not yet verified" or "Verified at the source".
  `GET /api/v1/access/requests/<id>` returns `grants` and `fulfilment`.

**Verified.**
- `tests/access/pending-grants-isolation.sql` 10/10:
  - cross-tenant request key refused;
  - duplicate refused;
  - `verified` without a time refused;
  - placeholder stored;
  - a member can neither create, fulfil nor verify a grant;
  - the other organization sees none.
- Vitest `modules/access-governance` 231/231, plus operations and runtime
  (346 across the three). New tests:
  - `pendingGrantRules.test.ts` (6);
  - grant verification in `planGrants`;
  - PENDING_RECONCILIATION in the ledger;
  - data-source reach ignores pending grants.
- E2E (local, dev Supabase):
  - `f1-reconciliation.spec.ts` 15/15, with a new test covering the whole
    chain: request → placeholder + pending grant → fulfilled, unverified →
    account arrives (grant moved) → grant arrives (verified, ledger VALID,
    no finding);
  - `request-catalog`, `approval-engine`, `access-packages` and `sod`
    31/31.

**Left out.**
- Account requests, i.e. a line for an application with no entitlement
  (ACCESS-P0-30).
- Fulfilment tasks (ACCESS-P0-29).
- Verification from page CSV imports (`fileImport.ts`); connector syncs,
  file connections included, do verify.

### 2026-10-11 — ACCESS-P0-29: fulfilment tasks (#51)

**Built.**
- **Migration 0122 (applied to dev):** `access_fulfilment_tasks`.
  - One task per pending grant, with same-tenant keys to the grant, request,
    application and assignee identity.
  - Status is open, claimed, completed, failed, verified or cancelled. A
    failure must carry a reason; a claim must say who.
  - Due time, reminder time, members read their own organization's tasks,
    and no client write policy.
  - `access_grants` gains a `(id, tenant_id)` unique key for the
    same-tenant key.
  - The notification type `fulfilment_task` is added to Operations'
    checks, additively, as in 0085 and 0102.
- **Global Configuration** `access.fulfilmentSlaDays` (1–30, default 3).
- **`fulfilmentTasks.ts`** (rules in `fulfilmentTaskRules.ts`):
  - **Opening:** a task opens with each new pending grant
    (`pendingGrants.pendGrant`). It is assigned to the application's
    technical owner, else its business owner, who is notified when they
    sign in to WonderID.
  - **Actions:** claim (open or failed), complete with an optional note
    (the grant becomes `fulfilled_unverified`), or fail with a reason. The
    owner or anyone with `access.approve` may act; once claimed, only the
    claimer or an access manager may finish it. Each action is a
    conditional update and is audited.
  - **Closing:** "Mark fulfilled" on a request or package item completes
    the tasks. Withdrawn grants cancel them. Reconciliation closes them as
    verified (`connectorAccess.applyGrants`).
  - **Reminders:** the daily access-governance cron reminds the owner of
    each overdue task, at most once a day.
- **Page and API:**
  - Home › Access Governance › Fulfilment Tasks (`/access/fulfilment`):
    still-to-do tasks soonest due first, or all. Each row has one next
    step: Claim, then Done with a note. "Report a problem" is folded.
  - `GET /api/v1/access/fulfilment-tasks` (`?view=all`, `?requestId=`) and
    `POST /api/v1/access/fulfilment-tasks/<id>` (`{ action, note }`).

**Verified.**
- `tests/access/fulfilment-tasks-isolation.sql` 8/8:
  - a task naming another organization's grant is refused;
  - a second task for the same grant is refused;
  - a failure without a reason is refused;
  - a member reads their own organization's tasks, but cannot complete or
    create one;
  - another organization sees none and can change none.
- Vitest: `fulfilmentTaskRules.test.ts` (5); config and shell-nav tests
  updated. Access, config and UI suites 347/347.
- E2E (local):
  - `f1-reconciliation` 15/15. Covered: a task opens for the application
    owner; an access manager completes it; the request is then fulfilled
    but not yet verified; a failure without a reason gives 400; claiming a
    completed task gives 409; the task is verified after reconciliation;
    the page lists it; another organization neither sees nor acts on it
    (404).
  - `access-packages`, `request-catalog` and `shell` also pass: 42/42 in
    the run together with F1.

**Left out.**
- A group as assignee: applications have no fulfilment group yet (onboarding
  templates, ACCESS-P0-34).
- Tasks for applications with write capability go to provisioning in F3.
  Until then every pending grant gets a task.
- The single inbox for approvals and tasks is EXPERIENCE-P0-29.

### 2026-10-11 — ACCESS-P0-30: remove-access and account requests (#52)

**Built.**
- **Migration 0123 (applied to dev; additive, nothing dropped):**
  - `request_type` gains `remove` and `disable_account`;
  - `access_grants.removal_status` (`pending_removal` → `removed_unverified`)
    and `removal_request_id`;
  - `access_fulfilment_tasks.kind` (grant, remove, create_account,
    disable_account), with `removal_grant_id` and `account_id`, a check that
    each kind names its subject, and one live task per grant or account and
    kind.
  - The first draft dropped and recreated two unique indexes; the database
    tool cancels `drop index`. So the waiting-request key stays as it was, a
    second waiting request of another type gets 409
    `ANOTHER_REQUEST_WAITING`, and removal tasks reference their grant
    through their own column.
- **Submitting** (`submitAccessRequest`, `requestType`):
  - A removal must name access the subject holds: live, not still pending,
    and not already being removed. A disable needs an active account.
    Otherwise the answer is 409 `NOTHING_TO_CHANGE`.
  - Both are low risk and have no duration.
  - A grant request with no entitlement asks for an account.
- **On approval** (`pendRequest`):
  - **Account request:** with no real account, a placeholder and a
    create-account task.
  - **Removal:** the grant becomes pending removal (it is still access) and a
    removal task opens.
  - **Disable:** a task for the one active account. Several accounts are
    not guessed between; the case is audited instead.
- **Done** on a task, or "Mark fulfilled" on the request
  (`markRequestFulfilled`), records the change as made but not yet seen.
- **Verification:**
  - A full access reconciliation that no longer finds a grant with an
    approved removal revokes it. The plan counts it as `revoked`, and the
    ledger shows REVOKED.
  - Account reconciliation closes create-account tasks when the placeholder
    is replaced, and disable tasks when the account shows disabled or is no
    longer listed (`verifyDisabledAccounts`).
- **Request form:** a folded "Remove access or disable the account instead".
  The default request is unchanged.
- **Request page and API:** progress comes from the request's tasks, worded
  for what was asked: "waiting for removal", "Removed · not yet verified",
  "Removal verified at the source", and so on.
- **Fulfilment Tasks:** each row says Add, Remove, Create account or Disable
  account.

**Per-line approval.** Every request is one line with its own approval route,
so a line is approved on its own. Multi-line baskets ("request baskets") are
a separate item in the design (§10, Access), not built here.

**Verified.**
- Vitest: access, UI and config suites 350/350. New tests:
  - removal confirmed only by a full run;
  - `requestProgress` (2 cases).
- E2E (local):
  - `f1-reconciliation` 16/16. The new test runs: remove → done →
    unverified → the source drops it → revoked, REVOKED in the ledger,
    verified; disable → done → the source shows it disabled → verified; a
    new account → placeholder and task → the account arrives → verified,
    placeholder gone.
  - `request-catalog`, `approval-engine`, `access-packages` and `sod`
    31/31.

**Left out.**
- Request baskets.
- An approved grant request with no end date still answers as "open" when
  the same access is requested again. This was true before; noted for
  ACCESS-P0-32 (time-bound access).

### 2026-10-11 — ACCESS-P0-31: requests for non-human identities; AI agents within their contract (#53)

**What changed.** Owners can now request access for what they own, through
the same catalog, approval chain, pending grant and fulfilment task as
people. No migration.

- **Service accounts and machine identities** (SERVICE_ACCOUNT, MACHINE,
  WORKLOAD, APPLICATION, API). The identity's owner may request for it as a
  manager may for a report: the policy must allow requests for others
  ("managers"). Someone who does not own it, and is not an access manager,
  is refused (`REQUEST_SCOPE`). Unowned identities are still refused first
  (IDENTITY-P0-20).
- **AI agents.** This replaces the earlier refusal ("an AI agent's access is
  requested from the agent").
  - Only the agent's business owner may request for it (`REQUEST_SCOPE`
    otherwise, even for an access manager).
  - A grant line must be within the agent's active contract, decided by
    `classifyAccessGrant()` (the same SHOULD vs CAN check Risk uses):
    - the application, by name or display name, is an approved application;
    - the entitlement's data classification is in the approved data, and
      not in the prohibited data.
  - No active contract → `NO_ACTIVE_CONTRACT` (409); outside it →
    `OUT_OF_CONTRACT` (403). A removal or a disable is always allowed.
  - The agent's separation-of-duties rules run before anything is written
    (`enforceSoD`, as on the legacy agent path).
  - The request names the agent identity and the agent, so the pending
    grant lands on the agent's own account (or its placeholder).
- **Approval routes to the resource's owners** for any non-human subject
  (`routeForSubject()`): a manager route becomes owner approval, because
  the subject has no manager and its owner is usually the requester. Before,
  the identity's owner stood in as manager. Critical risk still adds access
  managers; an owner who cannot sign in falls back to access managers, as
  before.
- **The legacy agent path** (`decideAccessRequest`, the access managers'
  "waiting agent requests") now applies only to requests without a subject
  identity. An agent request from the catalog is decided by its chain, like
  anyone's.
- **Duplicates after the rules.** An identical open request is now returned
  only once the rules allow the requester to ask. Before, anyone re-submitting
  someone else's waiting request got that request back.
- **Request form.** "For" lists what you own, marked "(you own)" or "(your
  agent)". With an agent chosen, only the contract's lines are offered; with
  none, the form says so and cannot be submitted. The server checks again.

**Verified.**
- Typecheck and ESLint clean.
- Vitest: 1219/1219. New tests:
  - owner / non-owner of a service account, and policy scope still
    applying to owners;
  - an agent's owner within, outside and without a contract; an access
    manager who is not the owner;
  - `routeForSubject`.
- E2E (local, dev Supabase):
  - `f1-reconciliation` 17/17. The new test: the owner of a service account
    requests for it (pending; the chain names the application owner, not the
    requester); a non-owner is refused; the agent's business owner gets a
    contract line (201) and is refused an out-of-contract one; an access
    manager who is not the owner is refused; approval puts the pending grant
    on the agent's account with a grant task; the form offers only the
    contract's lines.
  - `request-catalog`, `approval-engine`, `access-packages` and `sod`:
    all passed.

**Left out.**
- The catalog list itself is not narrowed per agent; only the request form
  is. A subject picker across the catalog is EXPERIENCE-P0-29.
- Delegated agent owners do not request; only the business owner.
- Agent access packages and the agent onboarding journey stay with
  IDENTITY-P0-19.

### 2026-10-11 — ACCESS-P0-32: time-bound access (#54)

**What changed.** Access with an end date now ends on time, through the same
fulfilment and reconciliation path as everything else. Migration 0124
(applied to dev, additive).

- **End dates.** A line's duration was already capped by its request policy
  (`DURATION_TOO_LONG`); the end date is the request's `requested_expiry`.
- **Extending** is a new request type, `extend`.
  - It is evaluated like a grant: same policy, same cap, same risk, same
    approval chain.
  - It needs access the subject holds through a request (not a package);
    otherwise it is refused with 409 `NOTHING_TO_CHANGE`.
  - The new end date counts from today.
  - On approval (`pendExtension`), the grant's evidence moves to the
    extension (`access_grants.request_id`). Removal work that the old end
    date had started is called off: the grant is no longer pending removal,
    and its removal task is cancelled. A removal someone asked for is never
    undone.
  - The request page has a folded "Extend" form for the requester or the
    person the access is for, offering durations up to the policy's maximum.
- **Reminder.** Once per request, `access.expiryReminderDays` before the end
  date (Global Configuration, default 7), the requester and the person it is
  for get an `access_expiring` notification. It goes out only for access
  that is held. Sent from the daily cron; claimed before sending, so two runs
  never both remind.
- **At the end date** (`sweepAccessExpiry`, run by the daily cron and by the
  request page for its own organization):
  - each live grant from the request is marked pending removal and gets
    exactly one removal task (`queueRemoval`);
  - grants never fulfilled are withdrawn, and their tasks cancelled;
  - the request is stamped `expiry_processed_at`.

  Idempotent three ways: the grant update is conditional, there is one live
  task per grant (0123), and only unstamped requests are read.
- **Package assignments** that expire or are revoked now also turn the
  access they gave into removal tasks. Before, only the item status changed.
- **Ledger.**
  - Access whose approval has expired is EXPIRED, both before and after
    the source confirms its removal (connector reconciliation revokes it).
    Before this change, the removal made it REVOKED.
  - Among requests for the same access, only the latest decision counts.
    An extension replaces what it extends, even when it ends sooner.
- **Migration 0124:**
  - request type `extend`;
  - `access_requests.expiry_reminded_at` and `expiry_processed_at`, with a
    partial index for the sweeps;
  - notification type `access_expiring`.

**Verified.**
- Typecheck, ESLint and `next build` are clean.
- Vitest: 1222/1222. New tests:
  - `accessExpiryRules` (end, reminder window, once only);
  - the ledger: EXPIRED before and after removal, an extension is current,
    a shortening extension governs;
  - the config default.
- E2E (local, dev Supabase):
  - `f1-reconciliation` 18/18. The new test:
    - 60 days is refused under a 30-day cap; 30 days is approved
      automatically and verified at the source;
    - an extension of 60 days is refused; 14 days is approved, and the
      grant now rests on it;
    - its end date passes: one removal task, and still one after the sweep
      runs again with the request unstamped;
    - the grant is not revoked until the source drops it, then it is
      revoked, the task verified and the ledger EXPIRED.
  - `access-packages`, `request-catalog`, `approval-engine` and `sod`: all
    passed (42 with the above).
  - `file-import` and `mcp-inventory`, which also read the ledger:
    - run together, one `file-import` UI step timed out waiting for "1
      added";
    - `file-import` then passed 17/17 on its own, both on `main` and with
      this change;
    - this change touches no import code. Noted, not root-caused further.

**Left out.**
- No automatic removal: that is F3 (provisioning).
- No reminder E2E: the cron route needs `CRON_SECRET`, which local runs don't
  have. The rule is unit-tested and the sweep is shared with the cron.
- Extending package access stays with the package (its own expiry).

### 2026-10-11 — Service support for EXPERIENCE-P0-29

- `listFulfilmentTasks({ forPerson })`: the tasks waiting for one person.
  These are tasks assigned to them, claimed by them, or (for someone who can
  approve access) with no owner. Read as the member (RLS), filtered by
  tenant.
- `requestProgressFor(tenantId, ids)`: the progress of a page of requests in
  two reads. It uses the service role, filtered by tenant, with each row's
  tenant checked.
- `requestProgress` adds the state `failed`: a task reported failed shows as
  failed until someone takes it up again. Before, it showed as waiting. The
  request API's `fulfilment` field can now be `failed`.
- The fulfilment task action now also refreshes `/access/requests`.

Verified with the EXPERIENCE-P0-29 entry (Experience audit log).

### 2026-10-12 — Fulfilment tasks done by a connector (INTEGRATION-P0-13 slice 1, with ACCESS-P0-29; decision D3)

**Built (migration 0129, `connectorFulfilment.ts`, `connectorFulfilmentRules.ts`).**
- **When the connector acts.** A remove-access or disable-account task is
  carried out by the connector when all of these hold:
  - the account came from a connection with writes turned on that supports
    the operation;
  - for a removal, the entitlement comes from that same connection.

  `openFulfilmentTask()` plans it and runs it after the response. The owner
  is notified only if the connector cannot do it.
- **Steps.**
  1. The task is claimed for the connector (`connector_status` running), so
     never twice at once, and person actions are refused while it runs.
  2. Each attempt has its own idempotency key (`fulfil:<task>:<n>`). A
     network failure, 429 or 5xx is retried twice, after 2 s and 8 s; total
     attempts are capped at 20.
  3. On success the task completes and a removal's grant becomes
     `removed_unverified`, exactly as when a person completes it. A
     verification sync follows; reconciliation closes the task as verified.
  4. On failure the task stays open with `connector_error`, and the owner is
     notified.
- **Try again.** `retry_connector` (API and a folded "Connector → Try again"
  on the task) is open to whoever may claim the task.
- **Lost runs.** The daily access-governance cron hands a run still marked
  running after 15 minutes back to its owner, saying the outcome is
  unknown.
- **Audit.** `access.fulfilment_task_completed` carries `byConnector`,
  `access.fulfilment_task_connector_failed` records failures, and the
  write's own `integration.write_*` entry is correlated.
- **Fulfilment Tasks page.** A badge shows "Connector working", "Done by
  connector" or "Connector failed", and the reason appears on the task's
  line.

**Verified.**
- Rules tests cover: which kinds a connector does, the target through the
  account's own connection (a cross-connection entitlement is refused),
  retry limits and delays, lost runs and keys.
- E2E `connector-provisioning.spec.ts` 5/5 and
  `tests/access/connector-fulfilment-isolation.sql` 7/7 (Integration audit
  log).

**Left out.** Grant and create-account tasks stay a person's work until D3's
second step.

### 2026-10-12 — Connector adds access and creates accounts (INTEGRATION-P0-13 slice 2, with ACCESS-P0-28/29/30)

**Built (`connectorFulfilment.ts`, `connectorFulfilmentRules.ts`, no migration).**
- **Grant tasks.** A grant task on a real account is planned like a
  removal: the account's own connection, an entitlement from that same
  connection, writes on and `grant_access` supported. On success the grant
  becomes `fulfilled_unverified`, as when a person completes it, and
  reconciliation verifies it. A placeholder account is never written to.
- **Create-account tasks.** Planned only for a placeholder (`status
  pending`): the target is the identity's email, username and display
  name (`newAccountTarget`; an email or username is required), through the
  connection the application's live onboarding reconciles against.
- **Access for someone with no account.** When the grant task's account is
  a placeholder and that connection can both create accounts and add
  access (`accountToCreateFirst`), a create-account task opens for the
  placeholder and the connector creates the account; the grant task waits
  and its owner is not notified. The verification sync reads the account,
  `replacePlaceholders()` moves the grant and closes the create task as
  verified, then `resumeConnectorGrants()` sends each open, untouched grant
  task on that account to the connector. If the connector failed to
  create the account, a new grant task notifies its owner as before.
- Every statement is filtered on `tenantId` and every row is checked
  against it (§14); no new table, so the slice 1 isolation SQL still
  covers the columns used.

**Verified.** See the Integration audit log entry of the same date
(typecheck, eslint, 546 unit tests, E2E `connector-provisioning` 8/8).

**Left out.** A grant task waiting for a connector-created account whose
read-back never correlates (e.g. the system changed the email) stays open
with its SLA reminder; it is not escalated sooner.

### 2026-10-12 — High-risk findings review: WID-C01, C02, H04 (CLAUDE.md §19.12)

The first post-merge review checked the access findings against the code;
the evidence is in `docs/WonderID/HIGH-RISK-FINDINGS.md`. Code: no change.
- `requestRules.test.ts`:
  - pins that a policy with threshold `critical` auto-approves high-risk
    requests (WID-C01);
  - renames the test that claimed high risk always needs approval.
- The knowledge base was corrected on approvals, self-approval, expiry and
  rogue closure.
- Owner decisions are listed under "High-risk findings follow-ups" in
  `04-ACCESS-AGENT-BACKLOG.md`. One is a self-approval block on the
  agent-request path, which today is allowed under a flag-only SoD policy
  (`sod.spec.ts`).

Verified: `npx vitest run modules/access-governance/requestRules.test.ts`
passed.

### 2026-10-12 — High risk always needs a person; no self-approval anywhere (WID-C01, owner decisions)

- `needsApproval` now always routes high and critical risk to a person,
  whatever the policy's threshold (`ALWAYS_HUMAN_RISK`).
- `decideAccessRequest` refuses SELF_APPROVAL when the requester approves
  or rejects their own agent request. The check runs after the SoD check:
  a blocking SoD policy still answers SOD_CONFLICT, and a flag-only one
  records the conflict, then refuses.
- `filterToolsForAgent` names emergency controls before lifecycle and
  contract reasons. Each tool is hidden exactly as before; only the
  reported code changes, so the gateway can hide suspended tools in
  Observe mode (WID-C03).

Verified:
- `requestRules.test.ts` and the access suite: 253 passed.
- E2E: `sod.spec.ts`, `request-catalog.spec.ts` and
  `approval-engine.spec.ts` pass.

Tracked in `docs/WonderID/FINDINGS-REMEDIATION.md`.

### 2026-10-12 — Reminders for removals the system has not confirmed (WID-C02)

`remindOverdueFulfilmentTasks` (daily) now also reminds the owner of a
`remove` task that was marked completed (by a person or a connector) but
that no read of the system has confirmed after `UNCONFIRMED_REMOVAL_DAYS`
(2), at most once a day. A pure rule, `needsUnconfirmedRemovalReminder`,
decides.

Verified: `npx vitest run modules/access-governance`, 326 passed with
`lib/security`, including the new rule tests.

Tracked in `docs/WonderID/FINDINGS-REMEDIATION.md`.

### 2026-10-12 — Ended access shows whether it is gone; removals due within a day (WID-C02)

- `endedRemoval` (pure, `pendingGrantRules.ts`) works out, from a
  request's grants, whether ended access is gone:
  - pending: a grant is live and not marked removed;
  - removed, not yet verified: every live grant is marked removed;
  - verified: every grant is revoked;
  - never fulfilled: every grant was withdrawn.
- `grantsForRequest` and `requestProgressFor` now read `removal_status`.
  `requestProgressFor` returns `{ progress, removal }` per request.
- The request list, the request page and `GET /api/v1/access/requests/[id]`
  (new field `removal`) show it. Before this, an ended request showed
  "Ended" whether or not the access was still there.
- `taskDueAt` (`fulfilmentTaskRules.ts`): `remove` and `disable_account`
  tasks are due within `REMOVAL_SLA_DAYS` (1), capped below the
  organization's `access.fulfilmentSlaDays`. The setting's help text says so.

Verified:
- `npx vitest run modules/access-governance lib/config "app/(customer)/access"`:
  274 passed.
- `npm run typecheck` and eslint on the changed files: clean.
- E2E was not run: this is a display change and a shorter deadline, not a
  security-path change (§17.8). The nightly run covers it.

Left out: the urgent leaver path (Identity module). Tracked in
`docs/WonderID/FINDINGS-REMEDIATION.md`.

### 2026-10-12 — A leaver's access becomes removal work; overdue removals escalate (WID-C02)

- `openLeaverRemovals` (new, `leaverRemovals.ts`, published in `service.ts`)
  takes the live grants on a person's accounts:
  - fulfilled grants are marked `pending_removal`, and each gets a
    `remove` task with `reason` 'leaver';
  - grants never fulfilled are withdrawn.

  It never throws: a failure is audited. The audit action is
  `access.leaver_removals_opened`.
- `openFulfilmentTask` takes `reason` and `manual`. A manual task makes no
  connector attempt. Leaver removals are manual. Expiry removals now carry
  `reason` 'expired' and still run through a connector, as before.
- `remindOverdueFulfilmentTasks` escalates a `remove` or `disable_account`
  task that is more than `ESCALATE_AFTER_DAYS` (1) overdue. It goes once
  to every holder of `access.approve` (`needsEscalation`, `escalated_at`).
- Migration 0135 adds `access_fulfilment_tasks.reason` and `escalated_at`.
  It is applied.
- The Fulfilment Tasks page shows "Person left" or "Approval ended" on such
  tasks. The task API gains a `reason` field.

Verified:
- `npx vitest run modules/access-governance modules/agent-identity "app/(customer)/access" lib/config`:
  358 passed.
- `npm run typecheck` and eslint on the changed files: clean.
- E2E, local:
  - `leaver-removals.spec.ts` 2/2 (new) and `human-lifecycle.spec.ts` 7/7;
  - `f1-reconciliation.spec.ts` 13/13, including the time-bound expiry
    test. The first run failed the accounts step at the default 30 s
    limit. It took 26 s locally against the remote database, which this
    change does not touch, and passed with `--timeout 120000`.

Left out:
- the owner decision on connectors carrying out a leaver's removals;
- tests for a connector outage and a failed deprovisioning.

Both are tracked in `docs/WonderID/FINDINGS-REMEDIATION.md`.

### 2026-10-12 — An account matched to a person stays with them (WID-H01)

- `planReconciliation` (`accountRules.ts`): an existing account with
  `correlation: correlated` and a person keeps that person when a fresh
  match would give someone else, no one, or several people. The move is
  recorded in `relinkHeld` (the account ref, the person kept, the match and
  its kind) and counted in `counts.relinkHeld`.
  - Manual links and agents' accounts were already kept.
  - Accounts with no person are matched afresh, as before.
- `reconcileAccounts` stores the count in
  `account_reconciliation_runs.relink_held` (migration 0139, applied). The
  first 100 held accounts go in the `account.reconciled` audit event
  (`relinkHeldAccounts`).
- The sync pipeline's account step carries `relinkHeld`. The connection
  page shows "N kept with their person though they now match someone
  else".

Verified:
- `npx vitest run modules/access-governance modules/integrations`: 622
  passed, including 3 new WID-H01 cases.
- `npm run typecheck` and eslint on the changed files: clean.
- E2E, local: `f1-reconciliation` 13/13 (a production build started with
  the config's test settings).

Left out: merge reversal and a source-priority policy. Both are tracked in
`docs/WonderID/FINDINGS-REMEDIATION.md`.

### 2026-10-12 — Connector tasks: one key per task, read before retrying an unclear change (WID-H02)

With the Integration Agent entry of the same date (the write path).
- `connectorFulfilment.ts` passes `taskKey` (`fulfil:<task>`), so every
  attempt at a task's change sends the system the same key. Attempt
  records keep `attemptKey`.
- An `uncertain` write result is not retried. The task goes back to its
  owner with `uncertainReason` ("the system may have made this change…"),
  `connector_uncertain_at` is set (migration 0142, applied), and a
  verification sync starts. Reconciliation closes the task if the change
  is there (`closeTasksForGrants` already takes open tasks).
- A connector run that never reported back (`releaseLostConnectorRuns`) is
  treated the same way: uncertain, with a verification sync.
- "Try again" (`retry_connector`) is refused with 409 `READ_PENDING` until
  a complete read of the connection, started after the unclear outcome,
  has finished (`retryWaitsForRead`, Integration's `readFinishedSince`).
  The claim clears the mark.

Verified:
- `npx vitest run modules/integrations modules/access-governance`: 633
  passed, plus the restored mass-change guard case (13/13 in
  `connectorWriteRules.test.ts`).
- `npm run typecheck`, eslint on the changed files and `npm run build`:
  clean.
- E2E, local, against the production build:
  `connector-provisioning.spec.ts` 21/21 (8.2 min). New cases:
  - a repeatable change: three tries with one key;
  - a non-repeatable change made, then answered 503: sent once, and
    closed by the read;
  - a non-repeatable change that failed: the retry is refused until the
    held read is released, then works with the same key.
  The first run found a fixture clash (a disabled account, a person the
  F3 test uses); the people were changed.

Left out (tracked): process-level crash tests, and compensation for an
account created whose access was not added.

### 2026-10-12 — Crash and timeout tests for connector tasks (WID-H02)

- New `modules/access-governance/connectorFulfilment.test.ts`: the service
  against an in-memory stand-in for the service-role client, with
  integrations mocked. Five cases:
  - a run lost mid-write (started 20 minutes ago) goes back to its owner
    as unclear (`connector_uncertain_at`), with a verification sync; a
    recent run and another organization's run are untouched;
  - an unclear result is attempted once, never retried, and read;
  - a 429 is retried with the same `taskKey` and a new attempt key, then
    completes;
  - a task already running returns `busy` without a write;
  - another organization's task is never claimed.
- Decided and recorded in the tracker: no automatic compensation for an
  account created whose access was not added. The access task stays with
  its owner (non-negotiable #15).

Verified: `npx vitest run modules/access-governance/connectorFulfilment.test.ts`
5/5; eslint and `tsc --noEmit` clean. No product code changed.

### 2026-10-12 — Disable a leaver's account through its connection (WID-C02, owner decision)

The owner chose, in the findings decision sheet: the connector disables a
leaver's account at once; removing each access stays a person's task.
- `openLeaverRemovals` (`leaverRemovals.ts`) now also calls
  `disableOnLeave`. For each of the person's accounts that
  `accountsToDisableOnLeave` keeps (an id on the system and its
  connection, not disabled, not a placeholder), if `connectionCanWrite(...,
  "disable_account")`, it opens a `disable_account` task with reason
  `leaver`. That task is not manual, so `openFulfilmentTask` plans it and the
  connector runs it at once: mass-change guard, one key per change,
  verification sync, failure to the application's owner.
- The leaver audit event lists `disablingAccountIds`; the function returns
  `disabling`.
- This is the approved automation path under non-negotiable #15.

Verified:
- `npx vitest run modules/access-governance modules/agent-identity`: 356
  passed, including `accountsToDisableOnLeave`.
- `npm run typecheck`, eslint on the changed files and `npm run build`:
  clean.
- E2E, local against the production build: `connector-provisioning` and
  `leaver-removals`, 24 passed (9.0 min). In "WID-C02 leaver", eve leaves
  with changes on: exactly one write (`PATCH /users/u-eve`), the disable
  task succeeds with reason `leaver`, and her access removal stays a
  person's task through the outage and the unconfirmed removal.

### 2026-10-12 — unlinked accounts go back for matching (WID-H01, owner decision)

- Migration 0149 (applied, additive) adds two columns to `accounts`:
  - `unlinked_identity_id`, with a same-tenant composite foreign key and
    on delete set null;
  - `rematch_requested_at`.
- `linkAccount`: an unlink records the person it was unlinked from; a link
  by hand clears it.
- `planReconciliation`:
  - a match to `unlinkedIdentityId` stays an orphan;
  - a correlated account with `rematchRequested` is matched afresh,
    without the hold that keeps an account with its person;
  - every upsert clears `rematch_requested_at`.
- `requestAccountRematch(tenantId, identityId)` (service role, tenant
  filter) flags the person's automatically correlated accounts. Manual
  links and agents' accounts are left alone. Integration's
  `unlinkSourceRecord` calls it when the unlink restored email, username or
  display name. It loads the Access service at call time, because Access
  already imports the Integration service.

Verified:
- typecheck, eslint on the changed files, `npm run build`: clean;
- `npx vitest run modules/access-governance
  modules/integrations/identitySourceRules.test.ts`: 313 passed,
  including the two new `accountRules.test.ts` WID-H01 cases.
- E2E, run locally:
  - `account-inventory` run on its own: 15 passed, including the two new
    WID-H01 cases;
  - in a combined run with `identity-sources` and `f1-reconciliation`:
    37 passed, 1 failed. The failure was "the inventory screens list,
    filter and link accounts": the Link account save was still running at
    the 10 s assertion. The same save took 12.4 s in the whole test when
    the spec ran alone, and it passed.
  - Not caused by this change, which adds one nullable column to that
    update. The slow save is worth a look on its own.

### 2026-10-12 — WID-H07 (owner decision)

Typed text out of audit records: approval comments, fulfilment notes (a claim note is now kept on the task), onboarding decision notes, application lifecycle reasons (now kept in `applications.lifecycle_note`, migration 0150), and package justifications, item details and revocation reasons. Each is passed as `typedText` and stored only as a fingerprint. See the Foundation entry for the mechanism.

### 2026-10-12 — WID-H07, identifiers only

WID-H07 identifiers only: `account.reconciled` lists held accounts by `accountId`, not by their external login (`ref`).

### 2026-10-13 — Birthright packages (ACCESS-P0-20, for IDENTITY-P0-18; owner decision)

Owner decision: birthright is pre-approved. Marking a package birthright
takes two administrators, and that is the approval (non-negotiable #15's
explicitly approved automation path).

- **Migration 0151 (applied):**
  - `access_packages.birthright_status` (off / pending / on), with
    `birthright_requested_by`, `birthright_approved_by` and
    `birthright_approved_at`;
  - check `access_packages_birthright_four_eyes`: 'on' needs an approver
    other than the requester;
  - `access_package_assignments.source` gains 'birthright'.
- **Rules (`packageRules.ts`):**
  - `birthrightTransition`: request, approve (four-eyes), off;
  - `birthrightNeedsReapproval`: contents or eligibility changed while on;
  - `birthrightApplies`.
- **Service (`packages.ts`):**
  - `setPackageBirthright`: audited, conditional on the state read. Approval
    needs the package active and non-empty.
  - Adding or removing a resource, or changing eligibility, while on sends
    it back to pending (`birthrightBackToPending`). The person who changed
    it becomes the requester, so they cannot approve it.
  - `assignBirthrightPackages`: assigns each eligible package, skipping
    ones already held (the live-assignment key is the lock), with source
    'birthright' and no request. Pending grants follow as for any
    assignment. Audited as the system.
- **API:** `POST /api/v1/access/packages/{id}/birthright`
  `{action: request | approve | off}`. Needs access.manage; an automation
  credential cannot approve (WID-H06).
- **UI:** a folded "Birthright" row on the package page, one action per
  state; the approver also gets "Withdraw".

Verified:
- typecheck and eslint;
- `npx vitest run modules/access-governance modules/agent-identity`:
  364 passed;
- E2E locally:
  - new `birthright.spec.ts`: 3/3 — two administrators, the eligible
    joiner assigned with no request, a pending grant, someone else not, a
    change back to pending, nobody new assigned while pending;
  - `access-packages.spec.ts` and `human-lifecycle.spec.ts`: 22/22.
- Screen at 1280px and 390px: no overflow.

Not done: removing birthright packages that a mover is no longer eligible
for. The mover's access-review task covers it, as before.

### 2026-10-13 — A mover's birthright packages: review, then removal (WID-H09)

Owner decision (13 Oct): when a person moves and no longer qualifies for a
birthright package they hold, their manager gets a dated review. Whatever
is not kept by the date is removed.

Built:
- **Migration `0153_access_birthright_mover_review.sql`** (applied) adds to
  `access_package_assignments`:
  - `review_due_at`, allowed only on birthright assignments;
  - `review_kept_by` and `review_kept_at`;
  - an index on live assignments under review.
- **`packageRules.ts`:**
  - `MOVER_REVIEW_DAYS` (14);
  - `moverReviewAction`: review when the person no longer qualifies by
    identity type or department; clear when they qualify again. Their
    status is ignored, because leaving has its own removals.
  - `moverReviewDue`.
- **`packages.ts`:**
  - `reviewBirthrightAfterMove` runs on every mover event and is audited
    (`access.package_mover_review_opened` / `_cleared`);
  - `keepAssignment` (`access.manage`) clears the review, records who
    kept it, and is audited (`_kept`);
  - `sweepPackageExpiry` also ends assignments past their review date as
    revoked, through `endAssignment`. Pending grants are withdrawn and
    held access becomes removal work, confirmed by reconciliation. It is
    audited (`_lapsed`), and runs in the existing cron and on package
    views.
- **Lifecycle** (`humanLifecycleService`): a mover event lists the packages
  under review on the manager's `review_access` task
  (`detail.birthrightReview`), and the manager's notification names them
  and the date.
- **API:** `POST /api/v1/access/package-assignments/{id}/keep`.
- **UI:** on the package page, an assignment under review shows "Moved:
  removed <date> unless kept" and a Keep button beside Revoke.

Verified:
- `npm run typecheck`; eslint on the changed files.
- Vitest `packageRules.test.ts` and `modules/agent-identity`: 100/100,
  including the new WID-H09 cases.
- Local E2E `birthright.spec.ts`: 11/11. The new test covers:
  - a move out opens a 14-day review listed on the manager's task;
  - read-only cannot keep it, an administrator can, and keeping twice is a
    409;
  - moving back and away again reopens the review;
  - past the date, the sweep revokes it with the reason and the full audit
    trail.

Left out:
- access-combination SoD (ACCESS-P1-05, owner decision "build later");
- a reminder before the review date (the manager's notification at the
  move names the date).

### 2026-10-13 — A mover review is decided by someone else (WID-H09, register 13:07 IST)

`keepAssignment` refused nobody: a mover holding `access.manage` could
keep their own old birthright access. It now refuses the person whose
access is under review: 403 `SELF_KEEP` (`keepRefusal`, pure, in
`packageRules.ts`), and the refused attempt is audited. Verified with
`packageRules.test.ts` 18/18, including the new case, and the typecheck.


## 2026-10-13 — Approving access afterwards (contract for RISK-P0-13)

`recordApprovedAfterwards()` is published from `modules/access-governance/service.ts`. Existing access found with no approval is approved as it stands. It is recorded as an access request (`grant`, `fulfilled`, decided by the approver, with an optional `requested_expiry`) and attached to the grant (`access_grants.request_id`).
- No new ledger rule is needed: an approved or fulfilled request is evidence, so the access is VALID with source WONDERID_REQUEST from the next refresh.
- Nothing is provisioned. An end date makes the daily expiry sweep remove the access then.
- Service role, every statement filtered on the tenant, audited as `access.request_approved_afterwards`. Risk calls it after its own checks (`risk.manage`, never the account's owner).
- Verified through the RISK-P0-13 E2E (see the Risk audit log).

## 2026-10-14 — Package resources from rogue-access remediation (RISK-P0-13)

Risk's `authorizeRogueFinding` now calls the published `listAssignments` and
`addPackageResource` to add rogue access to a package the identity already
holds. No Access code changed. Adding a resource leaves existing assignments
as they are, and a birthright package goes back to review as it always has.
The Risk log has the verification.

## 2026-10-14 — ACCESS-P0-33 part 1: entitlement types per application

Design §5.4. Classification rules (part 2) set the same fields.

- **Migration 0169.**
  - `entitlements` gains `entitlement_type`, `requestable` (default true, as
    today), `sox_relevant` (default false) and `field_provenance`. All are
    additive.
  - New `application_entitlement_types`, with one row per type per
    application:
    - how it is requested: one at a time, several, free text, or shown but
      not requestable;
    - whether it is certifiable;
    - its default and maximum duration;
    - an optional request policy;
    - its origin (connector or manual).
  - Same-organization foreign keys; the policy reference is cleared when the
    policy goes. One name per application, ignoring case. A default above
    the maximum is refused. Members read; writes go through the service.
- **Import.**
  - The connector's `type` lands on each entitlement.
  - Every type it sends is declared on the application once, keeping
    existing settings.
  - A type a person set is never overwritten by an import.
- **Requests** (`submitAccessRequest`, grant and extend).
  - Refused with `NOT_REQUESTABLE`: an entitlement not requestable, or of a
    type shown but not requestable.
  - The type's default duration applies when none is asked for. Its maximum
    caps the duration: more is `DURATION_TOO_LONG`, and open-ended becomes
    the maximum.
  - The rules are pure, in `entitlementTypeRules.ts`.
- **Manual changes.** A person sets an entitlement's type, requestable and
  SOX flags (`PATCH /api/v1/access/entitlements/:id/governance`,
  access.manage). Each change is recorded as a person's decision in
  `field_provenance`, which rules will respect. A type a person names is
  declared on the application.
- **Types API:** `GET` and `POST /api/v1/access/applications/:id/entitlement-types`
  (read access.read, write access.manage), and `PATCH …/:typeId`. A
  connector's type keeps its name.
- **UI.**
  - On the application page, entitlements show their type and flags, with
    "Entitlement types" folded below them and editable by access managers.
  - Each row on the Entitlements page shows its type and flags, with a
    folded editor.

**Left out, recorded.**
- **Certifiability not yet applied:** campaigns don't yet skip types marked
  not certifiable, because campaign scope is Compliance's (COMPLIANCE-P0-10).
- **Request modes not yet in the catalog:** "single", "multiple" and "free
  text" are stored, but the request catalog doesn't yet offer several or free
  text.
- **Ownerless entitlements still requestable:** they fall back to the
  application owner (ACCESS-P0-19); making them not requestable would change
  existing behaviour and needs a decision.
- **Classification rules:** these are part 2.

**Verified.**
- Unit tests: `entitlementTypeRules.test.ts` 5, plus a new
  `connectorAccessRules` test (the connector's type is taken, never over a
  type a person set); `modules/access-governance` 292 in all.
- Database: `tests/access/entitlement-types-isolation.sql`, 7 of 7 as
  expected.
- Local E2E: `request-catalog.spec.ts` with `f1-reconciliation.spec.ts`,
  30/30. The new tests cover:
  - a type named by a person is declared with a count;
  - a default above the maximum is refused;
  - a request longer than the type allows is refused, and one without a
    duration gets the type's default;
  - not requestable, by the entitlement or by its type, is refused;
  - the application page shows the type editor;
  - read-only gets 403 and another organization 404, or an empty list.
- Typecheck, eslint and `next build` are clean.

## 2026-10-14 — ACCESS-P0-33 part 2: entitlement classification rules

Design §5.2.1 and §5.4. An imported application brings entitlements with no
classification. A classification rule matches them and sets their
classification, with every value it sets traceable to the rule.

**Owner decision (2026-10-14).** "Entitlement behaviour today is okay."
Ownerless entitlements stay requestable and fall back to the application
owner (ACCESS-P0-19). This closes part 1's open question; nothing changes.

**Migration 0170.**
- `entitlement_classification_rules`:
  - holds a working copy and the published copy that runs, as Identity's
    `lifecycle_rules` (0166) does;
  - publishing is four-eyes: the approver is never the person who asked,
    and the database checks this;
  - a new rule starts report-only;
  - one name per organization, ignoring case.
- `entitlement_classification_rule_versions`: one row per publish, with who
  asked and who approved. Append-only: an update trigger refuses changes.
- `rule_runs` now also accepts this table's runs. The widening is additive.
- Members read; writes go through the service.

**Rules** (pure, `classificationRules.ts`).
- Triggers: `entitlement.imported` and `entitlement.changed`.
- Scope: optionally, a list of this organization's applications.
- Conditions read `entitlement.*` (name, type, privilege level, data
  classification, requestable, SOX, has owner, external),
  `application.*` (name, display name, risk level, data classification,
  type, vendor), and `old.*` / `new.*`.
- Effects set only: privilege level, data classification, type,
  requestable, SOX-relevant. Each value is checked.
- A value a person set (`field_provenance` `by: person`) is never
  overridden. The run log records it as skipped, with the reason.
- Each value a rule writes records the rule and its version as provenance.

**Service** (`classificationRulesService.ts`).
- List, get, create, update and retire. Edits use optimistic `updated_at`
  checks. An edit clears the simulation.
- Simulate runs the working copy as if enforced over the entitlements in
  scope, up to 50,000, paged by id. It shows what would change and what
  would be skipped, and writes nothing.
- Request publish needs a simulation since the last edit. Approval, by
  someone else, publishes the next version.
- An enforced rule is applied to the existing entitlements in its scope
  when it is published, up to 5,000. The approval reports the count as
  `appliedTo`.
- `classifyEntitlements` runs the published rules on an import (after
  `applyGrants` in `connectorAccess.ts`) and on a manually created
  entitlement. It never throws, so a failure never undoes an import. Every
  outcome goes to `rule_runs`.

**API:** `/api/v1/access/classification-rules`, with `[ruleId]`, `simulate`,
`publish` (`request` or `approve`), `retire` and `runs`. Reads need
access.read; writes need access.manage.

**UI.** Admin › Organization Settings › Classification Rules, next to
Identity Rules. It has two pages:
- the list, with a form to create a rule;
- the rule, showing what it does, its single next step, and its recent
  runs.

The owner's Access list is unchanged; the nav test pins it.

**Left out, recorded.**
- An application's own rule page or tab.
- Rules computing the owner. Owner provenance exists, but the owner stays
  with the person or the source.
- Applying a rule to more than 5,000 existing entitlements at publish time.
  Past that, the next import or change classifies the rest.

**Verified.**
- Unit tests: `classificationRules.test.ts` 5. `npx vitest run modules
  tests/architecture lib` passes, 1532, after the nav link moved to Admin
  (the owner's Access list is pinned by `shell-nav.test.ts`).
- Database: `tests/access/classification-rules-isolation.sql`, 11 of 11 as
  expected. It rolls itself back, leaving no fixtures.
- Local E2E: `classification-rules.spec.ts` with `request-catalog.spec.ts`
  and `f1-reconciliation.spec.ts` (the import path changed), 37/37 in
  8.0 minutes. The new spec covers:
  - refused conditions and effects;
  - a simulation first, then four-eyes publishing;
  - report-only changes nothing and logs `reported`;
  - enforce applies to the three matching existing entitlements
    (`appliedTo: 3`), with rule provenance;
  - a person's requestable value kept;
  - a new entitlement classified on creation;
  - the pages;
  - another organization 404 (including a scope naming its application);
  - read-only 403;
  - a retired rule stops.
- **Found by that run and fixed:** the "entitlements classified" audit
  event passed a text run label (`publish:<rule>:<version>`) as the audit
  log's uuid correlation id, so `writeAudit` refused it. The label now goes
  in the metadata, and only a uuid is used as the correlation id. Checked by
  typecheck; the spec does not read audit rows.
- Typecheck, eslint and `next build` are clean.

## 2026-10-14 — ACCESS-P0-34: application onboarding templates and questionnaire

Design §5.8.2 and §14 (forms). This is the first story in the owner's new
priority order: onboarding, requests, approvals, provisioning.

**Migrations 0171 and 0172.**
- `application_onboarding_templates` holds a template's:
  - name and description;
  - connection type;
  - configuration defaults: identifier and correlation fields, entitlement
    source, operations, and request and certification policy;
  - default business and technical owners;
  - entitlement types with their settings;
  - questions.
- A template is active or retired. One name per organization, ignoring
  case. Members read; the service writes.
- `application_onboardings` gains `template_id` and `answers`:
  - the template is a same-organization foreign key;
  - a template in use cannot be deleted.
- **0172:** templates are typed by the connector definition key
  (`connection_type_key`, a built-in such as `workday` or a custom key).
  - This is how connections have been typed since the connector framework.
    `integration_types` holds only the generic `connector` row.
  - 0171's `integration_type_id` stays unused (always null). It can be
    dropped with the owner's approval; it is not dropped here, because that
    is destructive.

**Rules** (pure, `onboardingTemplateRules.ts`).
- Defaults go through the onboarding configuration's own validation.
  - Entitlements "from the connector" need a connection type.
  - Owners are identities.
- Entitlement types reuse ACCESS-P0-33's validation. A name may appear only
  once.
- Questions:
  - text, yes/no or a choice of 2–20 options;
  - required or not;
  - a key derived from the label;
  - at most 20.
- Answers are checked against the questions. An empty answer removes it;
  "no" is an answer.
- A typed template fits only an application connected through that type;
  an untyped one fits any application.

**Service.**
- `onboardingTemplates.ts`: list, get, create, update (optimistic), retire.
  Owners must be active people of the organization.
- `startOnboarding(…, templateId)`:
  - refuses a template that does not fit (`TEMPLATE_DOES_NOT_FIT`) or is
    retired (`TEMPLATE_RETIRED`);
  - fills the draft from the defaults;
  - fills only the application's empty owners (through `updateApplication`,
    audited);
  - declares the template's entitlement types; a type the application
    already has keeps its own settings.
  - Re-onboarding keeps its earlier configuration and applies no template.
- `answerOnboarding` validates answers.
  - A change returns the onboarding to configuring. It clears validation,
    simulation, submission and approval.
  - The audit names the questions answered, not the answers.
- The checklist gains a blocking "Questionnaire answered" item. It is not
  applicable without questions.
- The approval audit records the template and the questions answered.
- `onboardingTemplatesFor(app)` returns the templates that fit, typed ones
  first.

**API:**
- `/api/v1/access/onboarding-templates` (GET with access.read, POST with
  access.manage), `[templateId]` (GET, PATCH) and `[templateId]/retire`;
- the onboarding route takes `start` with `templateId` and a new `answer`
  action.

**UI.**
- Admin › Applications › Onboarding Templates. The list has a folded "New
  template" form:
  - questions are one per line, with `*` for required and `(yes/no)` or
    `[A | B]` for choices;
  - entitlement types are one per line, with `: 90` for a maximum.
- The template page has an edit form and a folded "Retire".
- The onboarding start form offers the fitting templates. A template made
  for the application's connection type is the default; a general one is a
  choice, and "No template" is otherwise the default. The first local run
  showed why: defaulting to any template changed what an unrelated
  onboarding started with.
- The onboarding page shows a Questionnaire card, editable until promotion.

**Left out, recorded.**
- **Reusable forms and value lists** (§14, OPERATIONS-P0-12). The
  questionnaire is the template's own list of questions.
- **Templates for agents and external identities** (IDENTITY-P0-19,
  IDENTITY-P0-22).
- **The connection-type lookup** reads `config.definition.key` of the
  published `Integration` record instead of an Integration export. A
  `connectionTypeKey()` export from Integration would be cleaner;
  Integration Agent to consider.
- **Re-onboarding** does not re-apply a template.

**Verified.**
- Unit tests:
  - `onboardingTemplateRules.test.ts` 7;
  - two new checklist cases in `onboardingRules.test.ts`;
  - the questionnaire line format, 2;
  - `npx vitest run modules tests/architecture lib app` passes, 1568.
- Database: `tests/access/onboarding-templates-isolation.sql`, 8 of 8 as
  expected, rolled back.
- Local E2E: `onboarding-templates.spec.ts`, `application-onboarding.spec.ts`
  and `onboarding-proposals.spec.ts`, 28/28. The new spec covers:
  - template validation;
  - a typed template refused for an application without that connection;
  - defaults, owners and types applied;
  - the questionnaire blocking validation;
  - a changed answer after approval sending the onboarding back;
  - the pages;
  - another organization 404, and its own application cannot use the
    template;
  - read-only 403;
  - retired.
- Typecheck, eslint and `next build` are clean.

## 2026-10-14 — ACCESS-P0-42: internal fulfilment task assignment

This story was added by the owner on 2026-10-14 at High priority, ahead of
ServiceNow ticketing (INTEGRATION-P0-26, now Low). Before it, a manual task
went to the application's technical owner, then the business owner, and
otherwise was left to the access managers.

**Migration 0173.**
- `application_fulfilment_assignments` names who does an application's
  tasks: one row for the application and optionally one per entitlement
  type, unique ignoring case.
  - Each row names a person (an identity) or a Foundation group, never both
    and never neither.
  - Same-organization foreign keys.
- `access_fulfilment_tasks` gains:
  - `assignee_group_id` (same-organization; set to null if the group is
    deleted);
  - `assigned_by`, `assigned_at` and `assignment_reason`.
  - A task names a person or a group, never both.
- Members read; the Access service writes.

**Rules** (pure, `fulfilmentAssignmentRules.ts`).
- `resolveAssignee`: the entitlement type's row, else the application's
  row, else the technical owner, then the business owner. With none of
  them, the task falls to the access managers.
- `canAct` (`fulfilmentTaskRules.ts`): a group's task belongs to each
  member of the group. Once one member claims it, only they or an access
  manager can complete or fail it.
- `canReassign`: the assignee (a group member for a group's task), whoever
  claimed it, or an access manager may reassign, while the task is open,
  claimed or failed.
- `validateReassignment`: one person or one group, plus a reason.
- `workload`: tasks still to do per assignee, overdue first.

**Service.**
- `openFulfilmentTask` routes each new task through `assigneeForNewTask`:
  - it reads the grant's entitlement type for grant and remove tasks;
  - it records the route in the audit;
  - it notifies the person, or each group member.
- `listFulfilmentTasks(forPerson)` includes the member's groups' tasks.
  Access managers see tasks with neither a person nor a group.
- `reassignFulfilmentTask`:
  - refused while the connector is running, and when the target is
    unchanged (`UNCHANGED`);
  - checks the target (an active person or active group of the
    organization);
  - releases a claim;
  - optimistic on `updated_at`;
  - audited (the reason is typed text; the metadata holds from, to and
    whether a claim was released);
  - the new assignee is notified.
- `fulfilmentWorkload` counts tasks per assignee.
- Overdue reminders reach group members.
- `fulfilmentAssignments.ts`: list, set (replaces the same scope),
  remove, and `activeGroupIdsOf` (Foundation's `groupsOfUser`).

**API.**
- `/api/v1/access/applications/:id/fulfilment-assignments`: GET with
  access.read; POST and DELETE with access.manage.
- `/api/v1/access/fulfilment-tasks/:id/reassign`: access.read; the service
  decides who may.
- `/api/v1/access/fulfilment-tasks/workload`.

**UI.**
- Fulfilment tasks:
  - each task shows its group or owner;
  - a folded "Reassign" control (person or group, plus why), shown only to
    those who may;
  - a folded "Workload" summary under "Show all".
- The application page has a folded "Fulfilled by" in the Onboarding card,
  to set and remove the application's and each type's assignee.
- My Workspace's inbox includes the member's groups' tasks.

**Left out, recorded.**
- Automatic balancing (round robin, least loaded) inside a group: members
  claim from the group's queue.
- Assignment by request attributes other than the entitlement type.
- Ticketing (INTEGRATION-P0-26, Low).
- Out-of-office delegation of tasks, which is ACCESS-P0-23.

**Verified.**
- Unit tests: `fulfilmentAssignmentRules.test.ts` 5, with the existing
  fulfilment rule tests (14 in all); `npx vitest run modules
  tests/architecture lib app` passes, 1573.
- Database: `tests/access/fulfilment-assignment-isolation.sql`, 9 of 9 as
  expected, rolled back.
- Local E2E: `fulfilment-assignment.spec.ts` with `leaver-removals.spec.ts`,
  `connector-provisioning.spec.ts` and `f1-reconciliation.spec.ts` (task
  routing, listing and acting changed), 46/46 in 14.5 minutes. The new spec
  covers:
  - setting and replacing who fulfils;
  - routing by type and by application;
  - a group member claiming, and a non-member refused;
  - reassignment with a reason (claim released, audited);
  - an access manager handing a task back;
  - workload;
  - the screens;
  - read-only 403 and another organization 404.
- Typecheck, eslint and `next build` are clean.
## 2026-10-14 — ACCESS-P0-38 part 1: request baskets and model-after

Design §5.3: one request, many changes; bulk requests for others;
"model after". This is the owner's priority list, item 4.

**Migration 0174.** `access_requests.basket_id`, additive and indexed. A
basket's requests share it; a request sent on its own keeps it null. No
new table, so RLS is unchanged.

**Rules** (pure, `requestBasketRules.ts`).
- `validateBasket`:
  - one to 50 people and one to 20 lines, at most 200 requests in all;
  - each line is access to add or remove, or an account to disable, with an
    optional duration;
  - repeated people and lines are dropped.
- `modelAfterLines` proposes the model's access the person lacks. It leaves
  out, each with a reason:
  - access the person already has;
  - access already asked for;
  - anything not requestable;
  - anything on an application that is not live.
- `summarizeBasket` counts the requests made, the open ones returned, and
  the refusals by code.

**Service** (`requestBaskets.ts`).
- `submitRequestBasket` sends every line for every person through
  `submitAccessRequest`, the same deterministic path as a single request:
  - policy, the scope to request for others, requestable, type, duration,
    agent contract and agent SoD;
  - the request's own approval route;
  - duplicate detection.
- The basket id is set by the server, never taken from the client.
- Each outcome is reported on its own line; a refusal never hides or undoes
  another.
- People are handled four at a time; one person's lines go in order.
- One audit event per basket with the counts. Each request audits as
  before.
- `modelAfter` reads, as the caller (RLS), the live grants of both people
  and the person's open requests.
  - The model's access may be seen by an access manager, by the model, or
    by the model's manager; anyone else gets 403.
  - It proposes; it sends nothing.
- `listBasketRequests` returns a basket's requests, as the caller can see
  them.

**API.**
- `POST /api/v1/access/requests/basket` (access.request). It returns 200
  with each line's outcome, even when some lines are refused.
- `GET /api/v1/access/requests/basket/:id` (access.read).
- `GET /api/v1/access/requests/model-after?subject=&model=`
  (access.request).

**UI.**
- Request access › "Several at once" (`/access/catalog/basket`).
- People to choose from: yourself, your reports, what you own, and for an
  access manager every active person.
- A folded "Same access as…" fills the items from model-after for the first
  person chosen, saying what was left out and why.
- After sending, each person and item shows its real outcome, linked to its
  request.

**Left out, recorded** (part 2, or other stories).
- **Saved drafts and signed approval links:** ACCESS-P0-38 part 2.
- **Entitlement SoD in model-after:** design §5.3 says "minus SoD blocks",
  but entitlement SoD is ACCESS-P0-22 (not built). Agent SoD still applies
  at submission.
- **Change-account-attribute lines.**
- **Peer recommendations** (ACCESS-P0-41).

**Verified.**
- Unit tests: `requestBasketRules.test.ts` 4.
- Local E2E: `request-baskets.spec.ts` 5/5 with `request-catalog.spec.ts`
  (because `submitAccessRequest` changed), 19 passed and 3 skipped. The
  skipped three are ACCESS-P0-33's catalog tests: they depend on an
  application made in another describe block, and with 2 workers they ran
  in a different worker. That quirk is in the existing spec, not this
  change. The basket spec covers:
  - model-after's line and reasons;
  - per-line outcomes (2 approved, 2 `NOT_REQUESTABLE`);
  - a repeat returning the open requests;
  - the basket's requests by id;
  - the screen;
  - another organization's basket refused per line (`NOT_FOUND`);
  - read-only 403.
- Typecheck, eslint and `next build` are clean. Migration 0174 is applied
  to the dev project.

## 2026-10-14 — ACCESS-P0-38 part 2: approve from a message; saved drafts

Design §5.3, "approve from e-mail or chat". Building it showed that
approvers were never notified when a request's stage reached them; they
had to look in their Approvals inbox. This part adds that notification.

**Migration 0175.**
- `access_approval_links` holds one link per approver per stage opened:
  - only the SHA-256 of a 32-byte random token is stored;
  - the request is a same-organization foreign key;
  - each link expires and is single-use;
  - a member reads only their own links; the service writes.
- `access_request_drafts` holds a member's saved baskets (people, items,
  reason; at most 64 KB). A member reads only their own; the service
  writes.

**Notification and link** (`approvalLinks.ts`, `approvalLinkRules.ts`).
- When a chain starts, and whenever a later stage opens, each approver of
  that stage is told (type `approval_required`, in the app and by e-mail).
  - A named approver gets a message; an access-manager step reaches every
    holder of `access.approve`.
  - The requester and the person the access is for are never told.
  - Each message carries the recipient's own link,
    `/access/requests/:id?link=<token>`, prefixed with `APP_BASE_URL` when
    it is set. It is valid 72 hours and single-use.
  - Notifying runs after the response and never throws.
  - Audited as `access.approvers_notified`, with the count.
- Opening the link on the request page checks it against the member
  signed in:
  - **valid:** marked used, with an atomic `used_at is null` update; the
    page says "Opened from your approval message";
  - **used, expired, not yours, already decided or unknown:** the page
    says so;
  - opening is audited (`access.approval_link_opened` or
    `access.approval_link_refused`).
  - The link decides nothing. The decision is the page's normal form,
    under the approver's session and the approval engine's checks (#15,
    §17.4): there is never approval by unauthenticated link.

**Drafts** (`requestDrafts.ts`).
- List, save (new, or replacing the member's own) and delete. At most 20
  per member. Owner and tenant are checked on every write.
- Validated to a basket's shape: people ids, at most 50; items
  `app|entitlement`, at most 20; the reason.
- API: `/api/v1/access/requests/drafts` (GET, POST) and `[draftId]` (PUT,
  DELETE), all with access.request.
- UI on "Several at once":
  - "Start from a draft" appears when the member has drafts;
  - a folded "Save as draft" saves the basket;
  - a draft sent as a basket is deleted.

**Left out, recorded.**
- Pre-selecting a decision from the link: the page shows the normal
  form.
- Chat channels (Slack, Teams): those are Operations' notification
  channels, F7.
- Re-sending links when a stage is escalated.

**Verified.**
- Unit tests: `approvalLinkRules.test.ts` 3, covering every link state,
  the token format and draft validation, plus the basket rules.
- Database: `tests/access/approval-links-drafts-isolation.sql`, 7 of 7 as
  expected, rolled back.
- Local E2E, one worker, 25/25: `approval-links-drafts.spec.ts`,
  `request-catalog.spec.ts` (the approval engine changed) and
  `request-baskets.spec.ts`. The new spec covers:
  - the approver notified with their own link, only the hash stored, and
    the requester not asked;
  - another member told the link is not theirs;
  - the approver's first opening valid and the second "already used";
  - opening decides nothing;
  - a malformed link refused;
  - drafts saved, replaced and deleted;
  - another member's or organization's drafts 404;
  - read-only 403.
- Typecheck, eslint and `next build` are clean. Migration 0175 is applied
  to the dev project.

## 2026-10-14 — ACCESS-P0-23 part 1: approver delegation

Design §5.3: "out-of-office and standing delegations of approval, request
and administration rights, time-limited, audited, never to the subject of
the request". This part covers approval rights, item 5 of the owner's
priority list.

**Migration 0176.**
- `access_delegations` records the delegator, the delegate, the scope
  (`approvals`), when it starts and ends, why, who made it, and who ended it
  and when.
  - Both people are members of the organization (foreign keys to
    `tenant_memberships`).
  - Never to oneself, at most 180 days, and it ends after it starts.
  - Each person sees the delegations they give or receive; an access
    manager (`has_tenant_permission(access.manage)`) sees all. The service
    writes.
- `access_request_approvals.decided_on_behalf_of` records whom a delegated
  decision was for.

**Rules** (pure, `delegationRules.ts`; `approvalRules.actionableStep`).
- A member delegates their own approvals, from now (or a set start) until a
  date. Only an access manager may delegate someone else's.
- `actingFor` returns whose approvals a member holds now.
- `actionableStep` checks the member's own step first, then a step naming
  someone they stand in for, then an access-manager step.
- A delegation never passes on access-manager rights; it covers named steps
  only.
- The engine's existing refusal to let anyone decide a request they made,
  or one that is for them, applies to the person deciding, whoever they act
  for.

**Engine.**
- `decideApprovalStep` reads the delegations in force and records
  `decided_by` (the delegate) and `decided_on_behalf_of` (the approver). The
  approval audit carries `onBehalfOf`.
- `listRequestIdsAwaiting` includes the delegated steps, so the delegate's
  Approvals inbox shows them.
- Approver notifications (ACCESS-P0-38 part 2) also reach a named
  approver's delegates.

**Service and API.**
- `delegations.ts`: list (as the caller), create (both people active
  members) and end. A delegation can be ended by the person away, the
  delegate, or an access manager; for anyone else it is not found.
- Create and end are audited; the reason is typed text.
- `/api/v1/access/delegations` (GET, POST) and `[id]/revoke`, with
  access.read. The service decides who may act.

**UI.** Approvals view › "Away? Delegate your approvals" opens
`/access/delegations`. It lists the delegations in place ("In force" or
"Scheduled") with an "End" button, plus a folded "New delegation" form.
Access managers can choose whose approvals.

**Left out, recorded (part 2).**
- Delegation of request rights (asking on someone's behalf).
- Delegation of administration rights.
- Delegating fulfilment tasks; ACCESS-P0-42's reassignment covers handing
  over a single task.

**Verified.**
- Unit tests: `delegationRules.test.ts` 4, including delegated step
  matching; `modules/access-governance` 321 in all.
- Database: `tests/access/delegations-isolation.sql`, 9 of 9 as expected,
  rolled back.
- Local E2E, one worker:
  - `approval-links-drafts.spec.ts` and `request-catalog.spec.ts` (the
    approval engine changed) passed in the combined run;
  - `approval-delegation.spec.ts` 4/4 on its own rerun. The spec covers:
    - a non-delegate cannot see or decide the step;
    - only an access manager delegates someone else's approvals;
    - delegating to oneself is refused;
    - the delegate sees and decides the step, with `decided_by` and
      `decided_on_behalf_of` recorded and `onBehalfOf` in the audit;
    - another organization sees and ends none;
    - once ended, nothing is delegated;
    - the page.
  - The first run's failures were in the test, not the feature: a
    delegation left by an interrupted run, and a second request for the
    same entitlement returned as the open one. The setup now ends
    leftovers, and the second request uses its own entitlement.
- Typecheck, eslint and `next build` are clean. Migration 0176 is applied
  to the dev project.

## 2026-10-14 — Approved access lands on a person's one standard account (found by QA-P0-22)

**Defect.** `chooseAccount` (ACCESS-P0-28) refused to pick between several real accounts, so a person with an everyday account and an admin account on the same application got no pending grant and no fulfilment task after approval. The request showed `untracked` and nobody was asked to act. This pairing is the common case in a brownfield estate.

**Change.** `pendingGrantRules.chooseAccount` takes the accounts' `accountType`:
- When several real accounts exist and exactly one is `standard`, standard access goes to that one.
- An `elevated` or `admin` entitlement is never placed by this rule.
- Neither is a subject with two standard accounts; both still stay unchosen (§17.6).

`pendingGrants.accountFor` reads `account_type` and the entitlement's `privilege_level`, failing safe: an unreadable entitlement counts as privileged.

**Verified.**
- `pendingGrantRules.test.ts` 14/14, with a new case covering standard plus admin, privileged entitlements and two standard accounts.
- `brownfield.spec.ts` 7/7 and `f1-reconciliation.spec.ts` 17/17 against a local production build.

## 2026-10-14 — ACCESS-P0-23 part 2: request delegation

**Owner decisions recorded the same day.**
- **Administration delegation:** build it. It changes Foundation's authorization engine and is approved for that; it comes next, as part 3.
- **ACCESS-P0-35 (four-eyes publish of request policies and other governance objects):** on only for organizations with two or more administrators. A single-administrator organization keeps publishing at once.

**Migration 0177.**
- `access_delegations.scope` now allows `requests` as well as `approvals`. The check constraint is widened; existing rows are all `approvals`.
- `access_requests.requested_on_behalf_of` (nullable, indexed) is new.

**Rules.**
- `validateDelegation` takes `scope`, defaulting to approvals.
- `actingFor(…, scope)` counts only delegations of that scope.
- The approval engine reads approval delegations only. A request delegation never lets anyone decide approvals.

**Requests.** `submitAccessRequest` accepts `onBehalfOf`. A request delegation from that member must be in force; otherwise it is refused with 403 `NO_DELEGATION`. The request is then evaluated as the delegator:
- their identity as requester, so by default the access is for them;
- their manager and owner relations;
- never access-manager rights.

`requested_by` is the delegate and `requested_on_behalf_of` the delegator. The submission audit carries `onBehalfOf`.

**Approvals.**
- The chain plan routes a step naming the delegator to access managers ("asked for this through a delegate").
- Deciding refuses the delegator with `SELF_APPROVAL`.
- The waiting list hides the request from the delegator.

**UI.**
- **Delegations page:** a "What" choice (deciding approvals, or asking for access), and each row shows its scope.
- **Request form:** "Asking as" appears only when the member holds a request delegation. Choosing someone hides "For", because the request is for that person.

**Defect found by the E2E.** `requestsActingFor` did not pass its scope to `actingFor`, which defaulted to approvals, so every delegated request was refused. It was fixed before merging, and the spec now covers it.

**Verified.**
- `modules/access-governance` unit tests: 323 passed. They include scope validation, scope filtering, and routing a step that names the delegator to access managers.
- `tests/access/delegations-isolation.sql`: 10 of 10 as expected, rolled back. A `requests` row is stored and seen like an approvals row; scope `admin` is refused with 23514; another organization sees none.
- Local E2E on one worker:
  - `approval-engine`, `request-catalog` and `approval-links-drafts`: all passed;
  - `approval-delegation.spec.ts` 12/12 after the fix (7 tests plus sign-in setup). Without a delegation the request is refused; with one it is created for the delegator with both recorded; the delegator cannot approve it, and the step routes to access managers; an access manager approves it; once the delegation ends, it is refused again.

**Left.**
- Administration delegation (part 3, approved).
- Agent directions (human→agent, agent→human, agent→agent), which belong with ACCESS-P0-37.

**Docs.** The knowledge base's revision history moved to the end, newest first, at the owner's request, with today's missing entries and body text added. ROADMAP-PROGRESS marks were brought up to date. From now on both are updated in the same pull request as each piece of work.

## 2026-10-14 — ACCESS-P0-23 part 3: administration delegation

Built on the owner's decision of the same day.

**How it works.** An `administration` delegation gives the delegate time-bound copies of the delegator's directly assigned roles. The copies are written by Foundation's new `lib/rbac/delegatedRoles.ts` as ordinary `user_roles` assignments. Each copy:
- keeps its original scope and MFA condition;
- lasts no longer than the delegation or the original assignment;
- carries `delegation_id`.

The authorization engine is unchanged: it treats the copies like any other assignment.

**Rules** (`lib/rbac/delegatedRoleRules.ts`, pure). These roles are never copied:
- Tenant Administrator, which is always permanent (migration 0100);
- a role the delegate already holds, so their own assignment is never altered;
- a role held only by delegation, so there is no re-delegation;
- an inactive role, or an assignment that has ended.

**Service** (`delegations.ts`).
- Only a caller with `role.manage` creates one, and never to themselves: the database's no-self-grant check stands.
- A delegation that would copy nothing is ended at once and refused with `NOTHING_TO_DELEGATE`.
- Ending early deletes exactly that delegation's copies. Ending again finishes an interrupted removal.
- Every copy and every removal is audited as `role.assigned` / `role.removed` with the `delegationId`.
- Foundation's `assignRole` clears `delegation_id` when an administrator sets a copy's terms. It then becomes an ordinary assignment and stays.

**Migration 0178.**
- The scope list gains `administration`.
- `user_roles.delegation_id` is added: nullable, indexed, cascading on the delegation.

**UI.** Delegations › What › "Administration (their roles)" appears only for someone with `role.manage`.

**Also fixed.** `permission-catalog.spec.ts` looked for the "Administration" heading anywhere on the page. The Admin sidebar has had its own since the new navigation (13 October), so the spec now looks only in the page body. It was a test-only fault, red on main too.

**Verified.**
- Unit tests in `lib/rbac` and `modules/access-governance`: 365 passed. They include the copy planner (scope and MFA kept, every exclusion, never past the original's expiry) and the scope validation.
- `tests/access/delegations-isolation.sql`: 10 of 10, rolled back, with all three scopes.
- Local E2E on one worker:
  - `approval-delegation`, `authorization`, `custom-roles` and `users` passed (34 tests). The new case covers:
    - only a role manager sets one up;
    - Tenant Administrator alone gives nothing (409);
    - the copy is IAM_ADMIN until the end date;
    - the delegate can then manage access for someone else;
    - ended early, the copy is gone and so is the right.
  - `permission-catalog` 9/9 after its fix.

## 2026-10-14 — Handed over by the nightly investigation (QA): two Access items

1. **Performance (§15).** After each connector read, the account step (`accounts.ts:500`) and the access step (`connectorAccess.ts:242`) each rebuild the access ledger for the whole organization, including the rogue-findings sync.
   - That costs 8–10 s per rebuild unloaded and 20–23 s with two workers, and the access step waits for the account step's rebuild.
   - It made the 14 October nightly's connector-provisioning chain overrun, and the first half exceed its 35 minutes.
   - Fix direction: rebuild per application, or once per read, after both steps. This touches Integration's pipeline and Risk's findings sync, so it is not done here.
2. **Race (correctness).** In `connectorFulfilment.ts`, the update that marks a connector task completed checks only that the connector is still running.
   - If a read verifies the task between the write and that update, the task returns to `completed` and the request shows `fulfilled_unverified` for good.
   - It was not seen in this nightly; it was found by reading the code.
   - Fixed in the same pull request: the update now also requires the task not to be `verified` (`.neq("status", "verified")`).
     The grant updates beside it already only move from their pending states.

Item 1 is open, for the next Access pass.
