# 02 — Identity Agent Backlog

**Agent name:** `Identity Agent`
**Module:** AI Agent Identity & Lifecycle
**Branch:** `module/identity`
**Status:** DORMANT — do not start until the user says "Run Identity Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every non-"Done" row is in `docs/design/identity-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| IDENTITY-P0-01.1 | `agents` table and registration | Done |
| IDENTITY-P0-01.2 | Agent identity correlation (`agent_identities`) | Done |
| IDENTITY-P0-01.3 | Agent discovery inbox | Done — 2026-09-14: superseded by `buildDiscoveryInbox()` (IDENTITY-P0-05), now reading Integration Agent's published contract |
| IDENTITY-P0-02.1 | Lifecycle state machine (higher bar) | Done |
| IDENTITY-P0-02.2 | Ownership & accountability | Done |
| IDENTITY-P0-02.3 | Agent relationships | Done |
| IDENTITY-P0-03.1 | `agent_contracts` (higher bar) | Done |
| IDENTITY-P0-04 | Duplicate detection & merge/review workflow | Done — 2026-09-14, live RLS-verified |
| IDENTITY-P0-05 | Discovery reconciliation & orphaned identity detection | Done — 2026-09-14; also resolves IDENTITY-P0-01.3's dependency now that Integration Agent's contract exists. Extended 2026-09-15 into the fully functional Agent Discovery feature (detection/confidence/evidence, candidate review, ignore/link, registration wired to the existing lifecycle service) — see the audit log's 2026-09-15 entry |
| IDENTITY-P0-06 | Suspension restoration path (lifecycle state machine gap) | Done — 2026-09-15, unit-tested |
| IDENTITY-P0-07 | Contract autonomy/oversight fields (autonomy level, allowed tools, human approval requirements, required monitoring) | Not Started — 2026-09-15, user decided "Identity + Access" for the autonomy model (Identity owns the field, Access enforces it); see the Requirements Refresh section below |

---

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

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`02_AGENT_IDENTITY_LIFECYCLE.md`) that expands this module's P0/P1/P2 scope
beyond what was already tracked above. Reconciled against the existing
Progress Tracker (nothing already `Done` was reopened, and no existing
`Partial` row's status was lowered); the following are genuinely new stories
added to the tracker:

### IDENTITY-P0-04 — Duplicate Detection & Merge/Review Workflow

Corresponds to the new doc's IDENTITY-P0-02 ("Agent Registration"), which
raises duplicate detection using *configurable identity keys* and a
merge/review workflow to P0 — the existing backlog explicitly deferred any
automatic correlation/dedup to P1 (see IDENTITY-P0-01.2's "DO NOT IMPLEMENT"
note and the existing P1 list below). Objective: when an agent is registered
(manually, or promoted from the discovery inbox), run a duplicate-candidate
check against existing `agents` rows in the same tenant using one or more
admin-configurable identity keys (e.g. `agent_name` + `source_system` +
`source_object_id`), rather than silently creating a second record for the
same real-world agent. Acceptance criteria: a match at/above a configurable
threshold produces a reviewable duplicate-candidate record instead of
silently completing registration; an authorized reviewer can either merge
(void the duplicate while preserving the surviving record's lifecycle/audit
history) or confirm-as-distinct (registration proceeds normally); both
outcomes are audited via `writeAudit()`; tenant-isolated and RLS-protected if
a new table is introduced. **Not started.** Note: this likely needs a new
Identity-owned table (e.g. `agent_duplicate_candidates`) not yet listed in
`docs/design/ownership-map.md` — clearly within Identity Agent's existing
registration/discovery ownership, so not an ownership *ambiguity*, but it
still needs a map entry added when built; flagged here rather than edited
directly per this task's constraints.

### IDENTITY-P0-05 — Discovery Reconciliation & Orphaned Identity Detection

Corresponds to the new doc's IDENTITY-P0-09 ("Discovery Reconciliation").
Extends IDENTITY-P0-01.3's existing discovery inbox (currently `Partial`,
blocked on Integration Agent's contract — that dependency is unchanged by
this story) so that discovered agent-like identities are reconciled against
already-registered `agents`/`agent_identities` (avoiding the duplicate
registrations IDENTITY-P0-04 targets) and so that orphaned technical
identities — an identity reference with no live owning agent, e.g. because
its agent was retired or never registered — are surfaced as a distinct list
rather than silently dropped or conflated with net-new discoveries.
Acceptance criteria: the discovery inbox view distinguishes "genuinely new,"
"likely duplicate of an existing agent" and "orphaned identity, no owning
agent" categories; no fake/stubbed data is returned when Integration's
contract isn't available (same rule as IDENTITY-P0-01.3). **Not started.**

