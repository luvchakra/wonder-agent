# IGA and Agent ID: run order

| | |
|---|---|
| Status | Plan of record for the IGA and Agent ID work. D1 approved by the owner on 2026-10-11: the F1 and F2 stories are in their module backlogs (`docs/plan/`); later phases enter when they start. |
| Date | 2026-10-11 |
| Design | `../design/DESIGN.md` |
| Live status | `../progress/PROGRESS.md` (update it in the same PR as the work) |
| Order set by | The owner, 2026-10-11: reconciliation, account import and access requests first, for human and non-human identities alike |

## How to read this file

- Phases run in order. Within a phase, stories in different modules run in
  parallel. A story marked *does not gate* can slip without blocking the
  phase's exit test.
- Each story has an ID. IDs continue each module's numbering. An ID marked
  **†** is provisional: assigned here so the plan is complete, confirmed when
  the story enters its module backlog.
- "Issue" is the GitHub issue; phase issues hold their stories as sub-issues.
  Later phases have a tracking issue; their stories get issues when the phase
  starts.
- Every story follows CLAUDE.md: tenant from `getTenantContext()`, RLS and an
  isolation test for every new table, additive migrations, audit for every
  security-sensitive action, module boundaries, the connector boundary test,
  truthful states.

## Why this order

Requests can only be verified against real target data, and certification,
SoD and lifecycle all need trustworthy imported access. So import and
reconciliation come first, requests second (fulfilled by hand, verified by
reconciliation), and provisioning third, so that manual fulfilment is already
being verified before connectors start writing. Agent ID credentials are
independent and can run alongside F2–F5 once F1 is done.

```text
F1 import & recon ─▶ F2 requests ─▶ F3 provisioning (D3) ─┬─▶ F4 lifecycle & certification ─▶ F5 roles, SoD, delegation ─▶ F8 advanced
                                                          └─▶ F9 intelligence
F1 ─▶ F6 Agent ID credentials (parallel with F2–F5)
F2 ─▶ F7 workflow, forms, configuration ─▶ F8
F10 gates release after F9
```

## Ways of working

- A story ships on its own branch through a pull request, squash-merged only
  when the owner says "merge now" or "build now" (CLAUDE.md §19.6, §19.9).
  Docs ride along with code; no docs-only merges.
- Before a push: typecheck, eslint on changed files, the touched unit tests;
  for a migration, apply it to the dev project and re-check advisories.
- The nightly Playwright suite runs on Vercel in three parts; a red nightly is
  fixed before anything else merges.
- Record before you stop: the module's audit log entry and the Progress
  Tracker row, plus `../progress/PROGRESS.md`.

## Decisions that gate phases

| Decision | Gates | Recommendation |
|---|---|---|
| D1 approve the baseline | Adding any story to a backlog | Approved 2026-10-11 |
| D10 import frequency | F1 schedule behaviour | Daily plus "run now" |
| D11 automation credentials | FOUNDATION-P0-31 (F1) | Yes |
| D3 connector writes | F3 | Yes, reversible operations first |
| D7 relay | F3 relay story | Adopt |
| D9 first connectors | F3 connector stories | Entra ID, Workday, AWS |
| D12 shared rule runtime | F4 | Yes |
| D2 tokens to agents | F6 | Yes, scoped |
| D4 automatic suspension | F6 risk story | Propose only by default |
| D8 SCIM receiver and AuthZEN on the public surface | F6, F8 | Yes, as connection receivers |
| D5, D6 | Design choices already made (no password reset value, no auto-close) | — |

---

## Phase F1: Import and reconciliation

**Goal.** For every connected application, WonderID holds a current,
trustworthy copy of accounts, entitlements and who holds what, for people,
service accounts, machine identities and AI agents. Every run says what
changed; removals at the source are detected; access that appeared outside
WonderID is flagged.

| Story | Title | Module | Issue | Notes |
|---|---|---|---|---|
| INTEGRATION-P0-18 | Staging reflects the source: run tracking, missing-at-source after complete full runs, mass-missing guard | Integration | #42 | |
| INTEGRATION-P0-19 | Scheduled import and promotion; identity-source schedules run; run now | Integration | #43 | Needs P0-18; grants need ACCESS-P0-27 |
| ACCESS-P0-27 | Entitlement and access-grant reconciliation from connectors: preview, apply, removed at source | Access | #44 | Needs P0-18 |
| ACCESS-P0-25 | Imported access classification (authorized, legacy, unproven, rogue) and drift findings | Access + Risk | #45 | Existing story; needs P0-27 |
| IDENTITY-P0-20 | Non-human identities from accounts; owner from source or an unowned queue; agent accounts by identifier | Identity | #46 | |
| EXPERIENCE-P0-28 | Reconciliation console | Experience | #47 | Needs the three above |
| QA-P0-23 | Reconciliation suite | QA | #48 | |
| INTEGRATION-P0-20 | Custom attributes as mapping targets; schedule on every connection | Integration | #66 | Does not gate |
| FOUNDATION-P0-31 | Automation credentials for the administration API; Global Configuration and schedule API routes; Configuration administrator role template | Foundation | #67 | Done 2026-10-12 (D11 approved) |

