# WonderAgent — Root Engineering Contract

> **WonderAgent** is a vendor-neutral **AI Identity Governance & Runtime Assurance**
> SaaS platform. It makes AI agents first-class enterprise identities by governing
> their ownership, lifecycle, purpose, effective access, runtime behavior,
> certification, risk and remediation across a customer's existing IAM platforms.
>
> **Tagline:** Govern every AI agent. Verify every action.

This file is the binding contract for every Claude Code agent (or human) working on
this repository. It is read by every module agent before it does anything. Nothing in
a module backlog, a PR description, or a convenient shortcut overrides this file.
Changing anything in the "Locked Architecture" or "Architecture Non-Negotiables"
sections requires explicit user approval — not an agent's own judgment call.

The conceptual source of truth is the WonderAgent master PRD. The documents in
`docs/plan/*-BACKLOG.md` are the execution-scoped derivation of that PRD and are what
agents actually implement against.

---

## 1. Architecture Non-Negotiables

These must never erode, one story at a time. If a story appears to require breaking
one of these, the agent stops and reports rather than proceeding. Cite these by
number (e.g. "non-negotiable #3") when discussing scope with the user or in an audit
log entry.

1. Every customer-owned database table must contain `tenant_id` and be protected by
   Supabase PostgreSQL Row Level Security (RLS).
2. Tenant context must come from authenticated server-side membership/claims and
   never from an untrusted frontend-supplied `tenant_id`.
3. Platform Administration is a separate vendor-only authorization boundary and must
   never be accessible to customer users or customer administrators.
4. No cross-tenant data access, inference, caching, search, analytics, event
   processing, background-job or object-storage leakage is permitted.
5. Shared canonical identity/access entities are owned by the Foundation Agent; other
   modules must reference their published contracts rather than create duplicate
   identity concepts. (Scope note: "shared canonical identity/access entities" means
   the human/platform identity primitives — tenant, user, membership, role,
   permission. The AI-agent domain model itself — `agents`, `agent_identities`,
   `agent_contracts`, lifecycle — is a separate canonical domain owned by the
   Identity Agent. Neither module duplicates the other; see the Ownership Map.)
6. Modules must communicate through explicit published contracts/services/types and
   must not import another module's internal implementation.
7. WonderAgent is an AI Identity Governance and Runtime Assurance layer, not a
   replacement IAM, IGA, PAM or SIEM platform; existing IAM remains the system of
   record for identity and access where applicable.
8. SHOULD, CAN and DID are separate concepts: SHOULD represents approved agent
   purpose/policy/contract, CAN represents effective technical capability, and DID
   represents observed runtime behavior.
9. Deterministic authorization, risk, policy, tenant-isolation and remediation
   decisions must never depend solely on an LLM.
10. Secrets, API credentials, OAuth tokens, private keys and integration credentials
    must never be exposed to browser code, logs or source control.
11. All security-sensitive actions must produce an immutable/auditable audit event
    with actor, tenant, target, action, timestamp, outcome and correlation context.
12. External integration capabilities must be declared explicitly and connectors must
    not silently perform write/remediation operations when configured as read-only.
13. Every schema change must have a controlled migration and must preserve backward
    compatibility with already implemented module contracts unless explicitly
    approved.
14. No module may silently change a shared database schema, authentication model,
    RBAC model or integration contract owned by another module.
15. Human approval is required for consequential access grants, revocations, policy
    overrides and destructive remediation in P0 unless an explicitly approved
    automation path exists.
16. Customer data must never be used across tenants for AI prompts, analytics,
    search, recommendations or model context.
17. The canonical WonderAgent data model must remain vendor-neutral so Saviynt,
    SailPoint, Entra, Okta, custom IAM, MCP and future systems can map into it
    without making any one vendor the internal architecture.
18. A module agent must never modify another module's implementation merely to make
    its own story pass; instead record the dependency or required contract change in
    its audit log and stop if explicit ownership approval is required.

---

## 2. Locked Architecture

Changing anything below requires explicit user approval.

### Stack

- Next.js (App Router) + TypeScript + React + Tailwind CSS
- An accessible UI component library (Radix UI primitives, styled with Tailwind)
- A charting library (for risk/trend dashboards) and a graph visualization library
  (for the effective-access graph)
- Supabase PostgreSQL + Supabase Auth + PostgreSQL RLS
- Vercel (hosting) + GitHub (source control) + Claude Code (development)

### Tenancy model

WonderAgent is multi-tenant SaaS from day one.

```text
WonderAgent Platform
    |
    +-- Tenant A: Users, Agents, Policies, Integrations, Applications, Certifications, Audit
    +-- Tenant B
    +-- Tenant C
```

