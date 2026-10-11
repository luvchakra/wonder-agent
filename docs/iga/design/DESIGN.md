# WonderID IGA and Agent ID: the design

| | |
|---|---|
| Status | Draft baseline for owner review. Nothing here is built by being written down; stories start when the owner decides D1 (§17). |
| Date | 2026-10-11 |
| Scope | Identity governance for every identity type: people, external identities, service accounts, machine identities, workloads, APIs and AI agents. |
| Companion files | `../run-order/RUN-ORDER.md` (the phases and stories, in order) and `../progress/PROGRESS.md` (live status). |
| Sources | `docs/design/WONDERID-FOUNDATION-DESIGN.md` (the first design and its revisions, with the standards list, NIST mapping and coverage matrix), `docs/design/saviynt-reference-study.md` (a reading of a live Saviynt tenant), `docs/integrations/CONNECTOR-FRAMEWORK.md` (the connector reference), `docs/integrations/INTEGRATOR-GUIDE.md` (what is configurable today). |

This file is the clean statement of the design as it stands after the three
passes of 2026-10-11 (the foundation design, the delivery reordering, and the
integrator configurability review). It replaces nothing in `CLAUDE.md`: the
non-negotiables (NN #1–#20), the multi-tenant guardrails (§14) and the working
rules (§19) bind every proposal here. Where this file and the older design
differ, this file is the current intent and the older file keeps the history.

## Contents

1. [What WonderID is](#1-what-wonderid-is)
2. [Where the product stands](#2-where-the-product-stands)
3. [The model](#3-the-model)
4. [Connecting systems](#4-connecting-systems)
5. [Import and reconciliation](#5-import-and-reconciliation)
6. [Access requests](#6-access-requests)
7. [Rules](#7-rules)
8. [Lifecycle](#8-lifecycle)
9. [Roles and entitlements](#9-roles-and-entitlements)
10. [Certification](#10-certification)
11. [Separation of duties](#11-separation-of-duties)
12. [Privileged and emergency access](#12-privileged-and-emergency-access)
13. [Agent ID](#13-agent-id)
14. [Workflow, forms, events and jobs](#14-workflow-forms-events-and-jobs)
15. [Audit, evidence and intelligence](#15-audit-evidence-and-intelligence)
16. [Administration and the integrator surface](#16-administration-and-the-integrator-surface)
17. [Decisions](#17-decisions)
18. [Security and tenancy](#18-security-and-tenancy)

---

## 1. What WonderID is

WonderID answers five questions for every identity–access relationship: who
or what the identity is, what it can access, why it has that access, who
authorized it under which policy, and whether it is still appropriate. Two
pillars share one model:

- **IGA**: sources, lifecycle, requests, roles, certification, separation of
  duties, provisioning and audit for human, external and machine identities.
- **Agent ID**: AI agents as governed non-human identities with a human
  owner, scoped short-lived credentials, explicit delegation, a policy
  decision before every action, a kill switch and a complete audit trail.

**Principles.**

| # | Principle | In practice |
|---|---|---|
| P1 | One identity model for everything that holds access | Every type shares `identities` (0077); agent-specific fields stay on `agents` (NN #5) |
| P2 | Every access has a reason on record | Each grant has a ledger entry with its source and authorization (0114); provisioning writes to it |
| P3 | SHOULD, CAN and DID for every identity | Approved access, effective access from connectors, observed activity; drift is a finding (NN #8) |
| P4 | Deterministic decisions, human approval for consequence | Policy, risk, SoD, rules and routing are code; AI explains, recommends and drafts (NN #9, #15, #19) |
| P5 | Connectors are the only way in or out | Reads, writes, events, files, SCIM and the Runtime Gateway go through `modules/integrations/framework` (NN #20) |
| P6 | Read-only unless declared, enabled and approved | A write needs the definition's capability, the tenant's switch and an approval (NN #12, #15) |
| P7 | Standards on the wire, original inside | SCIM, OAuth token exchange, DPoP, AuthZEN, SSF/CAEP, SPIFFE-compatible identifiers; a vendor-neutral model (NN #17) |
| P8 | Short-lived beats revocable beats static | Credentials that expire in minutes; revocation is the backstop |
| P9 | Evidence is a by-product | Every decision stores what the decider saw, who decided, when and why |
| P10 | Configuration, not code, for integrators | Connectors, rules, policies, templates and forms are data an integrator writes in the console or sends to the API |
| P11 | Minimal UI | One primary action per screen; advanced options folded (CLAUDE.md §19.5) |

**What WonderID is not** (CLAUDE.md §10): not an identity provider for the
workforce, not a PAM vault, not a SIEM. It never stores or reveals a target
system's password, never records a privileged session itself, and never
becomes the log store of record.

## 2. Where the product stands

Checked against the code on 2026-10-11 (116 migrations; 201 of 252 backlog
stories done).

**Built.** The unified identity model with eight types, lifecycle states,
custom attributes and field provenance; identity sources with authority,
precedence, mappings, correlation rules and a leaver guard; account
correlation with orphan and dormant detection; the connector framework with
five drivers, sixteen built-in definitions, inbound receivers, CSV and the
connector boundary test; custom connector definitions written and tried in
the console; application catalog and onboarding with four-eyes approval;
request catalog, request policies, a staged approval engine and access
packages; the access ledger; agent registration, owners, versioned contracts,
discovery, duplicates, shadow AI, API keys, the Runtime Gateway with a
fail-closed decision pipeline, emergency controls; hash-chained audit, reports,
control frameworks; custom roles, groups, scoped assignments, authorization
policies; Global Configuration with versions.

**Gaps that shape the order of work.**

| Capability | Works | Missing |
|---|---|---|
| Account import | Daily connector syncs into staging; CSV import into real tables; identity import | Connector entitlements and grants never leave staging; promotion is manual; identity-source schedules never run |
| Reconciliation | Identity runs with preview and pending matches; account correlation; ledger marks unproven access | Staging is never pruned, so removals at the source go undetected; no incremental mode; no classification of imported access |
| Access requests | Catalog, policies, multi-stage approval, packages, expiry | Approval creates no grant and no task; "mark fulfilled" is never verified; no removal or account requests; AI agents refused |
| Provisioning | An idempotent write interface | No driver writes; nothing calls the interface |
| Rules | Agent policies over fixed facts; lifecycle events open fixed tasks | No birthright, attribute or event-driven rules |
| Automation | Every route checks a permission | `/api/v1/*` accepts only a browser session: no credential for scripts |
| SSO | Connection and claims-to-role mapping | The SAML/OIDC handshake waits on a Supabase SSO provider the owner configures |

## 3. The model

```text
Identity source ──feeds──▶ Identity (human | external | machine | service_account | application | workload | api | ai_agent)
                               │  owner / manager / sponsor / delegate edges
                               ├──has──▶ Account (on an Application, through a Connection)
                               │            └──holds──▶ Entitlement (type, owner, privilege level, classification, parent)
                               ├──assigned──▶ Business or IT role ──contains──▶ Entitlements | Packages | Roles
                               ├──assigned──▶ Access package ──contains──▶ Entitlements | Applications
                               ├──every grant──▶ Access ledger entry (source, authorization, status) ◀── provisioning task
                               └──ai_agent 1:1──▶ Agent ──▶ Contract (SHOULD) · credential binding · delegation grant · runtime decision (DID)
```

**Objects an integrator meets.**

- **Connection type** and **connection**: a definition (one product's API)
  and one organization's instance of it (settings, encrypted credentials,
  schedule, sync history).
- **Identity source**: the governance settings of a connection that imports
  identities: precedence, attribute authority, mappings, correlation rules,
  leaver strategy, mass-change guard.
- **Application**: a governed system with owners, an onboarding
  configuration, entitlement types and policies.
- **Account**, **entitlement**, **access grant**: what the application holds,
  imported through its connection and classified by the ledger.
- **Request**, **approval**, **task**: how access is asked for, decided and
  fulfilled.
- **Rule**: a trigger, a condition and effects (§7).
- **Campaign**: a certification with its population, reviewers and evidence.
- **Agent** and **contract**: an AI agent and its approved purpose.

**SCIM mapping.** `identities` ↔ SCIM `User` with the Enterprise extension;
`lifecycle_state` ↔ `active`; `manager_of` ↔ `enterprise:manager`; accounts ↔
a target's `User`; group entitlements ↔ `Group`; agents ↔ the draft `Agent`
resource (import and export only until adopted).

**Proposed tables** (each additive, with `tenant_id`, RLS, provenance columns
and an isolation test): `business_roles` and members, assignments, versions;
`entitlement_hierarchy`; the SoD set (functions, risks, rulesets, mitigating
controls, violations); `lifecycle_rules`; entitlement classification rules;
`event_subscriptions`; `delegations`; `provisioning_plans` and tasks;
`emergency_access_sessions`; `external_organizations`;
`agent_credential_bindings`; `agent_delegation_grants`; `agent_tokens`;
`ssf_streams`; `workflow_definitions` and runs; `forms`; `email_templates`;
automation credentials. `certification_items` widens from agent-only to
identity-generic.

## 4. Connecting systems

### 4.1 The framework today

A connector is a **JSON definition**: settings, authentication, a test call,
one request per canonical kind (identity, account, entitlement, access grant,
application, policy, MCP server, tool and resource) with field mappings,
transforms, filters and pagination, and the inbound channels the connection
receives on (webhooks, files, runtime events, the gateway). One engine runs
every definition through the connector gateway (SSRF guard, metering, rate
limits) and a driver: `http`, `ldap`, `sql` (PostgreSQL), `mcp`, `file` or
none. Secrets appear only as `{secret.<key>}` inside `auth`, requests stay on
the organization's own addresses, and SQL is one read-only statement.

An integrator writes a definition in the console (`/integrations/types/new`),
validated as typed, tried against a live system without saving, and published
as an immutable version for the organization; the same operations exist on
the API. Reference: `docs/integrations/CONNECTOR-FRAMEWORK.md`.

### 4.2 Extensions for integrators

| Extension | Adds | Phase |
|---|---|---|
| Schedule on every connection | Set in the console and the API, not only on file connections | F1 |
| Custom attributes as targets | Identity source mappings may target the tenant's custom attributes, with provenance | F1 |
| Incremental resources | A `changes` request per kind with a `since` cursor kept per connection; a definition without one runs full only | F3 |
| More authentication | OAuth 2.0 authorization code (callback as a receiver), private-key JWT, client certificate, API key in the body | F3 |
| Write operations | The provisioning verbs (§4.4) as templates in the same definition | F3 |
| Scripts and other engines | PowerShell, shell and other SQL engines run by the relay (§4.5) | F3 |
| Transforms | `regex`, `replace`, `coalesce`, `dateAdd`; XML for SOAP APIs later | F3 |
| Files and upgrades | Export and import a definition; "upgrade to version X" on a connection with a diff | F3 |
| Guided editor | A form over the JSON with a field picker over a sample response | F7 |
| Certified definitions | A definition submitted to the platform catalogue becomes a built-in for every tenant after the vendor's review | F7 |

### 4.3 Receiving

Every inbound path is a receiver of a connection under
`/api/connect/v1/<connection>/…`, authenticated with that connection's
credential: webhooks, files, runtime events, the Runtime Gateway, and later
the SCIM service (`/scim/v2/…`, with RFC 9967 change events), the SSF
receiver, the token service and the AuthZEN endpoints (decision D8).

### 4.4 Provisioning

Needs decision D3.

```text
Trigger (approved request line | lifecycle rule | certification revoke | finding remediation | expiry)
  → Plan      : identity → account(s) on target; minimal operations; authorization reference
  → Pre-check : connection healthy? capability declared AND enabled? SoD clean? authorization valid? mass-change guard?
  → Execute   : executeConnectorWrite() with an idempotency key
  → Verify    : read back, or wait for the next import, and compare
  → Record    : ledger entry, audit event, task status; notify the requester
```

Operations a definition may implement: create, update, enable, disable and
delete account; add and remove access; update identity attributes on the
target; request a password reset (the target's own flow, never a value in
WonderID); create, update and change membership of groups; create and read
tickets; grant and revoke emergency access. A write operation is a template
over a fixed, documented context (identity, account, entitlement,
application, connection, request, manager, owners, task); the driver injects
credentials after templating, so a template cannot echo them. Retries only
on idempotent operations; nothing is reported done until verified.

Applications without write capability get **fulfilment tasks** (claim,
complete with evidence, or fail with a reason) or an ITSM ticket through a
connector whose status is read back.

**SCIM client.** A `scim` driver implements the verbs over RFC 7644, honours
`If-Match`, uses `/Bulk` when advertised, discovers capability from
`/ServiceProviderConfig`, and pages by cursor when offered.

### 4.5 Reaching private networks: the relay

Needs decision D7. A small relay in the customer's network makes outbound
HTTPS calls to its connection's receiver, long-polls for connector jobs it
is allowed to run (an import page, a declared write, a script), runs them
with a local driver, and posts signed results. No inbound port, no VPN, no
arbitrary sockets. Credentials may stay on the relay. The relay authenticates
with a key generated on the host, enrolled once with an approval, rotated on
a schedule, revoked by disabling the connection. Several relays can serve one
connection; jobs are idempotent. Heartbeat, version, latency, key expiry and
backlog are monitored.

### 4.6 Connector catalogue priority

1. Directories and IdPs: Microsoft Entra ID, Active Directory (LDAP exists),
   Okta, Google Workspace.
2. HR: Workday, SAP SuccessFactors; generic SCIM and CSV exist.
3. Cloud: AWS IAM and Identity Center, Azure RBAC, GCP IAM (also the main
   machine-identity source).
4. Business applications: Salesforce, ServiceNow, SAP, Snowflake, GitHub,
   Atlassian, Slack, Microsoft 365.
5. Security: CyberArk and OpenBao/HashiCorp Vault metadata, never values;
   SIEM export.
6. AI platforms (§13.2): Azure AI, Amazon Bedrock agents, Google Vertex AI
   agents, OpenAI and Anthropic organizations, MCP registries.

Decision D9 picks the first three non-SCIM connectors; the recommendation is
Entra ID, Workday and AWS.

## 5. Import and reconciliation

The first thing WonderID must do well: hold a current, trustworthy copy of
each connected application's accounts, entitlements and who holds what, for
every identity type, and say what changed.

1. **Staging reflects the source.** Each sync records the run that last saw
   each staged object. After a *complete full* run, objects not seen are
   marked missing at the source, with a time; never deleted. Incremental and
   partial runs mark nothing. A mass-missing guard (a share set in Global
   Configuration) holds the run for a person. With this, integration-linked
   identity sources detect leavers too.
2. **Scheduled import and promotion.** After each sync, changed kinds are
   handed to their owning module's published service: identities to the
   identity sources linked to the connection; accounts, entitlements and
   grants to application reconciliation for onboarded applications.
   Identity-source schedules run. "Run now" exists. One job record chains
   import → promotion → reconciliation with counts and errors. Frequency per
   decision D10.
3. **Entitlement and grant reconciliation.** Staged connector entitlements
   and grants move into `entitlements` and `access_grants` through the
   application's onboarding mapping, with preview and apply, full and
   incremental modes, and counts of added, changed, removed and unchanged. A
   grant gone at the source becomes *removed at source* with a ledger event.
4. **Identity sources.** Sources are connections; attribute authority is per
   attribute, not per source; correlation is deterministic first (immutable
   id → employee number → verified e-mail → composite rule) and anything
   below the configured confidence goes to Pending Matches; the mass-change
   guard covers every attribute change; WonderID can be the source of record
   for populations without an HR record (contractors, volunteers, partners)
   through registration and sponsor forms; unclassified identities join a
   classification queue and cannot receive requested access.
5. **Classification.** Every imported account and grant is *authorized*
   (ledger evidence), *legacy* (present at the application's first baseline
   run), *unproven* or *rogue* (appeared after the baseline with no
   evidence). Rogue access raises a Risk finding; remediation follows in F3.
6. **Non-human identities from accounts.** Service and machine accounts that
   correlate to no person become, or link to, SERVICE_ACCOUNT, MACHINE,
   WORKLOAD or APPLICATION identities. The owner comes from a mapped source
   attribute; otherwise the identity joins an *unowned identities* queue.
   AI-agent accounts link through declared identifiers (OAuth client id,
   service principal, external id). An unowned non-human identity cannot be
   granted requested access.
7. **Human identity merge** (F4). Likely duplicate people over existing
   records are detected; the person deciding chooses the surviving value per
   attribute; accounts and access move to the survivor; the merge record is
   reversible. Nothing merges without a person.

**Console.** A reconciliation page per connection and per application: last
import, last reconciliation, counts, missing at source, held runs, errors,
preview → apply, run now. "Last seen at source" on account and grant pages.

## 6. Access requests

A request is followed until the access really exists.

- **Catalog and policies** (built): what is requestable, by whom (self,
  managers, access managers), durations, justification, risk threshold,
  auto-approval, the approval route; access packages with eligibility by
  identity type and department.
- **Approval** (built): staged chains (manager, entitlement owner,
  application owner, package owner, access managers), parallel and
  sequential stages, no self-approval, escalation and expiry.
- **Pending grants verified by reconciliation** (F2). On final approval each
  line becomes an `access_grants` row in *pending fulfilment*, ledger source
  REQUEST. When reconciliation sees the grant at the source the row becomes
  *active (verified)* and the line closes with that evidence. A manual "mark
  fulfilled" is *fulfilled, unverified* until then.
- **Fulfilment tasks** (F2) for applications a connector cannot write to:
  owner or group, claim, complete with a note or fail with a reason, SLA,
  reminders; closed by reconciliation. Connector writes replace tasks in F3.
- **Line types** (F2): add access, remove access, new account, disable
  account; each approved on its own route; a request completes when every
  line is resolved. Removal ends as *revoked* after reconciliation confirms.
- **Subjects** (F2): myself; people I manage; service accounts, machine
  identities and workloads I own (approval to the resource owners); AI
  agents, requested by the agent's business owner within what the contract
  allows (the catalog shows only that; the rest is refused server-side).
- **Time-bound** (F2): an end date per line, capped by policy; a reminder
  before expiry with a request to extend; a removal task at expiry, automatic
  in F3.
- **Delegation** (F5): out-of-office and standing delegation of approval,
  request and administration rights, time-limited, audited, never to the
  subject of the request.
- **Later** (F7): baskets of many changes and many identities, model-after
  ("give X the same requestable access as Y, minus what X has, minus SoD
  blocks"), saved drafts, approve from a signed e-mail link that still needs
  the approver's session, risk-based routing bands, deterministic peer
  recommendations ("people like you have", computed by code).

**Console.** My requests shows each line's state (requested → approved →
pending fulfilment → verified, or rejected, failed, expired); one inbox holds
approvals and fulfilment tasks; the subject picker offers myself, people I
manage, and identities I own.

## 7. Rules

An integrator configures behaviour with rules, not code. Every rule has the
same anatomy, so one editor, one simulator and one run log serve lifecycle
rules, attribute rules, entitlement classification rules, event
subscriptions and agent discovery rules.

| Part | Meaning |
|---|---|
| Trigger | One entry of the trigger catalogue |
| Scope | What the rule may touch: identity types, organizations, sources, applications |
| Condition | An expression over the subject's attributes (standard and custom), relationships (manager, owner, organization, sponsor) and, for change triggers, old and new values |
| Effects | One or more entries of the effect catalogue, in order |
| Mode | *Enforce*, or *report only*: the rule records what it would have done. New rules start report-only |
| Priority | Order when several rules fire on one event; later rules see earlier effects |
| Version and status | Draft → simulated → published (four-eyes) → retired; every publish is a version |

**Triggers.** Identity: created, activated, imported from a named source,
attribute changed (any or named), manager changed, moved, leaver, end date
reached, rehire, leave started or ended, classified, owner changed. Access
objects: entitlement imported or changed, application onboarded,
organization changed, access expiring in N days, access found outside
WonderID. Governance: request decided, task completed or overdue,
certification decision, campaign closed, finding raised or resolved.
Runtime: agent discovered, decision denied, kill switch used. Schedule:
daily or weekly, or "re-evaluate every rule of this kind nightly".

**Effects.** Identity: set an attribute to an expression, set type or
subtype, set owner, sponsor or manager, add to a group, move the lifecycle
state along an allowed transition. Access: assign or remove a package or
business role (ledger source `WONDERID_LIFECYCLE`), create a request on the
identity's behalf (through approval), open a micro-certification, set
entitlement attributes. Work: open a task with an SLA, notify, run a
workflow, send an outbound webhook through a connection. Agent: propose
RESTRICTED or SUSPENDED (automatic only under D4), require re-certification.

**Condition language.** A small typed expression language evaluated by
code, never by a model and never as SQL: `=`, `≠`, `<`, `>`, `in`, `matches`,
`exists`, `changed`, `was`; `and`, `or`, `not`; references `identity.*`,
`old.*`, `new.*`, `manager.*`, `source.*`, `application.*`, `entitlement.*`.
Computed values reuse the connector mapping forms (templates and the fixed
transform list), so an integrator learns one syntax. A rule that names an
undefined attribute fails validation.

**Attribute rules** ("user update rules"). Trigger imported or attribute
changed; effect set attribute: display name from first and last name, region
from cost centre, identity type from employment type, generated username and
e-mail. A value a rule writes carries provenance `rule` with the rule id and
version. A rule may set an attribute only where no source is authoritative
for it, or where the rule is declared the authority, so a rule never silently
overrides a system of record (NN #7).

**Entitlement classification rules.** Trigger entitlement imported or
changed; match on name, type, application, source attributes or group
membership; set owner, privilege level, data classification, `requestable`,
the SOX-relevant flag or the entitlement type. Report-only first, with a
per-entitlement preview.

**Guard rails.** An effect that grants consequential access creates a
request, auto-approved only under a published rule that was itself approved
under four-eyes (NN #15). A run touching more than the configured share of
identities is held. Simulation before publish lists who gains or loses what.
Every evaluation, effect, skip and error goes to the automation run log with
the rule version that decided.

**Where rules live.** Rule tables stay with the module that owns their
subject: `lifecycle_rules` (identity triggers and attribute rules, Identity),
classification rules (Access), `event_subscriptions` (Operations), agent
discovery rules and lifecycle policies (Identity). The rule runtime (parsing,
evaluation, simulation, run log) is one shared library published by
Operations next to the workflow engine (decision D12).

## 8. Lifecycle

**Events** (built): joiner, mover, leaver, rehire, conversion, manager
change, leave of absence, return, cancellation. Today they open fixed task
types for people.

**Lifecycle rules** (F4, §7): birthright on activation or a condition; mover
re-evaluation with a grace period and a targeted review; leaver (disable
sign-in, disable or delete accounts per application policy, revoke access,
transfer owned agents and identities, notify the manager); long leave;
expiry at `end_date` unless the sponsor extends; rehire re-links the old
identity without restoring old access.

**Automation boundary** (NN #15). Birthright grants under a published,
four-eyes-approved rule are an explicitly approved automation path. Leaver
disables are automated per application when the tenant turns that on;
deletes stay a human-approved task. A per-application termination SLA is
tracked; breaches are findings and the SLA report is an ITGC artefact.

**Manager kill action.** "Disable all access now" for an identity: one
confirmed action that creates a leaver plan through connectors and suspends
every agent the person owns as sole owner.

**External identities** (F8). External organizations (vendors, partners)
with a sponsor and a contract end date; invitations and sponsor
re-attestation; a tenant-editable taxonomy of external sub-types (third
party, partner, individual) whose type sets defaults for sponsor requirement,
maximum contract length and review frequency. A contractor with no end date
or sponsor is a finding.

**WonderID members** (the people who sign in). Invite one person today; bulk
invitation by CSV and an invitation API in F2; SSO sign-in once the owner
configures the Supabase SSO provider; passkeys in F9.

## 9. Roles and entitlements

Three kinds of role stay separate: Foundation `roles` are WonderID
permission roles; business and IT roles are bundles of access granted to
identities (F5); application roles are entitlements.

**Entitlements.** Types come from the connector or are declared by hand.
Every entitlement has an owner, a privilege level, a data classification, a
`requestable` flag and a SOX-relevant flag; ownerless entitlements are not
requestable and are listed as a gap. `entitlement_hierarchy` records
"includes" so effective access and SoD see implied entitlements. Per
application, each entitlement type says how it is offered in a request
(single choice, several, free text, shown but not requestable), whether it is
certifiable, whether a parent is required, the default and maximum duration,
and the approval route.

**Business and IT roles** (F5). Enterprise roles contain roles and packages
and are assigned by birthright rules; IT roles contain entitlements across
applications; application roles contain one application's entitlements;
agent roles bundle entitlements and tool permissions for a class of agents.
Lifecycle: draft → in review → published (four-eyes) → deprecated → retired,
every publish a version, two versions comparable, an older one restorable
as a new version. Impact simulation before publish (who gains, who loses,
which SoD rules fire). A role whose contents violate an SoD rule cannot be
published without a mitigating control. A role may carry an assignment
condition (the §7 language) so membership is computed.

**Mining** (F8). Bottom-up clustering by shared entitlements, top-down from
department and title, usage-weighted so dead access is excluded; rule mining
proposes birthright rules from peer groups. Candidates are proposals; a
person publishes.

## 10. Certification

**Campaign types** (F4): manager; entitlement owner; application owner; role
membership; role content; privileged access; service account and machine
identity; AI agent (built); external identity (sponsor: continue, extend,
end); WonderID administrators; event-driven micro-certifications on a mover
event, a new high-risk grant or an SoD exception nearing expiry.

**Scoping.** By organization, application, entitlement, risk; direct or
inherited assignments; outliers against the peer group; exclude access
granted in the last N days.

**Templates and preview.** A campaign is created from a versioned template
(type, scope, reviewers, schedule, reminders) and generated in a *preview*
state, where the owner checks population counts against the latest import
before launch. Scheduled campaigns with cron, next run and time zone.

**Reviewer experience.** Each item shows what the access is, how it was
granted (ledger source), when it was last used (DID), how common it is in the
peer group, SoD conflicts and risk. Decisions: keep, revoke, change end
date, reassign, consult (ask someone without delegating the decision). Bulk
decisions only on items with the same recommendation, recorded per item. No
self-review: the item routes to the reviewer's manager or the fallback
reviewer.

**Closed loop.** Revoke creates a fulfilment task (F2) or a provisioning plan
(F3); the item is *closed* only when the connector confirms removal or the
task completes with evidence. Reports show decided, remediated and
remediation-overdue separately.

**Evidence** (SOX). Per campaign: the population query, parameters,
extraction time and counts reconciled to the latest import; the snapshot
each reviewer saw; every decision with reviewer, time and rationale;
remediation evidence per revoked item; a signed close record in the
hash-chained audit log. Recommendations are deterministic (unused for N days
→ suggest revoke; held by fewer than X% of peers → outlier); AI may summarize
an item, labelled as AI-generated. Auto-closing "keep" decisions is not in
P0 (decision D6).

## 11. Separation of duties

Today WonderID has *action* SoD. This adds *access* SoD.

**Model.** Risk ("create vendor and pay vendor") → conflicting business
functions ("maintain vendor master", "release payments") → each function an
expression over entitlements, possibly across applications, with AND, OR,
NOT and *exclude*; hierarchy expanded before evaluation. Rulesets group risks,
with an owner, a version and a control mapping. Criticality per risk.
Fine-grained SoD (F8) applies the same model to transaction-level
entitlements from ERP connectors.

**Modes.** Preventive at request submit and approve, role publish, rule
publish and emergency access: block, require a mitigating control, add an
approval stage, or warn. Detective nightly and after each import, producing
violations with states open → in review → mitigated or accepted → remediated.
Simulation before a role or rule change. Detective evaluation of an
application waits while an import of that application is running.

**Mitigating controls** (F8). A control has an owner, a description, a test
frequency and evidence; a violation is mitigated by linking a control with an
end date; expiry reopens the violation. **Actual vs potential**: when DID
exists for both functions, an exercised violation sorts first. The workbench
shows the smallest change that clears a violation and whether it comes from a
role or a direct grant; removal still goes through approval and provisioning.
Saved group-by views: person, entitlement, risk, business process,
application. Alerts to risk and control owners on new high or critical
violations and on mitigation expiry.

**Starter rulesets.** A small original set of generic risks ships; customer
or auditor rulesets are imported as data.

## 12. Privileged and emergency access

Governance, not vaulting (CLAUDE.md §10). Privileged, shared and service
accounts must have an owner; a missing owner is a finding. **Just-in-time
elevation** is a request line with a short duration. **Emergency
(break-glass) access** (F8): an eligible person checks out a pre-approved
emergency identity or entitlement with a reason; a short approval, or
post-hoc approval where the policy allows; access granted through the
connector for the window and removed at check-in or expiry; preventive SoD
at check-out. **Post-use review**: the session evidence imported through a
connector (person, target, application type, account, start, end, session
mode, source address, request) goes to a reviewer who signs off or raises a
finding. When the target requires a password checkout, the connector calls
the customer's PAM, which releases it in its own interface; WonderID never
sees the value. Session recording is out of scope; the PAM's recording is
linked as evidence. Target-system password reset is the target's own flow
(decision D5).

## 13. Agent ID

### 13.1 The agent is a non-human identity with a human owner

Built: every agent is an `agents` row linked to an `identities` row of type
AI_AGENT; registration needs purpose, source system and an active business
and technical owner; a versioned contract (SHOULD) with approved and
prohibited applications, data and actions, autonomy 0–4, allowed tools,
approved users and delegators, expiry; a discovery inbox, duplicates, shadow
AI from unregistered runtime callers.

Additions (F6): an accountable **sponsor** distinct from the owners, who
inherits an agent whose sole owner leaves until a new owner accepts; a
stable, tenant-scoped, SPIFFE-compatible **identifier**
(`spiffe://<tenant-trust-domain>/agent/<id>`, a name, no SPIRE required);
**registration channels** (console, API, connector discovery, A2A Agent
Cards, SCIM `/Agents`), all landing in the inbox, nothing REGISTERED without
owners; **agent access packages** scoped to AI_AGENT, approved by resource
owners, limited by the contract; **lifecycle policies** moving an agent to
CERTIFICATION_DUE, RESTRICTED or SUSPENDED by rule on contract expiry,
certification due, owner left or inactivity.

### 13.2 Discovery and management by configuration

- **Discovery rules** on top of the built-in detector: name patterns, account
  types, OAuth client or service-principal types, source tags and labels, MCP
  tool-call origins, unregistered runtime callers; a *feeds agent discovery*
  switch per connection; report-only first, simulation, versions.
- **Agent classes** with contract templates (approved applications, data and
  actions, autonomy, tool allowlist, certification interval, required owners,
  default runtime policy: observe, shadow or enforce); registering from a
  class pre-fills the contract, and the owner still approves it.
- **Tool classification overrides** per tenant for named MCP tools, with a
  reason, on top of the deterministic read, write or destructive
  classification.
- **Discovery sources**: connector definitions for cloud AI platforms,
  model-provider organizations, MCP registries and agent frameworks' control
  planes, so an integrator adds one without code where the API is REST.

### 13.3 Credentials

Today: long-lived per-agent API keys. Target: a **gateway token service** on
the agent's runtime-gateway connection issuing access tokens for the
WonderID gateway audience (and MCP servers that opt in, decision D2). The
agent proves who it is with a private-key JWT assertion, mTLS, a SPIFFE
JWT-SVID from the customer's SPIRE, a cloud workload identity token through a
connector, or (deprecated, short exchange only) a legacy API key. Tokens are
sender-constrained with DPoP (`cnf.jkt`, a fresh proof per call), narrow
(`aud` the gateway, `authorization_details` from contract ∩ effective
access), short (default 5 minutes, 1–15 configurable, no refresh token) and
registered (`agent_tokens`: `jti`, thumbprint, `act` chain, `exp`, status;
ids and hashes only). Issuance fails closed: agent not ACTIVE, contract
missing or expired, owner missing, kill switch on, binding revoked → no
token. The LLM never holds the credential; downstream tools get their own
tokens, never the gateway token. New API keys get a mandatory expiry (≤ 90
days); a tenant can disable API keys once agents have moved.

### 13.4 Delegation chains

A **delegation grant** lets agent A act for user X within scope S until T,
created by X (self-service consent) or by an administrator for a group, only
if A's contract lists X; listed on X's My Access page and revocable in one
click. **Token exchange** (RFC 8693) issues a token with `sub` = X and
`act` = {A}, scope = X's effective access ∩ A's contract ∩ the grant.
**Chains**: agent B exchanges A's delegated token with its own; `act` nests;
depth limited (default 2, up to 4); each hop only narrows scope; B must be
allowed by A's contract. **Decisions use the whole chain**: X must still hold
the access, every actor ACTIVE and permitted, the grant valid; any broken
link → DENY. **No impersonation**: tokens without `act` are never issued to
agents for a user subject. **Human in the loop**: REQUIRE_APPROVAL returns a
pending decision id; X or the resource owner is asked on a separate channel
(in-app or CIBA-style with a binding message); approval issues a single-use,
action-bound token valid for minutes.

### 13.5 Policy check before every action

Built: a pure, fail-closed pipeline (tenant → identity → lifecycle →
emergency → SHOULD → CAN → context → risk → runtime policy) returning ALLOW,
DENY, REQUIRE_APPROVAL or ALLOW_WITH_RESTRICTIONS, explained step by step,
stored immutably, default OBSERVE_ONLY. Additions: an **AuthZEN 1.0** PDP
interface on the runtime-gateway connection (`evaluation`, batch
`evaluations`, `search/action`, discovery metadata); a **delegation step**
and a **token step** (DPoP proof, `jti` replay, revocation,
`authorization_details`); **per-agent rollout** observe → shadow (decisions
computed, "would have denied" counts shown) → enforce, with promotion an
approved action; a latency budget of p95 ≤ 50 ms for a cached decision with
tenant-partitioned caches; obligations a PEP must apply or treat as DENY;
approval resume.

### 13.6 Kill switch and revocation

Levels: a tool or MCP server (suspension, built); an agent (SUSPENDED, all
tokens revoked, API keys revoked, grants paused, CAEP `session-revoked` and
`credential-change` to subscribed receivers, connector disables the agent's
accounts where writes are enabled); a delegation (grant revoked); a person
(leaver plan: every agent they solely own → RESTRICTED); the tenant (every
decision DENY, CAEP to all receivers). With tokens of 15 minutes or less and
every call checking the register, a kill takes effect at the next call,
target ≤ 5 seconds inside WonderID. Suspending is one confirmed action with a
reason; restoring is staged and approved. A critical finding may *propose*
suspension; automatic suspension is decision D4. SSF transmitter and receiver
are connection types.

### 13.7 Audit and risk

Every agent action produces one immutable runtime decision and one audit
event with tenant, agent id and identifier, token `jti`, key thumbprint,
delegation chain, resource, action, context summary, decision, the policy and
contract versions that decided, obligations, latency, correlation id and
`txn`, and the PEP's reported outcome. SHOULD / CAN / DID gains a
*delegated-by* dimension. Risk rules extend with credential hygiene (still on
API keys, key age, too many keys), delegation breadth, chain depth, denied
rate in shadow mode, unapproved tool use and contract expiry.

## 14. Workflow, forms, events and jobs

**Workflow engine** (F7, Operations): declarative definitions of typed nodes
(start, condition, approval delegating to the Access engine, task, connector
operation delegating to provisioning, notification, wait, parallel and join,
sub-workflow, end); idempotent, resumable, every step recorded; workflows
never evaluate policy themselves. They plug into request routes beyond the
built-in ones, lifecycle events, external-identity onboarding, application
onboarding, emergency access and certification remediation. Workflow
definitions are versioned, and a change is itself approved.

**Forms** (F7): versioned typed fields bound to identity, request or
application attributes, with validation and visibility conditions; used for
request justifications, registration of externals, application onboarding
questionnaires and agent onboarding. Named value lists are reusable.

**Event subscriptions** (F7, §7): "when this happens, do that" without a
full workflow: trigger any published governance or runtime event; effects
run workflow, notify, open task, send outbound webhook. An outbound webhook
is a `webhook-out` connection (signed POST, retries, delivery log). Inbound
webhooks at a receiver can be mapped to events so they can trigger a
subscription.

**Notification channels.** E-mail is built; chat and ticketing channels
(Slack, Teams, ServiceNow, Jira) are connections with a `notify` capability;
routing per notification type per tenant; templates per channel, versioned,
with a fixed variable list and preview. A sent-notification log shows
delivery status and failures, as certification evidence.

**Jobs** (F7). One page for every schedule: connector syncs, promotion and
reconciliation, access governance, rule re-evaluation, certifications,
privacy retention; schedule, last and next run, outcome, run now
(permission-gated), history, and the automation run log of every automatic
decision with its input, outcome and error.

## 15. Audit, evidence and intelligence

Built: hash-chained append-only audit with integrity check, exports, eight
reports, ten control frameworks, record provenance on every object.

Additions: audit content aligned to AU-3 and the WIMSE AIMS draft (actor,
on-behalf-of subject, target, action, outcome, tenant, correlation id, `txn`,
token id, policy and rule versions); attribute-level old and new values for
changes to configuration and catalogue objects (never secrets, never erased
personal data); evidence packs per control (the query that produces the
evidence for a period, with population counts); reports for
terminated-with-active-access, orphan and dormant accounts, SoD violations by
risk, privileged access, role coverage, request cycle time, certification
completion and remediation, agent credential age, delegation grants; a
**control history** (per deterministic rule: found, still open, closed per
run) so owners see trends; an identity risk score per identity from
deterministic factors; peer-group outliers; an identity graph; an **identity
security posture** page (ownerless privileged accounts, accounts without MFA
from IdP connectors, stale keys, dormant admins, externals past contract end)
with **owner queues** ("mine") on Control Center; archival of closed
campaigns and old events as downloadable files per retention policy.

Control mappings remain evidence for auditors, never a compliance claim
(CLAUDE.md §10 item 10).

## 16. Administration and the integrator surface

The sidebar areas (Home, Intelligence, Onboarding, Control Center, SOD,
Certifications, AI Agents, Admin) already fit; new capabilities land as pages
in existing areas.

### 16.1 What an integrator configures, and where

| Area | Today (built) | Planned |
|---|---|---|
| Identities | Identity sources with precedence, per-attribute authority, mapping rows, correlation rules, leaver strategy and safety limit; dry-run, full and partial runs; pending-match queue; custom identity attributes; CSV import with a template on every object page | Scheduled runs and custom attributes as targets (F1); attribute and lifecycle rules (F4); registration and sponsor forms (F7); SCIM receiver and external sub-types (F8) |
| Members | Invite one person, status, roles; custom roles, groups, scoped and time-boxed assignments; SSO connection with claims-to-role mapping | Bulk invitation and an invitation API (F2); SSO sign-in once the Supabase provider is configured; passkeys (F9) |
| Applications | Register; onboarding wizard with connector, identifier and correlation fields, policies, validate → simulate → approve → promote; mapping proposals from OpenAPI or a sample; discovery | Entitlement types and classification rules (F4); onboarding templates and questionnaire (F7); provisioning (F3) |
| Connectors | JSON definitions written and tried in the console, versioned per organization | §4.2 extensions (F1, F3, F7) |
| Technical rules | None; packages have eligibility by type and department | Lifecycle rules with simulation and report-only mode (F4) |
| User update rules | None | Attribute rules with provenance and authority (F4) |
| Event-driven rules | Lifecycle events open fixed tasks; inbound webhooks stored as activity; daily schedules on file connections only | Event subscriptions, outbound webhooks, notification channels (F7); schedule on every connection (F1) |
| AI agents | Discovery inbox fed by every identity-importing connection; duplicates; shadow AI; registration, owners, contracts, lifecycle, API keys; MCP inventory; emergency controls; five tuning settings | Discovery rules, discovery switch, agent classes and templates, tool overrides, AI-platform connectors; sponsor and lifecycle policies; credentials and delegation (F6) |
| Policies | Request policies, packages, authorization policies, agent policies | One rules editor (F4); SoD rulesets (F5); runtime policies per class (F6) |
| Tenant settings | Global Configuration, versioned, console only; roles and the permission catalogue; notifications; MFA; AI provider; privacy; billing | Global Configuration API (F1); e-mail templates, jobs, configuration bundles (F7); labels (F9) |
| Automation | None: the API accepts only a browser session | Automation credentials (F1); bundles with diff and approved import (F7); integrator setup test (F7) |

### 16.2 Automation credentials for the administration API

Needs decision D11. An **automation credential** belongs to a tenant-owned
non-human identity of type APPLICATION, so it is governed like any other
(owner, review, expiry): a hashed secret shown once, expiry of at most one
year (default 90 days), optional source-address allowlist, rotation and
revocation, four-eyes on create and extend, never usable for sign-in.
Permissions come from a WonderID role through scoped assignments, so an
integrator's credential can be limited to configuration objects.
`Authorization: Bearer <credential>` on `/api/v1/*`; the tenant resolves from
the credential's row, never from a header or body (NN #2); rate limits per
credential; every action audited with the credential as actor and its owner
as on-behalf-of. Global Configuration, invitations and connection schedules
gain API routes so everything in §16.1 is reachable this way.

### 16.3 Integrator role, sandbox, promotion and guide

A built-in **Configuration administrator** role template (integration,
policy, application and tenant-settings permissions, scoped, time-boxed, MFA
required); a **sandbox** tenant promoted to production through
**configuration bundles** (a signed export of policies, roles, forms,
workflows, definitions and templates, a diff against the target tenant,
import with approval; PLATFORM-P0-13); per-tenant **labels** for terms such
as "Application"; the **integrator guide**
(`docs/integrations/INTEGRATOR-GUIDE.md`) kept in step with each phase.

**Global Configuration rule.** A setting is added to `lib/config/registry.ts`
only with the code that reads it (CLAUDE.md §19.11). Candidates from this
design: token lifetime, delegation depth, termination SLA, review retention,
recommendation peer threshold, mass-missing and mass-effect guard shares.

## 17. Decisions

Open for the owner. Nothing that depends on a decision is built before it.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve this design as the baseline and add its stories to the module backlogs in the run order's phase order | Approve |
| D2 | WonderID issues OAuth access tokens to agents (gateway audience, plus MCP servers that opt in) | Yes, scoped to agents; workforce sign-in stays with the customer's IdP |
| D3 | Enable write operations in connectors (per connection, declared, tenant-enabled, approval-gated). Gates F3 | Yes, starting with reversible operations |
| D4 | A critical finding may automatically suspend an agent, or only propose it | Propose by default; a per-tenant opt-in for agents, never for people |
| D5 | A target-system password reset that shows a new password once | No; trigger the target's own flow |
| D6 | Certifications auto-close low-risk "keep" decisions by rule | Not in P0 |
| D7 | The outbound-only relay instead of a network tunnel | Adopt |
| D8 | The SCIM receiver and the AuthZEN PDP on the public surface as connection receivers (widens the boundary test's allowlist) | Yes, with the boundary-test change approved explicitly |
| D9 | The first non-SCIM connectors | Entra ID, Workday, AWS |
| D10 | How often scheduled imports run; the free Vercel plan allows cron at most daily | Daily plus "run now" for F1; revisit when a customer needs same-day leaver detection |
| D11 | Automation credentials for the administration API (§16.2) | Yes, with the controls listed |
| D12 | One shared rule runtime published by Operations, used by every module's rule tables | Yes; rule tables stay with their owners |

## 18. Security and tenancy

Every proposed table is tenant-scoped with RLS and an isolation test that
proves the negative (NN #1, #2, #4, §14). Tenant context comes from
`getTenantContext()`; for agent tokens and automation credentials, from the
credential's own row. Caches for decisions are keyed by tenant. Agents stay
canonical in Identity, business roles in Access, provisioning in
Integration, workflows and the rule runtime in Operations; modules call each
other's published services (NN #5, #6, #18). SHOULD, CAN and DID stay
separate tables and computations (NN #8). Policy, SoD, risk, routing,
correlation, mining and recommendations are deterministic code; AI drafts,
explains and proposes, labelled (NN #9, #19). No plaintext secret is stored,
shown or logged; templates cannot reference secrets; tokens are stored as ids
and hashes (NN #10). Every change writes an audit event (NN #11). Writes
happen only when declared and enabled (NN #12). All schema changes are
additive (NN #13). Consequential grants and revocations need human approval
except under rules the tenant approved under four-eyes (NN #15). Peer
analytics and mining run within one tenant (NN #16). Every inbound and
outbound path is a connection (NN #20).

**Threats this design answers.** A stolen agent token (DPoP, short life,
register); prompt injection asking for more access (scope = contract ∩
access ∩ grant; the PDP never takes instructions from content; approvals go
to humans on another channel); confused deputy through delegation (every
link re-checked, scope only narrows, depth limited); mass deprovisioning
from a bad file (mass-change and mass-missing guards, staged preview, delete
never automatic); template injection in connector operations (fixed binding
context, driver-side escaping, validation at save); relay compromise
(declared operations only, approved enrolment, key rotation, revoke by
disabling the connection); approval by forwarded link (the link only opens
the page; the decision needs the signed-in approver); self-approval and
self-review (the database four-eyes trigger, extended to delegations, rule
publication and certification items); a leaked automation credential
(expiry, allowlist, role scope, revocation, per-credential rate limit and
audit).

**Evidence for SOX and similar regimes.** New access is approved (request,
chain, task, verification, ledger); timely termination (the SLA report
reconciled to the HR import); periodic review (population, snapshots,
decisions, remediation, close record); privileged access (inventory, owner,
review, emergency sessions with post-use review); separation of duties
(versioned rulesets, violations, mitigating controls and their tests);
change management of WonderID itself (versioned configuration, approved
publishes, hash-chained audit). The NIST SP 800-53 mapping and the standards
list are in `docs/design/WONDERID-FOUNDATION-DESIGN.md` §2 and §7.4 and
remain valid.
