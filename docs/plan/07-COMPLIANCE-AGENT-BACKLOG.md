# 07 — Compliance Agent Backlog

**Agent name:** `Compliance Agent`
**Module:** Certification, Controls & Compliance
**Branch:** `module/compliance`
**Status:** DORMANT — do not start until the user says "Run Compliance Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every row is in `docs/design/compliance-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| COMPLIANCE-P0-01.1 | Schema | Done |
| COMPLIANCE-P0-01.2 | Campaign launch & item population | Partial — only `scope_type: 'agent'` (criticality-filtered) has real population logic; the other four scope types are schema-ready but unimplemented pending a concrete spec |
| COMPLIANCE-P0-01.3 | Reviewer decision flow | Partial — approve/revoke/delegate/request_information fully work (revoke really calls `revokeAccessGrant()`); modify doesn't create an `access_requests` row, blocked on Access Agent publishing a distinct request type |
| COMPLIANCE-P0-01.4 | Certification detail panel data | Done |
| COMPLIANCE-P0-02.1 | Schema (higher bar) | Done |
| COMPLIANCE-P0-02.2 | Status computation, never a compliance claim (higher bar) | Partial — status computed from evidence recency only; live policy-violation state not checked, blocked on Access/Risk publishing a policy-scoped violation query |
| COMPLIANCE-P0-03 | Evidence snapshot (contract/policy versions) | Done |
| COMPLIANCE-P0-04 | Reviewer authorization & Segregation of Duties | Done |
| COMPLIANCE-P0-05 | Escalation of overdue certification items | Partial — no scheduler exists in this codebase yet, so `escalateOverdueItems()` is exposed as an operator/API-triggered sweep rather than an automatic cron; the escalation logic, recording and audit trail themselves are fully implemented and verified |
| COMPLIANCE-P0-06 | Tamper-evident evidence export package | Partial — evidence assembly + SHA-256 integrity marker + audited export event are implemented; the actual export file/delivery mechanism is intentionally not built, per this story's own ownership-map flag to the user (Operations Agent overlap, undecided) |
| COMPLIANCE-P0-07 | Governance Posture (composite score, distinct from risk) | Done — computed read-model across 12 dimensions, `getGovernancePosture()`, `GET /api/v1/compliance/agents/[id]/posture` |
| COMPLIANCE-P0-08 | Governance Attestation (broad: approver/decision/evidence) | Not Started — 2026-09-15, promoted from Identity's P1-tier concept, user decided Compliance-owned/broad scope |
| COMPLIANCE-P0-09 | Governance Evidence Pack assembly | Not Started — 2026-09-15, user decided Compliance assembles + Operations exports; see OPERATIONS-P0-07 |

---

## Dependencies

