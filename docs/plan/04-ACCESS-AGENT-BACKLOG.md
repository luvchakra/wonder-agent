# 04 — Access Agent Backlog

**Agent name:** `Access Agent`
**Module:** Effective Access & Access Governance (the CAN side, plus policy)
**Branch:** `module/access`
**Status:** DORMANT — do not start until the user says "Run Access Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every non-"Done" row is in `docs/design/access-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| ACCESS-P0-01.1 | Canonical access schema | Done — no `access_paths` table created; see audit log |
| ACCESS-P0-01.2 | Effective access computation & explainability (higher bar) | Done — critical acceptance test passed live |
| ACCESS-P0-01.3 | Access requests (P0 minimal) | Done |
| ACCESS-P0-02.1 | Policy schema (higher bar) | Done |
| ACCESS-P0-02.2 | Deterministic evaluation engine (higher bar) | Done — 2026-09-16: `agent.days_since_last_certification` real since 2026-09-14 (Compliance's `getCertificationHistory()`); `agent.external_communication` resolved via `AskUserQuestion` — modeled as `applications.is_external` (migration `0059`), a new admin-settable flag on Access's own `applications` table. Risk's "External communication capability" factor (`modules/risk/rules.ts`) now checks whether an agent's CAN touches any application marked external, replacing the hard-coded `false` |
| ACCESS-P0-02.3 | Segregation of Duties (SoD) (higher bar) | Done |
| ACCESS-P0-03 | Access Graph (graph-compatible relationships + tabular view) | Done — 2026-09-14 |
| ACCESS-P0-04 | Contract Comparison (SHOULD vs CAN diff: approved / excessive / missing / unknown) | Done — 2026-09-14, unit-tested against the live FinanceBot fixture's exact data |
| ACCESS-P0-05 | Policy Versioning, Priority & Change History (extends ACCESS-P0-02.1) | Done — 2026-09-14, live RLS-verified |
| ACCESS-P0-06 | Action governance enforcement (4-state model, uses Identity's autonomy fields) | Done — 2026-09-15, unit-tested, no migration needed |
| ACCESS-P0-07 | Broaden `policy_exceptions` into the canonical governance-exception model | Done — 2026-09-15, migration `0053`, live-applied |
| ACCESS-P0-11 | Deterministic runtime decision function (master P0-28–P0-32) | Done — 2026-09-25: pure `decideRuntimeRequest()` + fail-closed `evaluateRuntimeRequest()` loader (service-role, tenant-checked), 34 unit tests incl. master §21 fail-safe table and the §11 FinanceBot case; wired into the gateway by RUNTIME-P0-15; see audit log |
| ACCESS-P0-12 | Policy targets and publish (master P0-23) | Done — 2026-09-25: targets (TOOL, MCP_SERVER, MCP_TOOL, DATA_SOURCE, DATA_RESOURCE, ACTION) in `scope.targets` decide which runtime policies apply; priority orders evaluation; drafts + `publishPolicy()` (new version, audited) behind `policy.publish`; `createPolicy` now audited |
| ACCESS-P0-13 | Data sources inventory (master P0-11) | Done — 2026-09-25: `data_sources` (migration 0070, RLS, same-tenant composite FKs, no delete), entitlement link, CAN carries data source + classification fallback, audited service/API, `/access/data-sources` |
| ACCESS-P0-14 | Wire SoD checks (codebase-map D5, master P0-25) | Done — 2026-09-25: `enforceSoD()` on request submission, request decision and manual grant; blocking → 409 SOD_CONFLICT (audited failure), flag → proceeds and audited; `checkSoD()` now service-role + matches the agent in object or metadata |
| ACCESS-P0-15 | Application catalog model and inventory | Done — 2026-09-26, migration 0086 |
| ACCESS-P0-16 | Application onboarding: state machine, checklist, validate, simulate, approve, promote | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-17 | Account inventory: correlation, orphan and dormant accounts | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-18 | Self-service request catalog and request policies | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-19 | Approval engine: multi-stage chains, approver scope, no self-approval | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-20 | Access packages | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-21 | Business and IT roles | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-22 | Preventive SoD on entitlement combinations | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-23 | Delegations | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-24 | Access ledger and provenance | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-25 | Imported access classification and drift findings | Not Started — 2026-09-26, WonderID |

---

## Dependencies

- **Foundation Agent**: tenant context, RBAC, audit.
- **Identity Agent**: `getAgent()`, `getAgentContract()` (SHOULD) — read-only via
  contract.
- **Integration Agent**: normalized `NormalizedAccount`/`NormalizedApplication`/
  `NormalizedEntitlement`/`NormalizedAccessGrant` objects — read-only via
  `getNormalizedObjects()`.

If Integration Agent isn't implemented yet, Access Agent may still build the schema,
graph engine and policy engine against manually-entered access data (a manual "add
access grant" form) — do not block core stories on Integration existing; record the
dependency and consume the real contract once available.

## Owned entities

`applications`, `accounts`, `entitlements`, `access_grants`, `access_paths`,
`policies`, `policy_rules`, `policy_exceptions`, `policy_evaluations`.

## Consumed entities

Identity's `agents`/`agent_contracts` (read-only). Integration's normalized import
data (read-only).

## Published contracts

- `lib/shared/types/access-governance.ts`: `Application`, `Entitlement`,
  `AccessGrant`, `AccessPath`, `Policy`, `PolicyEvaluationResult`.
- `modules/access-governance/service.ts`:
  - `getEffectiveAccess(agentId): AccessGrant[]` — the full CAN set for an agent.
  - `explainAccessPath(agentId, resourceRef): AccessPath` — "why can X access Y".
  - `evaluatePolicies(context): PolicyEvaluationResult[]` — deterministic policy
    evaluation, called by Risk Agent.
  These are the only sanctioned ways other modules read effective access or evaluate
  policy; they must not query `access_grants`/`policies` directly.

---

## Higher-bar stories

ACCESS-P0-01.* (effective access graph correctness) and ACCESS-P0-02.*
(policy evaluation semantics) are higher bar — this is the module the FinanceBot
CustomerDB scenario depends on most directly.

---

## Epic ACCESS-P0-01 — Effective Access Graph

### ACCESS-P0-01.1 — Canonical access schema

```sql
create table applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text,                     -- e.g. 'data_warehouse','erp','saas'
  source_integration_id uuid,        -- Integration's integrations.id, nullable for manual
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null,            -- Identity's agents.id (no FK across module DBs conceptually, but same Postgres instance — FK is fine and enforced)
  application_id uuid not null references applications(id) on delete cascade,
  external_account_ref text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  name text not null,                -- e.g. 'CustomerDB_READ'
  data_classification text,          -- e.g. 'financial','pii'
  privilege_level text not null default 'standard' check (privilege_level in ('standard','elevated','admin')),
  created_at timestamptz not null default now()
);

create table access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  entitlement_id uuid not null references entitlements(id) on delete cascade,
  grant_type text not null check (grant_type in ('direct','inherited','group','role','delegated','token_scope','oauth_scope','api_scope','mcp_tool_permission','service_account_relationship')),
  source_integration_id uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

(`agents.id` is a real foreign key here since both tables live in the same Postgres
database — cross-module foreign keys within one Postgres instance are fine and
expected; "no shared internal implementation" means no importing another module's
*application code*, not avoiding FKs to another module's *published* table.)

### ACCESS-P0-01.2 — Effective access computation & explainability (higher bar)

`getEffectiveAccess(agentId)` walks:

```text
Agent → agent_identities (Identity) → accounts → access_grants → entitlements → applications
```

and returns every currently-granted (`revoked_at is null`) entitlement, annotated
with `grant_type` so a caller can distinguish direct vs. inherited/group/delegated
access.

`explainAccessPath(agentId, resourceRef)` returns the specific chain proving why an
agent can reach a resource, e.g.:

```json
{
  "agent_id": "financebot-id",
  "resource": "Snowflake:CustomerDB",
  "path": [
    { "step": "agent_identity", "ref": "svc-finance-ai" },
    { "step": "account", "ref": "svc-finance-ai@snowflake" },
    { "step": "access_grant", "type": "direct", "entitlement": "CustomerDB_READ" },
    { "step": "entitlement", "application": "Snowflake", "data_classification": "pii-adjacent-financial" }
  ]
}
```

**Worked example (the critical acceptance test):** FinanceBot's Saviynt import
produced an `access_grants` row linking its Snowflake account to a `CustomerDB_READ`
entitlement (Integration's data from INTEGRATION-P0-02.1's worked example).
`getEffectiveAccess('financebot-id')` must include `CustomerDB_READ` in its result
even though the agent's contract (`approved_applications: ["SAP","Snowflake"]`,
`approved_data: ["Financial reporting data"]`) never approved CustomerDB
specifically. This divergence — CAN includes something SHOULD does not — is exactly
what Risk Agent will need to detect; Access Agent's job is only to compute CAN
correctly and make the path explainable, not to judge it.

### ACCESS-P0-01.3 — Access requests (P0 minimal)

```sql
create table access_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null,
  requested_by uuid not null,
  application_id uuid not null references applications(id),
  entitlement_id uuid,
  justification text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','fulfilled')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
```

P0 scope: submit, approve/reject (by a user with `agent.update` or a dedicated
`access.approve` permission — add this permission key to Foundation's catalog via a
migration note in the audit log, since Foundation seeded only the initial P0 list).
Fulfillment (actually creating the `access_grants` row / calling out to the real IAM
via Integration's `createAccessRequest`) is P0 **only** for the manual path: an
`IAM_ADMIN` marks it fulfilled after making the change in the real IAM system
themselves, mirroring the "human-in-the-loop, existing IAM remains system of record"
non-negotiable (#7, #15).

---

## Epic ACCESS-P0-02 — Policy Management & Evaluation (higher bar)

### ACCESS-P0-02.1 — Policy schema

```sql
create table policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  policy_category text not null check (policy_category in ('identity','access','runtime','agent','lifecycle')),
  scope jsonb not null default '{}'::jsonb,   -- e.g. { "criticality": ["high","critical"] } or {} for all agents
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  action text not null check (action in ('flag','restrict','block')),
  exception_process text,
  owner_id uuid,
  effective_date timestamptz not null default now(),
  expiry_date timestamptz,
  status text not null default 'active' check (status in ('draft','active','disabled'))
);

create table policy_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id) on delete cascade,
  rule_type text not null check (rule_type in ('rbac','abac','resource','time')),
  condition jsonb not null,   -- structured condition, see worked examples below
  created_at timestamptz not null default now()
);

