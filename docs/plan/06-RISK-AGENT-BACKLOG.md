# 06 — Risk Agent Backlog

**Agent name:** `Risk Agent`
**Module:** Risk Engine & Rogue Agent Detection
**Branch:** `module/risk`
**Status:** DORMANT — do not start until the user says "Run Risk Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every row is in `docs/design/risk-agent-backlog-audit.md`. Every story in
this module is higher bar (see below).

| Story | Title | Status |
|---|---|---|
| RISK-P0-01.1 | Schema | Done |
| RISK-P0-01.2 | Detection rules, one per category | Done |
| RISK-P0-01.3 | Explainability | Done |
| RISK-P0-02.1 | Severity/risk score | Partial — `agents.risk_score` persistence blocked on Identity publishing `updateAgentRiskScore()`; the score is fully computed and stored on every finding |
| RISK-P0-03.1 | Assignment & recommendation | Done |
| RISK-P0-03.2 | Human-initiated remediation | Partial — endpoint/UI exist and behave honestly (`wired: false`); blocked on Access Agent publishing a remediation-initiation contract |
| RISK-P0-03.3 | Re-evaluation & resolution | Done |
| RISK-P0-01.4 | Evaluator version on evidence pack | Not Started |
| RISK-P0-02.2 | Configurable severity weights & INFO tier | Not Started |
| RISK-P0-03.4 | Expanded finding lifecycle states (ACKNOWLEDGED/INVESTIGATING/MITIGATED/EXCEPTION) | Not Started |
| RISK-P0-03.5 | False positive disposition with reason & expiry | Not Started |

---

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

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package module doc
`06_RISK_ROGUE_DETECTION.md`, whose "Expanded Requirements — Risk & Rogue
Detection P0/P1/P2" section (`RISK-P0-01` .. `RISK-P0-10`, `RISK-P1-01` ..
`RISK-P1-04`, `RISK-P2-01` .. `RISK-P2-03`) expands this module's scope
beyond what was already tracked above. Reconciled against the existing
Progress Tracker (nothing already `Done`/`Partial` was reopened or marked
down); checked `modules/risk/scoring.ts`, `modules/risk/findings.ts`,
`modules/risk/service.ts` and `lib/shared/types/risk.ts` directly rather than
assuming — the following are genuinely new or newly-explicit stories added
to the tracker, all `Not Started` (none could be verified as already
implicitly satisfied):

### RISK-P0-01.4 — Evaluator version on evidence pack

The new doc's Evidence Pack requirement (`RISK-P0-05`) explicitly lists
"evaluator version" alongside source events, access path, contract/policy,
timestamps and recommendation. `risk_findings`/`risk_evidence` (migration
covered by RISK-P0-01.1) do not carry an evaluator/rule-version column today
— confirmed by reading the schema and `findings.ts`'s insert paths. Add an
`evaluator_version` (or equivalent) column populated by `rules.ts` at
finding-creation time, so a finding's evidence pack can show exactly which
version of the deterministic rule produced it, per non-negotiable #11's
immutable-audit-context intent. Acceptance: every new finding row carries a
non-null evaluator/rule version; existing rows may backfill to a documented
baseline version rather than blocking on a data migration story of their
own.

### RISK-P0-02.2 — Configurable severity weights & INFO tier

