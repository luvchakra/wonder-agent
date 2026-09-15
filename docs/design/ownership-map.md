# WonderAgent — Module Ownership Map

This is the authoritative map of who owns what. Before creating a table, route,
service, API contract or shared type, check here first — if it already exists (or is
listed as belonging to another module), consume it instead of duplicating it. If you
believe something is missing, propose the addition in your audit log rather than
silently creating it if it would live in a shared/foundation location.

Legend: **FA**=Foundation Agent, **IA**=Identity Agent, **INT**=Integration Agent,
**AA**=Access Agent, **RA**=Runtime Agent, **RiskA**=Risk Agent,
**CA**=Compliance Agent, **EA**=Experience Agent, **PA**=Platform Agent,
**OA**=Operations Agent, **QA**=QA Agent.

## 1. Database tables

| Table | Owner | Notes |
|---|---|---|
| `tenants` | FA | Core tenant record |
| `tenant_settings` | FA | Per-tenant configuration |
| `users` | FA | Maps to Supabase Auth users |
| `tenant_memberships` | FA | User ↔ tenant, source of tenant context |
| `roles` | FA | Customer RBAC roles |
| `permissions` | FA | Granular permission strings (e.g. `agent.read`) |
| `role_permissions` | FA | Role ↔ permission |
| `user_roles` | FA | User ↔ role (scoped to tenant) |
| `sso_connections` | FA | SAML/OIDC IdP configuration per tenant |
| `audit_logs` | FA (write primitive) / OA (read, presentation, search) | Foundation owns the schema and the `writeAudit()` utility every module calls; Operations owns audit views, evidence export and search over it. No module writes to this table by hand — always through the shared utility. |
| `agents` | IA | Canonical AI agent identity |
| `agent_identities` | IA | Correlation to IAM/service-account/workload identities |
| `agent_owners` | IA | Business/technical/IAM/application owner assignments |
| `agent_lifecycle_events` | IA | Audited lifecycle state transitions |
| `agent_contracts` | IA | The Approved Agent Contract (source of SHOULD) |
| `agent_relationships` | IA | Agent-to-agent / agent-to-tool relationships |
| `applications` | AA | Canonical application registry (governed access-graph entity) |
| `accounts` | AA | Accounts an agent/identity holds on an application |
| `entitlements` | AA | Roles/permissions/entitlements on an application |
| `access_grants` | AA | Effective grants (direct, inherited, group, delegated, etc.) |
| `access_paths` | AA | Materialized/explainable path from agent → data |
| `policies` | AA | Identity/Access/Runtime/Agent/Lifecycle policy definitions |
| `policy_rules` | AA | Individual rule conditions within a policy |
| `policy_exceptions` | AA | Approved exceptions to a policy |
| `policy_evaluations` | AA | Evaluation results/audit trail of policy checks |
| `runtime_events` | RA | Normalized runtime event stream |
| `runtime_tools` | RA | Tool inventory observed/declared at runtime |
| `runtime_resources` | RA | Resource inventory observed at runtime |
| `risk_findings` | RiskA | Findings (rogue/policy/risk) |
| `risk_evidence` | RiskA | Evidence records backing a finding |
| `risk_severity_weights` | RiskA | Tenant-configurable severity-factor weight overrides (RISK-P0-02.2) |
| `certification_campaigns` | CA | Certification campaign definitions |
| `certification_items` | CA | Individual access items under review in a campaign |
| `certification_decisions` | CA | Reviewer decisions (approve/revoke/modify/delegate/request info) |
| `control_frameworks` | CA | ISO 27001/42001, NIST AI RMF/CSF, SOC 2, CIS, etc. |
| `controls` | CA | Individual controls within a framework |
| `control_mappings` | CA | Control ↔ WonderAgent policy mapping |
| `control_evidence` | CA | Evidence attached to a control |
| `integrations` | INT | Configured integration instances |
| `integration_types` | INT | Catalog of supported connector types |
| `integration_credentials` | INT | Encrypted, server-only credential storage |
| `integration_sync_jobs` | INT | Async job records (status, counts, errors, correlation id) |
| `integration_objects` | INT | Raw imported objects prior to normalization |
| `integration_mappings` | INT | Field/object mapping configuration per integration |
| `notifications` | OA | In-app/email notification records |
| `reports` | OA | Saved/scheduled report definitions |
| `platform_tenants` | PA | Platform-admin view/metadata of tenants (subscription, limits, status) |
| `platform_feature_flags` | PA | Global feature flag catalog |
| `feature_flags` | PA | Per-tenant feature flag state |
| `subscriptions` | PA | Per-tenant plan/subscription record |
| `platform_audit_logs` | PA | Platform-admin action audit (separate from tenant `audit_logs`) |
| `platform_config_versions` | PA | PLATFORM-P0-05.3 — version history for branding/feature-flag-default config changes, with rollback |
| `platform_announcements` | PA | PLATFORM-P0-05.4 — maintenance-mode windows and platform notices (global or per-tenant scope); Experience Agent renders via the published `getActiveAnnouncements()` read contract, not by querying this table directly |
| `agent_duplicate_candidates` | IA | IDENTITY-P0-04 (duplicate detection/merge review) — migration `0041`, built 2026-09-14 |
| `agent_attestations` | IA | Planned — IDENTITY-P1-02 (attestation), not yet implemented |
| `integration_exports` | INT | Planned — INTEGRATION-P1-05 (SIEM export delivery/retry status), not yet implemented |
| `runtime_event_quarantine` | RA | RUNTIME-P0-11 (ingestion hardening: replay protection/quarantine) — migration `0043`, built 2026-09-14 |
| `risk_campaigns` / `risk_campaign_items` | RiskA | Planned — RISK-P1-03 (risk campaigns), not yet implemented |
| `platform_ai_provider_configs` | PA | Planned — PLATFORM-P0-05.2 (AI provider configuration), not yet implemented |
| `platform_announcements` | PA | Planned — PLATFORM-P0-05.4 (maintenance mode/platform announcements); Experience Agent will need a read-only contract to render these in the customer shell once built |
| `notification_preferences` | OA | OPERATIONS-P0-05.1 (notification preferences) — migration `0048`, built 2026-09-14 |

