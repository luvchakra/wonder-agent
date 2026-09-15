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
