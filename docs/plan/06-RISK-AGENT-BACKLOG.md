# 06 — Risk Agent Backlog

**Agent name:** `Risk Agent`
**Module:** Risk Engine & Rogue Agent Detection
**Branch:** `module/risk`
**Status:** DORMANT — do not start until the user says "Run Risk Agent"

## Dependencies

- **Identity Agent**: agent facts, ownership, lifecycle (`getAgent`,
  `getOwnershipIssues`), and `transitionAgentLifecycle` (Risk calls this to move an
  agent to `RESTRICTED` on a CRITICAL finding, per Identity's transition table).
- **Access Agent**: `evaluatePolicies()` results, `getEffectiveAccess()`.
- **Runtime Agent**: `compareShouldCanDid()`.

Risk Agent is a pure consumer of the above three contracts plus its own findings
schema — it must not implement its own copy of ownership checks, policy evaluation,
or SHOULD/CAN/DID comparison. If a dependency isn't implemented yet, Risk Agent
cannot produce that category of finding yet — record it and build the categories
that are available; do not fabricate the missing module's output.

## Owned entities

`risk_findings`, `risk_evidence`.

## Consumed entities

Everything listed under Dependencies, read-only via contract.

## Published contracts

- `lib/shared/types/risk.ts`: `RiskFinding`, `RiskSeverity`, `RiskFactor`,
  `RogueCategory`.
- `modules/risk/service.ts`:
  - `getFindings(filter): RiskFinding[]`
  - `getFinding(id): RiskFinding` (with full evidence and explanation)
  - `assignFinding(id, userId)`
  - `resolveFinding(id, resolution)` — called after remediation is confirmed (by
    Compliance/Access re-evaluation) — see Epic RISK-P0-03.

---

## Higher-bar stories

Everything in this backlog is higher bar — a wrong deterministic rule here is a
false CRITICAL finding or a missed real one. No story in this module may substitute
an LLM's judgment for a rule (non-negotiable #9); an LLM may only be used later
(Experience/Operations layer) to *explain* a finding already computed here.

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. This
agent is dormant; every story is Not Started until "Run Risk Agent" is
issued. Every story in this module is higher bar (see below).

| Story | Title | Status |
|---|---|---|
| RISK-P0-01.1 | Schema | Not Started |
| RISK-P0-01.2 | Detection rules, one per category | Not Started |
| RISK-P0-01.3 | Explainability | Not Started |
| RISK-P0-02.1 | Severity/risk score | Not Started |
| RISK-P0-03.1 | Assignment & recommendation | Not Started |
| RISK-P0-03.2 | Human-initiated remediation | Not Started |
| RISK-P0-03.3 | Re-evaluation & resolution | Not Started |

---

## Epic RISK-P0-01 — Rogue Agent Detection Categories

### RISK-P0-01.1 — Schema

```sql
create table risk_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null,
  category text not null check (category in (
    'excessive_access','unauthorized_resource','unauthorized_action',
    'sensitive_data_violation','behavioral_deviation','identity_anomaly',
    'ownership_violation','lifecycle_violation'
  )),
  severity text not null check (severity in ('low','medium','high','critical')),
  title text not null,
  explanation text not null,
  recommendation text not null,
  status text not null default 'open' check (status in ('open','assigned','remediation_in_progress','resolved','false_positive')),
  assigned_to uuid,
  policy_id uuid,               -- Access Agent's policies.id, if rule-derived
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table risk_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references risk_findings(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('access_grant','runtime_event','policy_evaluation','ownership_fact','lifecycle_event')),
  reference_id uuid not null,   -- id of the underlying row in the owning module's table
  summary text not null,        -- human-readable snapshot, since the referenced row could change/be remediated later
  created_at timestamptz not null default now()
);
```

`risk_evidence.summary` exists because the underlying `access_grants` row may later
be revoked as part of remediation — the finding's evidence must remain readable and
accurate as of when the finding was created, per non-negotiable #11 (immutable audit
context).

### RISK-P0-01.2 — Detection rules, one per category

Each category is a deterministic function over the dependency contracts' output,
run as part of `evaluateAgentRisk(agentId)`:

| Category | Rule |
|---|---|
| `excessive_access` | `compareShouldCanDid(agentId)` returns `excessive_access` (CAN has an application/data-classification pair not in SHOULD) |
| `unauthorized_resource` | DID includes an `application`/`resource` never in SHOULD's `approved_applications`, regardless of whether CAN also technically permits it |
| `unauthorized_action` | DID includes an `action` present in the contract's `prohibited_actions`, or absent from `approved_actions` |
| `sensitive_data_violation` | DID or CAN touches a `data_classification` present in the contract's `prohibited_data` |
| `behavioral_deviation` | `compareShouldCanDid` returns `behavioral_violation` (SHOULD != DID) for a reason other than a simple resource mismatch already captured above — e.g. action pattern/frequency inconsistent with declared purpose (P0: keep this to "SHOULD != DID and not otherwise categorized" — a full statistical anomaly detector is P1) |
| `identity_anomaly` | Runtime event's `identity_id` doesn't match any `agent_identities` row Identity has on file for that agent, or matches one marked `status = 'removed'` |
| `ownership_violation` | Identity's `getOwnershipIssues(agentId)` reports missing/inactive required owner |
| `lifecycle_violation` | Agent's `lifecycle_state` is `SUSPENDED` or `RETIRED` but a runtime event with `event_time` after the transition timestamp still exists |

Each rule, on trigger, creates exactly one `risk_findings` row (do not create
duplicate open findings for the same agent+category+underlying evidence — check for
an existing `open`/`assigned`/`remediation_in_progress` finding with the same
category and overlapping evidence before creating a new one; update
`risk_evidence` on the existing finding instead).

### RISK-P0-01.3 — Explainability

