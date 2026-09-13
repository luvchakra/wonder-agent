# 02 — Identity Agent Backlog

**Agent name:** `Identity Agent`
**Module:** AI Agent Identity & Lifecycle
**Branch:** `module/identity`
**Status:** DORMANT — do not start until the user says "Run Identity Agent"

## Dependencies

- **Foundation Agent**: `getTenantContext()`, `requirePermission()`, `writeAudit()`,
  `lib/shared/types/foundation.ts`. Consume these; do not reimplement.
- **Integration Agent** (optional, for correlation): once Integration publishes
  normalized identity/account import data, Identity may correlate an
  `agent_identities` row to it. Do not block core registration/lifecycle stories on
  Integration existing — manual registration must work standalone.

## Owned entities

`agents`, `agent_identities`, `agent_owners`, `agent_lifecycle_events`,
`agent_contracts`, `agent_relationships`.

## Consumed entities (read-only, via contract)

Foundation's tenant/user/RBAC tables. Integration's normalized identity-import
contract (once published).

## Published contracts

- `lib/shared/types/agent-identity.ts`: `Agent`, `AgentLifecycleState`,
  `AgentContract`, `AgentOwner`, `AgentRelationship`.
- `modules/agent-identity/service.ts`: `getAgent(agentId)`, `listAgents(filter)`,
  `getAgentContract(agentId)` — the **only** sanctioned way other modules (Access,
  Runtime, Risk, Compliance, Experience) read agent identity/contract data. They must
  not query `agents`/`agent_contracts` tables directly from their own code — call
  this service so Identity can evolve its schema without breaking consumers.
- Lifecycle transition function `transitionAgentLifecycle(agentId, toState, reason)`
  — Risk Agent calls this (e.g. to move an agent `ACTIVE → RESTRICTED` after a
  critical finding) rather than writing to `agent_lifecycle_events` directly.

---

## Higher-bar stories

IDENTITY-P0-02.* (lifecycle transitions) and IDENTITY-P0-03.1 (contract as SHOULD
source) are higher bar: getting the lifecycle state machine or the contract schema
wrong is expensive for every downstream module. Stop and report on ambiguity.

---

## Epic IDENTITY-P0-01 — Canonical Agent Identity

### IDENTITY-P0-01.1 — `agents` table and registration

```sql
create table agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_name text not null,
  display_name text,
  description text,
  purpose text,
  agent_type text not null,        -- e.g. 'chatbot','automation','copilot','pipeline'
  agent_framework text,            -- e.g. 'langchain','custom','mcp-native'
  model_provider text,
  model_name text,
  model_version text,
  runtime text,                    -- e.g. 'mcp','aws-lambda','on-prem'
  environment text not null default 'production' check (environment in ('production','staging','development')),
  criticality text not null default 'medium' check (criticality in ('low','medium','high','critical')),
  data_classification text,        -- e.g. 'public','internal','confidential','pii','financial'
  status text not null default 'discovered',
  lifecycle_state text not null default 'DISCOVERED',
  source_system text,              -- e.g. 'saviynt','manual'
  source_object_id text,
  enterprise_identity_id text,
  service_account_id text,
  credential_reference text,       -- pointer only, never a raw secret
  risk_score numeric,
  posture_score numeric,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  last_seen_at timestamptz,
  next_review_at timestamptz,
  retirement_date timestamptz
);
create index on agents (tenant_id);
```

RLS: standard `tenant_id in (select current_tenant_ids())` policy for select; insert
requires `agent.create` permission (checked in the API route via
`requirePermission`, not only at the DB layer — RLS additionally restricts
`with check (tenant_id in (select current_tenant_ids()))` so a row can never be
inserted for a tenant the caller isn't a member of).

Manual registration form (`/api/v1/agents` POST, and a bare `/agents/new` page):
required fields to move from nothing to `DISCOVERED`: `agent_name`, `agent_type`. All
other fields optional at creation and filled in as the agent progresses through
lifecycle (see Epic 02).

**Worked example:** registering FinanceBot manually:

```json
POST /api/v1/agents
{
  "agent_name": "FinanceBot",
  "agent_type": "automation",
  "agent_framework": "custom",
  "model_provider": "anthropic",
  "model_name": "claude",
  "runtime": "mcp",
  "environment": "production",
  "criticality": "high",
  "data_classification": "financial"
}
```

Response includes `id`, `lifecycle_state: "DISCOVERED"`, `status: "discovered"`. An
audit event `agent.registered` is written via Foundation's `writeAudit()`.

### IDENTITY-P0-01.2 — Agent identity correlation (`agent_identities`)

```sql
create table agent_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  identity_type text not null check (identity_type in ('service_account','human_delegate','oauth_client','workload_identity','api_key','mcp_server')),
  external_reference text not null,  -- e.g. Saviynt account id, OAuth client id
  source_system text not null,       -- e.g. 'saviynt','manual','entra'
  confidence text not null default 'unverified' check (confidence in ('unverified','probable','confirmed')),
  status text not null default 'active' check (status in ('active','stale','removed')),
  created_at timestamptz not null default now()
);
```

An agent may have zero, one, or several correlated identities (e.g. a service
account in Saviynt *and* an OAuth client for an API integration). `confidence`
starts at `unverified` for anything auto-suggested by a future correlation job
(P1) and `confirmed` when a human explicitly links it via the UI, or when created
directly through manual entry by an authorized user.

**DO NOT IMPLEMENT** an automatic fuzzy-matching correlation engine in P0 — that's a
P1 concept. P0 only needs: manual linking, and accepting an already-normalized
identity reference handed to it by the Integration Agent's contract (a straight
one-to-one "this Saviynt account maps to this agent" association a human confirmed
during import review).

