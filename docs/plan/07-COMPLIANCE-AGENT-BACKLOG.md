# 07 — Compliance Agent Backlog

**Agent name:** `Compliance Agent`
**Module:** Certification, Controls & Compliance
**Branch:** `module/compliance`
**Status:** DORMANT — do not start until the user says "Run Compliance Agent"

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

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. This
agent is dormant; every story is Not Started until "Run Compliance Agent" is
issued.

| Story | Title | Status |
|---|---|---|
| COMPLIANCE-P0-01.1 | Schema | Not Started |
| COMPLIANCE-P0-01.2 | Campaign launch & item population | Not Started |
| COMPLIANCE-P0-01.3 | Reviewer decision flow | Not Started |
| COMPLIANCE-P0-01.4 | Certification detail panel data | Not Started |
| COMPLIANCE-P0-02.1 | Schema (higher bar) | Not Started |
| COMPLIANCE-P0-02.2 | Status computation, never a compliance claim (higher bar) | Not Started |

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

## P1

Full control libraries per framework. Executive/board compliance reporting.
Certification campaign templates and recurring auto-scheduling beyond a single
`due_date`.

## DO NOT IMPLEMENT

- Risk scoring itself (Risk Agent) — Compliance only reads and snapshots it.
- Actual entitlement revocation logic (Access/Integration Agents) — Compliance
  triggers it through their published contract, never a direct table write.
- Any UI beyond functional review screens (Experience Agent restyles).
