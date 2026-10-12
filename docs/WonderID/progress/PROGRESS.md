# IGA and Agent ID: live progress

| | |
|---|---|
| Last updated | 2026-10-12 |
| Current phase | F3 in progress. The exit scenario runs end to end against a stub system (2026-10-12): rogue access removed through the connector after a reviewer asks, verified, finding resolved |
| Next story | F3: INTEGRATION-P0-21 definition extensions, then INTEGRATION-P0-22 (SCIM; LDAP and http writes); the relay and named connectors wait on D7 and D9 |
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
| F1 Import and reconciliation | 9 | 9 | 0 | Done; exit test passed (seeded staging) |
| F2 Access requests | 8 | 8 | 0 | Done; exit test passed (seeded test organization) |
| F3 Provisioning | 10 | 1 | 2 | Removal and disabling through connectors; rogue access remediated through them; exit scenario passes against a stub system |
| F4 Lifecycle and certification | 10 | 0 | 0 | Not started; D12 approved |
| F5 Roles, SoD, delegation | 5 | 0 | 0 | Not started |
| F6 Agent ID | 11 | 0 | 0 | Not started; D2 approved |
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
| D2 | OAuth tokens to agents | Approved 2026-10-12 (owner): yes, scoped to agents and the gateway and opt-in MCP audiences; workforce sign-in stays with the customer's IdP |
| D3 | Connector writes | Approved 2026-10-12 (owner): yes, per connection, declared, tenant-enabled and approval-gated; disable/enable and remove access first, then create and add |
| D4 | Automatic agent suspension | Open |
| D5 | Password reset showing a value | Open (recommendation: no) |
| D6 | Auto-close certification decisions | Open (recommendation: not in P0) |
| D7 | Outbound-only relay | Open |
| D8 | SCIM receiver and AuthZEN as public receivers | Open |
| D9 | First connectors | Open (recommendation: Entra ID, Workday, AWS) |
| D10 | Import frequency on the free plan | Open (recommendation: daily plus run now) |
| D11 | Automation credentials | Approved 2026-10-12 (owner): yes, with the §8.2 controls (hashed, expiring at most a year, role-scoped, four-eyes, audited, rate-limited, never for sign-in) |
| D12 | Shared rule runtime | Approved 2026-10-12 (owner): one shared runtime published by Operations; rule tables stay with their owners |

## Owner actions outside the plan

| Action | Status |
|---|---|
| Configure the Supabase SSO provider so SAML/OIDC sign-in works (FOUNDATION-P0-03.3) | Open |
| Rotate the Saviynt training-tenant password shared in chat on 2026-10-11 | Done 2026-10-12 (owner) |
| Disconnect the paused Vercel project `kunals-projects-9f64757f/wonder-id` from the repository | Done 2026-10-12 (owner) |
| Review the `wonderapps_dashboard` database role: it can sign in and reads every row of about 24 customer tables in all organizations (`using (true)` policies). No migration in the repository creates it; found 2026-10-11 by the advisors | Open |

## F1: Import and reconciliation

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| INTEGRATION-P0-18 Staging reflects the source | Integration | #42 | Done | PR #79; migration 0117; isolation SQL 19/19; held runs decided on the connection page |
| INTEGRATION-P0-19 Scheduled import and promotion | Integration | #43 | Done | PR #80; migration 0118; identities then accounts after every full sync, steps on the job; source schedules run. Entitlements and grants join with ACCESS-P0-27 |
| ACCESS-P0-27 Entitlement and grant reconciliation | Access | #44 | Done | PR #81; migration 0119; preview then apply on the application page; joins the post-sync chain; removal and return are ledger events |
| ACCESS-P0-25 Imported access classification and drift findings | Access + Risk | #45 | Done | PR #82; migration 0120; baseline per application; legacy / authorized / unproven / rogue; one Risk finding per rogue access, resolved when approved or removed |
| IDENTITY-P0-20 Non-human identities from accounts | Identity | #46 | Done | PR #83. Service/shared/machine accounts become owned or queued identities; agents' accounts link by declared identifiers; unowned subjects refused for requests |
| EXPERIENCE-P0-28 Reconciliation console | Experience | #47 | Done | Held runs, run now with progress, chain steps, preview and apply, classification and last seen at source, on the connection, application and account pages |
| QA-P0-23 Reconciliation suite | QA | #48 | Done | `tests/e2e/f1-reconciliation.spec.ts`, 7 tests (14 with sign-in setup) passed locally. Found and fixed: connector-sourced onboarding could never validate |
| INTEGRATION-P0-20 Custom attributes as targets; schedule on every connection | Integration | #66 | Done | Mappings to custom attributes, typed and unique-checked by Identity, with provenance; schedule on every reading connection and its API. Does not gate |
| FOUNDATION-P0-31 Automation credentials | Foundation | #67 | Done | Migrations 0126–0127. Admin → Automation Credentials: one per application identity, secret shown once, four-eyes create and extend, expiry ≤ 1 year, CIDR allowlist, rate limit, rotate, revoke; `Bearer wa_ac_…` on /api/v1/* acts with its role only, every call audited; Global Configuration API; Configuration Administrator role |

Exit test: passed 2026-10-11 by the QA-P0-23 suite, on connector records seeded into staging (a live target is not reachable from the test). A person, an owned service account and an agent show accounts, entitlements and grants; a grant removed at the source is marked missing and its finding resolves; a grant added after the baseline is rogue with one finding.