### IDENTITY-P0-01.3 — Agent discovery inbox

When Integration Agent's contract surfaces an imported identity that looks
agent-like (flagged by Integration per its own criteria) but has no corresponding
`agents` row yet, Identity Agent exposes a "Discovered, unregistered" list
(`GET /api/v1/agents?status=discovered_unregistered`) sourced from Integration's
contract data — this is a read-through view, not a new table Identity owns of raw
imports (Integration owns `integration_objects`). A user can promote an entry to a
full `agents` row via IDENTITY-P0-01.1's creation path, pre-filled from the
discovered data.

**DO NOT IMPLEMENT** this story's UI polish — a functional list + "register" button
is enough; Experience Agent owns visual design.

---

## Epic IDENTITY-P0-02 — Lifecycle (higher bar)

### IDENTITY-P0-02.1 — Lifecycle state machine

States, in order: `DISCOVERED → REGISTERED → ASSESSED → APPROVED → PROVISIONED →
ACTIVE → CERTIFICATION_DUE → RESTRICTED → SUSPENDED → RETIRED`.

`agent_lifecycle_events`:

```sql
create table agent_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  from_state text,
  to_state text not null,
  reason text not null,
  actor_id uuid,           -- null for system-triggered transitions
  actor_type text not null check (actor_type in ('user','system')),
  created_at timestamptz not null default now()
);
```

`transitionAgentLifecycle(agentId, toState, reason, actor)` enforces the allowed
transition table below and writes both the `agent_lifecycle_events` row and a
`writeAudit()` call (`action: 'agent.lifecycle_transitioned'`). It updates
`agents.lifecycle_state` and, where noted, `agents.status`/`activated_at`/
`retirement_date`.

Allowed transitions and their required preconditions:

| From | To | Precondition |
|---|---|---|
| `DISCOVERED` | `REGISTERED` | `agent_owners` has at least one `business_owner` AND `technical_owner`; `purpose` is non-empty; `source_system` is set |
| `REGISTERED` | `APPROVED` | An `agent_contracts` row exists for this agent (IDENTITY-P0-03.1) AND caller has `agent.update` permission (owner approval is represented by the actor performing this transition being a valid owner or an `IAM_ADMIN`/`TENANT_SUPER_ADMIN`) |
| `APPROVED` | `PROVISIONED` | Manual for P0 (a user marks it provisioned once they've set up access in the real IAM) — do not attempt to call an external IAM API automatically here in Identity's scope; that belongs to Integration's future provisioning contract (P1) |
| `PROVISIONED` | `ACTIVE` | Manual confirmation, or automatic on receipt of the agent's first runtime event once Runtime Agent exists (accept a stub/no-op if Runtime doesn't exist yet — do not block) |
| `ACTIVE` | `CERTIFICATION_DUE` | System-triggered when `next_review_at <= now()` (a scheduled check; for P0 this can be computed on read rather than requiring a background cron — do not add new job infrastructure without asking) |
| `ACTIVE` | `RESTRICTED` | System-triggered by Risk Agent via `transitionAgentLifecycle` (policy violation, excessive access, unexpected behavior) OR manual by an authorized user (owner removal) |
| `CERTIFICATION_DUE` | `ACTIVE` | A certification decision resolves it (Compliance Agent calls this) |
| `RESTRICTED` | `SUSPENDED` | Manual, by `SECURITY_ADMIN`/`IAM_ADMIN`/`TENANT_SUPER_ADMIN` |
| `SUSPENDED` | `RETIRED` | Manual, requires a `reason` and sets `retirement_date = now()` |
| any state | `SUSPENDED` | Manual emergency suspension by `SECURITY_ADMIN`/`TENANT_SUPER_ADMIN`, always allowed regardless of current state |

Any transition not in this table is rejected with a clear error naming the current
state and the attempted target. If a precondition can't be evaluated because a
dependency module isn't implemented yet (e.g. no Risk Agent to ever trigger
`RESTRICTED` automatically), that's fine — the manual path still works; do not stub
out fake automatic behavior to compensate.

**Worked example:** FinanceBot goes `DISCOVERED → REGISTERED` after
`IDENTITY-P0-02.2` (ownership) sets both owners and `purpose = "Financial
reporting"`. A `REGISTERED → APPROVED` transition is attempted before an
`agent_contracts` row exists: rejected with `PRECONDITION_FAILED: agent contract
required`.