- **Foundation Agent**: tenant context, RBAC, audit.
- **Identity Agent**: agent/contract facts.
- **Access Agent**: `getEffectiveAccess()` (what's granted).
- **Runtime Agent**: `getDid()` (what's actually used — for the "Used/Never" column).
- **Risk Agent**: `getFindings()` (risk column on the certification review table).
- **Integration Agent**: remediation hand-off, once published, for "revoke" decisions
  that should reach the real IAM.

## Owned entities

`certification_campaigns`, `certification_items`, `certification_decisions`,
`control_frameworks`, `controls`, `control_mappings`, `control_evidence`.

## Consumed entities

Everything under Dependencies, read-only via contract.

## Published contracts

- `lib/shared/types/compliance.ts`: `CertificationCampaign`, `CertificationItem`,
  `CertificationDecision`, `ControlFramework`, `ControlStatus`.
- `modules/certification-compliance/service.ts`:
  - `getCertificationHistory(agentId)` — Identity/Risk reference this for "last
    certified" facts.
  - `recordDecision(itemId, decision)`.

---

## Higher-bar stories

COMPLIANCE-P0-02.* (control framework status) — must never imply the customer *is*
compliant; see non-negotiable and product-boundary #10.

---

## Epic COMPLIANCE-P0-01 — Access Certification

### COMPLIANCE-P0-01.1 — Schema

```sql
create table certification_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  scope_type text not null check (scope_type in ('agent','application','entitlement','privileged_access','high_risk_agent')),
  scope jsonb not null default '{}'::jsonb,
  cadence text not null check (cadence in ('one_time','periodic','event_driven')),
  status text not null default 'draft' check (status in ('draft','active','completed','cancelled')),
  due_date timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table certification_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  campaign_id uuid not null references certification_campaigns(id) on delete cascade,
  agent_id uuid not null,
  access_grant_id uuid,             -- Access Agent's access_grants.id, if entitlement-level
  reviewer_id uuid not null,
  risk_at_review text,              -- snapshot, e.g. 'high'
  usage_at_review text check (usage_at_review in ('used','never','unknown')),
  recommendation text check (recommendation in ('keep','review','remove')),
  status text not null default 'pending' check (status in ('pending','decided')),
  due_date timestamptz,
  created_at timestamptz not null default now()
);

create table certification_decisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references certification_items(id) on delete cascade,
  decision text not null check (decision in ('approve','revoke','modify','delegate','request_information')),
  justification text not null,
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  remediation_id uuid                -- Risk Agent's risk_findings.id or Access's access_requests.id, if a revoke triggers one
);
```

### COMPLIANCE-P0-01.2 — Campaign launch & item population

Launching a campaign against `scope_type = 'agent'` with `scope = {"criticality":
["high","critical"]}` creates one `certification_items` row per matching agent per
entitlement in its effective access (via Access Agent), pre-filled with
`risk_at_review` (from Risk Agent's current finding severity for that agent, if any)
and `usage_at_review` (from Runtime Agent's DID — `used` if any runtime event
touched that entitlement's resource in the campaign's lookback window, `never`
otherwise, `unknown` if Runtime Agent isn't available yet).

`recommendation` is computed, not typed by a human: `remove` if `usage_at_review =
'never'` AND risk is `medium` or above; `review` if risk is `high`/`critical`
regardless of usage; `keep` otherwise. This mirrors the PRD's worked table exactly:

```text
Agent       Access          Risk    Usage    Recommendation
FinanceBot  Snowflake READ  High    Used     Review
FinanceBot  SAP READ        Low     Used     Keep
FinanceBot  S3 READ         Med     Never    Remove
```

### COMPLIANCE-P0-01.3 — Reviewer decision flow

`recordDecision(itemId, { decision, justification })`: `approve` closes the item with
no side effect on access; `revoke` calls Access Agent's remediation-initiation
contract (same one Risk Agent uses — see ACCESS/RISK backlogs) to create an
`access_requests` row or hand off to Integration's `removeAccess`, always requiring
the human decision already captured as the trigger (satisfies non-negotiable #15
without needing separate re-approval); `modify` requires a free-text description of
the intended change and creates an `access_requests` row of type modify; `delegate`
reassigns `reviewer_id` to another user and leaves `status = 'pending'`; `request_information`
leaves the item `pending` and creates a notification-worthy event (Operations Agent
consumes it) without a terminal decision yet. Every decision is audited via
`writeAudit()` and immutable once written (a correction requires a new decision row,
never editing an old one — non-negotiable #11).

### COMPLIANCE-P0-01.4 — Certification detail panel data

Expose, via the service contract, everything the PRD's side-panel needs for one
item: agent identity, owner, access path (Access Agent's `explainAccessPath`), the
policy it's evaluated against (if any), usage evidence (Runtime), risk (Risk),
recommendation, and this agent's certification/audit history. This is a data
contract; Experience Agent builds the panel UI.

---

## Epic COMPLIANCE-P0-02 — Control Framework Mapping (higher bar)

### COMPLIANCE-P0-02.1 — Schema

```sql
create table control_frameworks (
  id text primary key,     -- 'iso27001','iso42001','nist_ai_rmf','nist_csf','soc2','cis'
  display_name text not null
);

create table controls (
  id uuid primary key default gen_random_uuid(),
  framework_id text not null references control_frameworks(id),
  control_ref text not null,     -- e.g. 'A.9.2.3'
  requirement text not null,
  unique (framework_id, control_ref)
);

create table control_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  control_id uuid not null references controls(id),
  policy_id uuid,                 -- Access Agent's policies.id this control maps to
  status text not null default 'no_evidence' check (status in ('compliant','partial','non_compliant','not_applicable','no_evidence')),
  owner_id uuid,
  created_at timestamptz not null default now()
);

create table control_evidence (
  id uuid primary key default gen_random_uuid(),
  control_mapping_id uuid not null references control_mappings(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('certification_decision','policy_evaluation','audit_log','manual_attestation')),
  reference_id uuid,
  summary text not null,
  created_at timestamptz not null default now()
);
```

Seed `control_frameworks` with the six named frameworks (rows only — do not attempt
to seed every real control from each standard's full text in P0; that's a large,
framework-specific content task better scoped as its own P1 story per framework).
For P0, it's acceptable to seed a small representative set of controls per framework
(3-5 each) sufficient to demonstrate the mapping mechanism end-to-end; note in the
audit log which frameworks got full vs. representative control sets.

### COMPLIANCE-P0-02.2 — Status computation, never a compliance claim

`status` on `control_mappings` is derived from linked evidence (e.g. a
`compliant` status requires at least one `control_evidence` row dated within the
control's review cadence and no open `non_compliant`-implying finding on the mapped
policy). Every screen and API response that surfaces this data must be worded as
"control status" / "evidence status," never "certified compliant" or "ISO
compliant" — this is a hard product-boundary rule (§10 of `CLAUDE.md`), not a
copywriting nicety; bake the wording into the API's response labels
(`status: "compliant"` is fine as an internal enum value, but any user-facing string
built from it must read like "Control A.9.2.3: Compliant" scoped to that one
control, never "Tenant is ISO 27001 compliant").

---

## Critical acceptance test

Launch an agent access certification, present Access vs. Approved vs. Used vs. Risk
vs. Recommendation exactly as the worked table above, capture
Approve/Revoke/Modify/Delegate/Request Information decisions, and retain immutable
evidence/audit history for each.

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`07_CERTIFICATION_COMPLIANCE.md`) that expands this module's P0/P1/P2 scope
beyond what was already tracked above. Reconciled against the existing
Progress Tracker (nothing already `Done` or `Partial` was reopened or marked
down); the following are genuinely new stories added to the tracker, each
verified against the actual code in `modules/certification-compliance/`
before being marked `Not Started` rather than assumed:

### COMPLIANCE-P0-03 — Evidence Snapshot (contract/policy versions)

The new doc's CERT-P0-03 requires that "certification decisions preserve a
point-in-time snapshot of access, contract, runtime usage, risk **and policy
versions**." Today's `certification_items` schema only snapshots
`risk_at_review` and `usage_at_review` at campaign-launch time
(`modules/certification-compliance/campaigns.ts`); there is no snapshot of
the agent's contract version or the policy version(s) the access was
evaluated against, and no snapshot is captured again at *decision* time (only
at item-population time), so a decision made weeks after launch is not
provably reproducible against what was true when the reviewer actually acted.
**Objective:** extend the schema (a `snapshot jsonb` column on
`certification_items` and/or `certification_decisions`) to capture agent
contract version/id, the effective access grant detail, and relevant policy
version/id at both population and decision time. **Acceptance:** given a
decided item, the system can reproduce exactly what the reviewer saw —
access, approved contract, usage, risk and policy version — even if the
live agent contract or policy has since changed.

### COMPLIANCE-P0-04 — Reviewer Authorization & Segregation of Duties

The new doc's CERT-P0-04 requires "only authorized reviewers can act on an
item" and "reviewer must not certify their own access where SoD rules
prohibit it." `recordDecision()` (`modules/certification-compliance/decisions.ts`)
today only checks the caller holds the `compliance.manage` permission —
it never checks that `actorId` matches the item's assigned `reviewer_id`,
and has no self-certification/SoD check at all (e.g. an agent's own business
owner certifying that agent's own access). **Objective:** enforce that only
the item's current `reviewer_id` (or an explicitly delegated reviewer) may
record a decision, and reject (or require an explicit override with its own
audit trail) a decision where the reviewer is also the agent's owner, subject
to Access Agent's SoD rule definitions. **Acceptance:** an authenticated user
who is not the assigned reviewer cannot record a decision on an item; a
configured SoD rule blocks self-certification and is audited when it fires.

### COMPLIANCE-P0-05 — Escalation of Overdue Certification Items

The new doc's CERT-P0-06 requires overdue reviews to escalate to configured
owners/managers and remain visible in campaign metrics. No escalation logic
exists anywhere in the current module — items simply carry a `due_date` with
no follow-up behavior when it passes. **Objective:** a scheduled or
on-read check that identifies `pending` items past `due_date`, escalates
them (recorded, auditable escalation event; actual notification delivery is
Operations Agent's contract once published) to a configured owner/manager,
and surfaces an overdue count in campaign-level metrics. **Acceptance:** a
campaign's summary reports its count of overdue/escalated items, and each
escalation is an audited event with actor, target item and timestamp.

### COMPLIANCE-P0-06 — Tamper-Evident Evidence Export Package

The new doc's CERT-P0-07 requires generating a tamper-evident evidence
package (campaign metadata, items, decisions, timestamps, reviewer identity
and linked evidence references) for a completed campaign. No export
mechanism exists in the module today. **Objective:** a service function that
assembles the full campaign evidence bundle and produces a checksummed/
signed artifact (e.g. content hash recorded alongside the export event) so
tampering after export is detectable. This module owns assembling the
compliance-specific evidence content; see the ownership-map flag below on
where the generic export/delivery mechanism should live. **Acceptance:**
given a campaign, an export contains every item, every decision with
reviewer identity and justification, and a verifiable integrity marker, and
the export action itself is audited.

### Already covered, no new tracker row needed

- **CERT-P0-01** (Certification Campaign) maps onto `COMPLIANCE-P0-01.1`
  (schema: name/scope/scope_type/cadence/status/due_date) and
  `COMPLIANCE-P0-01.2` (launch logic) — no scope change. Note: the new doc's
  campaign fields also mention an explicit "reviewer type" and an
  "escalation and evidence policy" on the campaign itself, which the current
  schema doesn't carry as first-class campaign fields; this is folded into
  `COMPLIANCE-P0-05` (escalation) above rather than tracked separately, since
  the escalation *policy* and the escalation *behavior* are the same piece
  of work.
- **CERT-P0-02** (Agent Access Review Item: Access/Approved/Used/Risk/
  Recommendation, with approve/revoke/modify/delegate/request-information)
  maps directly onto `COMPLIANCE-P0-01.2` (population with risk/usage/
  recommendation) and `COMPLIANCE-P0-01.3` (decision flow) — no scope
  change.
- **CERT-P0-05** (Decision Reasons required, all decisions audited) maps
  onto `COMPLIANCE-P0-01.3`, which already requires a non-empty
  `justification` on every decision (stricter than "where policy requires
  it") and writes an audit event via `writeAudit()` — no scope change.
- **CERT-P0-08** (Control Framework Foundation: framework → control →
  requirement → policy/evidence mapping, with version/source metadata) maps
  onto `COMPLIANCE-P0-02.1` — no scope change.
- **CERT-P0-09** (No Compliance Overclaim) maps onto `COMPLIANCE-P0-02.2`,
  which already bakes this exact wording rule into the higher-bar
  acceptance criteria — no scope change.
- **CERT-P1-02** (Framework Libraries per framework) is already listed
  below under `## P1` as "Full control libraries per framework" — not
  duplicated.

### Ownership-map flags for the user

- `COMPLIANCE-P0-06`'s tamper-evident evidence export overlaps in spirit
  with Operations Agent's ownership of generic "exports" and "audit evidence
  presentation" (`docs/design/ownership-map.md` §1/§3). This module should
  own assembling the compliance-specific evidence content/contract; whether
  the actual export file generation/delivery mechanism belongs to this
  module or should be handed to Operations Agent's existing export
  machinery is not decided here — flagged for the user rather than guessed,
  per `CLAUDE.md` §5 of the ownership map.
- `COMPLIANCE-P2-03` (Auditor Workspace, below) implies a read-only external
  or semi-external access mode into compliance evidence that doesn't map
  cleanly onto the existing customer RBAC model or Platform Administration's
  vendor-only boundary; flagged for the user to decide which authorization
  boundary it belongs to before it is scoped as a story.

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded the Certification & Compliance requirements document
(`07_CERTIFICATION_COMPLIANCE.md`, path
`7af02f4f-be08-5f91-b0d5-fc0907e4645c/8dd148e8-07_CERTIFICATION_COMPLIANCE.md`),
described as a newer/expanded version, for a fresh reconciliation pass
against the current backlog (which already absorbed one round of this same
document on 2026-09-14 — see the "Requirements Refresh — 2026-09-14" section
above).

**Finding: no new stories added.** A full line-by-line comparison of the
re-uploaded document against the backlog above found it to be **content-
identical** to what was already reconciled in round one — the same
`# 16. Access Certification`, `# 17. Certification UX` and `# 20. Control
Framework Module` master-PRD sections, the same "Claude Code Execution
Plan," the same expanded `CERT-P0-01` through `CERT-P0-09`,
`CERT-P1-01` through `CERT-P1-05`, and `CERT-P2-01` through `CERT-P2-03`
items (matching wording throughout), and the same critical acceptance test.
Every one of those already maps onto an existing Progress Tracker row
(`COMPLIANCE-P0-01.1` through `COMPLIANCE-P0-06`) or is explicitly listed
under round one's "Already covered, no new tracker row needed" bullets, its
`## P1` section, or its `## P2` section — there is no requirement, story, or
acceptance criterion in this upload that isn't already reflected there.

Re-confirmed against the actual codebase (not just the backlog text) before
concluding this: `modules/certification-compliance/` contains
`campaigns.ts`, `decisions.ts`, `escalation.ts`, `export.ts`, `snapshot.ts`
and `controls.ts`, backed by migrations `0036_compliance_certification.sql`,
`0037_compliance_indexes.sql` and
`0046_compliance_evidence_snapshot_sod_escalation.sql` — consistent with
what the Progress Tracker and the 2026-09-14 audit log entries already
claim as `Done`/`Partial`. No status on any existing row was changed by this
pass.

The two open ownership-map flags from round one (evidence-export file/
delivery mechanism vs. Operations Agent; the Auditor Workspace
authorization boundary for `CERT-P2-03`) remain open and are not
re-litigated here — they were already surfaced to the user in round one and
nothing in this re-upload adds detail that resolves them.

## P1

Full control libraries per framework. Executive/board compliance reporting.
Certification campaign templates and recurring auto-scheduling beyond a single
`due_date`.

- **Continuous Certification** (CERT-P1-01): trigger event-driven
  micro-certification after significant access/risk/runtime changes to an
  agent, rather than relying solely on periodic campaigns.
- **Certification Delegation, time-bound** (CERT-P1-03): today's `delegate`
  decision (`COMPLIANCE-P0-01.3`) reassigns `reviewer_id` with no expiry or
  scope limit; extend to a time-bound delegation with an explicit scope and
  its own audit trail.
- **Exception Governance** (CERT-P1-04): exceptions to a control mapping's
  status require an owner, rationale, compensating control, approval,
  expiry and periodic review — distinct from Access Agent's
  `policy_exceptions`, which govern access policy, not control-framework
  status.
- **Evidence Collection Jobs** (CERT-P1-05): scheduled jobs that collect
  evidence from Integration Agent's connectors on a cadence and associate
  each evidence row with its source timestamp and sync job id, rather than
  requiring evidence to be added manually.

## P2

Strategic, after P0/P1 proven — from the new requirements doc's CERT-P2-*
items:

- **Continuous Control Monitoring** (CERT-P2-01): evaluate control status
  continuously from live access/runtime events rather than on-demand/batch
  recomputation.
- **Regulatory Packs** (CERT-P2-02): country/industry-specific control packs
  maintained as versioned configuration data, never hard-coded UI logic.
- **Auditor Workspace** (CERT-P2-03): read-only evidence exploration,
  traceability and controlled exports for external auditors — see the
  ownership-map flag above; the authorization boundary for this needs a
  decision before it is scoped.

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. This
module's existing P0 stories (campaign/review/decision flow, control
mapping, evidence snapshot) already cover that document's P0-17/P0-18.
Four open, undecided items name Compliance Agent as a candidate owner —
recorded centrally, not claimed unilaterally here:

- **Governance Posture** (P0-12) — the single largest open item across the
  whole reconciliation; Compliance is one candidate owner (closest existing
  aggregation concept) but not decided.
- **Governance Attestation** (P0-13) — a priority conflict with Identity's
  existing `IDENTITY-P1-02`, plus a possible ownership question since its
  broader approver/decision/evidence shape reads closer to this module's
  `certification_decisions` than Identity's narrower self-attestation.
- **Governance Exceptions consolidation** (P0-14) — this module's own
  planned `CERT-P1-04` is one of three candidate "exception" concepts
  (alongside Access's `policy_exceptions` and the new doc's generic one);
  needs the user to pick one canonical model.
- **Governance Evidence Pack** (P0-19) — escalates, not duplicates, the
  already-open Compliance-vs-Operations evidence-export ownership question
  (`ownership-map.md`); the new doc's broader per-agent scope (now
  including attestation/exception data) raises the stakes on that decision
  without resolving it.

### Decisions resolved (2026-09-15, later same day)

The user answered all four via `AskUserQuestion`; three land on this
module. Added as new Progress Tracker rows above.

#### COMPLIANCE-P0-07 — Governance Posture

A composite score across Identity/Ownership/Purpose/Access/Action
authority/Certification/Runtime monitoring/Human oversight/Policy
compliance/Lifecycle/Compliance controls/Evidence completeness, resulting
in `GOVERNED` / `PARTIALLY_GOVERNED` / `NON_COMPLIANT` /
`EXCEPTION_APPROVED` / `SUSPENDED`, explicitly distinct from Risk Agent's
risk score (never conflated with it). A read-model computed from existing
published contracts (Identity's agent/contract/lifecycle/owner facts,
Access's effective access and contract comparison, this module's own
certification/control-mapping status, Risk's finding severity) — no new
table duplicating another module's data; deterministic and explainable
(non-negotiable #9), with a documented reason per dimension, not a single
opaque number. **Not started.**

#### COMPLIANCE-P0-08 — Governance Attestation (broad)

Promoted to P0 per the user's decision (Identity's own narrower
`IDENTITY-P1-02` stays P1 and unchanged — this is the broader concept).
Fields per the governance doc's P0-13: agent, policy/requirements,
checklist, approver, approval timestamp, validity, decision, comments,
evidence references. New Compliance-owned table (e.g.
`governance_attestations`) — tenant-scoped, RLS, `writeAudit()` on every
decision. Needs an ownership-map entry when built. **Not started.**

#### COMPLIANCE-P0-09 — Governance Evidence Pack assembly

Per-agent evidence bundle: identity, owners, purpose/lifecycle, IAM
identity, effective access, SHOULD/CAN/DID, policies, risk findings,
certifications, attestations (`COMPLIANCE-P0-08`), exceptions
(`ACCESS-P0-07`, once broadened), control mappings, runtime evidence,
remediation, audit events — assembled by calling every relevant module's
already-published read contract, never by querying another module's
tables directly (non-negotiable #6). File generation/delivery
(PDF/CSV/JSON) is Operations Agent's `OPERATIONS-P0-07`, not built here —
this story ends at producing the assembled, structured bundle Operations
consumes. Extends, not replaces, this module's existing `COMPLIANCE-P0-06`
evidence-snapshot work. **Not started.**

## DO NOT IMPLEMENT

- Risk scoring itself (Risk Agent) — Compliance only reads and snapshots it.
- Actual entitlement revocation logic (Access/Integration Agents) — Compliance
  triggers it through their published contract, never a direct table write.
- Any UI beyond functional review screens (Experience Agent restyles).