create table policy_exceptions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id) on delete cascade,
  agent_id uuid,
  reason text not null,
  approved_by uuid not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table policy_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_id uuid not null references policies(id) on delete cascade,
  agent_id uuid not null,
  result text not null check (result in ('pass','violation','exempted')),
  evidence jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now()
);
```

### ACCESS-P0-02.2 — Deterministic evaluation engine

`evaluatePolicies({ agentId })` loads every `active` policy in scope for the agent
(via `scope` matching, e.g. criticality/agent_type), evaluates each `policy_rules`
condition against the agent's current facts (contract from Identity, effective
access from ACCESS-P0-01.2, and — once available — runtime DID from Runtime Agent),
and writes a `policy_evaluations` row per policy. This must be a plain deterministic
rule interpreter (condition tree of `AND`/`OR`/comparisons over known fields) — an
LLM must never be in this evaluation path (non-negotiable #9).

**Worked example — ABAC condition (section 19 of the PRD):**

```json
{
  "rule_type": "abac",
  "condition": {
    "all": [
      { "field": "agent.data_classification", "op": "eq", "value": "PII" },
      { "field": "agent.external_communication", "op": "eq", "value": true }
    ]
  }
}
```
Evaluated result: if both true → this rule contributes to a `violation` (or informs
Risk Agent's HIGH risk factor — Access Agent emits the evaluation *result and
evidence*; Risk Agent decides the severity/finding).

**Worked example — resource-based policy:** "AI agents may not access PayrollDB" is
a `resource` rule type: `{ "field": "access.entitlement.application", "op": "eq",
"value": "PayrollDB" }` combined with `{ "field": "access.granted", "op": "eq",
"value": true }`. If FinanceBot's effective access ever includes a PayrollDB
entitlement, this evaluates to `violation`.

**Worked example — time-based policy:** "Agent certification expires after 90 days"
— `{ "field": "agent.days_since_last_certification", "op": "gt", "value": 90 }`. This
field is computed from Compliance Agent's certification records at evaluation time
(Access Agent reads Compliance's read contract once it exists; until then, this
specific policy type can't fully evaluate — record that as a known limitation, don't
fabricate a certification date).

### ACCESS-P0-02.3 — Segregation of Duties (SoD)

Implement configurable SoD rules as a specialization of `policy_rules` with
`rule_type = 'rbac'` evaluated against **user** actions rather than agent facts, e.g.
"the user who created an agent may not also certify its access" — evaluated at the
point of action (Compliance Agent calls `evaluatePolicies`-style check, or Access
Agent exposes a narrower `checkSoD(userId, action, agentId)` helper) rather than as a
background scan. Default: SoD is advisory (flagged) unless a tenant policy sets
`action: 'block'`.

**DO NOT IMPLEMENT** a general dynamic SoD conflict-graph solver — P0 needs
straightforward two-action conflict rules, not a full graph analysis engine.

---

## Critical acceptance test

For FinanceBot, calculate CAN from imported IAM/access data and show the exact path
proving why CustomerDB is reachable even though it is not in the approved Agent
Contract — i.e. `getEffectiveAccess` + `explainAccessPath` both succeed and agree,
and `evaluatePolicies` records the divergence as evidence (even if Access Agent
itself doesn't decide the finding severity).

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`04_ACCESS_GOVERNANCE.md`) that expands this module's P0/P1/P2 scope beyond what was
already tracked above. Reconciled against the existing Progress Tracker by content,
not by ID (the new doc's flat `ACCESS-P0-01`..`ACCESS-P0-10` numbering does not line
up with this backlog's epic-based `ACCESS-P0-0X.Y` numbering) — nothing already
`Done` was reopened. The following are genuinely new stories added to the tracker:

### ACCESS-P0-03 — Access Graph

The new doc's "Effective Access Graph" section (and its expanded requirement
`ACCESS-P0-03`) asks for the canonical relationships to be exposed as
graph-compatible nodes/edges plus a tabular representation, explicitly as "a view
over canonical relationships, not a separate source of truth." Today
`getEffectiveAccess`/`explainAccessPath` (ACCESS-P0-01.2, Done) compute single-agent
lists and single-resource paths on the fly, but there is no published function/API
returning the full multi-hop graph (agent → account → role/group → entitlement →
application/resource → data) for Experience Agent's graph visualization to render.
This reinforces, rather than reverses, the prior decision not to materialize an
`access_paths` table (ACCESS-P0-01.1's documented gap): the graph stays computed,
not stored. **Acceptance criteria:** a `getAccessGraph(agentId)`-style function
(or `/api/v1/access/agents/:id/graph` route) returns nodes/edges covering direct,
inherited, group, role, delegated, token/OAuth/API scope, MCP tool permission and
service-account relationship types, plus an equivalent flat/tabular row list for
non-graph UI consumers. **Not started.**

### ACCESS-P0-04 — Contract Comparison (also covers ACCESS-P0-10 — Access Change Traceability)

The new doc asks for an explicit comparison of the approved Agent Contract (SHOULD,
from Identity Agent) against effective access (CAN, ACCESS-P0-01.2) at
resource/action/data-classification level, classifying every item as approved,
excessive, missing or unknown (`ACCESS-P0-04`) — and for every such difference to
carry its source system, entitlement, path and last-sync time plus the specific
agent contract/policy it was checked against (`ACCESS-P0-10`). This is distinct from
`evaluatePolicies()` (which evaluates policy *rules*, not a raw SHOULD-vs-CAN diff)
and is exactly the computation the P0 critical acceptance scenario in CLAUDE.md §11
describes ("SHOULD = financial data only, CAN = financial data + CustomerDB") before
Risk Agent turns it into a finding. Neither exists today as a published function.
**Acceptance criteria:** a new `compareAccessToContract(agentId)` function
(published alongside `getEffectiveAccess`/`explainAccessPath` in
`modules/access-governance/service.ts` and `lib/shared/types/access-governance.ts`)
returns one row per effective-access item classified as `approved` / `excessive` /
`missing` / `unknown`, each row carrying `source_integration_id` (or manual),
`entitlement`, the `explainAccessPath` chain, `last_synced_at` (from Integration's
sync metadata where available) and the `agent_contract_id`/`policy_id` it was
compared against. Access Agent still only computes and evidences this diff — per
"DO NOT IMPLEMENT" below, it never turns it into a `risk_findings` row itself; Risk
Agent consumes this function's output the same way it consumes
`evaluatePolicies()`. **Not started.**

### ACCESS-P0-05 — Policy Versioning, Priority & Change History (also closes part of ACCESS-P0-06)

The new doc's Policy Model requirement (`ACCESS-P0-05`) asks for policies to carry a
stable ID, name, **version**, status, scope, **priority**, rule conditions,
effective dates, owner, exception reference and audit history. ACCESS-P0-02.1
(Done) already implemented ID, name, status, scope, rule conditions, effective/
expiry dates, owner and exception_process — but the `policies` table
(`supabase/migrations/0029_access_policies.sql`) has no `version` or `priority`
column, and there is no policy change-history trail. This same gap is why
ACCESS-P0-02.2's determinism story (Partial) cannot fully satisfy the new doc's
`ACCESS-P0-06` requirement to "store policy version and evaluation inputs/outputs"
for reproducibility — `policy_evaluations` stores `evidence` (inputs/outputs) but no
`policy_version`. **Acceptance criteria:** add `version integer not null default 1`
and `priority integer not null default 0` to `policies`; add a
`policy_versions`-style history table (or a trigger-populated audit trail) recording
prior field values on every update; add a `policy_version` column to
`policy_evaluations` populated with the policy's version at evaluation time, so a
stored evaluation is reproducible against the exact rule set that produced it. This
is an additive migration on top of already-owned tables — no ownership-map change
needed. **Not started.**

### Already covered, no new tracker row needed

- **ACCESS-P0-01** (Canonical Access Model) and **ACCESS-P0-02** (Effective Access
  Calculation) map directly onto already-`Done` **ACCESS-P0-01.1**/**ACCESS-P0-01.2**
  — no scope change (ACCESS-P0-01.1's documented "no `access_paths` table" gap
  stands as previously recorded, not reopened).
- **ACCESS-P0-08** (SoD Baseline) maps onto already-`Done` **ACCESS-P0-02.3** — no
  scope change.
- **ACCESS-P0-09** (Exceptions) maps onto the `policy_exceptions` table shipped as
  part of already-`Done` **ACCESS-P0-02.1** (`approved_by` required, `agent_id`
  scoping, `expires_at` present). Minor gap: `expires_at` is nullable rather than
  mandatory for approved exceptions; not significant enough on its own to warrant a
  new tracker row — worth enforcing (`not null` for `status = 'approved'`) whenever
  ACCESS-P1-04's fuller exception workflow (below) is built.
- **ACCESS-P0-07** (Risk-Sensitive Policy Actions) maps onto **ACCESS-P0-02.1**'s
  `action` field (`flag`/`restrict`/`block`) and **ACCESS-P0-02.2**'s evaluation
  engine (Partial) — "the MVP does not autonomously revoke access" is already the
  documented behavior (no `revoke` action exists). Minor gap: no explicit
  "require certification" action value; Compliance Agent can already trigger
  certification from a `violation` evaluation result without Access Agent adding a
  dedicated enum value, so no new row.
- **ACCESS-P0-06** (Deterministic Evaluation) maps onto already-`Done`/`Partial`
  **ACCESS-P0-02.2** for reproducibility of rule evaluation itself; its remaining
  "store policy version" gap is folded into the new ACCESS-P0-05 story above rather
  than tracked twice.
- **ACCESS-P0-10** (Access Change Traceability) is folded into the new ACCESS-P0-04
  story above rather than tracked as a separate row, since the new doc's own
  traceability fields (source system, entitlement, path, last sync, associated
  contract/policy) are acceptance criteria of the same comparison function.

No ownership-map addition is needed for any of the above — ACCESS-P0-03 and
ACCESS-P0-04 are new *functions/API routes* under `/api/v1/access` (already AA-owned
per `docs/design/ownership-map.md`) computed over already-AA-owned tables, and
ACCESS-P0-05 only adds columns/a history table to `policies`/`policy_evaluations`
(already AA-owned tables), not a new table needing a map entry.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded the module requirements doc (`04_ACCESS_GOVERNANCE.md`) a
second time on the same day, described as a newer/expanded version, and asked for a
fresh, thorough re-check in case it contained additional detail, new stories, or
refined acceptance criteria beyond the round-1 refresh directly above.

**Finding: nothing new.** The re-uploaded doc was diffed line-for-line (not
skimmed) against both the "Original Master PRD Requirements" text embedded verbatim
above (sections 11/18/19/28) and the "Expanded Requirements — Access Governance
P0/P1/P2" list (`ACCESS-P0-01` through `ACCESS-P2-03`) that the round-1 refresh
already reconciled. The content is textually identical to what round 1 already
worked through: every ID in the re-uploaded doc's expanded list is already either
(a) mapped onto a `Done` epic story in the "Already covered, no new tracker row
needed" list above, (b) already its own tracker row (`ACCESS-P0-03`/`ACCESS-P0-04`/
`ACCESS-P0-05`, all `Done`), or (c) already named by ID under `## P1`/`## P2` below
(`ACCESS-P1-02`, `ACCESS-P1-03`, `ACCESS-P1-04`, `ACCESS-P2-01`, `ACCESS-P2-02`,
`ACCESS-P2-03`) or present in the `## P1` section's lead prose (`ACCESS-P1-01` —
access simulation). The doc's front matter (Purpose, Shared Product Contract,
Engineering rules, Ownership Boundary, Dependencies, Definition of Done) is the
same standalone-execution-brief boilerplate already reflected in this backlog's own
header/Dependencies/Definition-of-Done sections and in `CLAUDE.md` — process
scaffolding, not a product requirement.