### IDENTITY-P0-02.2 — Ownership & accountability

```sql
create table agent_owners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  owner_type text not null check (owner_type in ('business_owner','technical_owner','iam_owner','application_owner','data_owner')),
  user_id uuid not null references users(id),
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (agent_id, owner_type, user_id)
);
```

Every production agent (`environment = 'production'`) must have an active
`business_owner` and `technical_owner` before it can leave `DISCOVERED`. High-risk
agents (`criticality in ('high','critical')`) should additionally have `iam_owner`
and `application_owner` — enforce this as a warning/finding-worthy condition, not a
hard block on lifecycle transition (only `business_owner`+`technical_owner` are hard
gates per the transition table above).

Ownership checks to implement as computed views/queries (not new tables): missing
owner, inactive owner (the assigned user's `tenant_memberships.status != 'active'`),
ownership conflict (same user as both business and technical owner — allowed but
flag it), stale ownership (no owner change reviewed in >180 days — P1 if a
"reviewed" concept doesn't exist yet in P0; for P0 it's enough to expose "owner
inactive" and "no owner" as queryable conditions). Do not create `risk_findings` rows
here — that is Risk Agent's job; Identity only exposes the underlying facts via its
service contract (e.g. `getOwnershipIssues(agentId)`).

### IDENTITY-P0-02.3 — Agent relationships

```sql
create table agent_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  related_agent_id uuid references agents(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('delegates_to','depends_on','shares_credential_with','orchestrates')),
  created_at timestamptz not null default now(),
  check (agent_id <> related_agent_id)
);
```

P0 scope: store and list relationships between two already-registered agents (e.g.
an orchestrator agent that calls a sub-agent). **DO NOT IMPLEMENT** automatic
relationship discovery from runtime traces in P0 — that depends on Runtime Agent
data and is a reasonable P1 extension.

---

## Epic IDENTITY-P0-03 — Agent Contract (source of SHOULD)

### IDENTITY-P0-03.1 — `agent_contracts` (higher bar)

```sql
create table agent_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  purpose text not null,
  owner_summary text,
  approved_applications text[] not null default '{}',
  approved_data text[] not null default '{}',
  prohibited_data text[] not null default '{}',
  approved_actions text[] not null default '{}',   -- e.g. 'READ','REPORT'
  prohibited_actions text[] not null default '{}', -- e.g. 'DELETE','EXPORT'
  certification_frequency text not null default 'quarterly' check (certification_frequency in ('monthly','quarterly','semiannual','annual')),
  maximum_risk text not null default 'medium' check (maximum_risk in ('low','medium','high')),
  status text not null default 'draft' check (status in ('draft','active','superseded')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (agent_id, version)
);
```

Only one `agent_contracts` row per agent may have `status = 'active'` at a time.
Editing an active contract creates a **new** row (`version + 1`), marks the previous
one `superseded`, and requires `agent.update` permission — contract changes are
audited (`action: 'agent.contract_updated'`) with the full before/after in
`writeAudit()` metadata, since this is literally the definition of SHOULD that Risk
Agent's findings will be judged against.

**Worked example — the FinanceBot contract from the PRD:**

```json
{
  "agent_id": "financebot-id",
  "purpose": "Financial reporting",
  "owner_summary": "Finance Operations",
  "approved_applications": ["SAP", "Snowflake"],
  "approved_data": ["Financial reporting data"],
  "prohibited_data": ["Payroll", "Customer PII"],
  "approved_actions": ["READ", "REPORT"],
  "prohibited_actions": ["DELETE", "EXPORT"],
  "certification_frequency": "quarterly",
  "maximum_risk": "medium",
  "status": "active",
  "version": 1
}
```

This is the exact row the Access Agent (SHOULD vs CAN) and Runtime Agent (SHOULD vs
DID) read via `getAgentContract(agentId)` — they must never read `agent_contracts`
directly.

---

## Critical acceptance test (must pass before this module is considered done)

Register FinanceBot, assign business/technical/IAM ownership, define the
financial-reporting purpose and approved SAP/Snowflake contract above, move it
through `DISCOVERED → REGISTERED → APPROVED → PROVISIONED → ACTIVE`, and show a
complete, audited transition history (`agent_lifecycle_events` rows matching every
transition, each with a corresponding `audit_logs` entry).

## P1

- Automatic identity correlation/fuzzy matching.
- Automatic relationship discovery from runtime traces.
- Per-tenant custom lifecycle states.
- Delegated/temporary ownership.
- Contract templates library.

## DO NOT IMPLEMENT

- Effective access computation (Access Agent).
- Any runtime event ingestion (Runtime Agent).
- Any risk scoring or finding generation (Risk Agent) — Identity only exposes
  ownership/lifecycle *facts*, never a severity or a finding.
- Any connector/credential/sync logic (Integration Agent).
