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