Every finding's `explanation` must be a plain-language, evidence-referencing string
generated deterministically from the evidence rows — not an LLM call. Worked
example (matches the PRD's Rogue Agent Detail screen):

```text
title: "Unauthorized Sensitive Data Access"
explanation: "FinanceBot's approved data is 'Financial reporting data' only. On
2026-09-12 10:31 UTC, FinanceBot read PII-classified data (Snowflake → CustomerDB)
via the query_customer tool. This access was not approved in the agent's active
contract."
recommendation: "Remove the CustomerDB_READ entitlement from FinanceBot's Snowflake
account."
```

Free-text natural-language elaboration *on top of* this deterministic explanation
(e.g. "explain this finding in plain English for an executive") is a legitimate
LLM-assist feature for Operations/Experience layers later — but the finding's
`category`, `severity`, and the base `explanation`/`recommendation` stored on the row
must come from this deterministic engine, never generated fresh by an LLM per
non-negotiable #9.

---

## Epic RISK-P0-02 — Deterministic Risk Scoring

### RISK-P0-02.1 — Severity/risk score

`severity` is computed from a deterministic weighted rule set over these factors
(each contributes 0 or its weight; sum maps to a severity band):

| Factor | Weight | Source |
|---|---|---|
| Production database / production environment access | 20 | `agents.environment = 'production'` + entitlement touches a data store |
| Sensitive data (PII/financial/confidential) involved | 25 | evidence's `data_classification` |
| External communication capability | 15 | contract/entitlement metadata flag (if not modeled yet, treat as 0 and note the gap) |
| No certification in >90 days (or contract's `certification_frequency` window) | 15 | Compliance Agent's last decision date, once available; 0 if unknown |
| Active policy violation (`evaluatePolicies` returned `violation`) | 15 | Access Agent |
| Runtime/behavioral anomaly present | 10 | this module's own `behavioral_deviation`/`identity_anomaly` findings |
| Business criticality = high/critical | 10 | `agents.criticality` |
| Missing/invalid ownership | 10 | Identity Agent |

Bands: `0–24 = low`, `25–49 = medium`, `50–74 = high`, `75+ = critical`. A single
`sensitive_data_violation` or `excessive_access` finding touching PII/financial data
on a production, high-criticality agent should land at `critical` — verify the
weights above actually produce that for the FinanceBot scenario as part of this
story's tests (financial data via `data_classification` weight 25 could be treated
as sensitive-data +25, +production 20, +criticality high +10, +policy violation +15
= 70 → "high", not quite reaching 75; if the worked scenario is expected to be
CRITICAL per the PRD, add a hard override: **any `sensitive_data_violation` finding
where the data classification is explicitly `prohibited_data` on the contract is
always at least `critical`, regardless of computed score** — implement this override
explicitly rather than tuning weights to coincidentally hit the threshold, since an
explicit override is auditable and an accidentally-tuned weight table is not).

Store the score and the specific contributing factors on the finding/agent so the
"Why?" UI (Experience Agent, PRD §36) can list them:

```json
{
  "risk_score": 100,
  "severity": "critical",
  "reasons": [
    "Production database access",
    "Customer PII",
    "Certification overdue (120 days)",
    "Behaviour exceeded approved purpose"
  ]
}
```

Persist `agents.risk_score` (Identity's column) via Identity's published update path
— Risk Agent does not write to `agents` directly; if Identity hasn't published a
`updateAgentRiskScore()` function yet, record this dependency and stop rather than
writing to Identity's table directly (non-negotiable #14).

---

## Epic RISK-P0-03 — Finding Lifecycle & Remediation Hand-off

### RISK-P0-03.1 — Assignment & recommendation

`assignFinding(id, userId)` sets `assigned_to` and `status = 'assigned'`, writes
audit. `recommendation` (already set at creation) names the specific corrective
action (e.g. "Remove the CustomerDB_READ entitlement").

### RISK-P0-03.2 — Human-initiated remediation

Risk Agent does not itself revoke access (non-negotiable #6/#15). It exposes
`POST /api/v1/findings/:id/remediate` which:

1. Sets `status = 'remediation_in_progress'`.
2. Calls Access Agent's exposed remediation-initiation contract (once published —
   e.g. `requestRemediation(findingId, recommendedAction)`), which itself may either
   create an `access_requests` row for a human to action in the real IAM, or, if a
   connector supports it, call Integration's `removeAccess()` (still requiring
   explicit human approval per non-negotiable #15 — never auto-triggered by this
   endpoint alone without the calling user's explicit confirmation in the request).
3. If Access Agent hasn't published this contract yet, record the dependency in the
   audit log and leave the finding `assigned` with a note — do not fabricate a
   remediation action.

### RISK-P0-03.3 — Re-evaluation & resolution

After a remediation action is confirmed complete (Access Agent's `access_grants` row
shows `revoked_at` set, or Compliance confirms a certification decision), a
re-evaluation of the same rule that created the finding must return "no longer
triggered" before the finding can move to `resolved`. `resolveFinding(id,
resolution)` requires this re-check — it must not be a bare status flip on a human's
say-so alone; the underlying evidence must actually be gone. If manual override is
genuinely needed (e.g. compensating control), require `resolution.type =
'accepted_risk'` with a `reason`, distinct from `resolution.type = 'verified_fixed'`.

**Worked example (closing the loop on the central scenario):** IAM Admin removes
CustomerDB_READ from FinanceBot's Snowflake account (via Access Agent's fulfillment
path). Risk Agent's re-evaluation calls the same `excessive_access` rule
(RISK-P0-01.2) — it no longer triggers because `getEffectiveAccess` no longer
includes CustomerDB. The finding transitions to `resolved`, `resolved_at` set, audit
written.

---

## Critical acceptance test

When SHOULD = financial data only, CAN includes CustomerDB, and DID shows CustomerDB
access, generate a CRITICAL finding with evidence (referencing the specific
`access_grants` and `runtime_events` rows) and a recommendation to remove the
CustomerDB entitlement — then, after that entitlement is removed, prove the same
finding resolves via re-evaluation rather than a manual status flip.

## P1

Statistical/ML-free-but-more-sophisticated behavioral baselining. Attack-path
scoring across multiple agents. Auto-remediation for pre-approved low-risk
categories (still requires an explicitly approved automation path per
non-negotiable #15 — do not build this speculatively).

## DO NOT IMPLEMENT

- Any UI (Experience Agent).
- Certification campaign logic (Compliance Agent) — Risk only feeds findings into
  certification review as evidence.
- Any actual access-grant mutation — Risk always goes through Access/Integration's
  published contracts, never direct writes to their tables.
