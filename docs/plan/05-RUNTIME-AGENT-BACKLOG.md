# 05 — Runtime Agent Backlog

**Agent name:** `Runtime Agent`
**Module:** Runtime Assurance & SHOULD/CAN/DID
**Branch:** `module/runtime`
**Status:** DORMANT — do not start until the user says "Run Runtime Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every row is in `docs/design/runtime-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| RUNTIME-P0-01.1 | Schema | Done |
| RUNTIME-P0-01.2 | Idempotent ingestion (higher bar) | Done |
| RUNTIME-P0-01.3 | Timeline queries | Done |
| RUNTIME-P0-02.1 | DID aggregation (higher bar) | Done |
| RUNTIME-P0-02.2 | Comparison engine (higher bar) | Done |
| RUNTIME-P0-11 | Ingestion Hardening — replay protection & event quarantine | Done — 2026-09-14, live RLS-verified |
| RUNTIME-P0-12 | SHOULD Normalization Model (unknown-safe) | Done — 2026-09-14, unit-tested |
| RUNTIME-P0-13 | Point-in-Time CAN Resolution & Historical Accuracy | Done — 2026-09-16: Risk Agent adopted it. `getFindingAsOfDetection()` (`modules/risk/findings.ts`) calls `compareShouldCanDid(tenantId, agentId, finding.createdAt)`, reconstructing CAN as of when a finding was first detected — the real, non-speculative caller this row was waiting on. Exposed via `GET /api/v1/findings/[id]/historical-context` and a "Show access as of detection time" panel in the Risk finding evidence drawer, see Risk Agent's own audit log |
| RUNTIME-P0-14 | Runtime Data Quality Tracking | Done — 2026-09-14, live-verified against real fixture data |
| RUNTIME-P0-15 | Runtime Gateway endpoint (master P0-26/P0-27/P0-33) | Done — 2026-09-25: `POST /api/gateway/v1/authorize` (agent-key auth, OBSERVE_ONLY, idempotent), migration `0062` `runtime_decisions` applied live, decisions panel on /runtime; 7 unit + 6 live SQL + 8 E2E security cases; p50 1,953 → 859 ms locally after cutting to 3 round trips; see audit log. The per-request runtime *event* moved to RUNTIME-P0-16, where event types exist |
| RUNTIME-P0-16 | Event types, sessions and decision fields (master P0-18) | Done — 2026-09-25: migration `0063` (12 event types, backfill, `session_id`/`decision_id`/`mcp_server`, `gateway` source) applied live; DID reads observed types only; gateway decisions on the timeline; truthful result labels; see audit log |
| RUNTIME-P0-17 | SHOULD tools and NOW (codebase-map D7, master P0-19) | Done — 2026-09-25: SHOULD carries `allowedTools`; new `unapproved_tool` outcome from observed tools; NOW from the latest gateway decision; four-column comparison with EXPERIENCE-P0-17 wording; see audit log |
| RUNTIME-P0-18 | Emergency controls and tool filtering at the gateway (master P0-34/P0-35) | Done — 2026-09-25: migration `0064` `runtime_emergency_controls` applied live (kill switch, tool/MCP-server suspension, session termination); gateway decisions honour them; revoke-all-keys; `POST /api/gateway/v1/tools/filter` (observe-only reports `wouldHide`); controls card on /runtime; 5 decision + 3 filter + 5 service unit cases, 6/6 live SQL, 6/6 E2E; see audit log |

