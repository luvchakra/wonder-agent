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