## F2: Access requests end to end

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| ACCESS-P0-28 Approved requests become pending grants | Access | #50 | Done | Migration 0121. Approval (chain, auto-approval, agent path, package items) adds a pending grant, on a placeholder account when the subject has none; Mark fulfilled → not yet verified; reconciliation verifies. Pending grants are not effective access |
| ACCESS-P0-29 Fulfilment tasks | Access | #51 | Done | Migration 0122. One task per pending grant for the application's owner; claim, done (grant unverified), fail with a reason; SLA in Global Configuration (3 days), daily reminder when overdue; closed as verified by reconciliation. Home › Access Governance › Fulfilment Tasks |
| ACCESS-P0-30 Remove-access and account requests | Access | #52 | Done | Migration 0123. Remove access (revoked when the source no longer lists it), a new account (placeholder until it appears), disable an account (until the source shows it disabled). Each request is one line with its own approval; multi-line baskets remain a separate item |
| ACCESS-P0-31 Requests for non-human identities | Access + Identity | #53 | Done | No migration. The owner of a service account or machine identity requests for it; an agent's business owner requests only what its contract approves (refused otherwise, server-side). Non-human requests are approved by the resource's owners |
| ACCESS-P0-32 Time-bound access | Access | #54 | Done | Migration 0124. End dates capped by policy; a reminder before the end with an Extend request (approved like any other); at the end, exactly one removal task per grant; the ledger shows EXPIRED once the source confirms the removal |
| EXPERIENCE-P0-29 Request tracking and tasks inbox | Experience | #55 | Done | No migration. Each request line shows its real state (waiting, approved, waiting for fulfilment, not yet verified, verified, failed, ended); "Waiting for you" lists fulfilment tasks with the approvals; For lists the people you manage and what you own |
| QA-P0-24 Request-to-verified suite | QA | #56 | Done | A person, a service account and an agent from request to verified; removal and expiry end revoked; approver ≠ requester; isolation SQL for 0123/0124 (11/11); a repeated reconciliation changes nothing |
| FOUNDATION-P0-32 Bulk invitation and invitation API | Foundation | #68 | Done | Migration 0125. Users → Import CSV… previews new, already-member and invalid rows and invites only the new; POST /api/v1/users/invitations (dry run; idempotent on e-mail); invitations expire (30 days by default) and can be sent again; roles never beyond the inviter's own permissions. Scripts use an automation credential (FOUNDATION-P0-31) |

Exit test: not run.

## F3: Provisioning

| Story | Module | Issue | Status | Notes |
|---|---|---|---|---|
| INTEGRATION-P0-11 (finish) Write interface with a caller | Integration | | Done | 2026-10-12. Definitions declare writes (`write`: revoke_access, disable_account, grant_access, create_account; http driver); a connection writes only after an administrator turns writes on (Connection → Changes in the system; audited); retryable failures marked |
| INTEGRATION-P0-13 Provisioning pipeline | Integration + Access | | Done | 2026-10-12. Slice 1 (migrations 0128–0129): remove-access and disable-account tasks done by the connector (claim, idempotent attempts, two retries, verification sync, reconciliation verifies); failures back to the owner with the reason, Try again, lost-run sweep. Slice 2 (no migration): approved access added and accounts created by the connector; access for someone with no account waits while the connector creates it, then is added once the account is read back. Ticketed fulfilment is INTEGRATION-P0-26 |
| INTEGRATION-P0-21 Definition extensions | Integration | #69 | Done | Slice 1 (2026-10-12): transforms `regex`, `replace`, `coalesce`, `dateAdd`; API key in the request body. Slice 2: incremental `changes` resources for scheduled syncs (full read at least daily; incremental runs mark nothing missing). Part 3a: private-key sign-in (`private_key_jwt`, `jwt_bearer`) and client certificates (mutual TLS). Part 3b: OAuth authorization code with PKCE. Part 4: export/import and connection upgrade with a preview |
| INTEGRATION-P0-22 † SCIM client; LDAP and http writes | Integration | | Not started | |
| INTEGRATION-P0-23 † WonderID Relay | Integration | | Not started | Needs D7 |
| INTEGRATION-P0-24 † Entra ID connector | Integration | | Not started | Needs D9 |
| INTEGRATION-P0-25 † HR connector | Integration | | Not started | Needs D9 |
| INTEGRATION-P0-26 † ServiceNow ticketing | Integration | | Not started | |
| RISK-P0-13 Rogue access remediation | Risk | | In progress | Core (2026-10-12, migration 0130): "Remove access" on a rogue-access finding raises an ordinary request under the application's policy; connector, verification, finding resolves verified fixed. `connector-provisioning.spec.ts` runs the F3 exit scenario. Other remediation actions, severity factors and trend remain |
| QA-P0-26 Provisioning safety suite | QA | | Done | 2026-10-12, no migration. The mass-change guard on writes: at most `integration.maxWritesPerHour` (default 100) changes per connection per hour; past it nothing is sent and the task goes to its owner with the reason. Tests in `connector-provisioning.spec.ts`: read-only types cannot be turned on, the guard, Try again once the limit allows, no attempt key sent twice, every operation verified |

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
- 2026-10-11: D1 approved by the owner; F1 started. INTEGRATION-P0-18 done (migration 0117, PR #79).
- 2026-10-11: INTEGRATION-P0-19 done (migration 0118, PR #80).
- 2026-10-11: ACCESS-P0-27 done (migration 0119, PR #81).
- 2026-10-11: ACCESS-P0-25 done (migration 0120, PR #82).
- 2026-10-11: IDENTITY-P0-20 done (no migration, PR #83).
- 2026-10-11: EXPERIENCE-P0-28 done.
