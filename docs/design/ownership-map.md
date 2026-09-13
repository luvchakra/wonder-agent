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
| `/api/v1/runtime/events` | RA |
| `/api/v1/findings` | RiskA |
| `/api/v1/certifications` | CA |
| `/api/v1/reports` (customer-facing reports/search/notifications) | OA |
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