One wording-level nuance was noted, not promoted to a new row: the re-uploaded
doc's `ACCESS-P1-02` (Advanced ABAC) attribute list includes "owner"
(`environment, data classification, geography, time, owner and agent type`) where
this backlog's existing P1 paraphrase omits it — an example attribute inside an
already-tracked story, not a new story.

**No Progress Tracker rows added and no existing row's status changed.** A
codebase sanity-check (`modules/access-governance/graph.ts`, `comparison.ts`,
`supabase/migrations/0042_access_policy_versioning.sql`) confirmed the tracker's
existing `Done` marks for `ACCESS-P0-03`/`ACCESS-P0-04`/`ACCESS-P0-05` are accurate,
not stale. Full detail in `docs/design/access-agent-backlog-audit.md`'s matching
2026-09-14 "Round-2 requirements re-check" entry.

**Not a decision made unilaterally:** the new requirements package's "Modular
Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a different *process*
model ("Only the agent explicitly activated by the user may start work. Agents must
never launch another agent automatically") than this repository's standing
autopilot/auto-chain policy in `CLAUDE.md` §7 and `docs/ORCHESTRATION.md` §2. That is
a meta/process question, not a product requirement, and is called out to the user
separately rather than silently changed here.

## P1

Delegated/temporary access with expiry as a first-class grant type beyond the basic
`delegated` grant_type value. Access simulation ("what would happen if we changed
policy X"). Full SoD conflict-graph analysis. Automatic policy recommendation.

Added from the 2026-09-14 requirements refresh (not already represented above):

- **Advanced ABAC** (`ACCESS-P1-02`): policy conditions over additional attributes —
  environment, data classification, geography, time and agent type — beyond the
  ABAC worked example already in ACCESS-P0-02.2.
- **Delegated access modeling detail** (`ACCESS-P1-03`): the existing "delegated
  access with expiry" P1 item above should, when built, explicitly model approver,
  delegator, delegatee and transitive access paths, not just an expiry timestamp on
  the grant.
- **Exception Workflow** (`ACCESS-P1-04`): a full request/approval/expiry/renewal/
  revocation workflow around `policy_exceptions`, with evidence — P0 only supports
  minimal read-only/manually-approved exceptions (ACCESS-P0-02.1).

## P2 (strategic, after P0/P1 proven)

Added from the 2026-09-14 requirements refresh:

- **Policy Optimization** (`ACCESS-P2-01`): recommend least-privilege policy
  improvements from recurring access patterns and approved outcomes; recommendations
  remain human-reviewed, never auto-applied (non-negotiable #9).
- **Continuous Access Graph** (`ACCESS-P2-02`): incrementally update effective
  access as source events arrive rather than relying solely on batch rebuilds from
  Integration Agent's sync jobs.
- **What-if Governance** (`ACCESS-P2-03`): answer "what changes if this entitlement
  is removed?" across certification, risk and runtime behavior — builds on
  ACCESS-P1-01 (Access Simulation).

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. No new
Access-owned story added, but two open cross-module items directly touch
this module's existing schema and are recorded there, not decided here:

- **Governance Exceptions consolidation** — the new doc's generic
  "Governance Exceptions" concept is a third candidate alongside this
  module's own `policy_exceptions` (P0 schema, `ACCESS-P1-04` for the full
  workflow) and Compliance Agent's planned `CERT-P1-04`. If the user picks
  `policy_exceptions` as the canonical model, `ACCESS-P1-04`'s scope would
  broaden — not assumed or built here.
- **Action Governance's 4-state model** (P0-09: allowed / allowed-with-
  approval / restricted / prohibited, per action) would most naturally be
  enforced by this module's policy engine (`ACCESS-P0-02.1`/`02.2`,
  `Done`), but depends on the Human Oversight/autonomy-level ownership
  decision landing first — not scoped as a story until that's answered.

