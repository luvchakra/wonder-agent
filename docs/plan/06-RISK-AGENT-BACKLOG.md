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
| RISK-P0-02.1 | Severity/risk score | Done — 2026-09-16: Identity published `updateAgentRiskScore()` (`modules/agent-identity/agents.ts`, service-role write with manual tenant check); `evaluateAgentRisk()` now calls it once per evaluation with the deterministic agent-level score (`base.riskScore`), persisting onto `agents.risk_score` regardless of whether any finding category actually triggered |
| RISK-P0-03.1 | Assignment & recommendation | Done |
| RISK-P0-03.2 | Human-initiated remediation | Done — `remediateFinding()` now calls Access Agent's already-published `revokeAccessGrant()` for every `access_grant`-evidenced grant; honestly `wired: false` for finding categories with no such evidence |
| RISK-P0-03.3 | Re-evaluation & resolution | Done |
| RISK-P0-01.4 | Evaluator version on evidence pack | Done |
| RISK-P0-02.2 | Configurable severity weights & INFO tier | Done |
| RISK-P0-03.4 | Expanded finding lifecycle states (ACKNOWLEDGED/INVESTIGATING/MITIGATED/EXCEPTION) | Done |
| RISK-P0-03.5 | False positive disposition with reason & expiry | Done |
| RISK-P1-05 | Additional deterministic risk factors (privilege level, destructive capability, credential status, attack path) | Partial — 2026-09-19: "Privilege level" fully wired (real data via `getEffectiveAccess()`'s `privilegeLevel`, triggers on elevated/admin); the other three have real names/weights but always contribute 0, each with its own documented missing-contract dependency, per this story's own explicit acceptance allowance — see audit log |
| RISK-P0-04 | Governance Drift detection | Done — 2026-09-16, unit-tested (7 tests), migration `0054` live-applied. New `governance_drift` category diffs current purpose/autonomy/allowed-tools/approved-actions/owners/IAM-identities/effective-access against the agent's state as of its last `APPROVED` lifecycle transition (no new table, reuses `risk_findings`/`risk_evidence`); "new tool/data source beyond `allowedTools`" and "runtime behavior changed" deliberately not built as separate sub-signals — see audit log |
| RISK-P0-11 | Investigations as a first-class record (master P0-37) | Not Started — 2026-09-25, master stories |
| RISK-P0-12 | New risk signals (master P0-20/P0-21) | Not Started — 2026-09-25, master stories |

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

**`agents.risk_score` persistence, resolved 2026-09-16:** previously the score was
fully computed and stored on every `risk_findings` row but never rolled up onto the
agent record, blocked on Identity publishing a write path for a column Risk doesn't
own. Identity published `updateAgentRiskScore(tenantId, agentId, riskScore)`
(`modules/agent-identity/agents.ts`, exported via `modules/agent-identity/service.ts`)
— service-role client, explicit `tenant_id` filter visible in the call (CLAUDE.md
§14, since a service-role caller must verify tenant ownership itself). `rules.ts`'s
`evaluateAgentRisk()` calls it once per evaluation, right after computing `base` (the
deterministic agent-level score shared by every trigger that run produces) — not
once per finding, and not skipped when zero categories trigger (a clean agent's real
computed score, e.g. `0`, is still worth recording, not left `null`/stale). Covered
by `modules/risk/rules.test.ts`'s two existing scenarios (asserts the exact score
`80` for the FinanceBot CRITICAL scenario, and `0` for the clean-agent scenario).

`severity` is computed from a deterministic weighted rule set over these factors
(each contributes 0 or its weight; sum maps to a severity band):

| Factor | Weight | Source |
|---|---|---|
| Production database / production environment access | 20 | `agents.environment = 'production'` + entitlement touches a data store |
| Sensitive data (PII/financial/confidential) involved | 25 | evidence's `data_classification` |
| External communication capability | 15 | resolved 2026-09-16 — `applications.is_external` (Access Agent, migration `0059`); triggers when the agent's CAN touches an external-marked application |
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

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded the Risk module requirements doc at
`06_RISK_ROGUE_DETECTION.md` for a fresh, thorough re-check, since the
upload was described as a newer/expanded version of the doc reconciled in
the round-1 refresh above. Read the full re-uploaded doc end to end and
compared it, section by section, against everything already tracked above
(the original Epics, the round-1 refresh, and the existing `## P1`/`## P2`
lists) — including sanity-checking against `modules/risk/scoring.ts`,
`modules/risk/findings.ts`, `modules/risk/rules.ts`,
`lib/shared/types/risk.ts` and the `risk_findings`/`risk_severity_weights`
migrations (`0034`, `0044`, `0045`) rather than assuming.