- Every customer-owned record carries `tenant_id` and is protected by RLS.
- Tenant context is resolved server-side from the authenticated user's membership/JWT
  claims — never trusted from the client.
- Platform Administration (`/platform-admin`) is a wholly separate authorization
  boundary, reachable only by WonderAgent platform-owner identities, never by any
  customer role.

### Module boundaries

The product is decomposed into 11 modules, each owned by one named agent. An agent
may only implement its own module's backlog (`docs/plan/NN-*-BACKLOG.md`) and may
only create/modify database tables, routes, services and shared types listed as
"owned by this module" in `docs/design/ownership-map.md`.

| # | Agent name | Module | Owns |
|---|---|---|---|
| 01 | **Foundation Agent** | Foundation, Authentication, Tenancy, Security & RBAC | Project architecture, shared DB foundation, tenant model, Supabase Auth, SSO foundation, customer RBAC, permissions, security primitives, shared types/contracts, RLS, security policies, module ownership registry |
| 02 | **Identity Agent** | AI Agent Identity & Lifecycle | AI agent registration, canonical agent identity, agent metadata, ownership, identity relationships, lifecycle states, agent discovery, agent contracts/purpose, lifecycle governance |
| 03 | **Integration Agent** | Integration Hub & Connectors | Integration framework, connector architecture, Saviynt read integration, generic REST integration, MCP integration, webhooks, integration credentials/configuration, sync jobs, external-object mapping |
| 04 | **Access Agent** | Effective Access & Access Governance | Effective access graph, access paths, IAM-derived permissions, entitlements, roles, groups, delegated access, OAuth scopes, application roles, tool permissions, access requests, policy management/evaluation, access governance analysis |
| 05 | **Runtime Agent** | Runtime Assurance & SHOULD/CAN/DID | Runtime event model, activity timeline, MCP runtime observation, tool/resource/action events, SHOULD calculation, CAN correlation, DID calculation, runtime comparison views |
| 06 | **Risk Agent** | Risk Engine & Rogue Agent Detection | Deterministic risk scoring, policy violations, excessive access detection, unauthorized resource/action detection, sensitive-data violations, behavioural deviation, identity anomalies, ownership/lifecycle violations, findings, rogue-agent detection |
| 07 | **Compliance Agent** | Certification, Controls & Compliance | Agent access certification, certification campaigns, certification decisions, evidence, control mappings, control-framework foundation, compliance views, review workflows |
| 08 | **Experience Agent** | Customer UI/UX | Customer-facing navigation, dashboards, agent screens, access views, runtime views, risk views, certification UI, responsive layouts, tables, cards, visualizations, UX consistency |
| 09 | **Platform Agent** | Vendor Platform Administration | Vendor-only `/platform-admin` console, tenant management, subscriptions, feature flags, global configuration, integration catalog, usage, platform health, support access, platform audit |
| 10 | **Operations Agent** | Audit, Reporting, Notifications & Search | Audit views, audit evidence presentation, reports, notifications, search, operational dashboards, exports, customer reporting |
| 11 | **QA Agent** | Final Integration, QA & Security Hardening | Cross-module integration verification, end-to-end testing, security testing, tenant-isolation testing, RBAC testing, performance checks, migration validation, architecture-boundary checks, regression testing, production hardening |

Full table/route/API/contract-level ownership is in
[`docs/design/ownership-map.md`](docs/design/ownership-map.md). No agent may create a
duplicate concept simply because it could not immediately find the existing one —
check the ownership map first.

---

## 3. Development Principles

- Prefer the simplest implementation that satisfies the story's acceptance criteria.
- Do not add speculative functionality ahead of the current story.
- Do not use an LLM for anything deterministic (authorization, risk scoring, policy
  evaluation, tenant isolation, remediation decisions).
- Every feature needs tests. Isolation/access-control tests are mandatory for
  anything touching shared or tenant-scoped data.
- Do not refactor unrelated code while implementing a story.
- Reuse existing patterns already established by the Foundation Agent; do not
  introduce a competing framework, ORM, state-management approach, or design system.
- Real authorization, validation and persistence only — never fake security behavior
  with UI-only checks.

---

## 4. Workflow

Each agent works one story at a time from its own backlog doc:

1. **Before starting a story**: read this file, the module's backlog
   (`docs/plan/NN-*-BACKLOG.md`), the tail of its own audit log
   (`docs/design/*-backlog-audit.md`), and `docs/design/ownership-map.md` to confirm
   no duplicate concept already exists.
