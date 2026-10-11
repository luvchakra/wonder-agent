# IGA and Agent ID: live progress

| | |
|---|---|
| Last updated | 2026-10-11 |
| Current phase | F1 Import and reconciliation (started 2026-10-11) |
| Next story | INTEGRATION-P0-19, Scheduled import and promotion (#43) |
| Plan | `../run-order/RUN-ORDER.md` · Design `../design/DESIGN.md` |

**How to update this file.** In the same pull request as the work (CLAUDE.md
§4, "Record before you stop"): set the story's status, add a one-line note
with the migration or PR, and move "Current phase" and "Next story" when they
change. Status values: `Not started`, `In progress`, `Blocked`, `Partial`,
`Done`. A phase is done when every gating story is Done and the exit test
passed. This file is hand-maintained; the generated programme rollup
`docs/PROGRESS.md` covers the module backlogs and stays separate.

## Summary

| Phase | Stories | Done | In progress | Status |
|---|---|---|---|---|
| F1 Import and reconciliation | 9 | 1 | 0 | In progress |
| F2 Access requests | 8 | 0 | 0 | Not started |
| F3 Provisioning | 10 | 0 | 0 | Not started; needs D3 |
| F4 Lifecycle and certification | 10 | 0 | 0 | Not started; needs D12 |
| F5 Roles, SoD, delegation | 5 | 0 | 0 | Not started |
| F6 Agent ID | 11 | 0 | 0 | Not started; needs D2 |
| F7 Workflow, forms, configuration | 10 | 0 | 0 | Not started |
| F8 Advanced governance | 8 | 0 | 0 | Not started |
| F9 Intelligence and experience | 8 | 0 | 0 | Not started |
| F10 Release gate | 2 | 0 | 0 | Not started |

Counts include existing stories the phases finish; their current backlog
status is shown per row below.

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Approve the baseline; stories enter the backlogs | Approved 2026-10-11 (owner); F1 and F2 stories added to the module backlogs |
| D2 | OAuth tokens to agents | Open |
| D3 | Connector writes | Open |
| D4 | Automatic agent suspension | Open |
| D5 | Password reset showing a value | Open (recommendation: no) |
| D6 | Auto-close certification decisions | Open (recommendation: not in P0) |
| D7 | Outbound-only relay | Open |
| D8 | SCIM receiver and AuthZEN as public receivers | Open |
| D9 | First connectors | Open (recommendation: Entra ID, Workday, AWS) |
| D10 | Import frequency on the free plan | Open (recommendation: daily plus run now) |
| D11 | Automation credentials | Open |
| D12 | Shared rule runtime | Open |

## Owner actions outside the plan

| Action | Status |
|---|---|
| Configure the Supabase SSO provider so SAML/OIDC sign-in works (FOUNDATION-P0-03.3) | Open |
| Rotate the Saviynt training-tenant password shared in chat on 2026-10-11 | Open |

## F1: Import and reconciliation

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| INTEGRATION-P0-18 Staging reflects the source | Integration | #42 | Done | Migration 0117; isolation SQL 19/19; held runs decided on the connection page |
| INTEGRATION-P0-19 Scheduled import and promotion | Integration | #43 | Not started | Finishes the schedule part of INTEGRATION-P0-08 (backlog: Partial) |
| ACCESS-P0-27 Entitlement and grant reconciliation | Access | #44 | Not started | |
| ACCESS-P0-25 Imported access classification and drift findings | Access + Risk | #45 | Not started | Backlog: Not Started |
| IDENTITY-P0-20 Non-human identities from accounts | Identity | #46 | Not started | |
| EXPERIENCE-P0-28 Reconciliation console | Experience | #47 | Not started | |
| QA-P0-23 Reconciliation suite | QA | #48 | Not started | |
| INTEGRATION-P0-20 Custom attributes as targets; schedule on every connection | Integration | #66 | Not started | Does not gate |
| FOUNDATION-P0-31 Automation credentials | Foundation | #67 | Not started | Needs D11; does not gate |

Exit test: not run.

## F2: Access requests end to end

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| ACCESS-P0-28 Approved requests become pending grants | Access | #50 | Not started | |
| ACCESS-P0-29 Fulfilment tasks | Access | #51 | Not started | |
| ACCESS-P0-30 Remove-access and account requests | Access | #52 | Not started | |
| ACCESS-P0-31 Requests for non-human identities | Access + Identity | #53 | Not started | |
| ACCESS-P0-32 Time-bound access | Access | #54 | Not started | |
| EXPERIENCE-P0-29 Request tracking and tasks inbox | Experience | #55 | Not started | |
| QA-P0-24 Request-to-verified suite | QA | #56 | Not started | |
| FOUNDATION-P0-32 Bulk invitation and invitation API | Foundation | #68 | Not started | Does not gate |

Exit test: not run.

## F3: Provisioning

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| INTEGRATION-P0-11 (finish) Write interface with a caller | Integration | | Partial | Backlog: Partial; interface built, no caller |
| INTEGRATION-P0-13 Provisioning pipeline | Integration | | Not started | Backlog: Not Started |
| INTEGRATION-P0-21 Definition extensions | Integration | #69 | Not started | |
| INTEGRATION-P0-22 † SCIM client; LDAP and http writes | Integration | | Not started | |
| INTEGRATION-P0-23 † WonderID Relay | Integration | | Not started | Needs D7 |
| INTEGRATION-P0-24 † Entra ID connector | Integration | | Not started | Needs D9 |
| INTEGRATION-P0-25 † HR connector | Integration | | Not started | Needs D9 |
| INTEGRATION-P0-26 † ServiceNow ticketing | Integration | | Not started | |
| RISK-P0-13 Rogue access management | Risk | | Not started | Backlog: Not Started |
| QA-P0-26 † Provisioning safety suite | QA | | Not started | |

## F4: Lifecycle and certification

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| OPERATIONS-P0-11 (runtime part) Shared rule runtime | Operations | #72 | Not started | Needs D12 |
| IDENTITY-P0-21 Attribute rules and the rule catalogue | Identity | #70 | Not started | |
| IDENTITY-P0-18 (finish) Lifecycle rules | Identity | | Partial | Backlog: events, tasks, transitions, ownership transfer built; rules not |
| IDENTITY-P0-17 (finish) Identity detail tabs | Identity | | Partial | Backlog: Partial |
| ACCESS-P0-33 Entitlement types; classification rules | Access | #71 | Not started | |
| COMPLIANCE-P0-10 Certification for every identity type | Compliance | | Not started | Backlog: Not Started |
| COMPLIANCE-P0-11 Certification of administrators | Compliance | | Not started | Backlog: Not Started |
| COMPLIANCE-P0-14 † Templates, preview, consultation, closed loop, SLA report | Compliance | | Not started | |
| IDENTITY-P0-23 † Human identity merge | Identity | | Not started | |
| FOUNDATION-P0-33 † Attribute-level audit detail | Foundation + Operations | | Not started | |

## F5: Roles, separation of duties and delegation

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| ACCESS-P0-21 Business and IT roles | Access | | Not started | Backlog: Not Started |
| ACCESS-P0-22 Entitlement SoD | Access | | Not started | Backlog: Not Started |
| ACCESS-P0-23 Delegations | Access | | Not started | Backlog: Not Started |
| ACCESS-P0-35 † Approved changes to governance objects | Access | | Not started | |
| ACCESS-P0-36 † SoD violation workflow; import guardrail | Access | | Not started | |

## F6: Agent ID

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| IDENTITY-P0-19 Agent onboarding, sponsor, packages, lifecycle policies | Identity | | Not started | Backlog: Not Started |
| IDENTITY-P0-22 Discovery rules, classes, templates, overrides | Identity | #73 | Not started | |
| IDENTITY-P0-24 † Agent identifier and credential bindings | Identity | | Not started | |
| INTEGRATION-P0-27 † Token service and AuthZEN receivers (transport) | Integration | | Not started | Needs D8 |
| RUNTIME-P0-19 † Gateway token service | Runtime | | Not started | Needs D2 |
| ACCESS-P0-37 † Delegation grants; pipeline steps; AuthZEN; shadow → enforce | Access | | Not started | |
| RUNTIME-P0-20 † Approval resume | Runtime | | Not started | |
| RUNTIME-P0-21 † Kill-switch propagation; SSF out | Runtime | | Not started | |
| RUNTIME-P0-22 † Audit record fields | Runtime | | Not started | |
| RISK-P0-14 † Agent risk factors; propose suspension | Risk | | Not started | Needs D4 for automatic |
| QA-P0-18 (extended) Gateway security suite | QA | | Not started | Backlog: Not Started |

## F7: Workflow, forms and configuration

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| OPERATIONS-P0-09 Workflow designer and runs | Operations | | Not started | Backlog: Not Started |
| OPERATIONS-P0-11 (rest) Event subscriptions; channels | Operations | #72 | Not started | |
| OPERATIONS-P0-12 † Forms, e-mail templates, jobs page, run log | Operations | | Not started | |
| PLATFORM-P0-13 (finish) Configuration bundles | Platform | | Partial | Backlog: Partial (Global Configuration built) |
| PLATFORM-P0-15 † Certified definitions | Platform | | Not started | |
| ACCESS-P0-34 Onboarding templates and questionnaire | Access | #74 | Not started | |
| ACCESS-P0-38 † Baskets, model-after, drafts, signed links | Access | | Not started | |
| IDENTITY-P0-25 † Generated identifiers | Identity | | Not started | |
| EXPERIENCE-P0-30 Guided connector editor | Experience | #75 | Not started | |
| QA-P0-25 Integrator setup suite | QA | #76 | Not started | |

## F8: Advanced governance

| Story | Module | Status |
|---|---|---|
| ACCESS-P0-39 † Mitigating controls; SoD workbench; fine-grained SoD | Access | Not started |
| ACCESS-P0-40 † Emergency and JIT access; session evidence | Access | Not started |
| IDENTITY-P0-26 † External organizations, sponsors, sub-types | Identity | Not started |
| ACCESS-P0-41 † Role and rule mining; peer recommendations | Access | Not started |
| INTEGRATION-P0-28 † SCIM receiver and events | Integration | Not started |
| INTEGRATION-P0-29 † SSF connection type | Integration | Not started |
| INTEGRATION-P0-30 † Cloud connectors | Integration | Not started |
| IDENTITY-P0-27 † Discovery from A2A and SCIM `/Agents` | Identity | Not started |

## F9: Intelligence and experience

| Story | Module | Status |
|---|---|---|
| EXPERIENCE-P0-19 Home and My Access | Experience | Not started (backlog: Not Started) |
| OPERATIONS-P0-10 Insights, reports, identity graph | Operations | Not started (backlog: Not Started) |
| OPERATIONS-P0-13 † Reports, evidence packs, posture, archival | Operations | Not started |
| RISK-P0-15 † Identity risk score for every type | Risk | Not started |
| RISK-P0-16 † Control history | Risk + Operations | Not started |
| EXPERIENCE-P0-31 † Owner queues on Control Center | Experience | Not started |
| EXPERIENCE-P0-20 Governed AI assistant | Experience | Not started (backlog: Not Started) |
| FOUNDATION-P0-21 Passkeys | Foundation | Not started (backlog: Not Started) |

## F10: Release gate

| Story | Module | Status |
|---|---|---|
| QA-P0-21 Security hardening pass | QA | Not started (backlog: Not Started) |
| QA-P0-22 Brownfield fixture | QA | Not started (backlog: Not Started) |

## History

- 2026-10-11: file created with the plan of record (`RUN-ORDER.md`). No story started.
- 2026-10-11: D1 approved by the owner; F1 started. INTEGRATION-P0-18 done (migration 0117).