**Finding: the re-uploaded doc's own content — its story-ID list
(`RISK-P0-01`..`RISK-P0-10`, `RISK-P1-01`..`RISK-P1-04`,
`RISK-P2-01`..`RISK-P2-03`) and headings — is identical to what round 1
already reconciled against; no new or renumbered story IDs, and no
additional P0/P1/P2 items appear in this pass's upload.** Round 1's
per-story reconciliation (the "Already covered, no new tracker row
needed" list, plus `RISK-P0-01.4`/`RISK-P0-02.2`/`RISK-P0-03.4`/
`RISK-P0-03.5` it added) still holds and is not reopened here.

One genuine gap survived round 1's story-ID-level reconciliation, because
round 1 matched `RISK-P0-01` ("Deterministic Risk Model") to
`RISK-P0-02.1` (Done) at the story-ID level without diffing the *specific
factor list* underneath it against the doc's separate, more detailed
"# 15. Risk Engine" narrative section (part of the doc's raw
"Original Master PRD Requirements" quote, not the numbered
`RISK-P0-XX` list, which is likely why it was missed both times). That
section enumerates 13 risk-score factors: privilege level, data
sensitivity, production access, destructive capability, external
communication, owner status, certification status, **credential status**,
policy violation, runtime anomaly, identity anomaly, **attack path**, and
business criticality. Checked `DEFAULT_SEVERITY_WEIGHTS` in
`modules/risk/scoring.ts` directly: it implements exactly 8 factors
(production environment access, sensitive data, external communication,
certification overdue, active policy violation, runtime/behavioral
anomaly, business criticality, missing/invalid ownership) — confirmed via
`grep` across `modules/risk/` and `lib/shared/types/risk.ts` that
**privilege level, destructive capability, credential status and attack
path never appear anywhere in the implementation or in any prior audit
entry**. This is a genuine, previously-uncaught gap between the doc and
the tracked backlog — added below as `RISK-P1-05`.

### RISK-P1-05 — Additional Deterministic Risk Factors

Extend the `RISK-P0-02.1`/`RISK-P0-02.2` weighted-factor model with four
factors the doc's "# 15. Risk Engine" section names but the current
factor table omits:

- **Privilege level** — the entitlement's own privilege tier (e.g.
  admin/superuser vs. standard scoped role), distinct from environment
  (`production access`) or ownership.
- **Destructive capability** — whether the effective access includes a
  destructive verb (delete/purge/overwrite) on a resource, distinct from
  merely touching sensitive data or production.
- **Credential status** — health of the credential/secret backing the
  agent's access (expired, weak, shared, overdue for rotation), distinct
  from `identity_anomaly` (which is about the *runtime event's identity
  not matching what's on file*, not the credential's own hygiene).
- **Attack path** — whether the agent sits on a graph path to a
  higher-value/blast-radius resource; related to but not identical to
  `RISK-P2-02` (Graph Risk Propagation, which models *downstream* impact
  of a compromised identity) — here the concern is scoring the agent's
  *own* current exposure via its position in the access graph, not
  simulating propagation from it. Depends on Access Agent's effective-
  access graph, same as `RISK-P2-02`.

Classified **P1** (enterprise readiness), not P0: the P0 central
acceptance scenario (FinanceBot/CustomerDB) already lands correctly at
`critical` using the existing 8 factors plus the explicit
prohibited-data override, without any of these four — none of them is a
required extension point for that scenario, and CLAUDE.md §3 directs
treating an unclear P0/P1 call as scope creep and preferring P1/P2. Two
of the four (`destructive capability`, `attack path`) also depend on data
Access Agent's effective-access model would need to expose (a
destructive-verb flag on entitlements; graph position) that isn't
confirmed to exist yet as a published contract — record that dependency
when this story is picked up rather than inventing Access Agent's
representation of it. Acceptance, when implemented: each new factor gets
its own named weight in `DEFAULT_SEVERITY_WEIGHTS`/
`risk_severity_weights` (reusing the existing configurable-weight
machinery from `RISK-P0-02.2` — no new config mechanism), contributes 0
until its data source is actually available (same documented pattern
already used for `external communication capability` and
`certification overdue`), and does not change any already-`Done` scoring
outcome for the FinanceBot scenario.

