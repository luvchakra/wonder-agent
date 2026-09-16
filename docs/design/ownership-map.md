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
| `governance_attestations` | CA | COMPLIANCE-P0-08 — broad governance attestation decisions (agent/policy/checklist/approver/decision/evidence) |
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
| `governance_attestations` | CA | Planned — COMPLIANCE-P0-08 (broad Governance Attestation, resolved 2026-09-15), not yet implemented |

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

### Governance requirements decisions (2026-09-15 — resolved same day via `AskUserQuestion`)

Full detail and section-by-section mapping in
[`docs/design/governance-requirements-reconciliation-2026-09-15.md`](governance-requirements-reconciliation-2026-09-15.md).
The user answered every open question from that pass; recorded here as the
now-current ownership assignments (each also detailed in its owning
module's own `## Requirements Refresh — 2026-09-15` section):

- **Human Oversight / Autonomy Model → Identity Agent** (new
  `agent_contracts` fields: autonomy level, allowed tools, human-approval
  requirement, required monitoring — `IDENTITY-P0-07`) **+ Access Agent**
  (enforces the resulting 4-state action-governance model —
  `ACCESS-P0-06`).
- **Governance Readiness Policy** — not separately decided; folds into
  whichever of the above actually ships (Identity's contract fields +
  Access's enforcement), not a distinct concept after all.
- **Governance Posture → Compliance Agent** (`COMPLIANCE-P0-07`) — a
  read-model computed from every other module's published contract, not a
  duplicated table; explicitly distinct from Risk Agent's risk score.
- **Governance Attestation → Compliance Agent, promoted to P0, broad scope**
  (`COMPLIANCE-P0-08`, new `governance_attestations` table — added to §1
  below). Identity Agent's own narrower `IDENTITY-P1-02` self-attestation
  concept is unchanged and still P1 — two different, both-legitimate
  attestation concepts now exist; do not merge them without asking again.
- **Governance Exceptions → Access Agent's `policy_exceptions`, broadened**
  (`ACCESS-P0-07`) to be the canonical exception model for any governance
  requirement, not just access policy. Compliance Agent's planned
  `CERT-P1-04` will reference this table rather than introduce its own.
- **Governance Drift → Risk Agent** (`RISK-P0-04`, a new `governance_drift`
  finding category in the existing `risk_findings`/`risk_evidence` — no new
  table).
- **Governance Evidence Pack → Compliance assembles, Operations exports**
  (`COMPLIANCE-P0-09` produces the structured per-agent bundle by calling
  every relevant module's contract; `OPERATIONS-P0-07` turns it into a
  downloadable PDF/CSV/JSON file, reusing `OPERATIONS-P0-01.2`'s existing
  export mechanism).
- **AI-Assisted Investigation → start now, read-only summaries only.**
  Foundation Agent owns a new shared `lib/ai/` primitive (`FOUNDATION-P0-16`
  — read-only, advisory-only, never a decision input, matching how
  `lib/audit/writeAudit()` is a Foundation-owned cross-module primitive);
  Experience Agent owns the UI surface (`EXPERIENCE-P0-14`).

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
| `/api/v1/ai/summarize` | FA — pure passthrough wrapper over `lib/ai/summarize.ts` (FOUNDATION-P0-16); added by Experience Agent to unblock `EXPERIENCE-P0-14`, since no domain module owns this cross-cutting primitive |
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