2. **Implement** the story to its stated acceptance criteria — no more, no less.
3. **Verify** using the full pipeline (typecheck, lint, architecture/import-boundary
   lint if present, migration lint if present, the module's own tests, and — if a
   live dev database is available — apply migrations to the dev Supabase project and
   re-check advisories). Build the app if UI/routes changed.
4. **Update the module's own audit log** with a dated entry: what was built, how it
   was verified, what was deliberately left out or deferred.
5. **Commit** with a focused message scoped to the story, then push and merge per
   [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).
6. Move to the next unfinished story. Never restart or duplicate completed work.

If a story's correct behavior depends on a real architecture or security decision the
backlog doesn't fully specify, stop and record the open question in the audit log
instead of guessing — see `docs/ORCHESTRATION.md` for the full stop-and-report rule.

---

## 5. Repository Structure

```text
CLAUDE.md                          # this file
docs/
  ORCHESTRATION.md                 # standing multi-agent orchestration policy
  design/
    ownership-map.md               # table/route/API/type ownership across modules
    foundation-agent-backlog-audit.md
    identity-agent-backlog-audit.md
    integration-agent-backlog-audit.md
    access-agent-backlog-audit.md
    runtime-agent-backlog-audit.md
    risk-agent-backlog-audit.md
    compliance-agent-backlog-audit.md
    experience-agent-backlog-audit.md
    platform-agent-backlog-audit.md
    operations-agent-backlog-audit.md
    qa-agent-backlog-audit.md
  plan/
    01-FOUNDATION-AGENT-BACKLOG.md
    02-IDENTITY-AGENT-BACKLOG.md
    03-INTEGRATION-AGENT-BACKLOG.md
    04-ACCESS-AGENT-BACKLOG.md
    05-RUNTIME-AGENT-BACKLOG.md
    06-RISK-AGENT-BACKLOG.md
    07-COMPLIANCE-AGENT-BACKLOG.md
    08-EXPERIENCE-AGENT-BACKLOG.md
    09-PLATFORM-AGENT-BACKLOG.md
    10-OPERATIONS-AGENT-BACKLOG.md
    11-QA-AGENT-BACKLOG.md

app/                                # Next.js App Router routes (thin: compose modules)
  (customer)/...                    # customer-facing routes — owned by Experience Agent
  platform-admin/...                # vendor-only routes — owned by Platform Agent
  api/v1/...                        # customer-facing API routes, one subtree per module
  api/platform/v1/...                # platform-admin API routes — owned by Platform Agent

lib/
  security/                        # Foundation: security primitives, secret handling
  tenant/                          # Foundation: tenant context resolution
  auth/                            # Foundation: Supabase Auth + SSO wiring
  rbac/                            # Foundation: RBAC/permission checks
  audit/                           # Foundation: shared audit-log writer
  db/                              # Foundation: Supabase server/browser clients
  shared/
    types/                         # Foundation-owned shared/published TypeScript contracts

modules/
  agent-identity/                  # Identity Agent
  integrations/                    # Integration Agent
  access-governance/               # Access Agent (effective access + policy engine)
  runtime-assurance/                # Runtime Agent
  risk/                            # Risk Agent
  certification-compliance/         # Compliance Agent
  ui/                              # Experience Agent: composition components, shell
  platform-admin/                  # Platform Agent: platform-only services
  operations/                      # Operations Agent: audit/reports/notifications/search

supabase/
  migrations/                      # sortable, prefixed per module, e.g. 0001_foundation_*.sql

tests/                              # cross-module integration/E2E tests — QA Agent
```

Each module's route/service code lives under its own directory. `app/` route files
should stay thin and delegate to the owning module's service functions in `modules/*`
or `lib/*`. A module may add its own migration(s) but must never edit or rewrite
another module's migration file. Use sortable, unique numeric prefixes
(`0001_`, `0002_`, ...) allocated in the order migrations are actually created —
coordinate through the audit log, not by guessing at a number.

Claude Code may adapt file-level details to whatever the repository's structure
already establishes rather than rigidly recreating this tree if a very good reason
exists — but must not change module *ownership* without user approval.

---

## 6. Module Ownership Map

See [`docs/design/ownership-map.md`](docs/design/ownership-map.md) for the full table
of database tables, API route prefixes, and shared contracts, and which module owns
each one. No agent may create a table, route or shared type that duplicates
something already listed there as owned by another module.

---

## 7. Agent Dispatch Instructions

- Only the **Foundation Agent** is started initially. All other agents remain dormant
  until explicitly started by the user.
- The user starts an agent by referring to its assigned name, e.g. **"Run Identity
  Agent"**, **"Run Integration Agent"**.
- When an agent is started, it must read this file (`CLAUDE.md`), its module backlog,
  and the tail of its own audit log before doing anything.
