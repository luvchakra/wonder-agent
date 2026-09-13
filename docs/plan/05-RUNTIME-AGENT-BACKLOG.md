# 05 — Runtime Agent Backlog

**Agent name:** `Runtime Agent`
**Module:** Runtime Assurance & SHOULD/CAN/DID
**Branch:** `module/runtime`
**Status:** DORMANT — do not start until the user says "Run Runtime Agent"

## Dependencies

- **Foundation Agent**: tenant context, RBAC, audit.
- **Identity Agent**: `getAgentContract()` (SHOULD).
- **Integration Agent**: normalized runtime events from MCP/webhook ingestion
  (`NormalizedRuntimeEvent`). If Integration hasn't published this yet, Runtime Agent
  may still build its own direct ingestion endpoint for MCP/REST events (P0 lists
  both MCP and REST/webhook as runtime sources) — do not block core event-model
  stories on Integration; reconcile duplicate ingestion paths later via the audit log
  if both end up built.
- **Access Agent**: `getEffectiveAccess()` (CAN), for the comparison engine.

## Owned entities

`runtime_events`, `runtime_tools`, `runtime_resources`.

## Consumed entities

Identity's contract, Access's effective access — read-only via their service
contracts.

## Published contracts

- `lib/shared/types/runtime.ts`: `RuntimeEvent`, `DidSummary`,
  `ShouldCanDidComparison`.
- `modules/runtime-assurance/service.ts`:
  - `ingestRuntimeEvent(event: RuntimeEvent)` — the only way any event enters
    `runtime_events`.
  - `getDid(agentId, window): DidSummary` — aggregated observed behavior.
  - `compareShouldCanDid(agentId): ShouldCanDidComparison` — the reproducible
    evidence Risk Agent consumes to generate findings. Runtime Agent computes the
    *comparison signal*; it does not assign severity or create a finding — that's
    Risk Agent.

---

## Higher-bar stories

RUNTIME-P0-01.2 (idempotent ingestion) and RUNTIME-P0-02.* (the comparison engine)
are higher bar — the whole product's central claim depends on this data being
correct and reproducible from stored evidence.

---

## Epic RUNTIME-P0-01 — Normalized Runtime Event Model

### RUNTIME-P0-01.1 — Schema

```sql
create table runtime_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null,               -- Identity's agents.id
  identity_id uuid,                     -- Identity's agent_identities.id, if resolved
  event_time timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('mcp','rest','webhook')),
  tool text,
  application text,
  resource text,
  action text not null,                 -- e.g. 'read','write','delete','export'
  data_classification text,
  success boolean not null,
  raw jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);
create index on runtime_events (tenant_id, agent_id, event_time desc);

create table runtime_tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid,
  name text not null,
  source_integration_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table runtime_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application text not null,
  resource text not null,
  data_classification text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tenant_id, application, resource)
);
```

**Worked example — the PRD's exact event:**

```json
{
  "agent_id": "financebot-id",
  "identity_id": "svc-finance-ai",
  "event_time": "2026-09-12T10:31:00Z",
  "source": "mcp",
  "tool": "query_customer",
  "application": "snowflake",
  "resource": "customer_db",
  "action": "read",
  "data_classification": "PII",
  "success": true
}
```

### RUNTIME-P0-01.2 — Idempotent ingestion (higher bar)

`ingestRuntimeEvent(event)` computes `dedupe_key` deterministically from
`(source, tool, application, resource, action, event_time, agent_id)` (or accepts an
explicit idempotency key if the source provides one) and relies on the
`unique (tenant_id, dedupe_key)` constraint — a duplicate submission (e.g. an MCP
proxy retry) must be a silent no-op, not a duplicate row and not an error surfaced to
the caller as a failure. On first sight of a `tool`/`resource`, upsert the
corresponding `runtime_tools`/`runtime_resources` row (`first_seen_at` set once,
`last_seen_at` bumped every time).