### Already covered, no new tracker row needed

- **IDENTITY-P0-01** (First-Class Agent Record — stable identifier
  independent of vendor/runtime identifiers) → `agents.id` from
  IDENTITY-P0-01.1; the table's own primary key is already independent of
  `source_object_id`/`enterprise_identity_id`/`service_account_id`.
- **IDENTITY-P0-03** (Ownership — required before APPROVED, changes audited)
  → IDENTITY-P0-02.2 (`agent_owners`) plus the `REGISTERED → APPROVED`
  precondition in IDENTITY-P0-02.1's transition table.
- **IDENTITY-P0-04** *(new-doc numbering; not to be confused with this
  backlog's own new IDENTITY-P0-04 row above)* — Identity Contract (purpose,
  approved tools/resources/actions, environment restrictions, owner,
  expiry/review date, risk constraints) → IDENTITY-P0-03.1 (`agent_contracts`)
  already implements purpose/owner/approved & prohibited applications, data
  and actions, and `maximum_risk` as the SHOULD source. Fields the new doc
  names that the current schema doesn't yet carry explicitly (a distinct
  "approved tools" list separate from applications, per-contract environment
  restriction, and an explicit contract expiry/review date rather than the
  agent-level `next_review_at`) are content gaps to fold into a future
  revision of IDENTITY-P0-03.1 rather than a new story, since the contract
  concept and table already exist and are `Done`.
- **IDENTITY-P0-05** (new-doc numbering) — Lifecycle State Machine →
  IDENTITY-P0-02.1, already `Done` with the same state sequence and a
  server-side-enforced transition table.
- **IDENTITY-P0-06** — Lifecycle Evidence (actor/system, reason, timestamp,
  prev/new state, evidence/correlation ID) → IDENTITY-P0-02.1's
  `agent_lifecycle_events` plus the paired `writeAudit()` call already carry
  actor, reason, timestamps and prior/new state; audit correlation context
  comes from Foundation's shared audit primitive.
- **IDENTITY-P0-07** — IAM Mapping (one-to-many external identities,
  confidence, source, sync timestamps, rationale) → IDENTITY-P0-01.2's
  `agent_identities` (`external_reference`, `source_system`, `confidence`,
  `status`) already covers the core concept; per-mapping first/last-sync
  timestamps and a free-text rationale field are minor schema gaps, not a
  new story.
- **IDENTITY-P0-08** — Ownership Health (missing/inactive/conflicting owner,
  changes near certification deadlines) → IDENTITY-P0-02.2's documented
  ownership-check queries (missing owner, inactive owner, ownership
  conflict, stale ownership).
- **IDENTITY-P0-10** — Environment Separation (explicit dev/test/staging/
  production; stronger controls for production) → `agents.environment`
  (IDENTITY-P0-01.1) plus IDENTITY-P0-02.2's rule that only *production*
  agents are hard-gated on business/technical ownership before leaving
  `DISCOVERED`.
- **IDENTITY-P1-01** (new doc, P1-tier) — Agent Relationships (parent/child,
  orchestrator/sub-agent, delegation, invocation) → already exceeded: this
  backlog implemented relationship storage/listing as **P0**
  (IDENTITY-P0-02.3, `Done`), not merely planned for P1.

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## P1

