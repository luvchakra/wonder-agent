# Identity Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-13 — IDENTITY-P0-01 through P0-03 (initial implementation)

**Agent:** Identity Agent · **Branch:** `claude/wonderagent-setup-lasmly` (same
deviation Foundation Agent recorded: this environment pins all work to the
harness-assigned branch rather than a separate `module/identity` worktree).

**Built — full P0 backlog in one pass:**

- **IDENTITY-P0-01.1** — `agents` table (migration `0012`) with RLS: client-facing
  tenant-scoped SELECT/INSERT/UPDATE (no DELETE — retirement is a lifecycle
  transition, never a row deletion). `createAgent()`/`getAgent()`/`listAgents()`
  in `modules/agent-identity/agents.ts`, exposed at `POST/GET /api/v1/agents` and
  `GET /api/v1/agents/:id`, plus bare functional pages `/agents` and
  `/agents/new` matching the worked example's exact fields.
- **IDENTITY-P0-01.2** — `agent_identities` (migration `0013`), manual linking
  only per the backlog's explicit P0 scope (no fuzzy-matching engine).
  `linkAgentIdentity()`/`listAgentIdentities()`, `POST/GET
  /api/v1/agents/:id/identities`.
- **IDENTITY-P0-01.3** — discovery inbox: `listAgents(tenantId, { status:
  "discovered_unregistered" })` always returns `[]` right now — **Integration
  Agent has not been dispatched**, so there is no normalized import contract to
  read through yet. This is the documented, allowed "don't block, don't invent
  the other module's architecture" path from `CLAUDE.md` §7, not an oversight.
  Revisit once Integration Agent publishes its contract.
- **IDENTITY-P0-02.1 (higher bar)** — `agent_lifecycle_events` (migration
  `0015`) and the full transition state machine in
  `modules/agent-identity/lifecycle.ts`, reproducing the backlog's table
  exactly: `DISCOVERED→REGISTERED` (requires active business_owner +
  technical_owner, non-empty purpose, source_system set),
  `REGISTERED→APPROVED` (requires an active `agent_contracts` row, and the
  actor must be an agent owner or hold `IAM_ADMIN`/`TENANT_SUPER_ADMIN`),
  `APPROVED→PROVISIONED` and `PROVISIONED→ACTIVE` (manual, no extra
  precondition), `ACTIVE→CERTIFICATION_DUE` (system-actor only, computed lazily
  on read via `maybeMarkCertificationDue()` inside `getAgent()`/`listAgents()`
  rather than a cron, exactly as the backlog allows),
  `ACTIVE→RESTRICTED`, `CERTIFICATION_DUE→ACTIVE`, `RESTRICTED→SUSPENDED`
  (requires `SECURITY_ADMIN`/`IAM_ADMIN`/`TENANT_SUPER_ADMIN`),
  `SUSPENDED→RETIRED`, and the "any state → SUSPENDED" emergency wildcard
  (requires `SECURITY_ADMIN`/`TENANT_SUPER_ADMIN`). Every transition writes
  both the `agent_lifecycle_events` row and a `writeAudit()` call, exactly as
  specified. Exposed at `POST/GET /api/v1/agents/:id/lifecycle`.

  **Judgment call, flagged rather than left silent:** the backlog's transition
  table doesn't say whether "any state → SUSPENDED" includes `RETIRED` as a
  valid `from`. I read `RETIRED` as terminal (nothing transitions out of it,
  full stop) since the backlog's whole chain treats it as the end state and no
  other row in the table ever transitions *from* `RETIRED`. Implemented that
  way in `isStructurallyAllowedTransition()`; flagging in case the intent was
  different.

  **Backlog inconsistency noted, not silently resolved:** the state list
  (`DISCOVERED → REGISTERED → ASSESSED → APPROVED → ...`) includes `ASSESSED`,
  and the `agents.lifecycle_state` CHECK constraint includes it too, but the
  backlog's own "Allowed transitions" table has no row transitioning into or
  out of `ASSESSED` anywhere — `REGISTERED` goes straight to `APPROVED`. I
  implemented exactly what the transition table says (no path through
  `ASSESSED` in P0), leaving the state reachable only for schema
  forward-compatibility. Not treating this as an ambiguity worth stopping for
  since the transition table is unambiguous on its own; noting it so a future
  session doesn't wonder why `ASSESSED` is unreachable.