**Not flagged as ML/LLM-based:** none of these four factors, nor anything
else in the re-uploaded doc, describes machine-learning- or LLM-based
anomaly detection — the doc's factor list and its "LLMs may explain
findings but MUST NOT be the sole authority for access/risk decisions"
line are consistent with non-negotiable #9 and with this backlog's
existing AI usage boundary. No flag needed on that front this round.

No other genuinely new requirement, story, or acceptance-criterion detail
was found in this pass — everything else in the re-uploaded doc (the
rogue categories, the evidence-pack shape, explainability, deduplication,
false-positive handling, the finding lifecycle states, the recommendation
engine, re-evaluation, and the `RISK-P1-01`..`RISK-P2-03` list) was
already reflected, at matching or finer granularity, in the Epics above
and in the round-1 refresh.

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
- **RISK-P1-05 — Additional Deterministic Risk Factors.** Extend the
  `RISK-P0-02.1`/`RISK-P0-02.2` weighted factor model with privilege level,
  destructive capability, credential status and attack path — see the
  "Requirements Refresh — 2026-09-14 (round 2, expanded doc)" section above
  for the full detail and dependency notes.

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

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. Its
existing detection categories (P0-16) already match this module's rogue-
detection set nearly one-for-one — no new row there. Two open, undecided
items name Risk Agent as a candidate owner, recorded centrally rather than
claimed here: **Governance Drift** (P0-15 — a cross-module change signal
distinct from any single existing finding category) and two new finding
category *names* ("expired approval," "governance control gap") that only
become meaningful once Governance Posture/Attestation/Exceptions (P0-12/
13/14) exist elsewhere first. Nothing added to this backlog's own tracker.

### RISK-P0-04 — Governance Drift detection (decision resolved 2026-09-15, later same day)

The user answered the open ownership question via `AskUserQuestion`:
**Governance Drift → Risk Agent.** New deterministic finding category
(`governance_drift`, alongside the existing categories) detecting material
post-approval changes: purpose changed, owner changed, IAM identity
changed, access expanded, new tool/data source, new action capability,
autonomy increased (once `IDENTITY-P0-07` exists), runtime behavior
changed. Built from cross-module diffs against the last-known-good
snapshot (mirroring how `RISK-P0-01.2`'s existing categories already diff
current state against the contract) — reuses `risk_findings`/
`risk_evidence`, no new table. Each detected drift should be able to
trigger Compliance's re-certification path once that trigger exists
(`CERT-P1-01`, currently P1 — do not build the trigger wiring itself
ahead of that). **Not started.**

---

## Requirements Refresh — 2026-09-25 (master P0/P1/P2 implementation stories)

Source: the user-supplied *WonderAgent Master P0/P1/P2 Implementation Stories* (MCP folded into the five pillars DISCOVER → UNDERSTAND → GOVERN → PROTECT → ASSURE), mapped story by story in [`docs/implementation/codebase-map.md`](../implementation/codebase-map.md). Ownership and architecture choices were decided by the user on 2026-09-25 (see `docs/design/ownership-map.md`, "Master stories decisions"). Nothing already `Done` is reopened; the rows below are added to this module's Progress Tracker as `Not Started`.

### RISK-P0-11 — Investigations as a first-class record (master P0-37)

User decision: a new Risk-owned investigation (e.g. INV-2026-001) grouping one or more findings, with status, priority, assignee, timeline, evidence, remediation and related findings — new `investigations` + `investigation_findings` tables (tenant_id + RLS), audited transitions.

### RISK-P0-12 — New risk signals (master P0-20/P0-21)

Suspicious delegation (from `agent_relationships`), shadow AI (from IDENTITY-P0-12), unapproved tool usage (SHOULD tools vs DID), and the four factors that are currently always false (certification overdue, destructive capability, credential health, attack path) where the data now exists.


---

## DO NOT IMPLEMENT

- Any UI (Experience Agent).
- Certification campaign logic (Compliance Agent) — Risk only feeds findings into
  certification review as evidence.
- Any actual access-grant mutation — Risk always goes through Access/Integration's
  published contracts, never direct writes to their tables.