**Acceptance criteria:** submitting the exact same event payload twice results in
exactly one `runtime_events` row and both calls return success.

### RUNTIME-P0-01.3 — Timeline queries

`GET /api/v1/runtime/events?agentId=...&from=...&to=...` returns a paginated,
tenant-scoped, chronological event list. This is the data source for the "Runtime
Activity" screen (Experience Agent builds the UI; Runtime Agent only guarantees the
API).

---

## Epic RUNTIME-P0-02 — SHOULD / CAN / DID Comparison Engine (higher bar)

### RUNTIME-P0-02.1 — DID aggregation

`getDid(agentId, window)` aggregates `runtime_events` in the given time window into a
summary: distinct `{application, resource, action, data_classification}` tuples
actually observed, each with first/last-seen timestamps and event count. This is
DID.

### RUNTIME-P0-02.2 — Comparison engine

`compareShouldCanDid(agentId)`:

1. **SHOULD** = the active `agent_contracts` row's `approved_applications` /
   `approved_data` / `approved_actions` (via Identity's `getAgentContract`).
2. **CAN** = `getEffectiveAccess(agentId)` (via Access Agent), reduced to the same
   `{application, data_classification}` shape as SHOULD/DID for comparison.
3. **DID** = `getDid(agentId, window)` (default window: since last certification, or
   last 90 days if none).

Comparison outcomes (return all that apply, not just one):

```text
SHOULD == CAN == DID  -> healthy
SHOULD != CAN         -> excessive_access (CAN has more) or insufficient_access (SHOULD has more than CAN)
CAN != DID            -> unused_capability (CAN has more) or unexpected_capability (DID has more than CAN — should be impossible if CAN is complete; flag as identity anomaly evidence)
SHOULD != DID         -> behavioral_violation
```

**Worked example — the PRD's central scenario, fully reproduced:**

- SHOULD: `{application: "SAP", data: "financial reporting"}`, `{application:
  "Snowflake", data: "financial reporting"}`.
- CAN (from Access Agent, includes the CustomerDB grant): `{application: "SAP",
  ...}`, `{application: "Snowflake", data: "financial reporting"}`, `{application:
  "Snowflake", resource: "CustomerDB", data: "PII"}`.
- DID (from the ingested event): `{application: "Snowflake", resource:
  "CustomerDB", action: "read", data_classification: "PII"}`.

Result: `SHOULD != CAN` → `excessive_access` (CustomerDB entitlement present but not
approved); `SHOULD != DID` → `behavioral_violation` (agent actually read PII data
outside its approved purpose). Both outcomes are returned with full evidence
(the specific `access_grants` row and the specific `runtime_events` row) — this
evidence bundle is exactly what Risk Agent turns into the CRITICAL finding.

**Acceptance criteria:** `compareShouldCanDid` is a pure read/compute function over
already-stored evidence — calling it twice with no new data produces byte-identical
output (reproducibility, per the module's critical acceptance test), and every
outcome in the result references the specific row(s) that produced it (no
unattributed "trust me" conclusions).

**DO NOT IMPLEMENT** severity assignment, finding creation, or notification — Runtime
Agent emits the comparison signal; Risk Agent turns it into a finding.

---

## Critical acceptance test

Ingest the FinanceBot → Snowflake → CustomerDB READ event and produce DID =
CustomerDB with timestamp, identity, tool/resource/action and an evidence trace
sufficient for `compareShouldCanDid` to reproduce the SHOULD/CAN/DID divergence above
from stored data alone.

## P1

AWS/Azure runtime sources, application log ingestion, SIEM integration, a
behavioral-anomaly engine beyond simple set comparison (e.g. statistical baselining).

## DO NOT IMPLEMENT

- Any risk severity, finding, or remediation recommendation (Risk Agent).
- Effective access computation itself (Access Agent) — Runtime only consumes it.
- Any connector/credential logic (Integration Agent).