**Exit test.** Connect an application through a built-in connector and
schedule it. Accounts, entitlements and grants appear for a person, a service
account and an AI agent, each correlated to the right identity. An account
removed at the source shows as missing after the next full run. An
entitlement added directly on the target shows as rogue with a finding.

**Starts with** INTEGRATION-P0-18 (#42).

## Phase F2: Access requests end to end

**Goal.** A request is followed until the access really exists: approval
creates a pending grant and a fulfilment task; the next reconciliation
confirms the access and closes the task. For people and the non-human
identities they own. Fulfilment stays manual until F3.

| Story | Title | Module | Issue | Notes |
|---|---|---|---|---|
| ACCESS-P0-28 | Approved requests become pending grants, verified by reconciliation | Access | #50 | Needs ACCESS-P0-27 |
| ACCESS-P0-29 | Fulfilment tasks: owner or group, claim, complete, fail, SLA, auto-close on reconciliation | Access | #51 | Needs P0-28 |
| ACCESS-P0-30 | Remove-access and account requests; per-line approval | Access | #52 | Needs P0-28, P0-29 |
| ACCESS-P0-31 | Requests for non-human identities; AI agents within their contract | Access + Identity | #53 | Needs IDENTITY-P0-20; with IDENTITY-P0-19 |
| ACCESS-P0-32 | Time-bound access: end dates, reminders, removal task at expiry | Access | #54 | Needs P0-29, P0-30 |
| EXPERIENCE-P0-29 | Request tracking per line; one inbox for approvals and tasks; subject picker | Experience | #55 | |
| QA-P0-24 | Request-to-verified suite | QA | #56 | |
| FOUNDATION-P0-32 | Bulk invitation by CSV and an invitation API | Foundation | #68 | Does not gate |

**Exit test.** A person requests an entitlement for themselves, for a service
account they own, and for an agent within its contract. Approvals run and
fulfilment tasks appear. The access is added on the target by hand, and the
next scheduled reconciliation marks each line verified and closes its task.
A removal request and an expiry go the same way, ending in revoked.

## Phase F3: Provisioning

Needs D3; the relay needs D7; connectors need D9. Tracking issue #57.

| Story | Title | Module | Issue |
|---|---|---|---|
| INTEGRATION-P0-11 (finish) | Capability model and write interface with a caller | Integration | |
| INTEGRATION-P0-13 | Provisioning pipeline: plan → pre-check → execute → verify → record; retries; failed-task view; manual and ticketed fulfilment | Integration | |
| INTEGRATION-P0-21 | Definition extensions: incremental resources, OAuth authorization code, JWT and certificate auth, more transforms, export and import, connection upgrade | Integration | #69 |
| INTEGRATION-P0-22 † | SCIM client driver; write support in the LDAP and http drivers | Integration | |
| INTEGRATION-P0-23 † | WonderID Relay: outbound job pull, key-bound identity, active–active, monitoring | Integration | |
| INTEGRATION-P0-24 † | Microsoft Entra ID connector (import and write) | Integration | |
| INTEGRATION-P0-25 † | HR connector: Workday or SuccessFactors (D9) | Integration | |
| INTEGRATION-P0-26 † | ServiceNow ticketing connector for manual fulfilment (Low, owner 2026-10-14) | Integration | |
| ACCESS-P0-42 | Internal fulfilment task assignment: a person or group per application (optionally per entitlement type), group queues, reassignment with a reason, workload view (owner request 2026-10-14) | Access | |
| RISK-P0-13 | Rogue access management: remediation through approval and provisioning | Risk | |
| QA-P0-26 | Provisioning safety suite: idempotency, mass-change guard, read-only enforcement, verification | QA | |

**Exit test.** The P0 acceptance scenario (CLAUDE.md §11) runs with real
removal: the unauthorized entitlement is removed through the connector after
human approval, verified by reconciliation, and the finding resolves.

## Phase F4: Lifecycle and certification

Needs D12. Tracking issue #58. May start after F2 if F3 is delayed;
certification revokes then use F2 tasks.

| Story | Title | Module | Issue |
|---|---|---|---|
| OPERATIONS-P0-11 (runtime part) | Shared rule runtime: parsing, evaluation, simulation, run log | Operations | #72 |
| IDENTITY-P0-21 | Attribute rules and the rule catalogue: triggers, effects, report-only mode, simulation | Identity | #70 |
| IDENTITY-P0-18 (finish) | Lifecycle rules: birthright, mover, leaver, expiry; four-eyes publish; manager "disable all access" | Identity | |
| IDENTITY-P0-17 (finish) | Identity detail tabs | Identity | |
| ACCESS-P0-33 | Entitlement types per application; entitlement classification rules | Access | #71 |
| COMPLIANCE-P0-10 | Certification campaigns for every identity type, with population evidence | Compliance | |
| COMPLIANCE-P0-11 | Certification of WonderID administrators' role assignments | Compliance | |
| COMPLIANCE-P0-14 † | Campaign templates and preview; consultation; closed-loop revocation; termination SLA report as control evidence | Compliance | |
| IDENTITY-P0-23 † | Human identity merge over existing records (attribute-level, audited, reversible) | Identity | |
| FOUNDATION-P0-33 † | Attribute-level old and new values in audit detail for configuration objects | Foundation + Operations | |

**Exit test.** A person, an external identity and a service account each go
joiner → birthright → request → review → revoke → verified, with a complete
evidence trail. An attribute rule fills a derived attribute with provenance.

## Phase F5: Roles, separation of duties and delegation

Tracking issue #59.

| Story | Title | Module | Issue |
|---|---|---|---|
| ACCESS-P0-21 | Business and IT roles: hierarchy, versions, simulation, computed membership | Access | |
| ACCESS-P0-22 | Entitlement SoD, preventive and detective, with the entitlement hierarchy | Access | |
| ACCESS-P0-23 | Delegations: approval, request, administration | Access | |
| ACCESS-P0-35 † | Approved changes to governance objects: four-eyes publish with a version diff for roles, SoD rules, lifecycle rules, request policies, workflows | Access (with Identity, Operations) | |
| ACCESS-P0-36 † | SoD violation workflow states and saved group-by views; no SoD evaluation during an import of the same application | Access | |

**Exit test.** An SoD conflict blocks a request and appears in the detective
report; a role change is simulated, approved and published as a new version.

## Phase F6: Agent ID, trusted credentials and delegation

Needs D2; D4 for the risk story; D8 for AuthZEN. Tracking issue #60.
Independent of F2–F5; may run in parallel once F1 is done.

| Story | Title | Module | Issue |
|---|---|---|---|
| IDENTITY-P0-19 | Agent onboarding journey, sponsor, agent access packages, lifecycle policies | Identity | |
| IDENTITY-P0-22 | Discovery rules, per-connection discovery switch, agent classes with contract templates, tool classification overrides, AI-platform connectors | Identity | #73 |
| IDENTITY-P0-24 † | Agent identifier (SPIFFE-compatible) and credential bindings | Identity | |
| INTEGRATION-P0-27 † | Token service and AuthZEN receivers on the runtime-gateway connection (transport only) | Integration | |
| RUNTIME-P0-19 † | Gateway token service: issuance, exchange, DPoP validation, replay cache, token register, revocation | Runtime | |
| ACCESS-P0-37 † | Agent delegation grants; delegation and token steps in the decision pipeline; AuthZEN mapping; per-agent shadow → enforce | Access | |
| RUNTIME-P0-20 † | Approval resume for REQUIRE_APPROVAL: pending decision → approval → action-bound token | Runtime | |
| RUNTIME-P0-21 † | Kill-switch propagation: revoke tokens and keys on suspend; SSF events out through a connection | Runtime | |
| RUNTIME-P0-22 † | Audit records with token id, key thumbprint, delegation chain and transaction id | Runtime | |
| RISK-P0-14 † | Agent risk factors: credential hygiene, delegation breadth, chain depth, shadow denials; propose suspension (automatic only under D4) | Risk | |
| QA-P0-18 (extended) | Gateway security suite: tokens, DPoP, delegation, kill switch | QA | |

**Exit test.** A demo agent obtains a DPoP token with a key, acts for user X
through a delegated token, is denied an action outside X's access, triggers a
human approval that resumes the action, and is killed: its next call fails
within 5 seconds and its tokens are listed as revoked.

## Phase F7: Workflow, forms and configuration

Tracking issue #61.

| Story | Title | Module | Issue |
|---|---|---|---|
| OPERATIONS-P0-09 | Workflow designer and runs | Operations | |
| OPERATIONS-P0-11 (rest) | Event subscriptions; outbound webhooks; notification channels as connections; inbound webhooks mapped to events | Operations | #72 |
| OPERATIONS-P0-12 † | Forms and named value lists; e-mail templates per channel; jobs page with the automation run log; sent-notification log | Operations | |
| PLATFORM-P0-13 (finish) | Configuration bundles: signed export, diff, import with approval | Platform | |
| PLATFORM-P0-15 † | Certified definitions: submit a custom definition to the platform catalogue; vendor review; built-in for every tenant | Platform | |
| ACCESS-P0-34 | Application onboarding templates per connection type, with a questionnaire form | Access | #74 |
| ACCESS-P0-38 † | Request baskets for many changes and identities; model-after; saved drafts; signed approval links | Access | |
| IDENTITY-P0-25 † | Generated identifiers for WonderID-authoritative populations | Identity | |
| EXPERIENCE-P0-30 | Guided connector definition editor | Experience | #75 |
| QA-P0-25 | Integrator setup suite: a tenant configured from scratch through the API with an automation credential and a bundle | QA | #76 |

**Exit test.** A tenant builds a contractor onboarding flow (form → sponsor
approval → birthright → provisioning) without code, and promotes it from a
test tenant with a reviewed diff. An integrator sets a tenant up through the
API alone.

## Phase F8: Advanced governance

Tracking issue #62. D8 for the SCIM receiver.

| Story | Title | Module |
|---|---|---|
| ACCESS-P0-39 † | Mitigating-control library; SoD workbench; exercised-violation flag; fine-grained SoD for one ERP connector |  Access |
| ACCESS-P0-40 † | Emergency and JIT access sessions with post-use review and session evidence; privileged and service-account governance | Access |
| IDENTITY-P0-26 † | External organizations, sponsors, invitations, re-attestation; external sub-types | Identity |
| ACCESS-P0-41 † | Role and rule mining; peer recommendations in requests and reviews | Access |
| INTEGRATION-P0-28 † | SCIM receiver and RFC 9967 change events | Integration |
| INTEGRATION-P0-29 † | SSF transmitter and receiver connection type | Integration |
| INTEGRATION-P0-30 † | Cloud connectors: AWS, Azure, GCP; Okta; Google Workspace; vault metadata | Integration |
| IDENTITY-P0-27 † | Discovery from A2A Agent Cards and SCIM `/Agents` | Identity |

**Exit test.** An auditor walkthrough of the SOX ITGC areas is answered from
WonderID evidence packs alone.

## Phase F9: Intelligence and experience

Tracking issue #63.

| Story | Title | Module |
|---|---|---|
| EXPERIENCE-P0-19 | Home and My Access self-service portal; unified tasks inbox | Experience |
| OPERATIONS-P0-10 | Insights, reports, identity graph | Operations |
| OPERATIONS-P0-13 † | New reports; control evidence packs; identity security posture page; archival; sent-notification history | Operations |
| RISK-P0-15 † | Identity risk score for every identity type | Risk |
| RISK-P0-16 † | Control history: per-rule counts per run | Risk + Operations |
| EXPERIENCE-P0-31 † | Owner queues ("mine") on Control Center | Experience |
| EXPERIENCE-P0-20 | Governed AI assistant: explain, search, draft, simulate; never decide | Experience |
| FOUNDATION-P0-21 | Passwordless: passkeys | Foundation |

## Phase F10: Release gate

Tracking issue #64.

| Story | Title | Module |
|---|---|---|
| QA-P0-21 | Security hardening pass, including the threats in the design's §18; the tenant-isolation suite over every new table; advisor checks; the PDP performance budget (p95 ≤ 50 ms cached) | QA |
| QA-P0-22 | Brownfield fixture: HR → lifecycle → request → provision → certify → revoke → verify | QA |
| Full Playwright suite | Green on the nightly, all four parts | QA |

---

## Story numbering

Highest IDs in use after this plan: FOUNDATION-P0-33, IDENTITY-P0-27,
INTEGRATION-P0-30, ACCESS-P0-41, RUNTIME-P0-22, RISK-P0-16, COMPLIANCE-P0-14,
EXPERIENCE-P0-31, PLATFORM-P0-15, OPERATIONS-P0-13, QA-P0-26. Provisional IDs
(†) may be renumbered when they enter a backlog; the title, not the number,
identifies the story until then.