### Pending ownership/architecture decisions (2026-09-14 requirements refresh — not resolved, flagged for the user)

- **Tamper-evident evidence export** (Compliance's new COMPLIANCE-P0-06) overlaps with
  Operations Agent's existing ownership of generic audit-evidence export/presentation.
  Undecided: does Compliance build a control/certification-specific export package that
  calls into Operations' export primitive, or does Operations own the export mechanism
  entirely with Compliance only supplying the data? Do not build either side of this
  until the user picks a direction.
- **Auditor Workspace** (Compliance P2) implies an external/semi-external read-only
  access mode that fits neither the current customer RBAC model nor the platform-admin
  boundary (non-negotiable #3). Needs an explicit architecture decision before any P2
  design work starts.
- **Point-in-time effective access** (Runtime's new RUNTIME-P0-13) needs Access Agent
  to publish a new "effective access as of a given timestamp" contract; Access Agent's
  current `getEffectiveAccess()`/`explainAccessPath()` only resolve *current* state.
  Not yet requested of Access Agent — record here so it isn't invented unreviewed by
  Runtime Agent when this story is picked up.

### Pending ownership/architecture decisions (2026-09-15 governance requirements reconciliation — not resolved, flagged for the user)

Full detail and section-by-section mapping in
[`docs/design/governance-requirements-reconciliation-2026-09-15.md`](governance-requirements-reconciliation-2026-09-15.md).
None of these were assigned to a module unilaterally:

- **Human Oversight / Autonomy Model** — no module owns an agent
  autonomy-level (0-4) concept yet; it's the root dependency for the
  contract's autonomy field, the SHOULD-vs-CAN autonomy comparison row, and
  a 4-state (allowed / allowed-with-approval / restricted / prohibited)
  action-governance model. Likely Identity Agent (contract field) +
  Access Agent (policy enforcement), but not decided.
- **Governance Readiness Policy** — a "is this agent production-ready" gate
  (risk assessment done, access review complete, human oversight policy,
  runtime monitoring configured, certification schedule set) reads across
  Identity/Access/Compliance data; unclear whether it's a new Identity
  Agent lifecycle precondition, a new Access Agent policy type, or its own
  concept.
- **Governance Posture** — a composite governed/partially-governed/
  non-compliant/exception-approved/suspended score, explicitly distinct
  from Risk Agent's risk score. No existing module owns this; candidates
  are Compliance Agent, Identity Agent, or a new concept. The largest
  single open item from the 2026-09-15 reconciliation.
- **Governance Attestation** — priority conflict (Identity's own
  `IDENTITY-P1-02` is P1; the new doc asks for P0) plus an ownership
  question (Identity's narrow self-attestation vs. a broader
  approver/decision/evidence shape closer to Compliance's
  `certification_decisions`).
- **Governance Exceptions consolidation** — three candidate "exception"
  concepts now exist in different documents (Access's `policy_exceptions`,
  Compliance's planned `CERT-P1-04`, and this doc's generic governance
  exception); needs the user to pick one canonical model rather than three
  modules each owning a slightly different one.
- **Governance Drift** — no module computes cross-module drift
  (purpose/owner/access/autonomy/runtime changes) as one signal today.
  Candidates: Risk Agent (detection specialist) or Identity Agent (owns
  change history).
- **Governance Evidence Pack** — escalates, not duplicates, the existing
  Compliance-vs-Operations evidence-export ownership question above; the
  new doc's per-agent evidence-pack scope is a superset of both and now
  explicitly includes attestation/exception data that doesn't exist yet.
- **AI-Assisted Investigation** — nothing in the codebase touches an LLM
  API today; needs a provider/data-boundary/ownership decision (likely
  Experience Agent for the UI plus a new shared `lib/ai/` read-only
  primitive) before any module builds toward it.

`agent-identity` (IA) and `access-governance` (AA) are deliberately separate: IA owns
*who the agent is*; AA owns *what it can reach*. Integration (INT) owns the raw
imported objects and the mapping layer that correlates them into IA's/AA's canonical
tables — INT never writes directly into `agents`, `agent_identities`, `applications`,
`entitlements`, etc.; it publishes normalized data through a contract that IA/AA
consume and persist into their own tables.

## 2. API route prefixes

| Prefix | Owner |
|---|---|
| `/api/v1/auth`, `/api/v1/users`, `/api/v1/roles`, `/api/v1/tenant`, `/api/v1/sso` | FA |
| `/api/v1/agents`, `/api/v1/agents/:id` | IA |
| `/api/v1/integrations` | INT |
| `/api/v1/access`, `/api/v1/policies` | AA |
| `/api/v1/runtime` (events, agents/:id/compare, agents/:id/did, data-quality, quarantine) | RA |
| `/api/v1/findings`, `/api/v1/risk` | RiskA |
| `/api/v1/compliance` (campaigns, control-mappings, controls, items) | CA |
| `/api/v1/reports`, `/api/v1/audit`, `/api/v1/search`, `/api/v1/notifications`, `/api/v1/notification-preferences`, `/api/v1/jobs` | OA |
| `/api/platform/v1/tenants`, `/api/platform/v1/subscriptions`, `/api/platform/v1/features`, and all other `/api/platform/v1/*` | PA |

All API authorization happens server-side, inside the route handler or a shared
middleware — never inferred from the client.

## 3. UI route ownership (composition vs. domain logic)

Experience Agent (EA) owns the composition, layout, navigation and shared UI
components under `app/(customer)/*` and `modules/ui/*`. Domain modules own the data
fetching/business logic those pages call into, exposed as functions/hooks EA
composes — EA does not invent domain logic, and domain modules do not own page
layout. Platform Agent (PA) owns `app/platform-admin/*` end-to-end (both composition
and logic), since it is a separate authorization boundary that must not depend on the
customer-facing shell.

## 4. Shared TypeScript contracts

Location: `lib/shared/types/`.

- Owned and published by **Foundation Agent**: tenant, user, membership, role,
  permission, session/auth context, RBAC guard types, the `AuditEvent` type, base
  API response/error envelope types.
- Each domain module publishes its own contract types under
  `lib/shared/types/<module>.ts` (e.g. `lib/shared/types/agent-identity.ts`,
  `lib/shared/types/access-governance.ts`) — the module owns that file, but it lives
  in the shared location so other modules can import types without reaching into
  `modules/<owner>/internal/*`.
- A module may only add to or extend its own contract file. Changing a contract
  published by a different module requires that owning module's agent (or explicit
  user direction per `CLAUDE.md` §4 non-negotiable #14/#18).

## 5. Adding something not listed here

If a story needs a table, route or type that isn't listed above and doesn't
obviously belong to your module:

1. Check whether it's actually a variant of something already owned elsewhere.
2. If it's genuinely new and within your module's charter, add it and update this
   file in the same commit.
3. If it's ambiguous or would plausibly belong to another module, record the
   question in your audit log and stop rather than guessing.