The new doc's Severity Model (`RISK-P0-02`) calls for CRITICAL/HIGH/MEDIUM/
LOW/**INFO** (this module currently implements only
low/medium/high/critical — confirmed in `lib/shared/types/risk.ts` and
`scoring.ts`) and "configurable policy weights" (today's weights in
`scoring.ts` are hard-coded constants, not tenant/admin-adjustable).
Acceptance: add an `info` band below the existing `low` floor for
sub-threshold observations that shouldn't read as `low` risk; move the
factor-weight table into a queryable, auditable configuration source (a
table or a versioned config record is acceptable) that `computeSeverity`
reads instead of inlining, with a change to any weight itself being an
audited, admin-only action — never silently tunable, and never delegated to
an LLM (non-negotiable #9). This does not change the existing
`applyProhibitedDataOverride` behavior or any already-`Done` scoring
outcome for the FinanceBot scenario.

### RISK-P0-03.4 — Expanded finding lifecycle states

The new doc's Finding Lifecycle (`RISK-P0-03`) specifies: `OPEN →
ACKNOWLEDGED → INVESTIGATING → REMEDIATION_PENDING →
MITIGATED/RESOLVED or FALSE_POSITIVE/EXCEPTION`. The implemented
`FindingStatus` union (`open | assigned | remediation_in_progress | resolved
| false_positive`) covers the shape but not the finer-grained
`acknowledged`/`investigating`/`mitigated`/`exception` states the new doc
calls out by name, and every transition must remain audited (already true
of `assignFinding`/`resolveFinding`'s `writeAudit` calls — that part
carries over unchanged). Acceptance: extend the status enum and its check
constraint additively (per CLAUDE.md §13, migrations stay backward
compatible), add the missing transition entry points, and keep every
transition producing an audit record exactly as today's `assigned`/
`resolved` transitions do. `remediation_in_progress` already maps to the new
doc's `REMEDIATION_PENDING` in meaning — keep the existing column value
rather than renaming it, to avoid an unnecessary breaking rename of an
already-`Done` contract.

### RISK-P0-03.5 — False positive disposition with reason & expiry

The new doc's False Positive Handling (`RISK-P0-08`) requires: human
disposition with a reason, evidence, and an optional expiry, and that a
false-positive decision must not erase original evidence. Today,
`resolveFinding` only implements `resolution.type` of `verified_fixed` and
`accepted_risk` (confirmed in `findings.ts`) — no code path ever actually
sets `status = 'false_positive'`, even though that value exists in the
schema's check constraint and the `FindingStatus` type. Acceptance: add a
`false_positive` resolution path requiring a `reason` (same non-empty check
already applied to `accepted_risk`), an optional `expires_at` after which
the finding's rule is automatically re-evaluated (reusing the RISK-P0-03.3
re-evaluation machinery rather than inventing a second one), and confirm the
existing `risk_evidence` rows are left untouched — never deleted or
overwritten — when a finding is dispositioned as a false positive.

### Already covered, no new tracker row needed

- `RISK-P0-01` (Deterministic Risk Model) — matches `RISK-P0-02.1` (Done):
  reproducible weighted scoring over stored factors, already implemented in
  `scoring.ts`.
- `RISK-P0-04` (Rogue Categories) — matches `RISK-P0-01.2` (Done): all eight
  categories (excessive access, unauthorized resource/action, sensitive-data
  violation, behavioral deviation, identity anomaly, ownership violation,
  lifecycle violation) already implemented as deterministic rules.
- `RISK-P0-05` (Evidence Pack), except the evaluator-version gap called out
  above as `RISK-P0-01.4` — source events, access path, contract/policy,
  timestamps, affected resource/action and recommendation are already
  covered by `RISK-P0-01.1`'s `risk_evidence` schema and `RISK-P0-01.3`'s
  explanation/recommendation generation.
- `RISK-P0-06` (Explainability) — matches `RISK-P0-01.3` (Done): the
  deterministic, evidence-referencing `explanation` string already answers
  what/why/how-severe/what-evidence/what-action.
- `RISK-P0-07` (Deduplication) — matches `RISK-P0-01.2`'s dedup rule (Done):
  `createOrUpdateFinding` already updates an existing open/assigned/
  remediation-in-progress finding's evidence instead of creating a
  duplicate.
- `RISK-P0-09` (Recommendation Engine) — matches `RISK-P0-03.1` (Done): every
  finding already carries a specific least-privilege `recommendation` at
  creation time, advisory until a human acts.
- `RISK-P0-10` (Re-evaluation) — matches `RISK-P0-03.3` (Done): re-evaluation
  and history-preserving resolution are already implemented and are exactly
  what closes the loop on the Critical acceptance test above.
- `RISK-P1-01` (Behavioural Anomaly Score) — already represented, at scoping
  level, by this backlog's existing P1 line "Statistical/ML-free-but-more-
  sophisticated behavioral baselining"; not duplicated below, but the new
  doc's framing (keep the anomaly signal separate from deterministic policy
  risk, never mixed in invisibly) is retained as the binding detail for
  whenever that P1 item is picked up.

**Ownership-map flag for the user:** the new doc's `RISK-P1-03` ("Risk
Campaigns" — recurring risk review queues with SLA tracking) implies a new
table (e.g. `risk_campaigns`/`risk_campaign_items`) that does not exist
today and is not listed in `docs/design/ownership-map.md` under any module.
It is conceptually adjacent to Compliance Agent's already-owned
`certification_campaigns`/`certification_items` but is a distinct risk-review
concept, not a certification one. This backlog does not add it to the
ownership map itself (per this task's constraints) — flagged for the user to
decide ownership before that P1 item is scoped.

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## P1

Statistical/ML-free-but-more-sophisticated behavioral baselining. Attack-path
scoring across multiple agents. Auto-remediation for pre-approved low-risk
categories (still requires an explicitly approved automation path per
non-negotiable #15 — do not build this speculatively).

- **RISK-P1-02 — Aggregate Risk.** Calculate agent, owner, application,
  business-unit and tenant risk views with drill-down to the underlying
  findings — a read/aggregation layer over `risk_findings`, no new owned
  entity.
- **RISK-P1-03 — Risk Campaigns.** Recurring risk-review queues and SLA
  tracking (see the ownership-map flag above — needs a table-ownership
  decision before scoping).
- **RISK-P1-04 — Risk Correlation.** Correlate multiple low/medium-severity
  signals into a single higher-level case where the evidence actually
  supports the correlation — distinct from the existing "attack-path scoring"
  line above, which is about access-path traversal rather than signal
  correlation.

## P2 (strategic, after P0/P1 proven)

- **RISK-P2-01 — Predictive Risk.** Estimate emerging risk from historical
  patterns, with predictions clearly labeled as probabilistic — never
  presented as a deterministic finding.
- **RISK-P2-02 — Graph Risk Propagation.** Model how a compromised/high-risk
  identity could affect connected resources and agents (depends on Access
  Agent's effective-access graph).
- **RISK-P2-03 — Continuous Risk Optimization.** Recommend contract/access
  changes that reduce risk without materially reducing approved business
  capability — advisory only, same human-approval boundary as
  `RISK-P0-09`'s recommendation engine.

## DO NOT IMPLEMENT

- Any UI (Experience Agent).
- Certification campaign logic (Compliance Agent) — Risk only feeds findings into
  certification review as evidence.
- Any actual access-grant mutation — Risk always goes through Access/Integration's
  published contracts, never direct writes to their tables.