- Automatic identity correlation/fuzzy matching.
- Automatic relationship discovery from runtime traces.
- Per-tenant custom lifecycle states.
- Delegated/temporary ownership.
- Contract templates library.
- Attestation — allow owners to attest that an agent's purpose, owner,
  runtime and identity mapping remain accurate (new doc's IDENTITY-P1-02).
  Likely needs a new Identity-owned `agent_attestations` table, not yet in
  `docs/design/ownership-map.md` — flagged here for the user, not created.
- Expiry controls — contract expiry with mandatory re-approval before
  continued operation (new doc's IDENTITY-P1-03); would extend
  IDENTITY-P0-03.1's `agent_contracts` schema with an explicit expiry/review
  field.
- Bulk lifecycle — safe bulk approve/restrict/suspend/retire with preview,
  authorization and a per-agent audit record for each affected agent (new
  doc's IDENTITY-P1-04); must call the existing `transitionAgentLifecycle`
  per agent rather than introducing a bulk-only code path that bypasses the
  transition table.

## P2 (strategic, after P0/P1 proven)

- Federated Agent Identity — portable identity relationships across agent
  runtimes and organizational domains (new doc's IDENTITY-P2-01).
- Agent-to-Agent Delegation Governance — delegated authority, delegation
  expiry, transitive access and chain-of-responsibility evidence, building on
  the existing `agent_relationships` table's `delegates_to` type (new doc's
  IDENTITY-P2-02).
- NHI Convergence — correlate agent identities with service accounts,
  workload identities, bots and other non-human identities via
  `agent_identities`, without WonderAgent becoming a generic NHI platform
  (Product Boundaries §10.7) (new doc's IDENTITY-P2-03).

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-supplied the module 02 requirements document at a fresh upload
path (`0a38fac6-02_AGENT_IDENTITY_LIFECYCLE.md`), described as a newer/
expanded version superseding the doc reconciled in the "Requirements
Refresh — 2026-09-14" pass above, and asked for a fresh, thorough re-check
in case it contains additional detail, new stories, or refined acceptance
criteria.

**Full read of the re-supplied document, cross-checked requirement-by-
requirement against this backlog's Progress Tracker, the existing
"Requirements Refresh — 2026-09-14" section above (including its "Already
covered, no new tracker row needed" list), and the `## P1`/`## P2` sections
below.** Result: **no genuinely new requirements, stories, or acceptance
criteria found.** The re-supplied document's content — the "Identity data
model" field summary; IDENTITY-P0-01 through IDENTITY-P0-10; IDENTITY-P1-01
through IDENTITY-P1-04; IDENTITY-P2-01 through IDENTITY-P2-03; and the
critical acceptance criteria paragraph — is, requirement ID for requirement
ID and substantively wording for wording, the same content the original
2026-09-14 pass already reconciled against:

- Doc's P0-01, P0-03, P0-04 (Identity Contract), P0-05 (Lifecycle State
  Machine), P0-06, P0-07, P0-08, P0-10 → already resolved to `Done` stories
  (IDENTITY-P0-01.1/01.2/02.1/02.2/03.1) in the first pass's "Already
  covered" list; re-verified still accurate against the current schema.
- Doc's P0-02 (Agent Registration — duplicate detection/merge workflow) and
  P0-09 (Discovery Reconciliation) → already added as this backlog's own
  IDENTITY-P0-04 and IDENTITY-P0-05 rows in the first pass. Both are now
  `Done`; spot-checked against the codebase and confirmed actually
  implemented: `modules/agent-identity/duplicates.ts` +
  `duplicates.test.ts` + migration `0041_identity_duplicate_candidates.sql`
  for P0-04, and `modules/agent-identity/discovery.ts` (reading Integration
  Agent's published `listIntegrations`/`getNormalizedObjects` contract) for
  P0-05 — matching the module's own audit log entries for both stories.
- Doc's P1-01 (Agent Relationships) → already exceeded (built as P0,
  IDENTITY-P0-02.3, `Done`), per the first pass's finding.
- Doc's P1-02/P1-03/P1-04 (Attestation, Expiry Controls, Bulk Lifecycle) →
  already carried in `## P1` below.
- Doc's P2-01/P2-02/P2-03 (Federated Agent Identity, Agent-to-Agent
  Delegation Governance, NHI Convergence) → already carried in `## P2`
  below.

No Progress Tracker rows were added, and no existing row's status was
changed, because there was nothing genuinely new to add. This is reported
explicitly rather than fabricating a gap to appear thorough — see the
corresponding 2026-09-14 (round 2) entry in
`docs/design/identity-agent-backlog-audit.md`.

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules and asked for it to be reconciled into the backlogs
before any implementation. Full section-by-section mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`; only
this module's own findings are recorded here.

### IDENTITY-P0-06 — Suspension Restoration Path

The new doc's P0-20 ("Emergency Suspension / Kill Switch") requires
"support controlled restoration" after a suspension. Direct inspection of
`modules/agent-identity/lifecycle.ts`'s `NORMAL_TRANSITIONS` table found
`SUSPENDED: ["RETIRED"]` is the *only* transition out of `SUSPENDED` — there
is no path back to `RESTRICTED` or `ACTIVE`. Everything else P0-20 asks for
(authorized-human-only, permission-controlled, mandatory reason, full audit
event, marking the agent `SUSPENDED`) is already built and unaffected by
this gap. **Built 2026-09-15.** Restoration is staged rather than a direct
`SUSPENDED → ACTIVE` jump, mirroring how an agent gets restricted in the
first place: `SUSPENDED → RESTRICTED → ACTIVE`. Both legs are gated by the
same elevated roles already used for `RESTRICTED → SUSPENDED`
(`RESTRICTED_TO_SUSPENDED_ROLES`), reuse the existing mandatory-reason +
`writeAudit()` path inside `transitionAgentLifecycle()` (no second
state-change code path), and are unit-tested in `lifecycle.test.ts`. No UI
change was needed — the agent detail page's lifecycle-transition form
already offers every `AgentLifecycleState` as a destination, so the new
transitions became selectable automatically once the state machine allowed
them.

### Minor, unnumbered gap noted (not a new story)

`AgentOwnerType` has no `escalation_owner` value, which the new doc's P0-05
("Ownership & Accountability") lists alongside business/technical/IAM
owner. Small, additive, Identity-owned — bundle into whichever future story
next touches `agent_owners`' schema rather than opening a standalone row
for one enum value.

### Decisions now resolved (2026-09-15, later same day)

The user answered the open cross-module questions via `AskUserQuestion`.
Relevant to this module:

- **Autonomy model → Identity + Access.** `agent_contracts` gains the
  autonomy-level/allowed-tools/human-approval/required-monitoring fields
  (this module, `IDENTITY-P0-07`, added above); Access Agent's policy
  engine enforces the resulting 4-state action model
  (`ACCESS-P0-06`, see that module's own backlog).
- **Governance Attestation → promoted to P0, Compliance-owned, broad
  scope.** This module's own `IDENTITY-P1-02` (narrow self-attestation)
  stays exactly as scoped and P1-tiered — the user's chosen option was the
  *broader*, Compliance-owned attestation concept (approver/decision/
  evidence-reference shape), not a re-tier of this module's existing item.
  See `COMPLIANCE-P0-08` in that module's backlog. No change to this
  module's own P1 list.
- **Governance Drift → Risk Agent.** No change here; see Risk Agent's
  backlog.
- **Governance Exceptions → broaden Access's `policy_exceptions`.** No
  change here.

### IDENTITY-P0-07 — Contract Autonomy & Oversight Fields

Extend `agent_contracts` (`IDENTITY-P0-03.1`, already `Done`) with the
fields the governance requirements doc's P0-03 names that the schema
doesn't carry today: `autonomy_level` (0-4, per the doc's Human Oversight
levels), a distinct `allowed_tools` list (separate from
`approved_applications`), a structured `human_approval_required` field
(not just the existing binary approved/prohibited action lists), and
`required_monitoring`. Acceptance criteria: new contract versions can set
these fields; existing contracts default to a safe/conservative value
(lowest autonomy, no implicit tool access) rather than silently
unrestricted; `createContractVersion()` validates `autonomy_level` is in
range; audited like every other contract field change. Also add
`escalation_owner` to `AgentOwnerType` (the governance doc's P0-05,
previously noted as a minor gap). **Not started.**

## DO NOT IMPLEMENT

- Effective access computation (Access Agent).
- Any runtime event ingestion (Runtime Agent).
- Any risk scoring or finding generation (Risk Agent) — Identity only exposes
  ownership/lifecycle *facts*, never a severity or a finding.
- Any connector/credential/sync logic (Integration Agent).
