# Codebase Map — WonderAgent Master P0/P1/P2 (2026-09-25)

**Why this exists.** The user supplied *WonderAgent — AI Identity Security &
Agent Control Plane: P0/P1/P2 Product & Implementation Stories* ("the master
stories", 43 P0 / 24 P1 / 8 P2 stories, five pillars DISCOVER → UNDERSTAND →
GOVERN → PROTECT → ASSURE). It supersedes the MCP-only requirements and states
MCP is not a separate product. It also has a rule (§14, §33): before any major
change, inspect the codebase and write this map. This map is the result.
Nothing here overrides `CLAUDE.md`. Where the master stories and `CLAUDE.md`
disagree, §6 below lists the disagreement for the user to decide.

**How it was built.** On 2026-09-25, on `main` at `5064904`, three parallel
read-only surveys covered:

- identity, discovery and integrations
- access, policy and runtime
- risk, compliance, operations, platform, RBAC, audit and auth

The security-relevant claims (§5) were then re-read at the cited lines before
being written down. Line references are as of that commit.

Status legend:

- **Built**: meets the story's intent today.
- **Partial**: the foundation exists and needs extending.
- **Gap**: nothing meaningful exists yet.

---

## 1. Repository at a glance

| Layer | Where | Notes |
|---|---|---|
| Framework | Next.js 16.3.5 App Router, React, TypeScript, Tailwind v4 (OKLCH tokens), Radix + CVA | `CLAUDE.md` §2 locked stack |
| Charts / graph | `recharts` (lazy-loaded, `modules/ui/charts.lazy.tsx`), `reactflow` 11 (`modules/ui/AccessGraphView.tsx`) | |
| Data | Supabase Postgres + Auth + RLS; 60 migrations `supabase/migrations/0001…0060` | One DB, per §16 |
| Session / tenancy | `proxy.ts` (one real `getUser()` per request), `lib/tenant/session.ts` (`getClaims()`, request-cached), `lib/tenant/getTenantContext.ts` | Tenant comes from membership, never from the client |
| RBAC | `lib/rbac/requirePermission.ts`, `lib/rbac/requirePlatformAdmin.ts`; 11 system roles, 35 permission keys | See §4 P0-42 |
| Audit | `audit_logs` (0005) + `lib/audit/writeAudit.ts` (service role, never throws) | Viewer at `/audit` |
| AI | `lib/ai/provider.ts` (OpenAI/Gemini, tenant BYOK + platform key), `lib/ai/summarize.ts`, `lib/ai/helpAnswer.ts` | Advisory only; never feeds a decision |
| Customer routes | `app/(customer)/*`; APIs under `app/api/v1/*` | |
| Vendor routes | `app/platform-admin/*`, `app/api/platform/v1/*` | Separate boundary (#3) |

### Modules and what they already own

| Module (agent) | Code | Core tables | Customer screens |
|---|---|---|---|
| Foundation | `lib/{tenant,auth,rbac,audit,db,security}` | tenants, users, tenant_memberships, roles, permissions, audit_logs, sso_connections, rate limits | `/settings/*` |
| Identity | `modules/agent-identity` | agents, agent_identities, agent_owners, agent_lifecycle_events, agent_contracts (versioned), agent_relationships, agent_duplicate_candidates | `/agents`, `/agents/[id]`, `/agents/new`, `/agents/discovery`, `/agents/duplicates` |
| Integration | `modules/integrations` | integration_types, integrations, integration_credentials (encrypted), integration_sync_jobs, integration_objects, integration_mappings | `/integrations`, `/integrations/[id]`, `/integrations/jobs` |
| Access | `modules/access-governance` | applications, accounts, entitlements, access_grants, access_requests, policies, policy_rules, policy_versions, policy_evaluations, policy_exceptions | `/access`, `/access/agents/[id]`, `/access/requests`, `/policies` |
| Runtime | `modules/runtime-assurance` | runtime_events, runtime_tools, runtime_resources, runtime_event_quarantine | `/runtime`, `/runtime/agents/[id]` |
| Risk | `modules/risk` | risk_findings, risk_evidence, risk_severity_weights | `/risk`, `/risk/agents/[id]`, `/risk/rogue` |
| Compliance | `modules/certification-compliance` | certification_campaigns, _items, _decisions, control_frameworks, controls, control_mappings, control_evidence, governance_attestations | `/compliance/campaigns` |
| Operations | `modules/operations` | notifications, notification_preferences, reports | `/audit`, `/reports`, `/search` |
| Platform | `modules/platform-admin` | platform_admins, platform_tenants, subscriptions, feature_flags, platform_* | `/platform-admin/*` |
| Experience | `modules/ui` | — | the shell and every screen's composition |

---

## 2. Reuse points the master stories name (§15, §33)

The master stories say to extend what exists and not to build parallel
registries, engines or stores. These are the concrete extension points:

| Master concept | Existing thing to extend | Owner |
|---|---|---|
| Agent registry | `agents`, `agent_contracts`, `lifecycle.ts` | Identity |
| Discovery engine | `buildDiscoveryInbox()`, `detection.ts`, `agent_duplicate_candidates` | Identity |
| Sync jobs / normalized objects | `integration_sync_jobs`, `integration_objects`, `integration_mappings`, connector registry | Integration |
| MCP registry | MCP integration (`connectors/mcp.ts`), `discoverMcpTools()` → `integration_objects` | Integration |
| Graph store | `getAccessGraph()`: a view over effective access, not a stored graph | Access |
| Policy engine | `evaluate.ts` + `conditions.ts` (three-valued), `policy_versions`, `actionGovernance.ts` | Access |
| Runtime event store | `runtime_events`, `computeDedupeKey()`, `isWithinReplayWindow()`, quarantine | Runtime |
| Risk engine | `scoring.ts`, `rules.ts evaluateAgentRisk()`, 12 factors, 9 finding categories | Risk |
| Audit store | `audit_logs` + `writeAudit()` | Foundation |
| Permission engine | `requirePermission()` + RLS | Foundation |
| Notification engine | `notify()`, Resend email | Operations |

---

## 3. P0 story-by-story status

| Story | Status | What exists | What is missing | Owner |
|---|---|---|---|---|
| P0-01 Multi-tenant foundation | **Built** | RLS on every tenant table; `current_tenant_ids()` checks tenant status (0039); tenant from membership; isolation SQL suites under `tests/*/` | Tenant-scoped graph queries are per-agent, so no cross-tenant risk. Background jobs carry tenant via job row | Foundation |
| P0-02 Auth, SSO, MFA | **Partial** | Email/password, Google, SSO connection CRUD + JIT (`lib/auth/sso.ts`), TOTP enrol at `/settings/security`, idle 30 min / absolute 12 h, global sign-out | SAML needs Supabase Pro plan (user chose to skip, 2026-09-16). **MFA is not enforced** (no AAL check). No admin-forced session revocation | Foundation |
| P0-03 First-class agent identity | **Partial** | `agents` with description, purpose, environment, criticality, source, lifecycle, risk_score, model columns; `agent_owners` (business/technical/iam/application/data/escalation/delegated, IDENTITY-P0-13) | No link tables for tools, data or models (models are columns); `agents_update` RLS allows any column (no immutability guard, though no route updates `id`); `enterprise_identity_id` / `service_account_id` never written | Identity |
| P0-04 Registration & identity contract | **Built** (2026-09-25, IDENTITY-P0-13) | `agent_contracts` versioned (draft/active/superseded, one active), audited (`agent.contract_updated`), approved apps/data/actions, prohibited lists, autonomy 0–4, allowed_tools, actions_requiring_approval; approved users/delegators, allowed environments, expiry; `next_review_at` set on publish; production approval needs an approver role; lifecycle refuses expired or wrong-environment contracts | The contract's owner is still a text summary (owners live in `agent_owners`) | Identity |
| P0-05 Lifecycle | **Partial** | Enum matches the master list exactly; `NORMAL_TRANSITIONS`, `validateTransition()`, role gates, `agent_lifecycle_events`, audit | **ASSESSED is unreachable** (no transition in or out). Suspension does not affect runtime authorization because there is none (see P0-26). Retirement does not remove access | Identity |
| P0-06 Ownership | **Built** (2026-09-25, IDENTITY-P0-13) | Owners with soft-delete history plus `agent.owner_changed` audit; `ownership_violation` findings; delegated owners with expiry; owners must be active members; ownership review (`agent.ownership_reviewed`) | History is audit-only | Identity / Risk |
| P0-07 Agent discovery | **Built** | `buildDiscoveryInbox()` (new / likely_duplicate / orphaned_identity), deterministic detection with confidence and signals, candidate decisions, duplicate merge | MATCHED and UNKNOWN are implicit, not categories; sources are integration identities only (no runtime-telemetry discovery) | Identity |
| P0-08 NHI discovery & inventory | **Built** (2026-09-25, IDENTITY-P0-11) | `buildNhiInventory()` + `/agents/identities`: linked, unlinked (with discovery's classification), orphaned and ignored non-human identities; human delegates excluded | — | Identity |
| P0-09 Shadow AI | **Built** (2026-09-25, IDENTITY-P0-12) | Events for an unregistered agent (`agentId` or `agentRef`) are quarantined as `UNREGISTERED_AGENT` and surface as `shadow_ai` discovery candidates with evidence; registering links the reference so later events are recorded | Risk score for shadow AI (RISK-P0-12); MCP events need the bridge (INTEGRATION-P0-07) | Identity + Runtime |
| P0-10 MCP server & tool discovery | **Built** (2026-09-25, INTEGRATION-P0-06) | `mcp_server` / `mcp_tool` / `mcp_resource` object families; tools classified read / write / unknown from annotations, then name; `getMcpInventory()` + `/integrations/mcp` | Linking a tool to an agent stays Identity's flow; SSRF guard on MCP `baseUrl` (open) | Integration |
| P0-11 Applications & data sources | **Built** (2026-09-25, ACCESS-P0-13) | `applications` + new `data_sources` (classification, owner, application; same-tenant composite FKs), `entitlements.data_source_id`; CAN carries the data source and falls back to its classification; `/access/data-sources` | Importing data sources from connectors; DATA_SOURCE policy target (ACCESS-P0-12) | Access |
| P0-12 Agent↔IAM mapping | **Partial** | `agent_identities` with confidence enum | `linkAgentIdentity()` hard-codes `confirmed`, **writes no audit** (#11); no evidence column; detection evidence not persisted on the link | Identity |
| P0-13 Saviynt read-only | **Built** | Saviynt connector, explicitly read-only, sync jobs, audit | — | Integration |
| P0-14 Generic REST | **Built** | `generic_rest` connector: endpoint, auth, pagination, mapping | Rate-limit handling to confirm | Integration |
| P0-15 Access intelligence | **Partial** | `getEffectiveAccess()` (apps, entitlements, privilege level, data classification); `compareAccessToContract()` | Tools / MCP tools / data resources are not first-class in CAN | Access |
| P0-16 Effective access graph | **Partial** | `getAccessGraph()` (agent, account, application, entitlement), reactflow view, a table beside it | Identity/role/tool/data nodes; edge evidence; blast radius; filters; bounds | Access / Experience |
| P0-17 Access path analysis | **Partial** | `explainAccessPath()` with an evidence drawer | Role, tool and resource hops; the identity hop is only a string | Access |
| P0-18 Runtime event model | **Partial** | `runtime_events` with dedupe, replay window, quarantine, correlation_id | **No event-type enum** (`action` is free text); no session_id or decision fields; MCP metadata only in `raw`; ingestion needs a *human* session (`runtime.ingest`), with no machine credential | Runtime |
| P0-19 SHOULD/CAN/DID | **Partial** | `compareShouldCanDid()` with seven outcomes and as-of CAN | **SHOULD tools always `[]`** though `agent_contracts.allowed_tools` exists; no NOW (current request) | Runtime |
| P0-20 Deterministic risk | **Built** | Weighted, explainable scoring (12 factors); per-tenant weights. RISK-P0-12 (2026-09-25): certification overdue, destructive capability and credential health now sourced; suspicious delegation finding; Shadow AI signal on the Risk page | Attack-path factor still unsourced (needs a graph-traversal contract); evaluation is on demand only | Risk |
| P0-21 Rogue agent detection | **Built** (2026-09-25, RISK-P0-12) | Findings for unauthorized resource/action, sensitive data, behavioral deviation, **unapproved tool use** and **suspicious delegation**; `/risk/rogue` | Statistical baselines (P1-05) | Risk |
| P0-22 Agent governance | **Partial** | Registration, approval, suspension, retirement, ownership, purpose, access requests | Production approval gate; `access_requests` fulfilment doesn't create a grant | Identity / Access |
| P0-23 Governance policies | **Built** (2026-09-25, ACCESS-P0-12) | Versioned policies, rules, batch evaluation, exceptions; runtime policy targets (TOOL, MCP_SERVER, MCP_TOOL, DATA_SOURCE, DATA_RESOURCE, ACTION); priority ordering; draft → publish behind `policy.publish` | Targets are applied to runtime policies; agent-level batch evaluation still uses agent/entitlement facts | Access |
| P0-24 Access certification | **Built** | Campaigns (5 scopes), items with snapshots, decisions, attestations, escalation cron, evidence export | Continuous / event-driven is enum-only (P1-06) | Compliance |
| P0-25 SoD & exceptions | **Partial** | Exception model (0053) with justification, compensating control, residual risk, expiry reminders | **`checkSoD()` is never called**; exception lookup was ignoring revocation (fixed, §5) | Access |
| P0-26 Runtime gateway | **Gap** | — | Everything: dedicated boundary, request/decision records, sessions | **Decision needed (§6.1)** |
| P0-27 Runtime authentication | **Gap** | Webhook HMAC; MCP event bearer token | Agent/workload credentials; token validation; delegated-user auth | Decision needed |
| P0-28 – P0-31 Identity-, intent-, context- and risk-aware authorization | **Gap** (inputs Partial) | Inputs exist: lifecycle, contract, effective access, risk score, `classifyAction()` (advisory: prohibited > with-approval > allowed > restricted) | A decision function that combines them at request time | Decision needed |
| P0-32 Runtime policy engine | **Gap** | `conditions.ts` evaluator reusable | ALLOW / DENY / REQUIRE_APPROVAL / ALLOW_WITH_RESTRICTIONS; OBSERVE_ONLY / ENFORCE / DEGRADED / SUSPENDED | Decision needed |
| P0-33 Tool & MCP enforcement | **Gap** | MCP tool discovery | Tool resolution, allow/deny, approval at call time | Decision needed |
| P0-34 Tool filtering | **Gap** | — | — | Decision needed |
| P0-35 Emergency controls | **Partial** | Emergency SUSPENDED from any state (security admins) | MCP-server / tool suspension, credential revocation, session termination, kill switch; nothing enforces suspension at runtime | Identity + decision needed |
| P0-36 Runtime activity | **Partial** | `/runtime` timeline with agent, tool, application, resource, action, success, correlation | Decision, policy, session and MCP-server columns (no data yet) | Runtime / Experience |
| P0-37 Findings & investigations | **Built** (2026-09-25, RISK-P0-11) | `investigations` + `investigation_findings` + `investigation_events` (select-only RLS, composite same-tenant FKs), INV-<year>-<n> references, audited transitions, resolve refused while a finding is open, `/risk/investigations`; searchable | — | Risk |
| P0-38 Audit & evidence | **Built** | `audit_logs` + viewer + CSV; evidence packs (PDF); campaign evidence export | correlation_id not filterable in the viewer and usually random | Foundation / Operations |
| P0-39 Compliance mapping | **Built** | 6 frameworks seeded (ISO 27001, ISO 42001, NIST AI RMF, NIST CSF, SOC 2, CIS), control mappings with statuses | Only 20 controls seeded; **no customer UI for controls or posture** | Compliance |
| P0-40 AI-assisted explanation | **Built** | `summarize()` for findings, evidence, SHOULD/CAN/DID, cert items; help assistant; never decides | Only one screen uses the summary panel | Platform / Experience |
| P0-41 Notifications, reports, search | **Built** | 7 notification types, 8 reports, search over 9 object types | Runtime alerts and approval notifications await the gateway | Operations |
| P0-42 Customer RBAC | **Partial** | 35 keys, RLS | Master names differ; per its own rule ("use existing naming conventions") only genuinely new keys should be added: `agent.suspend`, `discovery.*`, `access.simulate`, `policy.publish`, `runtime.enforce`, `runtime.emergency` | Foundation |
| P0-43 Platform admin | **Built** | Tenants, subscriptions, flags, branding, health, usage, announcements, AI provider | ~~Feature flags are never enforced~~ (fixed 2026-09-25, PLATFORM-P0-12: 13 rollout flags enforced); no platform-audit viewer | Platform |

**Tally:** 11 Built, 21 Partial, 11 Gap. The 11 gaps are the NHI and shadow-AI
inventories plus the whole PROTECT pillar (P0-26 to P0-34). P0-35 is Partial.

*Status since this map was written (2026-09-25):* the Runtime Gateway
stories (FOUNDATION-P0-17/18, ACCESS-P0-11, RUNTIME-P0-15..18) closed most
of the PROTECT gaps; PLATFORM-P0-12 enforces feature flags (the P0-43 gap
below); IDENTITY-P0-11/12 built P0-08 and P0-09. The rows above are
updated per story; each module's audit log has the detail.

---

## 4. The five pillars, as the code stands

- **DISCOVER**: agent discovery and duplicates are strong. NHI, shadow AI,
  model and data-source inventories do not exist. MCP tools are discovered but
  have no inventory screen.
- **UNDERSTAND**: effective access, the graph, path explanation and
  SHOULD/CAN/DID exist for applications and entitlements. Tools, MCP tools and
  data resources are not first-class, and blast radius is absent.
- **GOVERN**: lifecycle, contracts, owners, policies, exceptions,
  certification and compliance are the most complete pillar.
- **PROTECT**: absent. No runtime gateway or real-time decision exists; every
  control today is retrospective.
- **ASSURE**: runtime timeline, findings, evidence, audit and reports exist.
  Investigations, baselines and runtime decision evidence do not.

---

## 5. Defects found while mapping

Each was re-read at the cited lines before being written down.

| # | Defect | Severity | Where | Disposition |
|---|---|---|---|---|
| D1 | Policy evaluation treated a **revoked** or **not-yet-started** exception as active, so a revoked exception kept suppressing a violation | High (security) | `modules/access-governance/evaluate.ts` exception lookup | **Fixed in this pass**: the query now requires `status = 'active'` and `start_date <= now`. Recorded in the Access audit log |
| D2 | Runtime ingestion wrote a caller-supplied `identityId` through the service role without checking it belongs to the tenant and agent (§14 service-role rule) | Medium (security) | `modules/runtime-assurance/events.ts ingestRuntimeEvent()` | **Fixed in this pass**: the identity must belong to the same tenant and agent, else 404. Recorded in the Runtime audit log |
| D3 | `linkAgentIdentity()` writes no audit event (#11) | Medium | `modules/agent-identity/identities.ts` | **Fixed 2026-09-25** (IDENTITY-P0-14): audited, explicit confidence + basis |
| D4 | Lifecycle state ASSESSED is unreachable | Low | `modules/agent-identity/lifecycle.ts` | **Fixed 2026-09-25** (IDENTITY-P0-14): REGISTERED → ASSESSED → APPROVED |
| D5 | `checkSoD()` has no callers | Medium (P0-25) | `modules/access-governance/sod.ts` | **Fixed 2026-09-25** (ACCESS-P0-14): wired into request, decision and grant paths |
| D6 | MCP runtime events are stored as `integration_objects` and never reach `runtime_events`, so they are invisible to SHOULD/CAN/DID and risk | Medium (P0-18) | `modules/integrations/mcpEvents.ts` | **Fixed 2026-09-25** (INTEGRATION-P0-07): bridged through Runtime's `ingestRuntimeEventByReference()` |
| D7 | SHOULD tools always empty despite `agent_contracts.allowed_tools` | Low | `modules/runtime-assurance/compare.ts:93` | Open, Runtime Agent |
| D8 | Feature flags stored but never enforced | Low | `modules/platform-admin/featureFlags.ts` | Open, Platform Agent |
| D9 | MFA enrolment exists but is not enforced for anyone | Medium | Foundation | Open, needs a policy decision on who must use MFA |
| D10 | `listAgents()` relied on RLS alone. RLS admits *every* tenant the user belongs to, so a member of two organizations saw both organizations' agents in whichever one was selected | Medium (tenancy, §14) | `modules/agent-identity/agents.ts` | **Fixed in this pass**: explicit `tenant_id` filter. QA Agent to sweep the other RLS-only reads |

---

## 6. Decisions: resolved 2026-09-25

The user answered all five questions, plus the three sub-choices under
question 1, via `AskUserQuestion` on 2026-09-25:

1. **Runtime Gateway:**
   - It runs **inside this app** (`/api/gateway/v1/*`).
   - Ownership is **split**: Access owns the deterministic decision
     function and Runtime owns the endpoint, sessions and decision records.
   - Agents authenticate with **per-agent API keys** (Foundation).
   - The default mode is **OBSERVE_ONLY**; ENFORCE is switched on per
     tenant or environment through a feature flag.
2. **Wording:** show **both terms**: "Approved (SHOULD)", "Effective Access
   (CAN)", "Observed (DID)", "Current Request (NOW)".
3. **Inventories:** as proposed. Identity owns NHI and shadow AI.
   Integration owns MCP servers, tools and resources as normalized
   families. Access owns data sources.
4. **Permissions:** add only the missing keys, and rename nothing.
5. **Investigations:** a **new grouped record** owned by Risk.

Each became a tracked `Not Started` story in its owning module's backlog
(see the 2026-09-25 Requirements Refresh sections, and the ownership map's
"Master stories decisions"). `docs/PROGRESS.md` now tracks 190 stories
(145 done).

## 7. What changed in this pass

- This map.
- The customer shell was rebuilt to the user's light-console mockups: a white
  rail grouped into the master navigation's sections, with sub-pages. Only
  sub-pages with a real route are linked; the rest are the gaps above.
  Details are in the Experience audit log, 2026-09-25.
- Defects D1, D2 and D10 fixed. D1 and D2 have new unit tests. D10 is a
  one-line filter, covered by the existing suites.
- Dashboard, Agent inventory and Agent 360 rebuilt to mockups 1–3 with real
  data only. Mockups 4–12 and the MCP boards are the next Experience pass.

Nothing else in §3 was implemented in this pass. Items marked *Gap* are not
started.