- **IDENTITY-P0-02.2** — `agent_owners` (migration `0014`), client-facing RLS
  (tenant-scoped, same pattern as `agents`). `assignOwner()`/`removeOwner()`
  (soft-remove via `removed_at`)/`listOwners()`/`getOwnershipIssues()` in
  `modules/agent-identity/owners.ts` — the last one returns
  `missing_owner`/`inactive_owner`/`ownership_conflict`/
  `missing_recommended_owner` facts only, never a `risk_findings` row (Risk
  Agent's job once it exists). Exposed at `POST/GET /api/v1/agents/:id/owners`
  and `GET /api/v1/agents/:id/ownership-issues`.
- **IDENTITY-P0-02.3** — `agent_relationships` (migration `0017`), client-facing
  RLS. `addRelationship()`/`listRelationships()`/`removeRelationship()`,
  exposed at `POST/GET/DELETE /api/v1/agents/:id/relationships`. No automatic
  discovery from runtime traces, per the backlog's explicit P0 boundary.
- **IDENTITY-P0-03.1 (higher bar)** — `agent_contracts` (migration `0016`),
  versioned exactly as specified: `createContractVersion()` supersedes the
  prior active row and inserts `version + 1` as the new active one, backed by
  a partial unique index (`agent_contracts_one_active_per_agent`) enforcing
  "at most one active contract per agent" at the database level, not only in
  application code. `getAgentContract()` (active only) and
  `listContractVersions()` (full history). Exposed at `POST/GET
  /api/v1/agents/:id/contracts`.

**Security design decision (not explicit in the backlog, but a direct
extension of Foundation's own reviewed precedent for `audit_logs`), recorded
here rather than left implicit:** `agent_lifecycle_events` and
`agent_contracts` grant **no** client-facing INSERT/UPDATE policy at all —
only `transitionAgentLifecycle()` and `createContractVersion()` (via
`supabaseServiceRole()`, after their own validation) may write them. Every
other Identity table (`agents`, `agent_identities`, `agent_owners`,
`agent_relationships`) uses ordinary tenant-scoped client RLS plus an
app-layer `requirePermission()` check, matching how the backlog explicitly
described `agents` itself. Rationale: the transition table's validity and the
contract's versioning invariant are business rules no RLS tenant-check can
enforce — a client-facing INSERT policy on either table would let any tenant
member forge lifecycle/SHOULD history via a direct REST call, bypassing this
module's own logic entirely. Verified directly: see
`tests/identity/tenant-isolation.sql` — a same-tenant, correctly-scoped
`INSERT` into both tables is rejected by RLS specifically *because* no client
policy exists, not merely because of a tenant mismatch.

**Verification run:**
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean.
- `npm run test` — 12/12 passing, including
  `modules/agent-identity/lifecycle.test.ts` (pure unit tests for
  `isStructurallyAllowedTransition()` covering every row of the transition
  table, the any-state-to-SUSPENDED wildcard, and RETIRED's terminality).
- Tenant isolation proof executed directly against the live dev Supabase
  project via the Supabase MCP `execute_sql` tool (same methodology Foundation
  used, for the same reason: this sandbox's network egress cannot reach
  Supabase directly). Fixture: two tenants, one full agent graph each
  (agent + owner + identity + active contract + lifecycle event). Result,
  acting as Tenant A's user: every table returned only Tenant A's own row;
  Tenant B's agent was invisible even by primary-key lookup and a direct
  `UPDATE` against it affected 0 rows; a cross-tenant `agent_owners` insert
  was rejected; and — the specific case this design decision is meant to
  prevent — a **same-tenant** insert into `agent_lifecycle_events` and
  `agent_contracts` was also rejected, since neither table grants a client
  INSERT policy at all. Fixture data deleted afterward; script committed at
  `tests/identity/tenant-isolation.sql`. `get_advisors` (security and
  performance) clean after migration `0018` (tenant_id indexes on the five new
  tables) — no findings beyond the ones Foundation already reviewed and
  accepted (`current_tenant_ids`/`create_tenant_with_owner` REST-RPC exposure,
  `platform_admins`' intentional no-policy state, and the pre-existing
  Supabase-managed `rls_auto_enable`).

**Not started this session (deferred, not blocking other agents):** none of
IDENTITY-P0-01 through P0-03 was skipped — the full P0 backlog for this module
is implemented. The only gap is IDENTITY-P0-01.3's discovery inbox returning
empty pending Integration Agent, documented above.

**Dependencies consumed:** Foundation's `getTenantContext()`,
`requirePermission()`, `writeAudit()`, `supabaseServer()`/`supabaseServiceRole()`,
`lib/shared/types/foundation.ts` — all used exactly as published, no
modification to any Foundation file.

**Published this session, for Access/Runtime/Risk/Compliance/Experience to
consume once dispatched:** `modules/agent-identity/service.ts` (barrel) and
`lib/shared/types/agent-identity.ts` — see both files' contents for the full
exported surface (`getAgent`, `listAgents`, `getAgentContract`,
`transitionAgentLifecycle`, `getOwnershipIssues`, etc.). No other module has
been dispatched yet, so nothing has consumed this contract in anger; the
critical acceptance test (register FinanceBot, assign ownership, define the
SAP/Snowflake contract, walk it through
`DISCOVERED→REGISTERED→APPROVED→PROVISIONED→ACTIVE` with a complete audited
transition history) is buildable end-to-end today via the API routes above,
but has not been run as a scripted scenario in this session — worth doing
either now or as part of a future QA Agent pass.