### Decisions resolved (2026-09-15, later same day)

The user answered both open questions via `AskUserQuestion`:

- **Autonomy model → Identity + Access.** Identity Agent adds the
  autonomy-level/allowed-tools/human-approval fields to `agent_contracts`
  (`IDENTITY-P0-07`). This module enforces the resulting 4-state action
  model — added as **`ACCESS-P0-06`** above, blocked on `IDENTITY-P0-07`
  landing first (needs the fields to read).
- **Governance Exceptions → broaden `policy_exceptions`.** The user chose
  making this module's existing, already-`Done` `policy_exceptions` table
  the canonical exception model for any governance requirement, not just
  access policy — added as **`ACCESS-P0-07`** above. Compliance Agent's
  planned control-mapping exception story (`CERT-P1-04`) will reference
  this table instead of introducing its own; not this module's call to
  make for Compliance's backlog, recorded there instead.

### ACCESS-P0-07 — Broaden `policy_exceptions` (governance exception model)

`policy_exceptions` currently ties an exception to a `policy_id`. To serve
as the canonical governance-exception model, it needs to support
exceptions to things that aren't Access policies too (e.g. a missing
attestation, a certification gap, a control-mapping gap once Compliance's
own stories reference it). **Objective:** generalize the exception's
target reference (e.g. a `scope_type` + `scope_id` pair, or a nullable
`policy_id` alongside a more general reference) while keeping every
existing access-policy exception working unchanged; keep the existing
fields (reason, business justification, approver, start/expiry date,
compensating control, residual risk, status per the governance doc's P0-14
field list — cross-check against the current schema and add whatever's
missing). Must not become a second, competing model — this *is* the
canonical one now. **Not started.**

