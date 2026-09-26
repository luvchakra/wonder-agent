# WonderID (WonderAgent lineage) — Module Ownership Map

> **2026-09-26 — WonderID.** Ownership is unchanged by the WonderID adoption: every
> WonderID capability is owned by the existing module that owns its domain (see
> `CLAUDE.md` §2 and `docs/plan/WONDERID-ROADMAP.md`). New tables are added to the
> list below by the story that creates them, in the same commit.

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
| `tenants` | FA | Core tenant record. Slug is the tenant's address: policy-checked, immutable; `suspended_at`/`suspension_reason` (FOUNDATION-P0-22, 0095) |
| `tenant_domains` | FA | Hostnames a tenant is reached at: PLATFORM_SUBDOMAIN (label under `BASE_APP_HOST`, created by trigger) or CUSTOM_DOMAIN (verification P1). Select-only RLS; `resolve_tenant_host()` is the one public lookup (FOUNDATION-P0-22, 0095) |
| `tenant_settings` | FA | Per-tenant configuration |
| `users` | FA | Maps to Supabase Auth users |
| `tenant_memberships` | FA | User ↔ tenant, source of tenant context. Lifecycle (FOUNDATION-P0-23, 0096): invited, active, suspended, deactivated, removed; who changed it, when and why; invitation, account type, sign-in method. No self status change; last Tenant Administrator guarded in the database |
| `roles` | FA | Customer RBAC roles. System roles (tenant_id null) are protected in the database and change only by migration; custom roles (FOUNDATION-P0-25, 0098) are tenant-owned, with display name, status (inactive grants nothing), creator and copy source; never assigned outside their tenant |
| `permissions` | FA | Granular permission strings (e.g. `agent.read`), the stable ids. Catalogued (FOUNDATION-P0-24, 0097): resource, action, module, label and sensitivity are required; only migrations add keys |
| `role_permissions` | FA | Role ↔ permission |
| `user_roles` | FA | User ↔ role (scoped to tenant). `granted_by` (0096), never the user themselves; removing the last Tenant Administrator role is refused in the database. Terms (0100): scope (tenant, environment, application, agent), starts_at/expires_at, requires_mfa; a Tenant Administrator assignment stays unconditional |
| `groups` | FA | Tenant-owned groups of people (FOUNDATION-P0-26, 0099): name unique per tenant (case-insensitive), description, status. RLS select for the tenant's members; writes by the service only |
| `group_members` | FA | Group ↔ member (0099). Composite foreign keys keep the group and the member in the same tenant; nobody is recorded as adding themselves |
| `group_roles` | FA | Group ↔ role (0099): a system role or the tenant's own custom role (trigger); never granted by a member of the group (trigger, 42501). `getTenantContext()` combines these with direct roles on every request |
| `authorization_policies` | FA | Explicit tenant authorization policies (FOUNDATION-P0-19, 0100): DENY or REQUIRE_APPROVAL for permission keys or `prefix.*`, scoped to the tenant, environments, applications or agents, with exempt roles. Never covers `tenant.security.manage` (check constraint). RLS select for members; writes by the service with `tenant.security.manage`. Read on every request by `getTenantContext()` |
| `sso_connections` | FA | SAML/OIDC IdP configuration per tenant |
| `audit_logs` | FA (write primitive) / OA (read, presentation, search) | Foundation owns the schema and the `writeAudit()` utility every module calls; Operations owns audit views, evidence export and search over it. No module writes to this table by hand — always through the shared utility. |
| `agents` | IA | Canonical AI agent identity |
| `agent_identities` | IA | Correlation to IAM/service-account/workload identities |
| `agent_owners` | IA | Business/technical/IAM/application/data/escalation/delegated owner assignments, with delegation expiry and ownership-review stamps (IDENTITY-P0-13) |
| `agent_lifecycle_events` | IA | Audited lifecycle state transitions |
| `agent_contracts` | IA | The Approved Agent Contract (source of SHOULD) |
| `agent_relationships` | IA | Agent-to-agent / agent-to-tool relationships |
| `identities` | IA | WonderID common identity reference, one row per identity of any type (IDENTITY-P0-15). AI_AGENT rows mirror `agents` 1:1 by trigger (`agents` stays canonical); HUMAN rows for members are created by trigger on `tenant_memberships` (FA's table, read only) |
| `identity_attribute_definitions` | IA | Tenant-defined, typed identity attributes (IDENTITY-P0-16) |
| `identity_relationships` | IA | Relationships between identities (manager_of, owns, sponsors, …) with validity windows (IDENTITY-P0-16) |
| `identity_lifecycle_events` | IA | Human lifecycle events (joiner, mover, leaver, rehire, …), from sources or people (IDENTITY-P0-18) |
| `identity_lifecycle_tasks` | IA | Governed work each lifecycle event opens; closed by people with a note (IDENTITY-P0-18) |
| `identity_sources` | INT | Identity source configuration: template, authority, precedence, mappings, correlation rules, leaver strategy (INTEGRATION-P0-08) |
| `identity_reconciliation_runs` | INT | Reconciliation runs with counts, errors, change log, guard and preview flags; written by the worker only (INTEGRATION-P0-09) |
| `identity_source_links` | INT | Which source record is which identity; written by the worker only |
| `connector_write_operations` | INT | Idempotency record of every connector write (the key is the lock); written by the write interface only (INTEGRATION-P0-11) |
| `pending_identity_correlations` | INT | Ambiguous matches waiting for a person; decided through INT's service, which calls IA's `applySourcedIdentities()` |
| `applications` | AA | Canonical application registry (governed access-graph entity); since ACCESS-P0-15 also the WonderID application catalog (type, owners as identities, classification, onboarding status) |
| `application_onboardings` | AA | ACCESS-P0-16: one onboarding record per application — versioned, hashed configuration; validation, simulation, four-eyes approval and promotion each tied to the hash they ran against. Members read only; the service writes (service role, tenant-filtered) |
| `accounts` | AA | Accounts an agent/identity holds on an application. Since ACCESS-P0-17 an account belongs to any identity (`identity_id`; `agent_id` only for an AI agent's), with correlation (matched / linked by hand / orphan / ambiguous), type, last use, last seen and missing-from-source |
| `account_reconciliation_runs` | AA | ACCESS-P0-17: one record per reconciliation of an application's accounts against its connector, under the promoted onboarding configuration. Members read only; the service writes |
| `application_discoveries` | INT | INTEGRATION-P0-10: applications found by connectors, OpenAPI documents, SCIM metadata or manual reports; matched to the catalog or UNRECOGNIZED until a person registers (through Access's `registerApplication`), links, excepts or ignores with a reason. Members read only; the service writes |
| `onboarding_proposals` | INT | INTEGRATION-P0-12: proposals from an OpenAPI document or sample account (schema, identifier, correlation, entitlements, operations with evidence, risk, policies, assumptions, questions, destructive actions, tests) with AI provenance; the input is not stored (hash and size only). Applying writes only an onboarding draft. Members read only; the service writes |
| `entitlements` | AA | Roles/permissions/entitlements on an application; since ACCESS-P0-19 an optional owner (an identity) who approves requests for it |
| `access_grants` | AA | Effective grants (direct, inherited, group, delegated, etc.) |
| `access_paths` | AA | Materialized/explainable path from agent → data |
| `policies` | AA | Identity/Access/Runtime/Agent/Lifecycle policy definitions |
| `policy_rules` | AA | Individual rule conditions within a policy |
| `policy_exceptions` | AA | Approved exceptions to a policy |
| `policy_evaluations` | AA | Evaluation results/audit trail of policy checks |
| `access_requests` | AA | Access requests (ACCESS-P0-06). Since ACCESS-P0-18 also requests for identities: subject and requester identity, the request policy applied and its result, assessed risk, duration and expiry, cancelled/expired states; one pending request per person and item. Identity requests are written by the service (policy evaluation decides the initial status). Since ACCESS-P0-20 a request names an application or an access package (`access_package_id`) |
| `access_request_policies` | AA | ACCESS-P0-18: what may be requested and on what terms, per tenant default, application or entitlement (most specific wins): requestable, self/others scope, durations, justification, risk threshold, auto-approval, approval route. Members read only; the service writes |
| `access_request_approvals` | AA | ACCESS-P0-19: the approval steps of a catalog request — stage, who is asked (manager, entitlement owner, application owner, or access managers) and why, the action fingerprint the step is valid for, due time and escalation, and the decision (who, when, roles, comment). Members read only; the service writes; a trigger refuses a decision by the requester or subject |
| `access_packages` | AA | ACCESS-P0-20: bundles of access with an owner and a policy — who may discover and request them (identity types, departments), approval route/mode/timeout, durations, extension, certification frequency; draft/active/retired. Members read only; the service writes |
| `access_package_resources` | AA | ACCESS-P0-20: what a package includes (a live application's access or one of its entitlements). Members read only; the service writes |
| `access_package_assignments` | AA | ACCESS-P0-20: who holds a package (from an approved request or a direct assignment), until when, and its state (provisioning, active, partially failed, expired, revoked); one live assignment per identity and package. Members read only; the service writes |
| `access_package_assignment_items` | AA | ACCESS-P0-20: one work item per included resource — pending/fulfilled/failed on the way in, revoke-pending/revoked on the way out. Members read only; the service (later INTEGRATION-P0-13's pipeline) writes |
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
| `platform_ai_provider_configs` | PA | PLATFORM-P0-05.2 — per-tenant BYOK key override for OpenAI or Gemini (RLS enabled, zero client policies, mirrors `integration_credentials`); the platform-wide default keys are the `PLATFORM_OPENAI_API_KEY`/`PLATFORM_GEMINI_API_KEY` env vars, not rows in this table — migrations `0057`/`0058`, built 2026-09-16 |
| `platform_announcements` | PA | PLATFORM-P0-05.4 — maintenance-mode windows and platform notices (global or per-tenant scope); Experience Agent renders via the published `getActiveAnnouncements()` read contract, not by querying this table directly |
| `agent_duplicate_candidates` | IA | IDENTITY-P0-04 (duplicate detection/merge review) — migration `0041`, built 2026-09-14 |
| `agent_attestations` | IA | Planned — IDENTITY-P1-02 (attestation), not yet implemented |
| `integration_exports` | INT | Planned — INTEGRATION-P1-05 (SIEM export delivery/retry status), not yet implemented |
| `runtime_event_quarantine` | RA | RUNTIME-P0-11 (ingestion hardening: replay protection/quarantine) — migration `0043`, built 2026-09-14 |
| `risk_campaigns` / `risk_campaign_items` | RiskA | Planned — RISK-P1-03 (risk campaigns), not yet implemented |
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

### Master stories decisions (2026-09-25, resolved the same day via `AskUserQuestion`)

The user answered every open question in
[`docs/implementation/codebase-map.md`](../implementation/codebase-map.md) §6.
These are the current assignments. The stories are in each module's
`## Requirements Refresh — 2026-09-25` section.

- **Runtime Gateway: inside this app.** It is the `/api/gateway/v1/*`
  subtree of this Next.js app on Vercel, not a separate service, so there
  is no change to `CLAUDE.md` §2.
- **Gateway ownership is split between Access and Runtime.**
  - **Access Agent** owns the deterministic decision function
    `evaluateRuntimeRequest()` (ACCESS-P0-11). There is one policy engine,
    not two.
  - **Runtime Agent** owns the endpoint, the sessions and the decision
    records (RUNTIME-P0-15/16/18).
- **Agent authentication uses per-agent API keys.** Foundation Agent owns
  the credential primitive and the `agent_api_keys` table
  (FOUNDATION-P0-17), as part of the authentication model (#14).
- **The gateway ships in OBSERVE_ONLY mode.** Decisions are evaluated and
  recorded, but nothing is blocked. ENFORCE is switched on per tenant or
  environment through a Platform feature flag (PLATFORM-P0-12).
- **Customer-facing wording shows both terms:** "Approved (SHOULD)",
  "Effective Access (CAN)", "Observed (DID)" and "Current Request (NOW)"
  (EXPERIENCE-P0-17). SHOULD/CAN/DID remain the canonical model terms in
  `CLAUDE.md` §9.
- **New inventories:**
  - **Identity** owns NHI and Shadow AI as extensions of discovery
    (IDENTITY-P0-11/12).
  - **Integration** owns MCP servers, tools and resources as
    `integration_objects` families, with no separate MCP tables unless
    they prove insufficient (INTEGRATION-P0-06).
  - **Access** owns `data_sources` beside `applications` (ACCESS-P0-13).
- **Permission keys:** add only the missing keys; none of the existing 35
  are renamed (FOUNDATION-P0-18).
- **Investigations are a new grouped record owned by Risk:** the
  `investigations` and `investigation_findings` tables (RISK-P0-11).

`agent_api_keys` (FA) now exists: migration `0061`, FOUNDATION-P0-17, done
2026-09-25. It is locked down like `integration_credentials`, with RLS on
and no client policies, and is reached only through
`lib/security/agentApiKeys.ts`. Its HTTP wrappers are
`/api/v1/agents/:id/api-keys[/:keyId]`: FA-owned sub-routes under IA's
agent prefix.

`runtime_decisions` (RA) now exists: migration `0062`, RUNTIME-P0-15, done
2026-09-25. It is immutable decision evidence. Members can read it
through RLS; only the gateway writes it, through the service role.

`runtime_emergency_controls` (RA) now exists: migration `0064`,
RUNTIME-P0-18. Members can read it; only the service role writes it,
behind `runtime.emergency`. Controls are lifted, never deleted.
`/api/gateway/v1/tools/filter` is RA's, like `/authorize`.

`data_sources` (AA) now exists: migration `0070`, ACCESS-P0-13. It has
tenant-scoped RLS (select, insert, update; no delete, since sources are
retired). Composite foreign keys keep its application reference, and
`entitlements.data_source_id`, within the same tenant. The routes are
`/api/v1/access/data-sources` and
`/api/v1/access/entitlements/:id/data-source` (AA), and the page is
`/access/data-sources`.

MCP servers, tools and resources (IntA) are `integration_objects` families
(`mcp_server` / `mcp_tool` / `mcp_resource`, migration `0069`), not new
tables. The inventory contract is `getMcpInventory()`, and the page is
`/integrations/mcp`.

`investigations`, `investigation_findings` and `investigation_events`
(RiskA) now exist: migration `0071`, RISK-P0-11.

- Members read them through RLS; only the service role writes, behind
  `risk.manage`.
- Composite foreign keys keep an investigation to its own tenant's
  findings.
- The routes are `/api/v1/risk/investigations/*` (RiskA), and the pages
  are `/risk/investigations` and `/risk/investigations/:id`.

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
| `/api/v1/identities` (list/create, `:id`, `:id/relationships`, `:id/lifecycle`, `relationships/:id`, `attributes`, `lifecycle-tasks`) | IA |
| `/api/v1/integrations` (incl. `identity-sources`, `correlations`) | INT |
| `/api/v1/access`, `/api/v1/policies` | AA |
| `/api/v1/runtime` (events, agents/:id/compare, agents/:id/did, data-quality, quarantine) | RA |
| `/api/v1/findings`, `/api/v1/risk` | RiskA |
| `/api/v1/compliance` (campaigns, control-mappings, controls, items) | CA |
| `/api/v1/reports`, `/api/v1/audit`, `/api/v1/search`, `/api/v1/notifications`, `/api/v1/notification-preferences`, `/api/v1/jobs` | OA |
| `/api/gateway/v1/*` (`/authorize` live since RUNTIME-P0-15) | RA — the endpoint, which authenticates agents with API keys (FA) and calls AA's `evaluateRuntimeRequest()` for the decision |
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