---

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

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`05_RUNTIME_ASSURANCE.md`) that expands this module's P0/P1/P2 scope beyond
what was already tracked above. Reconciled against the existing Progress
Tracker (nothing already `Done` was reopened, and mapping was done by
content/meaning against the new doc's flat `RUNTIME-P0-NN` numbering, not by
matching IDs to this backlog's epic-based `RUNTIME-P0-EE.S` numbering); the
following are genuinely new stories added to the tracker.

### RUNTIME-P0-11 — Ingestion Hardening: Replay Protection & Event Quarantine

Maps to the new doc's RUNTIME-P0-02 ("Event Ingestion"). The idempotency half
of that requirement is already satisfied by RUNTIME-P0-01.2 (deterministic
`dedupe_key` + `unique (tenant_id, dedupe_key)`), and basic shape validation
already exists inline in `app/api/v1/runtime/events/route.ts`. Two pieces of
that requirement are genuinely unimplemented: (1) replay protection distinct
from idempotency — the ingestion endpoint has no timestamp/nonce or
signed-request window check, so a captured request can be resubmitted
indefinitely as long as its `dedupe_key` inputs are altered even slightly;
and (2) event quarantine — invalid events today are rejected with a plain
400 and never persisted, so there is no queryable record for an
administrator/Integration Agent to investigate a misbehaving source. **Not
started.**

**Acceptance criteria:** an event failing schema/replay-window validation is
written to a quarantine store (tenant-scoped, RLS-protected) with a safe
(non-secret-leaking) error reason instead of being silently dropped, and a
duplicate/replayed submission outside the legitimate idempotency case is
rejected rather than accepted as new.

**Dependency note:** may need Integration Agent's shared-secret/bearer-token
ingestion mechanism (per the existing authentication-decision comment in
`app/api/v1/runtime/events/route.ts`) to make replay protection meaningful
for machine-to-machine submitters; if so, record that as a consumed contract
rather than inventing credential infrastructure here (non-negotiable #6/#14).

### RUNTIME-P0-12 — SHOULD Normalization Model (unknown-safe)

Maps to the new doc's RUNTIME-P0-04 ("SHOULD Model"). Today
`compareShouldCanDid` (RUNTIME-P0-02.2) consumes `agent_contracts`'
`approved_applications`/`approved_data` fields directly as the SHOULD set —
it does not normalize contract purpose into the fuller vocabulary the new
doc specifies (approved tools, resource classes, actions, environments, data
categories), and it has no explicit "unknown" representation: an
agent/contract field that is empty or ambiguous today is simply absent from
`should`, which is observationally similar to "not approved" but is not the
same as a flagged "unknown — do not assume compliant" state the new doc
requires. **Not started.**

**Acceptance criteria:** a contract with an unset/ambiguous purpose field
produces an explicit `unknown` marker in the SHOULD model (never silently
treated as either fully permitted or fully denied), and the normalized SHOULD
shape includes tools and actions, not only application/data, so
`compareShouldCanDid` can be extended to compare on those dimensions without
another schema change.

### RUNTIME-P0-13 — Point-in-Time CAN Resolution & Historical Accuracy

Merges the new doc's RUNTIME-P0-05 ("CAN Model" — resolve whether an
observed action was technically possible *at the relevant point in time*)
and RUNTIME-P0-08 ("Historical Accuracy" — evaluate using the access/policy
version effective at event time, not today's). Both describe the same
underlying gap: `compareShouldCanDid` currently calls
`getEffectiveAccess(tenantId, agentId)` for *current* access only, so an
evaluation of a 90-day-old event today is scored against today's
entitlements, not the entitlements that were actually in force when the
event happened — a real distortion risk if access has changed since (e.g. an
entitlement was already revoked, which would make a genuine historical
`excessive_access` finding disappear on re-evaluation). **Not started.**

**Acceptance criteria:** `compareShouldCanDid` (or a new time-scoped variant)
can resolve CAN as of a given timestamp, and re-running an evaluation after
an entitlement change does not retroactively erase evidence of access that
was actually granted at the time of the observed event.

**Dependency note:** this requires Access Agent to expose effective access
*as of a point in time* (an access-history/versioning contract), which does
not appear to exist as a published contract yet. Per non-negotiable #18,
this is recorded here as a required contract addition from Access Agent
rather than something Runtime Agent should build itself — if Access Agent's
backlog does not already plan this, that should be raised with the user
rather than guessed at.

### RUNTIME-P0-14 — Runtime Data Quality Tracking

Maps to the new doc's RUNTIME-P0-10 ("Runtime Data Quality"). No existing
story tracks missing identity mappings, unknown resources, duplicate-event
volume, delayed events, or unsupported actions — `ingestRuntimeEvent` stores
`identity_id` as nullable and silently accepts a null resolution today, with
no signal surfaced anywhere that this happened. The new doc's explicit
requirement — "unknown must not silently become compliant" — is not met: an
event with an unresolved identity or unrecognized resource flows into DID
and the comparison engine exactly like a fully-resolved one. **Not started.**

**Acceptance criteria:** a queryable data-quality view/table records at
least missing-identity-mapping and unknown-resource counts per tenant/agent,
and the comparison engine's evidence bundle (RUNTIME-P0-02.2) is able to
distinguish "known compliant" from "unknown, unscored" rather than treating
both as absence of a violation.

### Already covered, no new tracker row needed

- **RUNTIME-P0-01** (Canonical Runtime Event) → `RUNTIME-P0-01.1` (schema).
  One minor field gap noted, not worth a separate story: the new doc lists
  `latency` as a canonical field; the current `runtime_events` schema has no
  `latency` column. Flagged for whoever next touches the schema rather than
  spun out on its own.
- **RUNTIME-P0-02** (Event Ingestion) → its idempotency/dedup and basic
  validation halves are covered by `RUNTIME-P0-01.2`; its replay-protection
  and quarantine halves are the genuinely new `RUNTIME-P0-11` above.
- **RUNTIME-P0-03** (Activity Timeline) → `RUNTIME-P0-01.3`
  (`GET /api/v1/runtime/events`), which already supports chronological,
  filtered, paginated per-agent queries with full event evidence in each row.
  Drill-down to *related policy/risk findings* is inherently cross-module
  (Risk Agent owns findings) and not a gap in what Runtime Agent itself must
  expose.
- **RUNTIME-P0-06** (DID Model) → `RUNTIME-P0-02.1` (`getDid`).
- **RUNTIME-P0-07** (SHOULD/CAN/DID Evaluation) → `RUNTIME-P0-02.2`
  (`compareShouldCanDid`), which already returns all applicable mismatch
  categories with attributed evidence. The new doc's mention of "severity" as
  part of this evaluation is **not** adopted here — this backlog's existing
  `DO NOT IMPLEMENT` boundary (severity/finding creation is Risk Agent's,
  per module ownership and non-negotiable #18) is preserved unchanged; the
  new doc's wording does not override module ownership.
- **RUNTIME-P0-09** (Evidence Chain) → `RUNTIME-P0-02.2`'s evidence bundle
  already attributes every comparison outcome to the specific
  `access_grants`/`runtime_events` row(s) that produced it, satisfying the
  reproducibility requirement; the remaining links in the chain (finding,
  access path) are owned and asserted by Risk Agent and Access Agent
  respectively on their own sides of the published contracts.

**Ownership-map flags for the user:** `RUNTIME-P0-11`'s quarantine store and
`RUNTIME-P0-14`'s data-quality tracking table/view are new database objects
that do not yet appear in `docs/design/ownership-map.md` (only
`runtime_events`, `runtime_tools`, `runtime_resources` are listed for this
module today). Both fit squarely within Runtime Agent's existing ownership
description ("Runtime event model... MCP runtime observation") so no
cross-module ownership conflict is expected, but the ownership map itself is
not edited here per this task's constraints — flagged for the user/Runtime
Agent to add the table names to the ownership map when actually implemented.

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded the requirements document for this module at
`707001e1-05_RUNTIME_ASSURANCE.md`, described as a newer/expanded version of
the doc reconciled in the "Requirements Refresh — 2026-09-14" pass above, and
asked for a fresh, thorough re-check against it in case it carried additional
detail, new stories, or refined acceptance criteria not present in the
smaller original.

**Finding: nothing new.** The re-uploaded document's substantive content —
its "Runtime Assurance" and "SHOULD vs CAN vs DID Engine" PRD sections, its
"Claude Code Execution Plan," and its full "Expanded Requirements — Runtime
Assurance P0/P1/P2" numbering (`RUNTIME-P0-01` through `RUNTIME-P0-10`,
`RUNTIME-P1-01` through `RUNTIME-P1-04`, `RUNTIME-P2-01` through
`RUNTIME-P2-03`, and its closing "Critical acceptance" note) — is, item for
item, the same content already reconciled above. Every one of its numbered
requirements maps cleanly onto something already present in this backlog:

- `RUNTIME-P0-01` → `RUNTIME-P0-01.1` (including the already-flagged
  `latency`-field gap, not spun into a new story).
- `RUNTIME-P0-02` → `RUNTIME-P0-01.2` (idempotency) + `RUNTIME-P0-11`
  (replay protection & quarantine).
- `RUNTIME-P0-03` → `RUNTIME-P0-01.3`.
- `RUNTIME-P0-04` → `RUNTIME-P0-12`.
- `RUNTIME-P0-05` and `RUNTIME-P0-08` → `RUNTIME-P0-13` (already moved from
  `Deferred` to `Partial` in the prior commit — left untouched here per this
  task's instructions).
- `RUNTIME-P0-06` → `RUNTIME-P0-02.1`.
- `RUNTIME-P0-07` → `RUNTIME-P0-02.2` (severity deliberately not adopted,
  per the existing `DO NOT IMPLEMENT` boundary).
- `RUNTIME-P0-09` → `RUNTIME-P0-02.2`'s evidence bundle.
- `RUNTIME-P0-10` → `RUNTIME-P0-14`.
- `RUNTIME-P1-01` (Cloud Runtime Adapters) and `RUNTIME-P1-02` (Behavioural
  Baselines) → already reflected in the `## P1` section's "AWS/Azure runtime
  sources... a behavioral-anomaly engine beyond simple set comparison"
  prose below.
- `RUNTIME-P1-03` (Streaming Evaluation) and `RUNTIME-P1-04` (Session
  Reconstruction) → already tracked under those exact story IDs in the
  `## P1` section below.
- `RUNTIME-P2-01`/`RUNTIME-P2-02`/`RUNTIME-P2-03` → already tracked under
  those exact story IDs in the `## P2` section below.
- The closing "Critical acceptance" note → matches this file's own
  "Critical acceptance test" section above essentially verbatim.

No new Progress Tracker row was added and no existing row's status was
changed. Sanity-checked against the live codebase
(`modules/runtime-assurance/*.ts`, `supabase/migrations/0032`, `0033`,
`0043_runtime_*.sql`) and this module's own audit log before concluding
this — the implementation and tracking already visible there account for
everything the re-uploaded doc describes; nothing was found that exists in
code but is undocumented, and nothing was found that the doc requires but no
part of this backlog mentions. See the dated audit-log entry for the same
conclusion in more detail.

## P1

AWS/Azure runtime sources, application log ingestion, SIEM integration, a
behavioral-anomaly engine beyond simple set comparison (e.g. statistical
baselining).

- **RUNTIME-P1-03 — Streaming Evaluation.** Evaluate events near real time
  (bounded latency) with durable retry semantics, rather than only on-demand
  `compareShouldCanDid` calls. New from the requirements refresh above.
- **RUNTIME-P1-04 — Session Reconstruction.** Group related events by
  session/`correlation_id` into a coherent agent action chain for
  investigation. `runtime_events.correlation_id` already exists in the
  schema; the reconstruction/grouping view itself is not built. New from the
  requirements refresh above.

## P2 (strategic, after P0/P1 proven)

- **RUNTIME-P2-01 — Runtime Interception Integrations.** Optional
  pre-execution authorization integrations where the customer's runtime
  supports them, without replacing the customer's own IAM (per non-negotiable
  #7 and Product Boundary #6).
- **RUNTIME-P2-02 — Advanced Sequence Detection.** Detect suspicious
  multi-step action sequences and privilege-escalation patterns with
  explainable evidence, beyond RUNTIME-P1-02's baseline statistical
  approach.
- **RUNTIME-P2-03 — Runtime Replay.** Let investigators reconstruct an
  historical session exactly from immutable evidence alone.

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. Its
P0-08 ("Runtime Assurance / DID," minimum semantic event fields) reads
near-identically to what this module's own 2026-09-14 round-2 refresh
already reconciled ("nothing new," confirmed against a live codebase
check) — trusted rather than re-derived in this pass. No new Runtime-owned
story added.

---

## Requirements Refresh — 2026-09-25 (master P0/P1/P2 implementation stories)

Source: the user-supplied *WonderAgent Master P0/P1/P2 Implementation Stories* (MCP folded into the five pillars DISCOVER → UNDERSTAND → GOVERN → PROTECT → ASSURE), mapped story by story in [`docs/implementation/codebase-map.md`](../implementation/codebase-map.md). Ownership and architecture choices were decided by the user on 2026-09-25 (see `docs/design/ownership-map.md`, "Master stories decisions"). Nothing already `Done` is reopened; the rows below are added to this module's Progress Tracker as `Not Started`.

### RUNTIME-P0-15 — Runtime Gateway endpoint (master P0-26/P0-27/P0-33)

User decisions: runs inside this app as the `/api/gateway/v1/*` subtree; agents authenticate with per-agent API keys (FOUNDATION-P0-17); **default mode is OBSERVE_ONLY** (decisions are evaluated and recorded, nothing blocked) with ENFORCE enabled per tenant/environment later. Independent of dashboard rendering; calls Access's `evaluateRuntimeRequest()` (ACCESS-P0-11); persists a decision record (new `runtime_decisions`, tenant_id + RLS), idempotent on request id (the matching runtime *event* — TOOL_REQUEST/ALLOWED/DENIED — is recorded by RUNTIME-P0-16, which introduces those event types; a gateway request is not yet an observed action, so writing it into DID now would be inaccurate); never runs an LLM in the request path. Security tests: forged tenant/agent/identity/resource ids, replay, duplicate requests, cross-tenant key.

### RUNTIME-P0-16 — Event types, sessions and decision fields (master P0-18)

A normalized event-type vocabulary (AUTHENTICATION, SESSION_STARTED/ENDED, TOOL_REQUEST/ALLOWED/DENIED/APPROVAL_REQUIRED/EXECUTED, API_CALL, DATA_ACCESS, DELEGATION, POLICY_DECISION), session id and decision fields on runtime events, MCP metadata as first-class fields — additive to the existing free-text `action`.

### RUNTIME-P0-17 — SHOULD tools and NOW (codebase-map D7, master P0-19)

SHOULD includes `agent_contracts.allowed_tools` (currently always empty); the comparison gains NOW (the current request) — current request vs approved purpose and vs effective access.

### RUNTIME-P0-18 — Emergency controls and tool filtering at the gateway (master P0-34/P0-35)

Suspended agents, MCP servers and tools resolve to DENY at the gateway; kill switch and session termination; tool filtering returns only permitted tools where the integration supports it (filtering never replaces authorization). Every emergency action requires `runtime.emergency`, confirmation and audit.


---

## DO NOT IMPLEMENT

- Any risk severity, finding, or remediation recommendation (Risk Agent).
- Effective access computation itself (Access Agent) — Runtime only consumes it.
- Any connector/credential logic (Integration Agent).