- An agent must never automatically start, invoke, delegate to, or implement another
  module's agent.
- An agent must never assume another module is complete merely because its backlog
  document exists.
- If a required dependency from another module is not implemented yet: use the
  documented contract/stub only where the consuming module's backlog explicitly
  permits it; otherwise record the dependency in the audit log and stop rather than
  inventing that module's architecture.
- An agent must not claim ownership of another module's tables, routes or services in
  its status reports.

Use these exact agent names everywhere (status reports, audit logs, commits):

`Foundation Agent`, `Identity Agent`, `Integration Agent`, `Access Agent`,
`Runtime Agent`, `Risk Agent`, `Compliance Agent`, `Experience Agent`,
`Platform Agent`, `Operations Agent`, `QA Agent`.

When started, an agent must report: agent name, module owned, current
branch/worktree, current story, dependencies being consumed, tables/entities it owns,
tables/entities it is consuming, and verification status.

**Current status:** Only the **Foundation Agent** is active. All other agents are
dormant pending explicit user dispatch.

---

## 8. Standing Orchestration Policy

The full mechanics (worktree/branch model, merge fallback, verification pipeline,
budget/stop rules, the stop-and-report rule for genuine ambiguity) are in
[`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md). Every agent must follow it.

---

## 9. Core Product Model

The canonical model must be preserved by every module that touches these concepts:

```text
AI Agent → Ownership → Lifecycle → Purpose/Identity Contract → SHOULD
    → IAM/Technical Access → CAN
    → Runtime Activity → DID
    → Risk → Finding → Certification → Remediation → Re-evaluation
```

- **SHOULD** — what the agent is approved to do (from its Agent Contract and
  policies).
- **CAN** — what the agent can technically do, based on effective access computed
  from IAM data.
- **DID** — what the agent actually did, based on observed runtime activity.

---

## 10. Product Boundaries — WonderAgent is NOT

1. A replacement IAM/IGA platform.
2. A replacement PAM platform.
3. A replacement SIEM/SOC platform.
4. A generic AI agent registry whose primary value is inventory alone.
5. Another MCP server.
6. An autonomous system that independently grants or revokes sensitive enterprise
   access without approved human/governance controls.
7. A generic NHI (non-human identity) platform in P0.
8. A custom LLM/model platform.
9. A proprietary graph database platform.
10. A basis for claiming an organization is "ISO compliant" merely because
    WonderAgent provides control mappings or evidence.

---

## 11. P0 Acceptance Scenario (the central acceptance test)

Every module must keep this scenario buildable end-to-end:

Customer has Saviynt + FinanceBot + MCP runtime. WonderAgent imports FinanceBot's
identity and access from Saviynt. The administrator defines FinanceBot's approved
purpose as financial reporting, owner as Finance Operations, approved applications as
SAP and Snowflake, approved data as financial reporting data, and approved actions as
READ and REPORT. WonderAgent receives runtime events showing FinanceBot accessing
Snowflake CustomerDB. The system calculates SHOULD = financial data only, CAN =
financial data + CustomerDB, DID = CustomerDB, generates a CRITICAL finding with
evidence, recommends removal of the unauthorized CustomerDB entitlement, allows a
human administrator to initiate remediation through the connected IAM workflow,
re-evaluates the agent after the access change, and resolves the finding when the
unauthorized access is removed.

---

## 12. Definition of Done

A feature is complete only when:

- The implementation matches the backlog's acceptance criteria.
- Tests are present and passing.
- Tenant isolation is verified where applicable.
- RBAC and authorization are verified where applicable.
- Migrations are validated (additive, tenant-safe, RLS present on new tables).
- Architecture/import boundaries are respected (no reaching into another module's
  internals).
- No secrets are exposed (browser bundle, logs, source control).
- Audit logging is implemented for security-sensitive operations.
- Responsive UI is verified for UI changes (desktop and mobile breakpoints, no
  overlap/clipping).
- TypeScript/lint/build checks pass where applicable.
- The module's own audit log is updated.
- The change is committed with a focused message, the feature branch is pushed, and
  the story is merged into the integration branch per `docs/ORCHESTRATION.md`.

---

## 13. Secrets & Environment

- Supabase project: `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are safe for client-side use.
- The Supabase **service role key** is a server-only secret. It must live only in
  `.env.local` (gitignored) or the hosting platform's encrypted environment variable
  store (Vercel project settings) — never in a committed file, never in client code,
  never printed to logs.
- This is the **only** database this project may connect to. No other database or
  data store may be introduced for WonderAgent without explicit user approval.
- See `.env.local.example` for the required variable names (no real values are
  committed).
