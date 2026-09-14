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
| ACCESS-P0-02.2 | Deterministic evaluation engine (higher bar) | Partial — `agent.external_communication` and `agent.days_since_last_certification` are always unknown pending other modules |
| ACCESS-P0-02.3 | Segregation of Duties (SoD) (higher bar) | Done |

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

## P1

Delegated/temporary access with expiry as a first-class grant type beyond the basic
`delegated` grant_type value. Access simulation ("what would happen if we changed
policy X"). Full SoD conflict-graph analysis. Automatic policy recommendation.

## DO NOT IMPLEMENT

- Risk scoring or `risk_findings` — Risk Agent consumes `evaluatePolicies()` output;
  Access Agent never creates a finding itself.
- Runtime event ingestion (Runtime Agent).
- Certification campaigns/decisions (Compliance Agent).
- Any connector/credential logic (Integration Agent).
