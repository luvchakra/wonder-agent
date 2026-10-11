# WonderID Foundation Design — Identity Governance (IGA) and Agent ID

| | |
|---|---|
| Status | Draft for owner review. Proposes work; changes nothing on its own. Revised 2026-10-11: delivery reordered so reconciliation, account import and access requests come first (§10). |
| Date | 2026-10-11 |
| Scope | IGA for every identity type, and Agent ID (AI agents as governed non-human identities) |
| Builds on | `CLAUDE.md` (binding contract), `docs/plan/WONDERID-ROADMAP.md`, `docs/requirements/WonderID_P0_Implementation_Spec_v3.md`, `docs/integrations/CONNECTOR-FRAMEWORK.md` |
| Inputs | Public standards (§2). Saviynt's public product pages and public training guides, and seven Saviynt documents supplied by the owner (§12), used at the level of *which capabilities exist*. |

This is an original WonderID design. It takes ideas from open standards and
uses the vendor material only as a checklist of capabilities an enterprise buyer
expects. It does not reuse vendor wording, configuration formats, variable
names or architecture. Where a WonderID design differs from the market norm on
purpose, the reason is given.

Nothing here overrides `CLAUDE.md`. Every proposal is checked against the
non-negotiables (§1 of `CLAUDE.md`), cited as "NN #n". Proposals that would
need an owner decision are collected in §11 and are not to be built until
decided.

---

## Contents