---

## Requirements Refresh — 2026-09-25 (master P0/P1/P2 implementation stories)

Source: the user-supplied *WonderAgent Master P0/P1/P2 Implementation Stories* (MCP folded into the five pillars DISCOVER → UNDERSTAND → GOVERN → PROTECT → ASSURE), mapped story by story in [`docs/implementation/codebase-map.md`](../implementation/codebase-map.md). Ownership and architecture choices were decided by the user on 2026-09-25 (see `docs/design/ownership-map.md`, "Master stories decisions"). Nothing already `Done` is reopened; the rows below are added to this module's Progress Tracker as `Not Started`.

### ACCESS-P0-11 — Deterministic runtime decision function (master P0-28–P0-32)

User decision: Access owns the decision logic, Runtime owns the endpoint. A pure, deterministic `evaluateRuntimeRequest()` returning ALLOW / DENY / REQUIRE_APPROVAL / ALLOW_WITH_RESTRICTIONS with reason, policy id + version and restrictions, in the master order: tenant → identity → lifecycle → emergency controls → approved access → effective access → context → risk → runtime policy. Fail-safe defaults: unknown identity/resource, suspended agent/resource, explicit deny, expired JIT → DENY; a missing or failing policy is never permission (§17.4). No LLM in the path (#9). Exhaustive unit tests per branch.

### ACCESS-P0-12 — Policy targets and publish (master P0-23)

Policy scope/facts for TOOL, MCP_SERVER, MCP_TOOL, DATA_SOURCE, DATA_RESOURCE and ACTION targets, plus a publish step (draft → published version) guarded by the new `policy.publish` permission; `priority` actually orders evaluation.

### ACCESS-P0-13 — Data sources inventory (master P0-11)

User decision: Access owns data sources beside `applications` — a `data_sources` table (tenant_id, RLS) with classification, linked to entitlements/applications, feeding CAN.

### ACCESS-P0-14 — Wire SoD checks (codebase-map D5, master P0-25)

`checkSoD()` is called where conflicting access or actions are granted/requested, producing findings or blocking per policy; it currently has no callers.


---

## DO NOT IMPLEMENT

- Risk scoring or `risk_findings` — Risk Agent consumes `evaluatePolicies()` output;
  Access Agent never creates a finding itself.
- Runtime event ingestion (Runtime Agent).
- Certification campaigns/decisions (Compliance Agent).
- Any connector/credential logic (Integration Agent).

---

## WonderID (2026-09-26)

Adopted by explicit user decision; see `CLAUDE.md` and `docs/plan/WONDERID-ROADMAP.md`.
These stories extend this module's own tables, services and routes.

### ACCESS-P0-15 — Application catalog model and inventory

Extend `applications` with type, display name, business and technical owners, environment, risk level, criticality, data classification, connector, onboarding and lifecycle status, discovered/connected; Application Catalog, Inventory and Application Details screens.

### ACCESS-P0-16 — Application onboarding: state machine, checklist, validate, simulate, approve, promote

Onboarding record per application with the spec's states and P0 checklist; simulation never mutates production; promotion activates exactly the approved version; a changed configuration invalidates earlier validation.

### ACCESS-P0-17 — Account inventory: correlation, orphan and dormant accounts

Accounts correlated to identities (not only agents), orphan accounts (no identity), dormant accounts (no use within a configured window), account reconciliation view.

### ACCESS-P0-18 — Self-service request catalog and request policies

Requestable applications, entitlements and packages governed by request policies (who may request, for whom, max duration, justification, risk threshold, auto-approval eligibility); requests for self and others with the spec's status machine; duplicates return the open request.

### ACCESS-P0-19 — Approval engine: multi-stage chains, approver scope, no self-approval

Sequential and parallel approval stages resolved from policy (manager, application owner, entitlement owner, named group), approver-scope checks, no self-approval, expiry and escalation, exact-action approval fingerprints.

### ACCESS-P0-20 — Access packages

Bundles of entitlements and roles with owner, policy (eligibility, approvers, duration, expiry, certification), assignment and expiry-driven revocation; usable for humans and AI agents.

### ACCESS-P0-21 — Business and IT roles

Business/IT/application roles with entitlements, hierarchy, owners, risk, requestability; assignments with source, provenance, start and expiry; simulation of add/remove showing access, SoD and risk impact without executing.

### ACCESS-P0-22 — Preventive SoD on entitlement combinations

Conflict rules over entitlements/roles with actions BLOCK, REQUIRE_EXCEPTION, REQUIRE_ADDITIONAL_APPROVAL, WARN, evaluated at request, package, role and direct grant; exceptions with owner, expiry and compensating control. Extends the existing SoD (ACCESS-P0-14), which covers conflicting actions by one person.

### ACCESS-P0-23 — Delegations

Approval, request and administration delegation and access-on-behalf, each with grantor, grantee, scope, start, finite expiry, reason and audit; human→agent, agent→human and agent→agent directions.

### ACCESS-P0-24 — Access ledger and provenance

Append-only ledger per identity-access relationship with source (request, role, package, lifecycle, import, legacy, admin, emergency, agent authorization, unknown), request and approval lineage, dates, last verified/used and status; the "why does this identity have this access?" view. Missing evidence is UNPROVEN, never fabricated.

### ACCESS-P0-25 — Imported access classification and drift findings

Desired vs actual reconciliation: target-only, WonderID-only, attribute, ownership, status and privilege drift; imported access classified AUTHORIZED, LEGACY, UNPROVEN or ROGUE by configurable rules so pre-go-live access is not labelled malicious.