1. [Product stance and design principles](#1-product-stance-and-design-principles)
2. [Standards baseline](#2-standards-baseline)
3. [Where WonderID is today](#3-where-wonderid-is-today)
4. [Canonical model](#4-canonical-model)
5. [IGA design](#5-iga-design)
6. [Agent ID design](#6-agent-id-design)
7. [Cross-cutting: security, tenancy, audit, control mapping](#7-cross-cutting-security-tenancy-audit-control-mapping)
8. [Administration and experience](#8-administration-and-experience)
9. [Modifications required to the current implementation](#9-modifications-required-to-the-current-implementation)
10. [Phased delivery plan](#10-phased-delivery-plan)
11. [Decisions needed from the owner](#11-decisions-needed-from-the-owner)
12. [Capability coverage matrix (supplied documents and public vendor material)](#12-capability-coverage-matrix)
13. [References](#13-references)

---

## 1. Product stance and design principles

WonderID answers five questions for every identity–access relationship: *who
or what is this identity, what can it access, why does it have that access,
who authorized it under which policy, and is it still appropriate?* (CLAUDE.md
header). This document turns those questions into designs for two pillars:

- **IGA** — the governance of human, external and machine identities: sources,
  lifecycle, requests, roles, certifications, separation of duties,
  provisioning and audit.
- **Agent ID** — AI agents as first-class non-human identities with a human
  owner, scoped short-lived credentials, explicit delegation, a policy decision
  before every action, a kill switch, and a complete audit trail.

### 1.1 Principles

| # | Principle | What it means in practice |
|---|---|---|
| P1 | **One identity model for everything that holds access** | Humans, externals, service accounts, workloads, APIs and agents share one `identities` reference (already built, migration 0077). Agent-specific fields stay on `agents` (NN #5). |
| P2 | **Every access has a reason on record** | Each grant has a ledger entry stating its source (request, role, package, lifecycle rule, import, emergency, agent authorization). The ledger is already built (0114); provisioning must write to it. |
| P3 | **SHOULD / CAN / DID for every identity, not only agents** | SHOULD is approved access (requests, roles, contracts). CAN is effective access from connectors. DID is observed activity. Drift between them is a finding (NN #8). |
| P4 | **Deterministic decisions, human approval for consequence** | Policy, risk, SoD and approval routing are code. AI may explain, recommend and draft only (NN #9, #19, §17). |
| P5 | **Connectors are the only way in or out** | Reads, writes, events, files, SCIM and the Runtime Gateway all go through `modules/integrations/framework` (NN #20). |
| P6 | **Read-only unless declared and approved** | A connection writes only when its definition declares the write capability *and* the tenant enabled it *and* the specific change passed approval (NN #12, #15). |
| P7 | **Standards on the wire, original inside** | Interfaces speak SCIM, OAuth token exchange, DPoP, AuthZEN, SSF/CAEP and SPIFFE-compatible identifiers so customers can plug in existing tools. The internal model stays vendor-neutral (NN #17). |
| P8 | **Short-lived beats revocable beats static** | Prefer credentials that expire in minutes. Revocation is the backstop, not the main control. Static API keys remain only as a migration path. |
| P9 | **Evidence is a by-product, not a project** | Every decision stores what the decider saw, who decided, when and why, in a form an auditor can test for completeness and accuracy (§7.3). |
| P10 | **Minimal UI** | One primary action per screen; advanced options folded (CLAUDE.md §19.5). Breadth of capability must not become breadth of buttons. |

### 1.2 What WonderID deliberately is not

Unchanged from CLAUDE.md §10 and restated where it shapes this design:

- **Not an identity provider for the workforce.** WonderID does not sign people
  into target systems. For agents it issues *gateway-scoped* credentials only
  (§6.2); whether that counts as an IdP role is decision D2 (§11).
- **Not a PAM vault.** Emergency and privileged access are governed (who may,
  for how long, with what review) and fulfilled through connectors to the
  customer's PAM or target system. WonderID never stores or reveals a
  plaintext credential (§5.7).
- **Not a SIEM.** WonderID consumes activity it needs for DID and usage
  evidence, and sends security signals out (SSF), but does not become the
  log store of record.

---

## 2. Standards baseline

Statuses were checked on 2026-10-10/11. Internet-Drafts change; re-check on
Datatracker before relying on a draft-specific detail.

### 2.1 IGA standards

| Standard | Status | What WonderID uses it for |
|---|---|---|
| **SCIM 2.0 Core Schema — RFC 7643** | Proposed Standard (2015) | Attribute model for User, Group and the Enterprise User extension (`employeeNumber`, `department`, `manager`, …). `externalId` + `meta.version` carry source identity and change detection. Attribute characteristics (`mutability`, `returned`, `uniqueness`) inform WonderID attribute definitions. |
| **SCIM 2.0 Protocol — RFC 7644** | Proposed Standard (2015) | `/Users`, `/Groups`, PATCH (`add`/`remove`/`replace` with value-filter paths), filtering, `/Bulk`, ETags (`If-Match`), discovery (`/ServiceProviderConfig`, `/Schemas`, `/ResourceTypes`). WonderID is both a SCIM **client** (provisioning driver) and a SCIM **receiver** (inbound HR/IdP feed). |
| **SCIM cursor pagination — RFC 9865** | Proposed Standard (Oct 2025) | `cursor`/`nextCursor` paging for large reconciliations; the driver prefers cursor when the target advertises it. |
| **SCIM events — RFC 9967** | Proposed Standard (May 2026) | Change notifications as Security Event Tokens (`…:prov:create`, `…:prov:patch`, `…:prov:deactivate`, `…:misc:asyncresp`). Lets an HR system or IdP push joiner/mover/leaver changes instead of WonderID polling. |
| **SCIM Agent resource — draft-wzdk-scim-agent-resource-00** | Individual draft (Jun 2026) | `Agent` resource at `/Agents` with `agentUserName`, `owners[]`. WonderID maps its agent registry to it for import/export; not depended on until adopted. |
| **NIST SP 800-53 Rev. 5 (release 5.2.0)** — AC-2, AC-3, AC-5, AC-6, AC-24, IA-2/4/5/9, AU-2/3/9/10 | Final | Control vocabulary. §7.4 maps each WonderID capability to the controls it helps evidence. |
| **NIST SP 800-207 Zero Trust** | Final (2020) | PDP/PEP split: WonderID's policy engine is the PDP; the Runtime Gateway and connectors are PEPs. |
| **SOX §302/404, PCAOB AS 2201, AS 1105** | Law / auditing standards | ITGC access domains (provisioning with approval, timely termination, periodic user access review, privileged review, SoD), completeness and accuracy of the review population, reviewer independence, remediation evidence (§5.5, §7.3). |

### 2.2 Agent and workload identity standards

| Standard | Status | What WonderID uses it for |
|---|---|---|
| **OAuth 2.0 Token Exchange — RFC 8693** | Proposed Standard (2020) | Delegation: `subject_token` (the user) + `actor_token` (the agent) → a token whose `act` claim names the agent and nests prior actors. `may_act` pre-authorizes who may act for a subject. Impersonation (no `act`) is **not** offered. |
| **DPoP — RFC 9449** | Proposed Standard (2023) | Sender-constrained agent tokens: `cnf.jkt` binds the token to the agent's key; each call carries a proof (`htm`, `htu`, `iat`, `jti`, `ath`, server `nonce`). A stolen token is useless without the key. |
| **JWT client assertion — RFC 7523**, **mTLS — RFC 8705** | Proposed Standards | How an agent authenticates to obtain a token without a shared secret. |
| **Rich Authorization Requests — RFC 9396** | Proposed Standard (2023) | `authorization_details` carry the exact tool/resource/action/limits of a grant; the gateway enforces them. |
| **Resource Indicators — RFC 8707**, **Protected Resource Metadata — RFC 9728** | Proposed Standards | Audience-restricted tokens; MCP servers advertise their authorization server. |
| **Token Revocation — RFC 7009**, **Introspection — RFC 7662** | Proposed Standards | Revocation and status checks for longer-lived tokens. |
| **OAuth 2.0 Security BCP — RFC 9700** | BCP 240 (2025) | PKCE, no implicit/password grants, sender-constrained and audience-restricted tokens. |
| **Transaction Tokens — draft-ietf-oauth-transaction-tokens-11** | WG draft, awaiting write-up (Jul 2026) | Short-lived `txn` context passed along a call chain inside a trust domain. WonderID records `txn` for correlation; issuance is a later option. |
| **Identity chaining — draft-ietf-oauth-identity-chaining-17** | Approved, RFC Editor queue | Agent calls that cross trust domains (customer → SaaS). |
| **SPIFFE / SPIRE** | CNCF graduated | Workload identifier format `spiffe://<trust-domain>/<path>`, JWT-SVID / X.509-SVID as attested agent credentials, no secret held by the workload. |
| **IETF WIMSE — draft-ietf-wimse-aims-00 (AIMS)** and arch/identifier/workload-creds drafts | WG documents (2026) | Layered model for agent identity: identifier → short-lived credentials → attestation → authentication → authorization → monitoring/remediation → policy → compliance. Also: "static API keys are an antipattern", the LLM never holds credentials, tamper-evident audit with agent, delegated subject, resource, decision and correlation id. |
| **OpenID AuthZEN Authorization API 1.0** | Final (Jan 2026) | Standard PEP→PDP interface: `evaluation`, batch `evaluations`, `search/{subject,resource,action}`, discovery at `/.well-known/authzen-configuration`. WonderID exposes its runtime decision engine through it. |
| **OpenID CIBA Core 1.0** | Final | Out-of-band human approval of an agent action (`binding_message`, poll/ping/push). |
| **OpenID SSF 1.0, CAEP 1.0, RISC 1.0** | Final (Sep 2025) | Propagating kill-switch and revocation (`session-revoked`, `credential-change`, `risk-level-change`, `account-disabled`) to and from other systems. |
| **MCP authorization (spec 2026-07-28)** | Published | MCP servers are OAuth resource servers: RFC 9728 metadata, PKCE, RFC 8707 `resource` required, no token passthrough, Client ID Metadata Documents preferred over dynamic registration. Shapes the MCP side of the gateway. |
| **A2A protocol 1.0** | Linux Foundation | Agent Cards (`securitySchemes`, signed cards) as a discovery source for agents. |
| **OpenID "Identity Management for Agentic AI" whitepaper** (Oct 2025); **NCCoE agent identity & authorization concept paper** (Feb 2026) | Guidance | Problem framing: delegation, consent fatigue, recursive delegation, cross-domain agents, prompt-injection-resistant authorization. |

---

## 3. Where WonderID is today

Summary of the 2026-10-11 code inventory (116 migrations, `0001`–`0116`;
`docs/PROGRESS.md` 201 of 252 stories Done). "Built" means code and migration
exist and the backlog row is Done.

### 3.1 IGA

| Capability | Built | Gap |
|---|---|---|
| Unified identity model | `identities` with 8 types and lifecycle states, custom attributes, relationships (0077); field provenance (0080) | Detail tabs for Groups/Access/Risk/Activity (IDENTITY-P0-17 Partial) |
| Authoritative sources | `identity_sources`, precedence, mappings, correlation rules, leaver threshold guard, reconciliation runs, pending matches (0081–0083) | Schedules stored but not run; SCIM/REST/HR are presets over files, not native pulls (INTEGRATION-P0-08 Partial) |
| Lifecycle (JML) | Joiner/mover/leaver/rehire/conversion events → governed human tasks (0084, 0085); agent lifecycle state machine | No birthright rules, no rule engine on events, no automatic deprovisioning (IDENTITY-P0-18 Partial) |
| Accounts | Correlation, orphan/dormant, account types (0089) | Moving accounts from staging into `accounts` is started by hand per application. Staging is never pruned, so removals at the source go undetected through connectors. No incremental mode (§10, F1) |
| Requests and approvals | Request policies (0092), staged approval engine with four-eyes trigger, escalation (0093), access packages for every identity type (0094), catalog | Approval creates no pending grant or task; fulfilment is a manual "mark fulfilled" that reconciliation never verifies; no removal or account requests; AI agents refused in the catalog; no delegation (ACCESS-P0-23), recommendations or emergency access (§10, F2) |
| Roles and entitlements | Applications catalog, entitlements with privilege level and owner, access grants with ten grant types, access ledger (0114) | No business/IT roles, no entitlement hierarchy (ACCESS-P0-21), no role mining |
| Certifications | Campaigns, items, decisions, snapshots, escalation, evidence export (0036, 0046) | `certification_items.agent_id` NOT NULL → agent-only (COMPLIANCE-P0-10); revoke changes only WonderID's record |
| SoD | Action/process SoD from audit history, block or advise, exceptions (0053) | No entitlement-combination SoD (ACCESS-P0-22), no detective scans, no mitigating-control library |
| Connectors | Declarative framework + gateway, 5 drivers (http, ldap, sql, mcp, file), 16 built-in definitions, inbound receivers, CSV, boundary test (0108–0113); daily scheduled sync into staging (`integration_objects`) | Staged entitlements and access grants from connectors are read by nothing (only CSV reaches `entitlements`/`access_grants`); identity-source schedules not run. **Read-only**: no driver implements write; `executeConnectorWrite()` (0087) has no caller; no SCIM server/client; no Entra/Okta/AWS/Azure/GCP |
| Audit | Hash-chained append-only `audit_logs`, integrity check, exports, 8 report types, 10 control frameworks (0104, 0105), record provenance (0115) | Identity graph and insights (OPERATIONS-P0-10) |
| Admin and config | Custom roles, groups, scoped assignments, authorization policies (0097–0101); Global Configuration with versions (0116); notifications; feature flags | No workflow engine, forms, email templates, transport of configuration |

### 3.2 Agent ID

| Capability | Built | Gap |
|---|---|---|
| Agent registration and owner | `agents`, owners of seven types, REGISTERED requires purpose, source and active business + technical owner | Sponsor and agent onboarding journey (IDENTITY-P0-19) |
| Purpose (SHOULD) | Versioned `agent_contracts`: approved/prohibited apps, data, actions, autonomy 0–4, allowed tools, approved users and delegators, expiry | — |
| Discovery | Deterministic detector, discovery inbox, duplicates, shadow AI from unregistered runtime | A2A Agent Card and SCIM `/Agents` as sources |
| Credentials | Per-agent API keys (`wa_ak_…`, hashed, optional expiry, revoke one/all) (0061) | **No short-lived tokens, no DPoP, no token exchange, no workload attestation** |
| Delegation | Contract fields `approved_users`, `approved_delegators`; `context.userId` recorded | **Not evaluated**; no delegated token; no chain |
| Policy before action | Pure, fail-closed decision pipeline (tenant → identity → lifecycle → emergency → SHOULD → CAN → context → risk → runtime policy), ALLOW / DENY / REQUIRE_APPROVAL / ALLOW_WITH_RESTRICTIONS, immutable `runtime_decisions` | Default OBSERVE_ONLY, no tenant enforcing; custom API (not AuthZEN); REQUIRE_APPROVAL only notifies |
| Kill switch | Tenant kill switch, tool/MCP-server suspension, session termination (0064); SUSPENDED/RESTRICTED states | No propagation outside WonderID; keys not auto-revoked on suspend |
| Audit (DID) | Runtime events with dedupe and replay window, quarantine, DID calculation, SHOULD/CAN/DID compare, decisions in audit | Delegation chain and token id not in the record; gateway security suite (QA-P0-18) open |

---

## 4. Canonical model

The model below names **existing** tables in plain text and **proposed**
additions in *italics*. Ownership follows `docs/design/ownership-map.md`; no
proposal moves ownership.

```text
Identity source ──feeds──▶ Identity (human | external | machine | service_account | application | workload | api | ai_agent)
                               │  owner / manager / sponsor / delegate edges (identity_relationships)
                               │
                               ├──has──▶ Account (on an Application, via a Connection)
                               │             └──holds──▶ Entitlement (privilege level, owner, *parent entitlement*, *business functions*)
                               │
                               ├──assigned──▶ *Business / IT role* ──contains──▶ Entitlement | Access package | *role*
                               ├──assigned──▶ Access package ──contains──▶ Entitlement | Application
                               │
                               ├──every grant──▶ Access ledger entry (source, authorization, status) ◀── provisioning task
                               │
                               └──ai_agent 1:1──▶ Agent ──▶ Agent contract (SHOULD)
                                                      ├──▶ *Workload credential binding* (SPIFFE id / key thumbprint)
                                                      ├──▶ *Delegation grant* (user X → agent, scope, expiry)
                                                      └──▶ Runtime decision / Runtime event (DID)
```

### 4.1 Mapping to SCIM

| WonderID | SCIM | Notes |
|---|---|---|
| `identities` (human, external) | `User` + Enterprise extension | `identities.id` ↔ SCIM `id` when WonderID is the provider; source id ↔ `externalId` |
| `identities.lifecycle_state` | `active` | ACTIVE/LEAVE_PENDING → `true`; DISABLED/TERMINATED → `false` |
| `identity_relationships(manager_of)` | `enterprise:manager` | |
| `accounts` | `User` on the target | One WonderID identity → many target `User`s |
| `entitlements` (group type) | `Group` / `members[]` | |
| `entitlements` (other) | `entitlements[]` / `roles[]` on User | |
| `agents` | `Agent` (draft-wzdk) | Import/export only until the draft is adopted |

### 4.2 Proposed model additions

Each is an additive migration by the owning module (NN #13, #14), with
`tenant_id`, RLS, the four provenance columns and the `record_provenance`
trigger (CLAUDE.md §14, §19.10), and an isolation test.

| Proposed table | Owner | Purpose |
|---|---|---|
| *`business_roles`*, *`business_role_members`* (entitlements, packages, child roles), *`business_role_assignments`*, *`business_role_versions`* | Access | Business and IT roles with hierarchy, versioning, owners (ACCESS-P0-21) |
| *`entitlement_hierarchy`* (parent/child) | Access | Entitlements that imply others (an admin group that contains a reader group) |
| *`sod_business_functions`*, *`sod_function_members`*, *`sod_risks`*, *`sod_rulesets`*, *`sod_mitigating_controls`*, *`sod_violations`* | Access | Entitlement-level SoD (ACCESS-P0-22 and P1) |
| *`lifecycle_rules`* | Identity | Birthright and event rules (condition on identity attributes → package/role/task) |
| *`delegations`* | Access | Approval, request, administration and access-on-behalf delegations (ACCESS-P0-23) |
| *`provisioning_plans`*, *`provisioning_tasks`* | Integration | Plan → pre-check → execute → verify pipeline (INTEGRATION-P0-13), reusing `connector_write_operations` for idempotency |
| *`emergency_access_sessions`* | Access | Time-boxed elevated access with post-use review |
| *`external_organizations`* | Identity | Vendors and partners that external identities belong to, with sponsor and contract end date |
| *`agent_credential_bindings`* | Identity (data) / Runtime (use) | SPIFFE ID or public-key thumbprint registered for an agent |
| *`agent_delegation_grants`* | Access | "Agent A may act for user X" with scope, expiry, revocation |
| *`agent_tokens`* (issued-token register: `jti`, `cnf_jkt`, `act` chain, `exp`, status) | Runtime | Revocation, introspection and audit correlation |
| *`ssf_streams`* | Integration | SSF transmitter/receiver stream configuration, as a connection type |
| *`workflow_definitions`*, *`workflow_runs`* | Operations | Already planned (OPERATIONS-P0-09) |
| *`forms`*, *`email_templates`* | Operations | Request and lifecycle forms; branded notifications |

`certification_items` changes from agent-only to identity-generic
(`identity_id` NOT NULL, `agent_id` nullable, backfilled from `agents`) —
COMPLIANCE-P0-10. This is the only change to an existing column's nullability
proposed here, and it widens rather than narrows.

---

## 5. IGA design

### 5.1 Identity sources and the identity warehouse

**Goal.** One trusted record per person or thing, assembled from the systems
that are authoritative for each attribute, with every value traceable to its
source (NN #7: WonderID reconciles against the system of record rather than
overriding it).

**Design.**

1. **Sources are connections.** An HR system, directory, contractor system or
   CSV feed is a connection whose definition declares `identity_source` import
   capability. The existing `identity_sources` row becomes the *governance
   settings* of that connection: precedence, attribute authority, correlation
   rules, leaver strategy and the mass-change guard.
2. **Attribute authority, not source priority alone.** Each attribute names its
   authoritative source(s) in order (`department` from HR, `email` from the
   directory). Field provenance (0080) already stores the winning source per
   value; the reconciler applies authority per attribute.
3. **Run on schedule or on event.** Schedules move from "stored" to "run" by the
   existing connector-sync cron. Sources that push (SCIM receiver, RFC 9967
   events, webhook) apply changes as they arrive. Every run is staged, previewed
   and applied (0083 already does this for files).
4. **Correlation is deterministic first.** Order: immutable source id → employee
   number → verified email → composite rule. Below the configured confidence the
   record goes to Pending Matches; nothing is auto-merged on a fuzzy match
   (CLAUDE.md §17.6).
5. **Mass-change guard.** If a run would terminate or change more than the
   configured percentage of identities, it stops and asks for approval. This
   exists for leavers (0081) and extends to every attribute change.
6. **WonderID as source of record for some populations.** Contingent workers,
   volunteers and partner users often have no HR record. A tenant can make
   WonderID authoritative for an identity type: those identities are created
   through a registration or sponsor form (§5.10) and carry `source = wonderid`.
7. **Identity verification (optional, P2).** Before activating a self-registered
   or external identity, a verification step may be required. WonderID records
   the verification result from a connected verification provider; it does not
   do document checks itself.
8. **Classification.** New identities with an unknown type or no owner are
   listed on a classification queue (Onboarding area) until a person sets type,
   owner or sponsor. Unclassified identities cannot receive requested access.

### 5.2 Lifecycle: joiner, mover, leaver

**Goal.** Access follows the person's or thing's real status quickly enough to
pass an ITGC termination test, with humans approving what matters.

**Events** (existing in 0084): joiner, mover, leaver, rehire, conversion
(contractor → employee), manager change, leave of absence, return, cancellation.

**Lifecycle rules** (*new `lifecycle_rules`*, Identity):

| Rule kind | Trigger | Effect |
|---|---|---|
| Birthright | Identity becomes ACTIVE, or matches a condition (`department = Finance AND type = HUMAN`) | Assign access packages / business roles; ledger source `WONDERID_LIFECYCLE` |
| Mover | Attribute change matching a condition | Re-evaluate birthright: add new, schedule removal of no-longer-matching access after a grace period, open a targeted review of the rest (event-based micro-certification, §5.5) |
| Leaver | Lifecycle → LEAVE_PENDING / TERMINATED | Disable sign-in, disable or delete accounts per application policy, revoke access, transfer ownership of owned agents/identities/entitlements, notify the manager |
| Long leave | Leave flag set | Suspend non-essential access, restore on return |
| Expiry | `end_date` reached (externals, contractors) | Same as leaver unless the sponsor extends |
| Rehire | Previously TERMINATED identity reappears | Re-link old identity, do not restore old access, apply birthright |

Conditions use a small, typed expression language (attribute comparisons, `in`,
`and`/`or`/`not`) evaluated by code, versioned and simulated before publish.
A rule change shows *which identities would gain or lose what* before it can be
published (simulation, §5.4).

**Automation boundary (NN #15).**

- Birthright grants that the tenant pre-approved as a rule are an "explicitly
  approved automation path". Each rule's publication is itself approved under
  four-eyes.
- Leaver disables are automated when the tenant turns that on for an
  application (disable is reversible). Deletes stay a human-approved task.
- A per-application **termination SLA** (e.g. 24 hours) is tracked. Breaches
  are findings, and the SLA report is an ITGC artefact.

**Manager kill action.** A manager or access administrator can "disable all
access now" for an identity. It is one confirmed action that creates a leaver
plan: disable every account through connectors and suspend every agent the
person owns as sole owner.

### 5.3 Access requests and approvals

**Built.** Request policies, staged approval chains (manager, entitlement owner,
application owner, package owner, access managers), parallel and sequential
stages, four-eyes trigger, escalation and expiry, access packages, catalog.

**Additions.**

| Capability | Design |
|---|---|
| One request, many changes | A request is a *basket* of line items: add access, change account attributes, remove access, create or disable an account. Each line is approved on its own route; the request completes when every line is resolved. |
| Request for others, in bulk | Request policies already allow requests for others. Add bulk: the same basket for N identities, approved per identity. |
| Model after | "Give X the same access as Y": the basket is pre-filled with Y's *requestable* access, minus what X already has, minus anything SoD would block. |
| Catalog | Search across name, description, tags and owner; filter by job function (the requester's department/title), application, risk. Catalog visibility rules hide items with no owner or not requestable for the requester's organization. |
| Recommendations (deterministic) | "People like you have" ranks access held by ≥ N% of the requester's peer group (same department and title), computed by code. AI may phrase the explanation; it never decides (§17.1). |
| Risk-based routing | Risk of a line = max(entitlement privilege, application criticality, data classification, SoD result, identity risk). The request policy maps risk bands to routes: low → owner only, high → owner + access managers, critical → + security, mandatory justification. |
| Preventive SoD | Every line is checked against entitlement SoD (§5.6) at submission and again at approval. Outcome per rule: block, require mitigating control, add approval stage, warn. |
| Time-bound | Every line can carry an end date; policies cap the maximum. Expiry creates a removal task. |
| Approver delegation | ACCESS-P0-23: out-of-office and standing delegations of approval, request and administration rights, time-limited, audited, never to the subject of the request. |
| Approve from e-mail or chat | A signed, single-use, short-lived link opens the approval page with the decision pre-selected; the decision still needs the approver's signed-in session (no approval by unauthenticated link). |
| SLA and escalation | Existing escalation extends to n levels with per-stage SLAs and reminders. |
| Manual fulfilment | Lines whose application has no write capability become fulfilment tasks for the application's fulfilment group, which can be claimed, delegated or sent to an ITSM connector (ServiceNow, Jira, Zendesk) as a ticket whose status is read back. |
| Physical and non-IT assets | Out of scope for P0/P1. An access package can contain a "manual item" (a badge, a laptop) fulfilled as a task, which covers the common case without a separate asset model. |

### 5.4 Role and entitlement modelling

**Three kinds of role stay separate** (roadmap decision 2): Foundation `roles`
are WonderID permission roles; *business roles* are bundles of access granted to
identities; application roles stay entitlements.

**Entitlements.**

- Types come from the connector (group, role, permission, license, scope,
  tool permission). Hierarchy (*`entitlement_hierarchy`*) records "includes",
  so effective access and SoD see implied entitlements.
- Every entitlement has an owner, a privilege level, a data classification, a
  `requestable` flag and an optional *SOX-relevant* flag that drives
  certification scope and evidence retention.
- Ownerless entitlements are not requestable and are listed as a governance gap.

**Business and IT roles** (ACCESS-P0-21):

| Role type | Contains | Typical assignment |
|---|---|---|
| Enterprise / business | Other roles, access packages | Birthright rule on job, department, location |
| IT / technical | Entitlements across applications | Requested, or included in a business role |
| Application | Entitlements of one application | Requested |
| Agent role | Entitlements and tool permissions suitable for a class of agents | Through agent access packages (IDENTITY-P0-19) |

- **Lifecycle.** Draft → in review → published → deprecated → retired. Every
  publish is a new version. Two versions can be compared and an older one
  restored (as a new version).
- **Impact simulation.** Before publishing: who gains, who loses, which SoD
  rules newly fire, which certifications are affected.
- **Inherent SoD.** A role whose own contents violate a SoD rule cannot be
  published without a mitigating control.
- **ABAC with roles.** A role can carry an assignment condition (the same
  expression language as lifecycle rules) so membership is computed, not
  hand-maintained.

**Role mining (P1).** Bottom-up: cluster identities by shared entitlements
(deterministic algorithm, e.g. frequent itemsets), propose candidate roles with
coverage and outlier figures. Top-down: start from a department/title and show
the common entitlements. Usage (DID) data marks entitlements never used, so
mined roles exclude dead access. Candidates are proposals; a person publishes.

**Rule mining (P1).** The same analysis applied to attributes: "92% of
identities with `department = Finance` hold package *Finance Basic*" →
proposed birthright rule.

### 5.5 Access certification

**Goal.** Periodic and event-driven reviews of every identity type that stand up
in a SOX ITGC test.

**Campaign types** (COMPLIANCE-P0-10, extending today's agent-only campaigns):

| Type | Reviewer | Population |
|---|---|---|
| Manager | Each identity's manager | All access of direct reports |
| Entitlement owner | Entitlement owner | Holders of owned entitlements |
| Application owner | Application owner | Accounts and access on the application |
| Role membership | Role owner | Identities assigned the role |
| Role content | Role owner | Entitlements inside the role |
| Privileged access | Security or application owner | Privileged accounts and admin entitlements |
| Service account / machine identity | Owner | Machine identities and their access |
| AI agent (exists) | Agent business owner | Agent access against its contract |
| External identity | Sponsor | External identities: continue, extend, end |
| WonderID administrators (COMPLIANCE-P0-11) | Security owner | WonderID's own role assignments |
| Event-driven (micro) | Manager or owner | Only the access affected by a mover event, a new high-risk grant or an SoD exception nearing expiry |

**Scoping.** Filter by organization, application, entitlement, risk; include
only direct assignments or also inherited ones; include only outliers against
the peer group; exclude access granted in the last N days.

**Reviewer experience.** Each item shows: what the access is, how it was granted
(ledger source), when it was last used (DID), how common it is in the peer group,
SoD conflicts, risk. Decisions: keep, revoke, change end date, reassign,
consult (ask someone without delegating the decision). Bulk decisions are
allowed only on items with the same recommendation and are recorded per item.

**Reviewer independence.** No self-review: if the reviewer is the subject or
holds the access through the same request, the item routes to the reviewer's
manager or the fallback reviewer (existing self-review check extended to all
types).

**Closed loop.** Revoke creates a provisioning plan (§5.8). The item is
*closed* only when the connector confirms removal (or the fulfilment task is
completed with evidence). Campaign reports show decided, remediated and
remediation-overdue separately.

**Evidence (SOX).** For each campaign WonderID stores:

1. the population query, its parameters, the extraction time and record counts,
   and a reconciliation of those counts to the latest connector import
   (completeness and accuracy of company-produced information, AS 1105);
2. the snapshot each reviewer saw (existing 0046);
3. every decision with reviewer, time, rationale;
4. remediation evidence per revoked item;
5. a signed campaign close record, in the hash-chained audit log.

**Recommendations.** Deterministic: unused for N days → suggest revoke;
held by fewer than X% of peers → flag outlier. AI may summarize the item for
the reviewer, labelled as AI-generated.

**Archiving.** Closed campaigns move to read-only storage after the retention
window set in Global Configuration; evidence is kept per plan (seven years for
Enterprise, CLAUDE.md §18.4).

### 5.6 Separation of duties

Today WonderID has *action* SoD (the same person may not perform two
conflicting governance actions). This section adds *access* SoD.

**Model** (business-process-first, so rules stay readable):

```text
Risk ("Create vendor and pay vendor")
  └─ conflicts between Business functions ("Maintain vendor master", "Release payments")
        └─ each function = expression over entitlements, possibly across applications
              e.g.  (SAP:FK01 OR SAP:XK01) AND NOT SAP:display_only
```

- Function expressions support AND, OR, NOT and *exclude* (an entitlement that
  neutralizes the function, such as a read-only flag). Entitlement hierarchy is
  expanded before evaluation.
- **Rulesets** group risks (e.g. "Financial close", "Procure to pay"), have an
  owner, a version and a control mapping (SOX ITGC, internal policy).
- **Criticality** per risk: low, medium, high, critical.
- **Fine-grained SoD** (P1) applies the same model to transaction or permission
  level entitlements imported from ERP connectors (SAP, Oracle, Workday). The
  model is the same; only the connector supplies finer entitlements.

**Where it runs.**

| Mode | When | Result |
|---|---|---|
| Preventive | Request submit and approve, role publish, birthright rule publish, emergency access | Block / require mitigating control / extra approval / warn, per risk criticality |
| Detective | Nightly and after each import | `sod_violations` with status open, mitigated, remediated, accepted |
| Simulation | Before a role or rule change | What would newly violate |

**Mitigating controls library.** A control has an owner, a description, a test
frequency and evidence. A violation can be *mitigated* by linking a control
with an end date; the control owner certifies it periodically. Expiry reopens
the violation.

**Actual vs potential.** When DID data exists for both functions, a violation is
marked *exercised* if the identity actually used both sides in the period.
Exercised violations sort first.

**Remediation advice.** For a violation, the workbench shows the smallest change
that clears it: which entitlement to remove, and whether it comes from a role
(fix the role) or a direct grant (revoke the grant). Removing access still goes
through approval and provisioning.

**Alerts.** Risk and control owners are notified on new high/critical violations
and on mitigation expiry.

**Starter rulesets.** WonderID ships a small, original set of generic risks
(e.g. "maintain vendor + approve payment", "create user + approve access",
"develop code + deploy to production") that customers adapt. Vendor or auditor
rulesets are imported through CSV as data; none are copied.

### 5.7 Privileged and emergency access (governance, not vaulting)

WonderID governs privileged access without becoming a PAM vault (CLAUDE.md §10).

| Capability | Design |
|---|---|
| Privileged inventory | Accounts typed privileged/shared/service (built) plus entitlements with `privilege_level = admin`. Shown on Control Center. |
| Ownership of shared and service accounts | Every privileged, shared or service account must have an owner identity; missing owner is a finding. |
| Just-in-time elevation | A request line with a short duration (minutes to hours) for an eligible entitlement. Approved → connector grants → expiry revokes → ledger source `EMERGENCY_ACCESS` or `JIT`. |
| Emergency ("break-glass") access | *`emergency_access_sessions`*: an eligible person checks out a pre-approved emergency identity or entitlement with a reason; a short approval (or post-hoc approval if the policy allows) applies; access is granted through the connector for the window; on check-in or expiry it is removed. |
| Post-use review | After check-in, the activity captured for the session (from the target's logs through a connector) goes to a reviewer who signs off or raises a finding. |
| SoD on emergency use | Preventive SoD runs at check-out; conflicts need explicit acknowledgement. |
| Credentials | When the target requires a password checkout, the connector calls the customer's PAM (CyberArk, OpenBao/HashiCorp Vault) to release it to the user *in the PAM's own interface*. WonderID never sees, stores or displays the secret (NN #10). |
| Session recording | Out of scope; link to the PAM's recording as evidence. |

### 5.8 Connectors and provisioning

**Built.** Declarative connector definitions run by one engine, a connector
gateway with SSRF guard, metering and rate limits, five drivers, inbound
receivers, CSV, the capability model with six write flags, and an idempotent
write ledger with no caller.

**Provisioning pipeline** (INTEGRATION-P0-13):

```text
Trigger (approved request line | lifecycle rule | certification revoke | finding remediation | expiry)
  → Plan      : resolve identity → account(s) on target; compute minimal operations; attach authorization ref
  → Pre-check : connection healthy? capability declared AND enabled for tenant? SoD still clean?
                authorization still valid (not revoked/expired)? mass-change guard?
  → Execute   : executeConnectorWrite() with idempotency key = hash(plan id, operation, target)
  → Verify    : read back from the target (or wait for the next import) and compare
  → Record    : ledger entry (source + authorization), audit event, task status; notify requester
```

- **Operations** (connector-level verbs a definition may implement): create
  account, update account, enable, disable, delete, add access, remove access,
  update identity attributes on the target, request password reset (target-side
  reset flow, never a plaintext password in WonderID), create group, update
  group, change group membership/owners, create ticket, read ticket status,
  grant and revoke emergency access.
- **Binding context.** A write operation in a definition is a template over a
  *fixed, documented context*: `identity` (attributes), `account`,
  `entitlement` (+ parent/child), `application`, `connection`, `request`
  (requested attributes, justification, end date), `manager`, `owners`
  (ordered), `task` (ids, idempotency key). Secrets are never part of the
  context; the driver injects credentials after templating so a template cannot
  echo them. Templates are validated at definition save time against the
  context schema.
- **Retries and failure.** Bounded retries on idempotent operations only
  (CLAUDE.md §18.5); a failed task is visible with its error class and can be
  retried by a person or turned into a manual task. Nothing is reported done
  until verified (§17.5).
- **Manual and ticketed fulfilment.** For applications without write capability
  the plan becomes a task (claim, delegate, complete with evidence) or an ITSM
  ticket through a connector, whose status is polled.

**SCIM.**

- **Client (outbound).** A `scim` driver implements the write verbs over RFC 7644
  (`POST /Users`, `PATCH` with `PatchOp`, `DELETE`, group membership by PATCH),
  honours `If-Match`, uses `/Bulk` when advertised, discovers capability from
  `/ServiceProviderConfig` and `/Schemas`, pages by cursor (RFC 9865) when
  offered.
- **Receiver (inbound).** A SCIM service at
  `/api/connect/v1/<connection>/scim/v2/{Users,Groups,ServiceProviderConfig,Schemas,ResourceTypes}`
  lets an HR system or IdP push identities to WonderID. It is a receiver of a
  `scim-source` connection (NN #20), authenticated with the connection's
  credential, writing to the staging pipeline of §5.1 rather than directly to
  `identities`.
- **Events.** RFC 9967 SETs accepted on the same receiver family for
  push-based change notification.

**Reconciliation.** Full and incremental imports per connection; account
correlation (built); drift detection compares what the target says (CAN) with
what the ledger authorized (SHOULD) and classifies differences: authorized,
legacy, unproven, rogue (ACCESS-P0-25), raising findings (RISK-P0-13).

**Connector catalogue priority.** Ordered by how often enterprise customers need
them and by what the P0 scenario needs:

1. Directories and IdPs: Microsoft Entra ID, Active Directory (LDAP driver
   exists), Okta, Google Workspace.
2. HR: Workday, SAP SuccessFactors, generic SCIM and CSV (exist).
3. Cloud: AWS IAM / Identity Center, Azure RBAC, GCP IAM (accounts, roles,
   policies, service principals, keys — also the main machine-identity source).
4. Business apps: Salesforce, ServiceNow, SAP, Snowflake, GitHub, Atlassian,
   Slack, Microsoft 365.
5. Security: CyberArk and OpenBao/HashiCorp Vault (privileged accounts and
   secret metadata, never values), SIEM export.
6. Generic: SCIM, REST (http driver), SQL, LDAP, CSV/SFTP/S3 files, PowerShell
   via the relay (§5.8.1).

#### 5.8.1 Reaching systems inside a customer network: WonderID Relay

Many targets (Active Directory, on-premises databases, mainframe security) are
not reachable from the internet. The common market approach is a network tunnel
that routes private address ranges from the vendor cloud into the customer
network. WonderID takes a narrower design that fits serverless hosting and
least privilege:

- **Outbound only.** A small relay process runs in the customer network and
  makes outbound HTTPS calls to its connection's receiver
  (`/api/connect/v1/<connection>/relay/…`). No inbound port, no VPN, no route
  into the customer network from WonderID.
- **Job pull, not packet routing.** The relay long-polls for *connector jobs*
  (an import page, a write operation) addressed to it, runs them with a local
  driver (LDAP, SQL, PowerShell, file), and posts signed results. WonderID can
  only ask for operations the connection's definition declares; it can never
  open an arbitrary socket in the customer network.
- **Credentials stay local, optionally.** Target credentials may be held only by
  the relay (customer-managed) so they never reach WonderID.
- **Strong relay identity.** The relay authenticates with a private key
  generated on the host (DPoP-bound tokens or mTLS); its public key is enrolled
  once with an approval. Keys rotate on a schedule; a compromised relay is
  revoked by disabling the connection.
- **Availability.** Several relays can serve one connection (active–active job
  claiming with leases); jobs are idempotent (§5.8), so a relay that dies
  mid-job is safe to retry.
- **Monitoring.** Last heartbeat, version, job latency, certificate/key expiry,
  backlog. Alerts on missed heartbeats and keys within 30 days of expiry,
  throttled.
- **Allowlisting.** Optional customer egress allowlist of WonderID's host; the
  relay refuses to talk to any other host.

This is a framework transport, so it stays inside NN #20: the relay is part of
a connection, and product modules still only read what the framework stored.

### 5.9 Passwords and credentials for target systems

WonderID is not an IdP or a vault, and must never reveal a secret (NN #10).
Therefore:

- **Self-service password for WonderID sign-in** stays with Supabase Auth
  (existing), moving toward passkeys (FOUNDATION-P0-21).
- **Target-account password reset** is a *connector operation that triggers the
  target's own reset* (e-mailing the user a reset link, or setting
  "must change at next logon" with a temporary secret delivered by the target).
  WonderID records that a reset happened, never the value.
- **Password policies** for target accounts are reported as posture (from
  connector metadata), not enforced by WonderID.
- **Machine credentials** (API keys, certificates, client secrets, SSH keys) are
  inventoried as metadata (owner, created, last rotated, expiry, scope) from
  cloud and vault connectors; rotation is requested through the owning system.

Whether WonderID should offer a vault-backed password reset that shows a new
password once is decision D5 (§11); the recommendation is no.

### 5.10 Workflow, forms and orchestration

**Workflow engine** (OPERATIONS-P0-09, Operations): declarative definitions
of typed nodes — *start (trigger)*, *condition*, *approval* (delegates to the
Access approval engine), *task* (human work item), *connector operation*
(delegates to the provisioning pipeline), *notification*, *wait / timer*,
*parallel / join*, *call sub-workflow*, *end*. Each node is idempotent and
resumable; a run records every step. Workflows never evaluate policy
themselves; they call Access policy evaluation (roadmap decision 3).

**Where workflows plug in.** Request approval routes (beyond the built-in
routes), lifecycle events, external-identity onboarding, application
onboarding, emergency access, certification remediation.

**Forms.** A form is a versioned list of typed fields bound to identity or
request attributes, with validation and visibility conditions. Used for
request justifications, registration of externals and contractors, application
onboarding questionnaires and agent onboarding.

**Jobs.** The existing cron jobs (connector syncs, access governance,
certifications, privacy) become visible on one *Jobs* page: schedule, last run,
next run, outcome, run-now (permission-gated), history. No new job runner.

### 5.11 Audit, evidence, reporting and intelligence

**Built.** Hash-chained append-only audit with integrity check, exports, eight
reports, control frameworks, record provenance.

**Additions.**

- **Audit record content** aligned to AU-3 and the AIMS draft: actor, on-behalf-of
  subject (delegation), target, action, outcome, tenant, correlation id,
  *transaction id* (`txn`), *token id* (`jti`) for agent actions, policy and
  rule versions that decided.
- **Evidence packs per control.** A control (e.g. SOX ITGC "timely
  termination") links to the query that produces its evidence (termination SLA
  report for the period, with population counts). Auditors get a packet per
  control and period.
- **Reports** (added): terminated-with-active-access, orphan and dormant
  accounts, SoD violations by risk, privileged access, role coverage, request
  cycle time, certification completion and remediation, agent credential age,
  delegation grants.
- **Intelligence.** Identity risk score per identity (deterministic factors:
  privilege, outliers, SoD, dormant access, rogue access, credential hygiene),
  peer-group outlier analysis, identity graph view (OPERATIONS-P0-10).
- **Identity security posture.** A Control Center page of misconfigurations
  across connected systems: ownerless privileged accounts, accounts without MFA
  (from IdP connectors), stale keys, dormant admins, external identities past
  contract end.
- **Archival.** Read-only export of closed campaigns, old runs and old runtime
  events per retention policy, downloadable as files.

---

## 6. Agent ID design

### 6.1 The agent is a non-human identity with a human owner

**Already true.** Every agent is an `agents` row linked 1:1 to an
`identities` row of type AI_AGENT; registration requires purpose, source
system and an active business owner and technical owner.

**Additions.**

1. **Sponsor.** An accountable executive sponsor distinct from the owners
   (IDENTITY-P0-19). If the sole owner leaves, the leaver plan (§5.2) moves the
   agent to RESTRICTED and assigns the sponsor until a new owner accepts.
2. **Identifier.** Each agent gets a stable, tenant-scoped, SPIFFE-compatible
   identifier: `spiffe://<tenant-trust-domain>/agent/<agent-id>` (WIMSE
   identifier). The trust domain is derived from the tenant, never supplied by
   the client. This is a *name*; it does not require the customer to run SPIRE.
3. **Registration channels.** UI, API, connector discovery (cloud AI platforms,
   MCP registries), A2A Agent Cards, SCIM `/Agents` (draft-wzdk) import. All
   land in the discovery inbox; nothing becomes REGISTERED without the
   required owners.
4. **Agent access packages.** Agents receive access the same way humans do:
   through requests and access packages scoped to AI_AGENT, approved by the
   owners of the resources. The contract (SHOULD) limits what may be requested.
5. **Lifecycle policies.** Contract expiry, certification due, owner left,
   inactivity → state changes (CERTIFICATION_DUE, RESTRICTED, SUSPENDED) by rule,
   each audited.

### 6.2 Scoped, short-lived credentials

**Today.** Long-lived per-agent API keys. Per AIMS, static keys are an
antipattern; they remain only as a migration path.

**Design: the WonderID gateway token service.** A token endpoint on the agent's
`runtime-gateway` connection issues **access tokens for the WonderID Runtime
Gateway audience only** (and for MCP servers that trust WonderID, D2).

| Step | Mechanism |
|---|---|
| Agent proves who it is | One of: (a) private-key JWT client assertion (RFC 7523) with a key registered in *`agent_credential_bindings`*; (b) mTLS client certificate (RFC 8705); (c) SPIFFE JWT-SVID from the customer's SPIRE, trusted by federating the customer's trust bundle; (d) a cloud workload identity token (AWS/GCP/Azure) via a connector; (e) legacy API key (deprecated, short exchange only). |
| Token is sender-constrained | DPoP (RFC 9449): the token carries `cnf.jkt`; every gateway call includes a fresh proof (`htm`, `htu`, `iat`, `jti`, `ath`, server `nonce`). |
| Token is narrow | `aud` = the gateway (RFC 8707); `authorization_details` (RFC 9396) list allowed tool/resource/action groups derived from the contract ∩ effective access. |
| Token is short | Default 5 minutes, configurable 1–15 minutes in Global Configuration; no refresh token; re-issue on demand. |
| Token is registered | *`agent_tokens`* stores `jti`, `cnf_jkt`, `act` chain, `exp`, status (for revocation, introspection and audit). Only hashes or ids, never the token itself. |

**Rules.**

- The LLM never holds the credential; the agent runtime (or a sidecar) does.
  This is documented guidance and checked in agent onboarding.
- Downstream tools receive *their own* tokens, never the agent's gateway token
  (MCP: no token passthrough).
- Issuance fails closed: agent not ACTIVE, contract missing/expired, owner
  missing, kill switch on, credential binding revoked → no token.
- API keys: new keys get a mandatory expiry (≤ 90 days by default); key
  creation warns that DPoP tokens are preferred; a per-tenant setting can
  disable API keys once agents have moved.

### 6.3 Delegation chains ("agent acting for user X")

**Model.** A delegation is explicit, scoped, time-limited and revocable.

1. **Delegation grant** (*`agent_delegation_grants`*): user X allows agent A to
   act for X within scope S until T. Created by X (self-service consent) or by
   an administrator for a group, and only if A's contract lists X (or X's group)
   in `approved_users` / `approved_delegators`. Grants are listed on X's
   My Access page and revocable in one click.
2. **Token exchange** (RFC 8693) at the gateway token service:
   `subject_token` = X's token (from the customer IdP, validated against the
   tenant's SSO configuration), `actor_token` = A's own token. The issued token
   has `sub` = X, `act` = {`sub`: A}, and `authorization_details` =
   (X's effective access) ∩ (A's contract) ∩ (grant scope).
3. **Chains.** If agent A delegates to agent B (orchestration), B exchanges A's
   delegated token as `subject_token` with its own `actor_token`; the result
   nests `act` (`{sub: B, act: {sub: A}}`). Depth is limited (default 2,
   configurable up to 4). Each hop can only narrow scope, never widen it.
   B must be allowed by A's contract (`delegates_to` relationship, 0017).
4. **Decisions use the whole chain.** Per RFC 8693 only the outermost actor is
   "current", but WonderID's policy checks every link: the subject X must still
   hold the access, every actor must be ACTIVE and permitted for the action, and
   the grant must be valid. Any broken link → DENY.
5. **No impersonation.** Tokens without `act` for a user subject are never
   issued to agents.
6. **Human approval in the loop.** When the decision is REQUIRE_APPROVAL, the
   gateway returns a pending decision id; WonderID asks X (or the resource
   owner, per contract) on a separate channel — in-app or a CIBA-style
   back-channel request with a binding message describing the action — and the
   agent polls or receives a callback. Approval issues a single-use,
   action-bound token (`authorization_details` naming exactly that action),
   valid for minutes. This replaces today's notify-only behaviour.

### 6.4 Policy check before every action

**Today.** A pure, fail-closed pipeline returns ALLOW / DENY /
REQUIRE_APPROVAL / ALLOW_WITH_RESTRICTIONS, explained step by step, stored
immutably. Default is OBSERVE_ONLY.

**Additions.**

| Change | Design |
|---|---|
| AuthZEN interface | Expose the same engine as an AuthZEN 1.0 PDP on the runtime-gateway connection: `POST …/access/v1/evaluation`, `…/evaluations` (batch, with `deny_on_first_deny`), `…/search/action` (what may this agent do on this resource?), and discovery metadata. Subject = agent (with `act`/delegation context in `properties`), resource = tool/MCP server/data resource, action = name, context = environment, amount, session, `txn`. Existing endpoints stay as aliases. |
| Delegation step | New pipeline step after identity: validate the delegation chain (§6.3). |
| Token step | Validate the DPoP proof, `jti` not replayed, token not revoked, `authorization_details` cover the action. |
| Enforcement rollout | Per agent, not only per tenant: OBSERVE → *shadow* (decisions computed and shown, still allowed) → ENFORCE. A tenant-level default plus per-agent overrides; promoting an agent to ENFORCE is an approved action. The UI shows "would have denied" counts during shadow. |
| Latency budget | p95 ≤ 50 ms for a cached decision: contract, effective access and policies cached per tenant with short TTL and version-based invalidation (CLAUDE.md §14 tenant-partitioned caches). |
| Restrictions honoured | ALLOW_WITH_RESTRICTIONS returns obligations (read-only, max amount, record/field scope, expiry) the PEP must apply; PEPs that cannot apply an obligation must treat it as DENY. |
| Approval resume | REQUIRE_APPROVAL produces a pending decision that resumes after approval (§6.3 step 6). |

The engine stays deterministic (NN #9). An AI component may *propose* a policy
(e.g. from observed DID), which a person reviews and publishes.

### 6.5 Kill switch and revocation

**Levels** (existing controls extended):

| Level | Effect inside WonderID | Propagation outside |
|---|---|---|
| Single action / tool | Tool or MCP-server suspension (exists) | MCP server connection told to deny that tool |
| Agent | Agent → SUSPENDED; all its tokens marked revoked; API keys revoked; delegation grants paused | CAEP `session-revoked` and `credential-change` to subscribed receivers; connector disables the agent's service accounts / OAuth clients on targets (if write enabled) |
| Delegation | Grant revoked | Tokens carrying that grant fail at the next decision |
| Owner / person | Leaver plan: every agent where the person is sole owner → RESTRICTED | As per agent level for suspensions |
| Tenant | Kill switch (exists): every runtime decision DENY | CAEP to all receivers |

**Speed.** Because tokens live ≤ 15 minutes and every gateway call checks the
token register and the agent state, a kill takes effect at the next call
(target ≤ 5 seconds inside WonderID). Outside WonderID it depends on the
receiver honouring SSF events, which is why short token lifetimes matter.

**Safety.** Suspending is one confirmed action with a reason (NN #11). Restoring
is staged (SUSPENDED → RESTRICTED → ACTIVE) and needs approval (built). A risk
finding of critical severity can *propose* suspension; whether it may suspend
automatically is decision D4 (§11).

**SSF as a connection type.** WonderID as SSF *transmitter* (sending CAEP/RISC
events to IdPs, SaaS and gateways) and *receiver* (accepting `credential-compromise`,
`account-disabled`, `risk-level-change` from the IdP or EDR, which feed lifecycle and
risk). Both are connections (NN #20).

### 6.6 Full audit trail

Every agent action produces one immutable runtime decision and one audit event
carrying: tenant, agent id and identifier, token `jti`, DPoP key thumbprint,
delegation chain (`sub` and each `act`), resource, action, context summary,
decision, the policy and contract versions that decided, obligations, latency,
correlation id and `txn`, outcome reported back by the PEP (when available).
Records are in the hash-chained audit log (0104). The SHOULD / CAN / DID
comparison (built) gains a *delegated-by* dimension: "what did agent A do for
user X".

### 6.7 Agent risk and posture

Existing deterministic risk rules extend with: credential hygiene (still on
API keys, key age, too many active keys), delegation breadth (number of users,
scope), chain depth used, denied-action rate in shadow mode, unapproved tool use,
contract expiry. These feed the rogue-agent view and certification
recommendations.

---

## 7. Cross-cutting: security, tenancy, audit, control mapping

### 7.1 Non-negotiables this design touches

| NN | How the design keeps it |
|---|---|
| #1, #2, #4, #14 (§14) | Every proposed table is tenant-scoped with RLS and an isolation test. Tenant comes from `getTenantContext()`; for agent tokens, from the connection the request arrived on. Caches for decisions are keyed by tenant. |
| #5, #6 | Agents stay canonical in Identity; business roles in Access; provisioning in Integration; workflows in Operations. Modules call each other's published services. |
| #8 | SHOULD (requests, roles, contracts, delegation grants), CAN (connector imports), DID (runtime and usage) stay separate tables and computations. |
| #9, #19, §17 | Policy, SoD, risk, routing, correlation, mining and recommendations are deterministic code. AI drafts, explains and proposes, labelled as AI. |
| #10 | No plaintext secret is stored, shown or logged: target credentials stay in the customer's PAM or on the relay; agent tokens are stored as ids/hashes; templates cannot reference secrets. |
| #11 | Every change (grant, revoke, rule publish, token issue, delegation, kill switch) writes an audit event with actor, on-behalf-of, target, outcome and correlation. |
| #12 | Writes happen only when the definition declares the operation *and* the tenant enabled it for that connection. Read-only connections never write. |
| #13 | All schema changes are additive migrations, numbered in creation order. |
| #15 | Consequential grants and revocations need human approval, except rules the tenant explicitly approved as automation (birthright, leaver disable, expiry removal), each of which was itself approved under four-eyes. |
| #16 | Peer analytics and mining run within one tenant only. No cross-tenant models. |
| #17 | SCIM, OAuth and AuthZEN are interface mappings; the internal model names no vendor. |
| #20 | SCIM receiver, SSF, relay, token service and AuthZEN endpoints are all receivers of a connection under `/api/connect/v1/<connection>/…`. Provisioning is a driver operation. |

### 7.2 Threats specific to this design

| Threat | Control |
|---|---|
| Stolen agent token replayed | DPoP binding; `jti` replay cache; ≤ 15 min lifetime; token register for revocation |
| Prompt injection makes an agent request extra access | Token scope = contract ∩ effective access ∩ delegation; the PDP never takes instructions from content; approvals go to humans on a separate channel with a binding message |
| Confused deputy through delegation | Every link of the `act` chain re-checked; scope only narrows; depth limit |
| Mass deprovisioning from a bad HR file | Mass-change guard; staged preview; leaver delete is never automatic |
| Template injection in connector operations | Fixed binding context; values escaped per target format by the driver; templates validated at save |
| Relay compromise | Relay can only run declared operations; enrolment approved; key rotation; revoke by disabling the connection |
| Approval by forwarded e-mail link | Link only opens the page; decision needs the signed-in approver |
| Self-approval / self-review | Database four-eyes trigger (built) extended to delegations, rule publication, certification items |

### 7.3 Audit evidence for SOX and similar regimes

| ITGC area | WonderID evidence |
|---|---|
| New access is approved | Request, approval chain with approvers and times, provisioning task, verification, ledger entry |
| Timely termination | Termination SLA report: HR termination time → disable time per account, population counts reconciled to the HR import |
| Periodic access review | Campaign population with extraction query and counts, reviewer snapshots, decisions, remediation proof, close record |
| Privileged access | Privileged inventory, owner, privileged review campaign, emergency sessions with post-use review |
| Segregation of duties | Rulesets with version history, violations, mitigating controls and their tests |
| Change management of the IGA system itself | Versioned configuration, rule and role publish approvals, hash-chained audit |

Control mappings remain evidence for auditors, never a compliance claim
(CLAUDE.md §10 item 10, §18.4).

### 7.4 NIST SP 800-53 mapping

| Control | WonderID capability |
|---|---|
| AC-2 a–l | Identity types, owners, sources, lifecycle rules, approvals, reviews, leaver handling |
| AC-2(1), (4) | Automated lifecycle and provisioning; automatic audit of account actions |
| AC-2(2), (3) | Time-bound and emergency access expiry; dormant and expired account disable |
| AC-2(7) | Privileged accounts inventory, ownership, review |
| AC-2(12), (13) | DID-based atypical usage; disable on high-risk signal (SSF receiver) |
| AC-3(2), (8), (13) | Four-eyes approvals; revocation propagation; ABAC conditions |
| AC-5 | Access SoD (§5.6) and action SoD (built) |
| AC-6(5), (7), (9) | Privileged restriction; certification; privileged-use logging via connectors |
| AC-24 | Runtime PDP before every agent action; AuthZEN interface |
| IA-4, IA-5 | Identifiers (incl. SPIFFE-compatible for agents); credential lifetime, binding, rotation evidence |
| IA-9 | Agent and relay authentication (key, mTLS, SVID, DPoP) |
| AU-2, AU-3, AU-9, AU-10 | Audit content, hash chain and append-only, delegation chain as identity association |

---

## 8. Administration and experience

The current sidebar areas (Home, Intelligence, Onboarding, Control Center,
SOD, Certifications, AI Agents, Admin — CLAUDE.md §13) already match the
information architecture this design needs. New capabilities land as pages in
existing areas; no new area is proposed.

| Capability | Where | Design |
|---|---|---|
| Home | Home | Pending approvals, reviews and tasks; my recent requests; KPIs chosen per tenant (pending reviews, pending approvals, overdue tasks); an optional admin banner (EXPERIENCE-P0-19). |
| My Access | Home › My Access | What I have and why (ledger), request access, my delegations given to agents, my delegates. |
| Tasks | Home | One inbox for approvals, reviews, fulfilment tasks and lifecycle tasks, with claim and delegate. |
| Identity repository | Admin | Identities, Accounts, Entitlements, Roles, User Groups, Organizations, External organizations. Static and rule-based user groups. |
| Policies | Admin › Policies | Lifecycle rules, request policies, SoD rulesets, authorization policies, agent runtime policies — each with simulation and versioned publish. |
| Forms | Admin | Form designer (§5.10); named value lists reusable across forms. |
| Workflows | Admin | Workflow designer and runs (OPERATIONS-P0-09). |
| Jobs | Admin | All scheduled jobs: schedule, last/next run, run now, history (§5.10). |
| Global Configuration | Admin (built) | Each new setting is added to `lib/config/registry.ts` only with the code that reads it (CLAUDE.md §19.11). Candidates: token lifetime, delegation depth, termination SLA, review retention, recommendation peer threshold. |
| Email templates | Admin › Settings | Per-notification templates with a fixed variable list, preview and versioning. |
| Labels and branding | Admin › Settings | Already partly built (branding). Label overrides per tenant for terms such as "Application". |
| Administrative roles | Admin › Users & Permissions (built) | WonderID permission roles, scoped assignments, delegated administration by organization (built in 0099/0100). |
| Configuration promotion | Admin | Export a set of configuration objects (policies, roles, forms, workflows, definitions) as a signed bundle, diff it against the target tenant, import with approval. Replaces a "package transport" with diff-first promotion. |
| Archive | Admin › Compliance | Download archived records as files. |
| Logs and audit | Intelligence › Audit Trail (built) | Plus e-mail delivery history per notification. |
| Profile menu | Header | Recent sign-in activity, my downloads (large exports run in the background, notify when ready), language, notification preferences, sign out. |
| Menu search | Sidebar (built) | Searches menu items only. |

Every page follows §19.5: one primary action; settings folded.

---

## 9. Modifications required to the current implementation

Grouped by owning module. "Existing story" means the change is already on the
roadmap; "New" means a story to add to that module's backlog when the owner
approves this design. No module edits another's code (NN #18).

### Foundation (01)

| Change | Story |
|---|---|
| Permission keys for new capabilities (roles, SoD, lifecycle rules, provisioning, delegation, emergency access, agent tokens, relay enrolment), added to the catalogue migration and `lib/shared/types` | New (with each feature) |
| Published contract types for delegation context and token claims in `lib/shared/types` | New |
| Passwordless (WebAuthn) | FOUNDATION-P0-21 |

### Identity (02)

| Change | Story |
|---|---|
| Non-human identities from accounts: owner from source or unowned queue; agent accounts linked by declared identifiers | IDENTITY-P0-20 (F1) |
| Finish identity detail tabs | IDENTITY-P0-17 |
| Lifecycle rules (birthright, mover, leaver, expiry, long leave) with simulation and four-eyes publish; manager "disable all access" | IDENTITY-P0-18 (finish) + New |
| External organizations, sponsor re-attestation, invitation/registration flow | New (P1) |
| Agent sponsor, onboarding journey, agent access packages, lifecycle policies | IDENTITY-P0-19 |
| Agent identifier (SPIFFE-compatible), `agent_credential_bindings` | New |
| Discovery from A2A Agent Cards and SCIM `/Agents` | New (P1) |

### Integration (03)

| Change | Story |
|---|---|
| Staging reflects the source: run tracking, missing-at-source after complete full runs, mass-missing guard | INTEGRATION-P0-18 (F1) |
| Scheduled import and promotion pipeline; run identity-source schedules; run now | INTEGRATION-P0-19 (F1), INTEGRATION-P0-08 (finish) |
| Native SCIM/REST pulls | INTEGRATION-P0-08 (finish) |
| Write operations in drivers (http, ldap, sql, scim), binding context, provisioning pipeline, verification, manual and ITSM fulfilment | INTEGRATION-P0-13, INTEGRATION-P0-11 (finish) |
| SCIM driver (client) and SCIM receiver (server) with RFC 9967 events | New |
| WonderID Relay (outbound job-pull transport) | New |
| SSF transmitter/receiver connection type | New (P1) |
| Connectors: Entra ID, Okta, Google Workspace, Workday, AWS, Azure, GCP, ServiceNow (ticketing), CyberArk/Vault metadata | New (one story each, P0 for Entra + one HR + AWS) |
| Gateway token service and AuthZEN receivers on the runtime-gateway connection (transport); decision logic stays in Access/Runtime | New |

### Access (04)

| Change | Story |
|---|---|
| Business/IT roles, hierarchy, versions, simulation, ABAC membership | ACCESS-P0-21 |
| Entitlement hierarchy; SoD business functions, risks, rulesets, preventive + detective + simulation, mitigating controls, exercised flag | ACCESS-P0-22 + New (P1 library and workbench) |
| Delegations (approval, request, admin, on-behalf); move pending items to the delegate when delegation starts | ACCESS-P0-23 |
| Request baskets (multi-line, remove/modify), bulk, model-after, peer recommendations | New |
| Entitlement and access-grant reconciliation from connectors (preview, apply, removed at source) | ACCESS-P0-27 (F1) |
| Imported access classification (authorized, legacy baseline, unproven, rogue) and drift findings | ACCESS-P0-25 (F1) |
| Approved requests become pending grants, verified by reconciliation | ACCESS-P0-28 (F2) |
| Fulfilment tasks (claim, complete, SLA, auto-close on reconciliation) | ACCESS-P0-29 (F2) |
| Remove-access and account requests | ACCESS-P0-30 (F2) |
| Requests for non-human identities, AI agents within their contract | ACCESS-P0-31 (F2) |
| Time-bound access with expiry tasks | ACCESS-P0-32 (F2) |
| Emergency/JIT access sessions | New (P1) |
| Agent delegation grants; delegation and token steps in the runtime decision pipeline; AuthZEN mapping; per-agent shadow/enforce mode | New |
| Role and rule mining | New (P1) |

### Runtime (05)

| Change | Story |
|---|---|
| Token register (`agent_tokens`), DPoP proof validation and replay cache, token issuance and exchange logic | New |
| Approval resume for REQUIRE_APPROVAL (pending decision → approval → action-bound token) | New |
| Kill switch propagation: revoke tokens and keys on suspend; emit SSF events through the Integration connection | New |
| Audit records with `jti`, `cnf_jkt`, `act` chain, `txn` | New |

### Risk (06)

| Change | Story |
|---|---|
| Rogue access management | RISK-P0-13 |
| Identity risk score for all identity types; new agent factors (credential hygiene, delegation breadth) | New |
| Propose suspension on critical findings (automatic only if D4 approves) | New |

### Compliance (07)

| Change | Story |
|---|---|
| Identity-generic certification items (`identity_id`), all campaign types, consult, scoping filters, micro-certifications | COMPLIANCE-P0-10 |
| WonderID administrator access review | COMPLIANCE-P0-11 |
| Closed-loop revocation (item closes only on verified removal); population completeness evidence; termination SLA report as control evidence | New |

### Experience (08)

| Change | Story |
|---|---|
| Reconciliation console | EXPERIENCE-P0-28 (F1) |
| Request tracking per line and tasks inbox | EXPERIENCE-P0-29 (F2) |
| Home, My Access | EXPERIENCE-P0-19 |
| Pages for roles, SoD workbench, lifecycle rules, delegations, emergency access, agent credentials, relay status | With each feature |

### Platform (09)

| Change | Story |
|---|---|
| Configuration Studio: signed bundle export, diff, import with approval | PLATFORM-P0-13 (finish) |

### Operations (10)

| Change | Story |
|---|---|
| Workflow designer and runs; forms; email templates; jobs page; e-mail delivery history | OPERATIONS-P0-09 + New |
| New reports (§5.11), control evidence packs, identity graph, posture page | OPERATIONS-P0-10 + New |

### QA (11)

| Change | Story |
|---|---|
| Reconciliation suite (deletion detection, guards, baseline, isolation) | QA-P0-23 (F1) |
| Request-to-verified suite (person, service account, agent; removal; expiry) | QA-P0-24 (F2) |
| Gateway security suite extended to tokens, DPoP, delegation and kill switch | QA-P0-18 |
| Provisioning safety tests (idempotency, mass-change guard, read-only enforcement) | QA-P0-21 |
| Brownfield end-to-end: HR → lifecycle → request → provision → certify → revoke → verify | QA-P0-22 |

---

## 10. Phased delivery plan

**Revised 2026-10-11 (owner direction).** Reconciliation, account import and access requests come first, for human and non-human identities alike. The earlier F1–F7 plan is renumbered F1–F10 around that order. Nothing was removed; work moved later.

Each phase:
- ends with a usable increment and an exit test;
- can run stories in different modules in parallel;
- depends on the phases before it.

**Story IDs:**
- Existing IDs are kept.
- New IDs continue each module's numbering: INTEGRATION-P0-18, ACCESS-P0-27, IDENTITY-P0-20, EXPERIENCE-P0-28, QA-P0-23 and up.
- A new story enters its module backlog (with its Progress Tracker row) when the owner approves D1. Until then this section is the plan of record.

### Where these three stand today (code check, 2026-10-11)

| Capability | Works end to end | Partial | Missing |
|---|---|---|---|
| **Account import** | Connector syncs (daily cron) refresh the staging table `integration_objects`. CSV import puts applications, entitlements, accounts and grants into the real tables. Identity sources import identities. | Accounts move from staging to `accounts` only when someone starts it by hand, per onboarded application. | Entitlements and access grants from connectors never leave staging. Nothing moves data on after a scheduled sync. Identity-source schedules are stored but never run. |
| **Reconciliation** | Identity runs: preview, pending matches, guarded leavers from CSV. Account correlation, orphan and dormant states. Ledger marks access with no evidence as UNPROVEN. | Staging is never pruned, so an account or identity removed at the source is never detected through a connector, and leavers from integration-linked sources are missed. | No incremental mode. No reconciliation of entitlements and grants. No classification of imported access (ACCESS-P0-25), so no rogue-access findings. |
| **Access request** | Catalog, request policies, multi-stage approval with escalation, packages, ledger evidence. Service accounts and machine identities can be requested by their manager, an access manager or the package owner. | Fulfilment is a manual "mark fulfilled". | Approval creates no pending grant and no task. No removal or account requests. No recon check that access really arrived. AI agents are refused in the catalog. No connector writes (`executeConnectorWrite` has no caller). |

### Phase F1: Import and reconciliation

**Goal.** For every connected application, WonderID holds a current, trustworthy copy of:
- accounts, entitlements and who holds what;
- for people, service accounts, machine identities and AI agents alike.

Every run says what changed. Removals at the source are detected. Access that appeared outside WonderID is flagged.

| Story | Module | What it delivers |
|---|---|---|
| **INTEGRATION-P0-18** Staging reflects the source | Integration | See below. |
| **INTEGRATION-P0-19** Scheduled import and promotion | Integration | See below. Finishes the schedule part of INTEGRATION-P0-08. |
| **ACCESS-P0-27** Entitlement and access-grant reconciliation | Access | See below. |
| **ACCESS-P0-25** Imported access classification and drift findings *(existing)* | Access + Risk | See below. |
| **IDENTITY-P0-20** Non-human identities from accounts | Identity | See below. |
| **EXPERIENCE-P0-28** Reconciliation console | Experience | See below. |
| **QA-P0-23** Reconciliation suite | QA | See below. |

**INTEGRATION-P0-18, Staging reflects the source.**
- Each sync records the run that last saw each object.
- After a **complete full** run, objects not seen are marked missing at the source, with a time. They are never deleted.
- Incremental and partial runs never mark anything missing.
- A mass-missing guard (a percentage, set in Global Configuration) holds the run for approval.
- With this, integration-linked identity sources detect leavers too.

**INTEGRATION-P0-19, Scheduled import and promotion.**
- After each sync, the changed kinds are handed to their owning module's published service:
  - identities to the identity sources linked to the connection;
  - accounts, entitlements and grants to application reconciliation for onboarded applications.
- Identity-source schedules run (finishing the schedule part of INTEGRATION-P0-08).
- There is a "run now" action.
- Each run links import → promotion → reconciliation in one job record with counts and errors.
- How often it runs depends on D10.

**ACCESS-P0-27, Entitlement and access-grant reconciliation.**
- Staged connector entitlements and grants move into `entitlements` and `access_grants`, as CSV already does.
- It works through the application's onboarding mapping, including the entitlement type and the account ↔ entitlement link.
- Full and incremental modes, with a preview (dry-run) and an apply.
- Counts of added, changed, removed and unchanged.
- A grant gone at the source becomes **removed at source** with a ledger event, not a deletion.
- Accounts keep `missing_from_source_at` semantics.

**ACCESS-P0-25, Imported access classification and drift findings (existing story).**
- Every imported account and grant is classified against the ledger: **authorized** (evidence exists), **legacy** (present at the application's first baseline run), **unproven**, or **rogue** (appeared after the baseline with no evidence).
- Rogue access raises a Risk finding, through the published Risk contract.
- Remediating it comes in F3 (RISK-P0-13).

**IDENTITY-P0-20, Non-human identities from accounts.**
- Service and machine accounts that correlate to no person can become, or link to, SERVICE_ACCOUNT, MACHINE, WORKLOAD or APPLICATION identities.
- The owner comes from a mapped source attribute; otherwise the identity joins an **unowned identity** queue in Onboarding.
- AI-agent accounts link through declared identifiers: OAuth client id, service principal, agent external id.
- Unowned non-human identities cannot be granted requested access.

**EXPERIENCE-P0-28, Reconciliation console.**
- One page per connection and per application: last import, last reconciliation, counts, missing at source, held runs, errors.
- Preview → apply, and run now.
- "Last seen at source" on account and grant pages.
- One primary action per page (§19.5).

**QA-P0-23, Reconciliation suite.** Tests for:
- deletion detection, and the full vs partial run rule;
- the mass-missing guard;
- idempotent re-runs;
- the baseline rule (legacy vs rogue);
- tenant isolation of every new column and table;
- an end-to-end path through a built-in connector (PostgreSQL or Keycloak) and through CSV.

**Exit.**
- Connect an application through a built-in connector and schedule it.
- Accounts, entitlements and grants appear for a person, a service account and an AI agent, each correlated to the right identity.
- An account removed at the source shows as missing after the next full run.
- An entitlement added directly on the target shows as rogue with a finding.

### Phase F2: Access requests end to end

**Goal.** A request is followed until the access really exists. Approval creates a pending grant and a fulfilment task. The next reconciliation confirms the access arrived and closes the task. This works for people and for the non-human identities they own. Fulfilment stays manual until F3.

| Story | Module | What it delivers |
|---|---|---|
| **ACCESS-P0-28** Approved requests become pending grants | Access | See below. |
| **ACCESS-P0-29** Fulfilment tasks | Access | See below. |
| **ACCESS-P0-30** Remove-access and account requests | Access | See below. |
| **ACCESS-P0-31** Requests for non-human identities | Access + Identity | See below. Coordinated with IDENTITY-P0-19. |
| **ACCESS-P0-32** Time-bound access | Access | See below. |
| **EXPERIENCE-P0-29** Request tracking and tasks inbox | Experience | See below. |
| **QA-P0-24** Request-to-verified suite | QA | See below. |

**ACCESS-P0-28, Approved requests become pending grants.**
- On final approval, each line becomes an `access_grants` (or account) row in status **pending fulfilment**.
- The row links to the request, and the ledger source is REQUEST. Package assignment items behave the same way.
- When reconciliation sees the matching grant at the source, the row becomes **active (verified)**, and the request line closes with that evidence.
- A manual "mark fulfilled" records **fulfilled, unverified** until reconciliation confirms it.
- The request shows its true state at each step (§17.5).

**ACCESS-P0-29, Fulfilment tasks.**
- Lines for applications without write capability create a task for the application's fulfilment owner or group.
- The task can be claimed, completed with a note, or flagged as failed with a reason.
- Tasks have an SLA, become overdue and send reminders.
- Reconciliation closes the task when it confirms the access.

**ACCESS-P0-30, Remove-access and account requests.**
- A request line can remove an existing grant, ask for a new account, or ask to disable one.
- Each line is approved on its own route; a request with several lines completes when every line is resolved.
- Removal is confirmed by reconciliation, after which the grant becomes **revoked** in the ledger.

**ACCESS-P0-31, Requests for non-human identities.**
- Service accounts, machine identities and workloads are requested by their owner, and approval routes to the owners of the resource.
- **AI agents:** the agent's business owner requests on the agent's behalf. The catalog shows only what the agent's contract (SHOULD) allows, and the request runs through the same approval chain. This replaces today's refusal.
- An unowned non-human identity cannot be a subject (IDENTITY-P0-20).
- Coordinated with IDENTITY-P0-19 (agent access packages).

**ACCESS-P0-32, Time-bound access.**
- Each line can carry an end date, capped by the request policy.
- A reminder goes out before expiry, with a request to extend.
- At expiry a removal task is created; F3 makes it automatic.

**EXPERIENCE-P0-29, Request tracking and tasks inbox.**
- My requests shows each line's state: requested → approved → pending fulfilment → verified, or rejected, failed or expired.
- One inbox holds approvals and fulfilment tasks.
- The subject picker offers myself, a person I manage, or an identity I own.

**QA-P0-24, Request-to-verified suite.** End-to-end tests for:
- a person, a service account and an AI agent (within its contract);
- removal and expiry;
- approver ≠ requester, and tenant isolation;
- a repeated reconciliation, which must not duplicate grants or close a task twice.

**Exit.**
- A person requests an entitlement for themselves, for a service account they own, and for an agent within its contract.
- Approvals run and fulfilment tasks appear.
- The access is added on the target by hand, and the next scheduled reconciliation marks each line verified and closes its task.
- A removal request and an expiry go the same way, ending in revoked.

### Phase F3: Provisioning, closing the loop automatically

Needs decision **D3**.

- INTEGRATION-P0-11 (finish) and INTEGRATION-P0-13: write operations in drivers, the binding context, plan → pre-check → execute → verify, retries, failed-task view. Connections with write enabled fulfil requests and expiries directly instead of creating tasks.
  - The first operations are reversible or low-risk: add and remove group or entitlement membership, enable and disable account.
  - Create account follows.
- SCIM driver (client); write support in the LDAP and http drivers.
- Connectors: Microsoft Entra ID, one HR system, ServiceNow ticketing (D9).
- WonderID Relay for on-premises targets (§5.8.1, D7).
- RISK-P0-13: rogue access remediation, through approval and provisioning.

**Exit.** The P0 acceptance scenario (CLAUDE.md §11) runs with real removal: the unauthorized entitlement is removed through the connector after human approval, verified by reconciliation, and the finding resolves.

### Phase F4: Lifecycle and certification

- IDENTITY-P0-17, IDENTITY-P0-18 (finish): identity detail tabs; lifecycle rules (birthright, mover, leaver, expiry) with simulation and four-eyes publish; the manager's "disable all access".
- COMPLIANCE-P0-10, COMPLIANCE-P0-11: certification for every identity type, with population evidence. Revoke goes through F2 tasks or F3 provisioning, and an item closes on verified removal.
- Human identity merge over existing records (study D-6), campaign templates and preview (D-10), attribute-level audit detail (D-13).

**Exit.** A person, an external identity and a service account each go joiner → birthright → request → review → revoke → verified, with a complete evidence trail.

### Phase F5: Roles, separation of duties and delegation

- ACCESS-P0-21: business and IT roles.
- ACCESS-P0-22: entitlement SoD (preventive and detective) with the entitlement hierarchy.
- ACCESS-P0-23: delegations.
- Approved changes to governance objects (study D-3); SoD violation workflow and import guardrail (D-8, D-9).

**Exit.** An SoD conflict blocks a request and appears in the detective report; a role change is simulated, approved and published as a new version.

### Phase F6: Agent ID, trusted credentials and delegation

Unchanged in scope; was F3.

- Agent identifier and credential bindings.
- A gateway token service issuing DPoP-bound tokens of 15 minutes or less.
- A token register and revocation.
- Delegation grants and RFC 8693 `act` chains.
- The AuthZEN interface.
- A per-agent shadow → enforce rollout, and approval resume.
- IDENTITY-P0-19 (agent onboarding, sponsor, lifecycle policies; agent access packages may land earlier with ACCESS-P0-31).
- QA-P0-18 extended.

F6 is independent of F2–F5 and may run in parallel once F1 is done.

**Exit.** As in the earlier plan: key-based DPoP token, delegated action, denied out-of-scope action, approval that resumes, and a kill switch effective within 5 seconds.

### Phase F7: Workflow, forms and configuration

Was F4.

- OPERATIONS-P0-09: workflows.
- Forms and named value lists, e-mail templates, and the jobs page with an automation run log (D-12).
- PLATFORM-P0-13: configuration bundles.
- Request baskets for many identities, and model-after.
- Saved request drafts (D-1); generated identifiers (D-2).

### Phase F8: Advanced governance

Was F5.

- Mitigating controls and the SoD workbench; fine-grained SoD.
- Emergency and JIT access, with session evidence (D-4).
- External organizations and sponsors, with external sub-types (D-15).
- Role and rule mining; peer recommendations.
- SCIM receiver and SSF.
- Cloud connectors.

### Phase F9: Intelligence and experience

Was F6.

- EXPERIENCE-P0-19 and OPERATIONS-P0-10.
- Identity risk score for every type.
- Control history (D-5) and owner queues (D-7).
- EXPERIENCE-P0-20 (governed assistant).
- FOUNDATION-P0-21 (passwordless).

### Phase F10: Release gate

Was F7.

- QA-P0-21 hardening (including the threats in §7.2), the QA-P0-22 brownfield fixture, the full Playwright suite.
- A tenant-isolation suite over every new table, advisor checks, and the PDP performance budget (p95 ≤ 50 ms cached).

### Dependency summary

```text
F1 import & recon ─▶ F2 requests (manual fulfilment, verified by recon) ─▶ F3 provisioning (D3) ─┬─▶ F4 lifecycle & certification ─▶ F5 roles, SoD, delegation ─▶ F8 advanced
                                                                                                └─▶ F9 intelligence
F1 ─▶ F6 Agent ID credentials (parallel with F2–F5)
F2 ─▶ F7 workflow, forms, configuration (needs the request and task model) ─▶ F8
F10 gates release after F9
```

F4 can start once F2 is done, if F3 is delayed. Certification revokes then use F2's fulfilment tasks until provisioning exists.

---

## 11. Decisions needed from the owner

These are real architecture or product decisions (CLAUDE.md §4 stop-and-report
rule). The recommendation is given; nothing that depends on them is built until
decided.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve this document as the design baseline and add the "New" stories (§9) to the module backlogs in the phase order of §10. | Approve. |
| D2 | May WonderID issue OAuth access tokens to agents (gateway audience only, plus MCP servers that opt in to trust WonderID)? This makes WonderID an authorization server for agents, though not an IdP for people (CLAUDE.md §10 item 1). | Yes, scoped to agents and the gateway/opt-in MCP audiences; workforce sign-in stays with the customer IdP. |
| D3 | (Gates phase F3.) Enable write/provisioning operations in connectors (still per connection, declared, tenant-enabled and approval-gated; NN #12, #15). The framework doc currently says "read only". | Yes, starting with disable/enable and remove access (reversible or low-risk), then create and add. |
| D4 | May a critical finding automatically *suspend* an agent (reversible, audited), or only propose it? | Propose only by default; a per-tenant opt-in setting for automatic suspension of agents (never of people). |
| D5 | Target-system password reset that shows a new password once? | No. Trigger the target's own reset flow; never handle the value. |
| D6 | May certifications auto-close "keep" decisions for low-risk items based on a published rule? | Not in P0. Recommendations only; revisit in P1 with an explicit rule and sampling. |
| D7 | Adopt the outbound-only WonderID Relay instead of a network tunnel for on-premises connectivity. | Adopt. |
| D8 | Should the SCIM receiver and the AuthZEN PDP be offered on the public API surface (under `/api/connect/v1/<connection>/…`)? This widens the inbound surface of the connector boundary (NN #20; the boundary test allowlist may need a new receiver kind). | Yes, as connection receivers, with the boundary-test change approved explicitly. |
| D9 | Priority of first non-SCIM connectors: Entra ID + Workday + AWS (recommended) or another set. | Entra ID, Workday, AWS. |
| D10 | How often scheduled imports and reconciliation run (F1). The Vercel project is on the free plan, whose cron jobs run at most once a day, so today "hourly" means daily. Options: (a) keep daily, plus "run now" and push receivers; (b) move to a paid plan for sub-daily cron; (c) an external scheduler calling a signed endpoint. | (a) for F1; revisit when a customer needs same-day leaver detection. |

---

## 12. Capability coverage matrix

The left column lists capabilities found in (a) the seven Saviynt documents the
owner supplied on 2026-10-11 (IGA overview; architecture and functional
modules; unified navigation and admin home; user interface and home page;
developed-connector list; provisioning binding variables; secure connectivity
appliance) and (b) Saviynt's public product pages and publicly available
training guides. `docs.saviyntcloud.com` requires a customer sign-in and was
not used. Wording is WonderID's own. The right columns say where WonderID
covers the capability and in which phase (phases as revised in §10 on 2026-10-11).

### 12.1 Identity repository and lifecycle

| Capability | WonderID design | Phase |
|---|---|---|
| Identity warehouse from one or more authoritative sources (HR, contractor systems) | §5.1 sources as connections, attribute authority | Built + F1 |
| Application → instance → connection model | Application + connection (one connection per target instance); definitions shared as connection types | Built |
| Users, accounts, entitlements, roles, user groups (static/dynamic), organizations | §4, §8 identity repository | Built + F1 / F5 |
| Custom identity attributes | `identity_attribute_definitions` | Built |
| Entitlement types, owners (ranked), requestable flag, default and maximum duration | §5.4 entitlement attributes; request policies | Built + F1 / F2 |
| Entitlement hierarchy and implied entitlements | §5.4 `entitlement_hierarchy` | F5 |
| Self-service / delegated registration for contingent and external users (WonderID as source of record) | §5.1 item 6, §5.10 forms | F7/F8 |
| Duplicate identity detection at import and over existing identities | Agent duplicates and import-time correlation (built); merge of existing human identities (Saviynt study D-6) | Built (import correlation; agents) + F4 (people) |
| Account correlation; re-correlation after import | Built (0089); re-correlate from Pending Matches | Built + F1 |
| Birthright rules on create/import | §5.2 lifecycle rules | F4 |
| Mover rules that re-evaluate access and launch reviews | §5.2 mover + micro-certification | F4 |
| Leaver clean-up; manager one-click "disable all accounts" | §5.2 leaver plan, manager kill action | F4 (plan) / F3 (execution) |
| Periodic scan rules over existing population | Detective SoD, lifecycle rule re-evaluation job | F4 / F5 |
| Identity verification before activation | §5.1 item 7 (provider result recorded) | F8 |
| Identity classification queue | §5.1 item 8 | F1 |
| Third-party identities: vendor organizations, sponsors, invitations, consent, contract end | §5.1, §5.2 expiry, `external_organizations` | F8 |

### 12.2 Access requests and approvals

| Capability | WonderID design | Phase |
|---|---|---|
| Request access to applications, roles, entitlements; standard and service accounts | §5.3 basket lines; service accounts as identity type | Built + F2 |
| Create / modify / remove access or accounts in one request | §5.3 basket | F2 |
| Shopping-cart catalog with search over description, tags, metadata; job-function filtering; catalog visibility by organization | §5.3 catalog | Built + F7 |
| Model-after request | §5.3 | F7 |
| Bulk requests for many users | §5.3 | F7 |
| Recommendations from peer access during request, approval and review | §5.3, §5.5 deterministic peer analysis | F8 |
| Risk-based approval (static and dynamic risk), auto-approval of low risk, mandatory justification | §5.3 risk-based routing | F2 |
| Preventive SoD (enterprise, application, cross-application) during request | §5.6 preventive | F5 |
| Multi-level, serial and parallel approval; conditional branches | Built approval engine; workflows §5.10 | Built + F7 |
| n-level escalation and SLAs, multiple notifications | §5.3 | Built + F2 |
| Delegation of authority, out-of-office, limited-duration delegated administration | ACCESS-P0-23 | F5 |
| Approve from e-mail or chat | §5.3 (signed link, signed-in decision) | F7 |
| Integrated manual tasks with claim and delegate | §5.3 manual fulfilment, §8 tasks inbox | F2 |
| Ticketing for manual fulfilment with ticket status read-back | §5.8 ITSM fulfilment | F3 |
| Time-bound access with automatic removal | §5.3 | Built + F2 (task) / F3 (automatic) |
| Physical assets (badges) | Manual items in access packages | F7 |
| REST APIs to extend requests; integration with HR and portals | Published API + receivers | Built + F7 |
| Customizable landing page and labels | §8 home, labels | F9 |

### 12.3 Roles

| Capability | WonderID design | Phase |
|---|---|---|
| Hierarchical roles: enterprise/business, base, IT/technical, application; emergency roles | §5.4 role types; emergency via §5.7 | F5 / F8 |
| Fine-grained application roles provisioned to targets | Application roles = entitlements; provisioning §5.8 | F3 |
| Role mining (bottom-up, top-down, usage-weighted) and rule mining | §5.4 mining | F8 |
| Role impact simulation; SoD-free role design | §5.4 simulation and inherent SoD | F5 |
| ABAC conditions combined with roles | §5.4 ABAC with roles | F5 |
| Role lifecycle workflow, history, versioning, comparison, rollback | §5.4 lifecycle | F5 |
| Role membership and role content certification | §5.5 | F5 |

### 12.4 Certifications

| Capability | WonderID design | Phase |
|---|---|---|
| User manager, privileged/critical access, application owner, entitlement owner, role membership, role content, service account campaigns | §5.5 campaign types | F4 |
| Risk-based / outlier-only campaigns; direct vs inherited scope | §5.5 scoping | F4 |
| Event-driven reviews on attribute change (transfer, long absence); micro-certifications | §5.5 event-driven | F4 |
| Scheduling, status tracking, reporting, archiving | §5.5 | Built + F4 |
| Closed-loop revocation with tasks | §5.5 closed loop, §5.8 | F2 (task) / F3 (automatic) / F4 |
| Recommendations from usage (last use, last logon) and peer analysis | §5.5 recommendations | F8 |
| Reassign and consult; second-level campaign approvers | §5.5 decisions | F4 |
| Bulk decisions; bulk handling of leavers inside a campaign | §5.5 bulk | F4 |
| Trust score with automatic certify decisions | Deliberately recommendations only (D6) | — |

### 12.5 Separation of duties and application access governance

| Capability | WonderID design | Phase |
|---|---|---|
| Rulesets of risks and business functions mapped to coarse- and fine-grained entitlements, with AND/OR/NOT/exclude | §5.6 model | F5 (coarse) / F8 (fine) |
| Business-function lifecycle: owners, control mapping, criticality, versions, history | §5.6 rulesets | F5 |
| Prebuilt rulesets for critical applications | Original generic starter set; customer rulesets imported as data | F8 |
| Cross-application SoD | §5.6 (functions span applications) | F5 |
| Detective and preventive evaluation; risk simulation | §5.6 modes | F5 |
| Investigation workbench; usage-based actual vs potential | §5.6 exercised flag, workbench | F8 |
| Mitigating controls library | §5.6 | F8 |
| Remediation recommendations (user → role, role → entitlement), impact analysis | §5.6 remediation advice | F8 |
| Risk trend analysis; alerts to control owners | §5.6 alerts, §5.11 reports | F8 |
| Critical transaction monitoring | DID from ERP connectors feeding SoD and findings | F8 |
| SoD checks on emergency use | §5.7 | F8 |
| License optimisation (unused access) | Unused-access report from DID | F9 |

### 12.6 Privileged, emergency and machine access

| Capability | WonderID design | Phase |
|---|---|---|
| Governance of privileged, service, shared and generic accounts; ownership | §5.7 | F8 |
| Check-out / check-in elevated access; time-bound provisioning | §5.7 emergency sessions, JIT | F8 |
| Approval workflows for elevation | Approval engine | F8 |
| Aggregated privileged activity; review and sign-off after check-in | §5.7 post-use review | F8 |
| Behavioural analytics on privileged activity | Risk signals over DID | F9 |
| Vaulting, session recording | Out of scope (customer PAM via connector, §1.2) | — |
| Service-account request, ownership succession, certification | §5.2 ownership transfer, §5.5 | F2 / F4 / F8 |
| NHI discovery (workloads, keys, certificates, tokens), owners, timeline | Built NHI inventory + cloud connectors | Built + F8 |
| AI agent registry, owners, lifecycle, access map, runtime authorization, intent/purpose checks, delegation awareness | §6 (contracts = purpose; deterministic SHOULD/CAN/DID) | Built + F6 |

### 12.7 Connectors, provisioning and connectivity

| Capability | WonderID design | Phase |
|---|---|---|
| Connector families: directories, cloud platforms, security and vaults, SIEM, collaboration, enterprise apps, HR, ITSM, developer tools, mainframe, generic technologies (REST, SOAP, SCIM, LDAP, database, files over SFTP/S3, scripts) | §5.8 catalogue priority; generic drivers; scripts via relay | Built (generic) + F3/F8 |
| Provisioning operations: create, update, enable, disable, delete account; add and remove access; update user; password reset/change; create ticket; ticket status; emergency access IDs | §5.8 operations (password reset via target's flow, §5.9) | F3 |
| Group management: create, update, manage membership and owners | §5.8 operations | F3 |
| Standard variables available to provisioning templates (task, user, manager, account, application, requested attributes, entitlement, parent/child entitlement, ranked owners) | §5.8 binding context — fixed, documented, secret-free | F3 |
| Instant and batch provisioning, retries, pending task console | §5.8 pipeline, retries, failed-task view | F3 |
| Full and incremental reconciliation | §5.8 | Built + F1 |
| SCIM server exposed by the IGA platform | §5.8 SCIM receiver | F8 |
| Secure connectivity to customer networks (tunnel appliance with private CA, strong ciphers, IP allowlisting, high availability, monitoring of health and certificate expiry) | §5.8.1 WonderID Relay (outbound job pull, key-bound identity, active–active, heartbeat and key-expiry alerts) | F3 |
| Application onboarding (new and existing), questionnaires | Built onboarding state machine (0088) + forms §5.10 | Built + F7 |
| Discovery of applications | Built (0090) | Built |

### 12.8 Administration, security and experience

| Capability | WonderID design | Phase |
|---|---|---|
| Admin roles controlling feature access | Built WonderID permission roles and custom roles | Built |
| Organization hierarchy for delegated administration and request scoping | Built scoped assignments + organization scoping of catalog | Built + F7 |
| Policies for lifecycle events | §5.2 | F4 |
| Forms for identity and lifecycle workflows | §5.10 | F7 |
| Global configuration | Built (0116) | Built |
| Job control panel | §5.10 jobs page | F7 |
| Orchestration of multi-system processes | §5.10 workflow engine | F7 |
| Archival library | §5.11 archival | F9 |
| Settings: SMTP, e-mail templates, UI customization, defaults | §8 | F7 |
| Admin functions: search and disable a user, application logs, audit logs, certificate management, data analysis, e-mail delivery history | Audit trail (built), reports, e-mail history §8; relay key management §5.8.1 | Built + F7 |
| Configuration transport between environments | §8 configuration promotion (diff-first) | F7 |
| Authentication: internal, directory, SAML, OAuth for APIs | Supabase Auth, SSO, passkeys; agent tokens §6.2 | Built + F6/F9 |
| Field-level encryption, encryption in transit and at rest | `encryptSecret` AES-256-GCM (built) | Built |
| Visibility rules for requestable entitlements | §5.3 catalog visibility | F2 |
| Change control and traceable operator access | Versioned config, hash-chained audit, platform admin boundary | Built |
| Audit retention (1 year online, 7 years archive) | Plan-based retention (built), archive §5.11 | Built + F9 |
| High availability | Hosting platform (Vercel + Supabase); relays active–active | Built + F3 |
| Navigation: collapsible sidebar, logo, area list (Home, Intelligence, Integrations/Onboarding, Control Center, SOD, Certifications, Identities, Admin) | Built sidebar areas (CLAUDE.md §13) | Built |
| Profile menu: recent security activity, change password, downloads (background, notify), uploads, language, notification toggle, sign out | §8 profile menu | F9 |
| Menu search, home banner, shortcuts, personalised tiles, KPIs (pending reviews, approvals, password expiry), recent requests/assignments widgets, help links | §8 home | Built (search) + F9 |
| In-app guided tour | Not planned (help guide exists) | — |
| Identity Security Posture view across systems | §5.11 posture page | F9 |
| Analytics controls that trigger remediation on result rows | Reports + findings → remediation via approval (no raw SQL exposed to tenants) | F9 |

---

## 13. References

**IGA standards**

- RFC 7643 SCIM Core Schema — https://www.rfc-editor.org/rfc/rfc7643
- RFC 7644 SCIM Protocol — https://www.rfc-editor.org/rfc/rfc7644
- RFC 9865 SCIM Cursor Pagination — https://www.rfc-editor.org/rfc/rfc9865
- RFC 9967 SCIM Profile for Security Event Tokens — https://datatracker.ietf.org/doc/rfc9967/
- draft-wzdk-scim-agent-resource — https://datatracker.ietf.org/doc/draft-wzdk-scim-agent-resource/
- NIST SP 800-53 Rev. 5 (release 5.2.0) — https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
- NIST SP 800-207 Zero Trust Architecture — https://csrc.nist.gov/pubs/sp/800/207/final
- PCAOB AS 2201 — https://pcaobus.org/oversight/standards/auditing-standards/details/AS2201
- PCAOB AS 1105 — https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105

**Agent and workload identity**

- RFC 8693 Token Exchange — https://www.rfc-editor.org/rfc/rfc8693
- RFC 9449 DPoP — https://www.rfc-editor.org/rfc/rfc9449
- RFC 7523 JWT Profile — https://www.rfc-editor.org/rfc/rfc7523
- RFC 8705 OAuth mTLS — https://www.rfc-editor.org/rfc/rfc8705
- RFC 9396 Rich Authorization Requests — https://www.rfc-editor.org/rfc/rfc9396
- RFC 8707 Resource Indicators — https://www.rfc-editor.org/rfc/rfc8707
- RFC 9728 Protected Resource Metadata — https://www.rfc-editor.org/rfc/rfc9728
- RFC 7009 Token Revocation — https://www.rfc-editor.org/rfc/rfc7009
- RFC 7662 Token Introspection — https://www.rfc-editor.org/rfc/rfc7662
- RFC 9700 OAuth 2.0 Security BCP — https://www.rfc-editor.org/rfc/rfc9700
- Transaction Tokens draft — https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/
- Identity chaining draft — https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/
- SPIFFE standards — https://github.com/spiffe/spiffe/tree/main/standards
- SPIRE — https://spiffe.io/docs/latest/spire-about/
- IETF WIMSE documents — https://datatracker.ietf.org/wg/wimse/documents/
- draft-ietf-wimse-aims (AI Identity Management System) — https://datatracker.ietf.org/doc/html/draft-ietf-wimse-aims
- OpenID AuthZEN Authorization API 1.0 — https://openid.net/specs/authorization-api-1_0.html
- OpenID CIBA Core 1.0 — https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html
- OpenID SSF 1.0 — https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html
- OpenID CAEP 1.0 — https://openid.net/specs/openid-caep-1_0-final.html
- OpenID RISC 1.0 — https://openid.net/specs/openid-risc-1_0-final.html
- MCP authorization (2026-07-28) — https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- A2A protocol — https://a2a-protocol.org/latest/specification/
- OpenID "Identity Management for Agentic AI" — https://arxiv.org/abs/2510.25819
- NCCoE software and AI agent identity concept paper — https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd

**Vendor material (capability level only)**

- Saviynt product pages: https://saviynt.com/products/identity-governance-and-administration, https://saviynt.com/products/application-access-governance-solutions, https://saviynt.com/products/privileged-access-management-software-solutions, https://saviynt.com/products/external-identity-management, https://saviynt.com/products/non-human-identity, https://saviynt.com/products/zuma, https://saviynt.com/products/identity-security-posture-management, https://saviynt.com/intelligence
- Saviynt public training guides (2026 editions): SCIP, SCAIP and SCIA exam guides on saviynt.com
- Seven Saviynt documents supplied by the owner, 2026-10-11 (not stored in the repository)
