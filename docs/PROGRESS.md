# WonderAgent — Progress Tracker

High-level status of every module, aggregated from the per-module Progress
Tracker tables in [`docs/plan/`](plan/). **This file is generated — do not edit it
by hand.** Update the owning module's backlog table, then regenerate:

```bash
npm run progress
```

Generated 2026-09-25 from 11 module backlogs.

---

## Overall

**167 of 226 tracked stories complete — 74%**

```
██████████████████████████████░░░░░░░░░░  74%
```

| Status | Stories |
|---|---|
| Done | 167 |
| Partial | 21 |
| Deferred | 1 |
| Not Started | 37 |
| **Total tracked** | **226** |

Beyond these, the backlogs list **52 P1** and **32 P2** forward-looking items.
Those are prose scope bullets rather than tracked stories, so they carry no status
and are deliberately excluded from the counts above.

---

## By module

| # | Agent | Done | Partial | Deferred | Not Started | Total | Progress |
|---|---|---|---|---|---|---|---|
| 01 | [Foundation Agent](plan/01-FOUNDATION-AGENT-BACKLOG.md) | 29 | 2 | 0 | 3 | 34 | `███████████████░░░` 85% |
| 02 | [Identity Agent](plan/02-IDENTITY-AGENT-BACKLOG.md) | 15 | 0 | 0 | 5 | 20 | `██████████████░░░░` 75% |
| 03 | [Integration Agent](plan/03-INTEGRATION-AGENT-BACKLOG.md) | 13 | 1 | 0 | 6 | 20 | `████████████░░░░░░` 65% |
| 04 | [Access Agent](plan/04-ACCESS-AGENT-BACKLOG.md) | 15 | 0 | 0 | 11 | 26 | `██████████░░░░░░░░` 58% |
| 05 | [Runtime Agent](plan/05-RUNTIME-AGENT-BACKLOG.md) | 13 | 0 | 0 | 0 | 13 | `██████████████████` 100% |
| 06 | [Risk Agent](plan/06-RISK-AGENT-BACKLOG.md) | 13 | 2 | 0 | 1 | 16 | `███████████████░░░` 81% |
| 07 | [Compliance Agent](plan/07-COMPLIANCE-AGENT-BACKLOG.md) | 13 | 0 | 0 | 1 | 14 | `█████████████████░` 93% |
| 08 | [Experience Agent](plan/08-EXPERIENCE-AGENT-BACKLOG.md) | 20 | 2 | 0 | 4 | 26 | `██████████████░░░░` 77% |
| 09 | [Platform Agent](plan/09-PLATFORM-AGENT-BACKLOG.md) | 12 | 1 | 1 | 1 | 15 | `██████████████░░░░` 80% |
| 10 | [Operations Agent](plan/10-OPERATIONS-AGENT-BACKLOG.md) | 11 | 1 | 0 | 2 | 14 | `██████████████░░░░` 79% |
| 11 | [QA Agent](plan/11-QA-AGENT-BACKLOG.md) | 13 | 12 | 0 | 3 | 28 | `████████░░░░░░░░░░` 46% |

---

## Story detail

### 01 — Foundation Agent

**Module:** Foundation, Authentication, Tenancy, Security & RBAC  
**Backlog status:** ACTIVE (this is the only agent started initially)  
**Stories:** 29 done · 2 partial · 0 deferred · 3 not started (34 tracked) · 10 P1 / 2 P2 ahead

| Story | Title | Status |
|---|---|---|
| FOUNDATION-P0-01.1 | Initialize the Next.js application | Done |
| FOUNDATION-P0-01.2 | Environment variable contract | Done |
| FOUNDATION-P0-01.3 | Supabase client factories | Done |
| FOUNDATION-P0-02.1 | `tenants` and `tenant_settings` | Done |
| FOUNDATION-P0-02.2 | `users` and `tenant_memberships` | Done |
| FOUNDATION-P0-02.3 | Roles, permissions, RBAC join tables | Done |
| FOUNDATION-P0-02.4 | Row Level Security (higher bar) | Done — `current_tenant_ids()` patched 2026-09-14 (migration `0039`) to also check `tenants.status`, closing a gap Platform Agent's tenant-suspension story surfaced; see audit log |
| FOUNDATION-P0-02.5 | `getTenantContext()` helper | Done |
| FOUNDATION-P0-03.1 | Email/password auth | Done |
| FOUNDATION-P0-03.2 | Tenant selection / JIT provisioning | Done |
| FOUNDATION-P0-03.3 | SSO connection foundation (SAML/OIDC) | Partial, intentionally deferred — 2026-09-14: full CRUD service/API/admin UI, domain-based sign-in routing, auth callback + JIT provisioning, live RLS-verified; real end-to-end IdP handshake still unverified. 2026-09-16: confirmed via `mcp__Supabase__get_organization` + Supabase's own docs that this is a hard infrastructure blocker, not a code gap — SAML 2.0 is Pro-plan-and-above only, and this org is on the free plan. User explicitly chose to skip this and close out the P0 gap-closure pass without it (see audit log); resume only if the user upgrades the plan and supplies a real IdP |
| FOUNDATION-P0-03.4 | MFA foundation | Partial — 2026-09-14: Supabase Auth TOTP enroll/verify/unenroll wired at `/settings/security`; real enrollment against a physical authenticator app not verified in this sandbox, see audit log |
| FOUNDATION-P0-04.1 | `requirePermission()` | Done |
| FOUNDATION-P0-04.2 | `requirePlatformAdmin()` (higher bar) | Done |
| FOUNDATION-P0-04.3 | Role management UI (minimal) | Done — 2026-09-14: `/settings/roles`, live RLS-verified |
| FOUNDATION-P0-05.1 | `audit_logs` + `writeAudit()` | Done |
| FOUNDATION-P0-05.2 | Secret encryption helper (higher bar) | Done |
| FOUNDATION-P0-05.3 | Baseline HTTP security | Done — 2026-09-14: CSP/security headers in `next.config.ts`; sign-in/sign-up routed through rate-limited server actions (migration `0040`), live-verified |
| FOUNDATION-P0-06.1 | Platform-admin identity | Done |
| FOUNDATION-P0-06.2 | Route/middleware enforcement | Done |
| FOUNDATION-P0-07.1 | Fixtures (higher bar) | Done |
| FOUNDATION-P0-07.2 | Isolation tests — critical acceptance test (higher bar) | Done |
| FOUNDATION-P0-08 | Job Security primitive (tenant-scoped, idempotent background jobs) | Done — 2026-09-14: `lib/jobs/tenantScopedJob.ts` published, unit-tested; not yet adopted by Integration Agent's existing sync-job code (recommended, not done unilaterally — non-negotiable #18), see audit log |
| FOUNDATION-P0-09 | Session Security (idle/absolute expiry, fixation protection) | Done — 2026-09-14: idle/absolute timeout enforced in `proxy.ts`, unit-tested; fixation mitigated by Supabase issuing a fresh session per sign-in |
| FOUNDATION-P0-11 | Input/Output Safety (shared validation/encoding utility) | Done — 2026-09-14: `lib/security/validate.ts` published, unit-tested, adopted by the new SSO route |
| FOUNDATION-P0-12 | Database Migration Discipline (explicit policy) | Done — already followed as informal practice every module this session; now written down explicitly, see Requirements Refresh below |
| FOUNDATION-P0-15 | Tenant Lifecycle (provisioning/active/suspended/closed) | Done — `tenants.status` existed since FOUNDATION-P0-02.1; enforcement gap closed by migration `0039` (2026-09-14) |
| FOUNDATION-P1-05 | CSRF protection verification & hardening for state-changing `/api/v1/*` routes | Done — 2026-09-19: confirmed from `@supabase/ssr`'s own installed source (`DEFAULT_COOKIE_OPTIONS`, unoverridden by `proxy.ts`/`lib/db/supabaseServer.ts`) that every session cookie is genuinely `SameSite=Lax`; added `tests/e2e/csrf.spec.ts`, a real-browser positive/negative proof (a cross-site page's authenticated-looking fetch is rejected — the auth-token cookie is withheld, confirmed by inspecting the actual outgoing request) run live against this session's dev server — see audit log |
| FOUNDATION-P0-16 | `lib/ai/` — shared, read-only, advisory-only LLM summarization primitive | Done — 2026-09-16: the provider/credential decision this row was waiting on resolved via `PLATFORM-P0-05.2` (OpenAI, platform-wide + per-tenant BYOK). `summarize(tenantId, request)` now calls Platform's published `resolveAiProviderKey()` and makes a real OpenAI chat-completions call via `fetch()`; still throws `AiNotConfiguredError` when no key resolves, never a fake/empty summary. No DB client import in this file itself (boundary still enforced by the file's own shape) — see Platform Agent's audit log for the full implementation detail (this file's change is a small, expected consequence of that story, not new Foundation-owned scope) |
| FOUNDATION-P0-17 | Agent API keys — machine credential for the Runtime Gateway (master P0-27) | Done — 2026-09-25: migration `0061` applied live; `lib/security/agentApiKeys.ts` (hash-only storage, tenant+agent-bound verify, fail-closed), API routes, Agent 360 card; 16 unit + 9 live SQL checks + 4 E2E; see audit log |
| FOUNDATION-P0-18 | New permission keys (master P0-42) | Done — 2026-09-25: 7 keys seeded by least privilege in `0061`, `requireAnyPermission()` added; live-verified; see audit log |
| FOUNDATION-P0-19 | WonderID permissioning: object, request, approval and admin scope; default roles | Not Started — 2026-09-26, WonderID |
| FOUNDATION-P0-20 | Permission simulation and the Permissions (WonderID) screens | Not Started — 2026-09-26, WonderID |
| FOUNDATION-P0-21 | Passwordless: passkeys/WebAuthn enrollment, sign-in, policy, step-up, recovery | Not Started — 2026-09-26, WonderID |

### 02 — Identity Agent

**Module:** AI Agent Identity & Lifecycle  
**Backlog status:** DORMANT — do not start until the user says "Run Identity Agent"  
**Stories:** 15 done · 0 partial · 0 deferred · 5 not started (20 tracked) · 8 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| IDENTITY-P0-01.1 | `agents` table and registration | Done |
| IDENTITY-P0-01.2 | Agent identity correlation (`agent_identities`) | Done |
| IDENTITY-P0-01.3 | Agent discovery inbox | Done — 2026-09-14: superseded by `buildDiscoveryInbox()` (IDENTITY-P0-05), now reading Integration Agent's published contract |
| IDENTITY-P0-02.1 | Lifecycle state machine (higher bar) | Done |
| IDENTITY-P0-02.2 | Ownership & accountability | Done |
| IDENTITY-P0-02.3 | Agent relationships | Done |
| IDENTITY-P0-03.1 | `agent_contracts` (higher bar) | Done |
| IDENTITY-P0-04 | Duplicate detection & merge/review workflow | Done — 2026-09-14, live RLS-verified |
| IDENTITY-P0-05 | Discovery reconciliation & orphaned identity detection | Done — 2026-09-14; also resolves IDENTITY-P0-01.3's dependency now that Integration Agent's contract exists. Extended 2026-09-15 into the fully functional Agent Discovery feature (detection/confidence/evidence, candidate review, ignore/link, registration wired to the existing lifecycle service) — see the audit log's 2026-09-15 entry |
| IDENTITY-P0-06 | Suspension restoration path (lifecycle state machine gap) | Done — 2026-09-15, unit-tested |
| IDENTITY-P0-07 | Contract autonomy/oversight fields (autonomy level, allowed tools, human approval requirements, required monitoring) | Done — 2026-09-15, migration `0052`, live-applied |
| IDENTITY-P0-11 | NHI inventory (master P0-08) | Done — 2026-09-25: `buildNhiInventory()` + `/agents/identities` (linked / unlinked with classification / orphaned / ignored; human delegates excluded; linking via discovery) |
| IDENTITY-P0-12 | Shadow AI discovery from runtime telemetry (master P0-09) | Done — 2026-09-25: unregistered-agent events quarantined by Runtime and surfaced as `shadow_ai` candidates with evidence; exact-identifier `resolveAgentReference()`; registering links the reference |
| IDENTITY-P0-13 | Contract and ownership completeness (master P0-03/04/06) | Done — 2026-09-25: delegated and escalation owners, member-only owners, ownership review; contract approved users/delegators, environments, expiry; `next_review_at` set; production approval needs an approver; same-tenant agent references (0075) |
| IDENTITY-P0-14 | Defects D3 + D4 from the codebase map | Done — 2026-09-25: every identity link states confidence + basis and is audited (`agent.identity_linked`); ASSESSED reachable (REGISTERED → ASSESSED → APPROVED, direct path kept) |
| IDENTITY-P0-15 | Unified identity reference model (human, external, machine, service account, application, workload, API, AI agent) | Not Started — 2026-09-26, WonderID |
| IDENTITY-P0-16 | Identity attributes and relationships | Not Started — 2026-09-26, WonderID |
| IDENTITY-P0-17 | Identities directory and identity detail | Not Started — 2026-09-26, WonderID |
| IDENTITY-P0-18 | Human lifecycle: joiner, mover, leaver, rehire, ownership transfer | Not Started — 2026-09-26, WonderID |
| IDENTITY-P0-19 | AI agent onboarding journey, sponsor, agent access packages, lifecycle policies | Not Started — 2026-09-26, WonderID |

### 03 — Integration Agent

**Module:** Integration Hub & Connectors  
**Backlog status:** DORMANT — do not start until the user says "Run Integration Agent"  
**Stories:** 13 done · 1 partial · 0 deferred · 6 not started (20 tracked) · 2 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| INTEGRATION-P0-01.1 | Adapter contract & capability declaration | Done |
| INTEGRATION-P0-01.2 | Schema (higher bar on credential storage) | Done |
| INTEGRATION-P0-01.3 | `integration_sync_jobs` | Done |
| INTEGRATION-P0-01.4 | Normalized object storage | Done |
| INTEGRATION-P0-02.1 | Saviynt REST adapter | Partial — endpoint paths/HTTP method/pagination/auth verified against Saviynt's real API reference; response field names still unconfirmed against a live tenant |
| INTEGRATION-P0-02.2 | Sync status & health surfaces | Done |
| INTEGRATION-P0-03.1 | Configurable connector | Done — this is the connector the critical acceptance test runs against |
| INTEGRATION-P0-03.2 | Object/field mapping UI | Done |
| INTEGRATION-P0-04.1 | MCP server registration & tool discovery | Done — 2026-09-14: `object_type` classification question resolved now that Runtime Agent's `runtime_tools` model exists — confirmed to be a genuinely different concept (DID-only, populated solely from observed runtime events) from MCP discovery-time data, so `entitlement` remains the correct classification; see audit log |
| INTEGRATION-P0-04.2 | Runtime event ingestion via MCP (higher bar) | Done |
| INTEGRATION-P0-04.3 | Webhooks (generic inbound) | Done |
| INTEGRATION-P0-05.1 | Verified credential rotation (no overwrite until new credential proven) | Done — 2026-09-14, unit-tested |
| INTEGRATION-P0-06 | MCP servers, tools and resources as normalized object families (master P0-10) | Done — 2026-09-25: `mcp_server`/`mcp_tool`/`mcp_resource` families (migration 0069), deterministic read/write classification, `getMcpInventory()`, `/integrations/mcp` with Discover now |
| INTEGRATION-P0-07 | Bridge MCP runtime events into `runtime_events` (codebase-map D6, master P0-18) | Done — 2026-09-25: MCP events bridged through Runtime's `ingestRuntimeEventByReference()` (dedupe, replay, flag, exact agent resolution); truthful `runtime` outcome; constant-time secret; validated body |
| INTEGRATION-P0-08 | Authoritative identity sources | Not Started — 2026-09-26, WonderID |
| INTEGRATION-P0-09 | Identity import and reconciliation pipeline | Not Started — 2026-09-26, WonderID |
| INTEGRATION-P0-10 | Application discovery and unrecognized applications | Not Started — 2026-09-26, WonderID |
| INTEGRATION-P0-11 | Connector capability model, write interface with idempotency, SSRF guard | Not Started — 2026-09-26, WonderID |
| INTEGRATION-P0-12 | AI-assisted onboarding proposals | Not Started — 2026-09-26, WonderID |
| INTEGRATION-P0-13 | Provisioning and deprovisioning pipeline | Not Started — 2026-09-26, WonderID |

### 04 — Access Agent

**Module:** Effective Access & Access Governance (the CAN side, plus policy)  
**Backlog status:** DORMANT — do not start until the user says "Run Access Agent"  
**Stories:** 15 done · 0 partial · 0 deferred · 11 not started (26 tracked) · 3 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| ACCESS-P0-01.1 | Canonical access schema | Done — no `access_paths` table created; see audit log |
| ACCESS-P0-01.2 | Effective access computation & explainability (higher bar) | Done — critical acceptance test passed live |
| ACCESS-P0-01.3 | Access requests (P0 minimal) | Done |
| ACCESS-P0-02.1 | Policy schema (higher bar) | Done |
| ACCESS-P0-02.2 | Deterministic evaluation engine (higher bar) | Done — 2026-09-16: `agent.days_since_last_certification` real since 2026-09-14 (Compliance's `getCertificationHistory()`); `agent.external_communication` resolved via `AskUserQuestion` — modeled as `applications.is_external` (migration `0059`), a new admin-settable flag on Access's own `applications` table. Risk's "External communication capability" factor (`modules/risk/rules.ts`) now checks whether an agent's CAN touches any application marked external, replacing the hard-coded `false` |
| ACCESS-P0-02.3 | Segregation of Duties (SoD) (higher bar) | Done |
| ACCESS-P0-03 | Access Graph (graph-compatible relationships + tabular view) | Done — 2026-09-14 |
| ACCESS-P0-04 | Contract Comparison (SHOULD vs CAN diff: approved / excessive / missing / unknown) | Done — 2026-09-14, unit-tested against the live FinanceBot fixture's exact data |
| ACCESS-P0-05 | Policy Versioning, Priority & Change History (extends ACCESS-P0-02.1) | Done — 2026-09-14, live RLS-verified |
| ACCESS-P0-06 | Action governance enforcement (4-state model, uses Identity's autonomy fields) | Done — 2026-09-15, unit-tested, no migration needed |
| ACCESS-P0-07 | Broaden `policy_exceptions` into the canonical governance-exception model | Done — 2026-09-15, migration `0053`, live-applied |
| ACCESS-P0-11 | Deterministic runtime decision function (master P0-28–P0-32) | Done — 2026-09-25: pure `decideRuntimeRequest()` + fail-closed `evaluateRuntimeRequest()` loader (service-role, tenant-checked), 34 unit tests incl. master §21 fail-safe table and the §11 FinanceBot case; wired into the gateway by RUNTIME-P0-15; see audit log |
| ACCESS-P0-12 | Policy targets and publish (master P0-23) | Done — 2026-09-25: targets (TOOL, MCP_SERVER, MCP_TOOL, DATA_SOURCE, DATA_RESOURCE, ACTION) in `scope.targets` decide which runtime policies apply; priority orders evaluation; drafts + `publishPolicy()` (new version, audited) behind `policy.publish`; `createPolicy` now audited |
| ACCESS-P0-13 | Data sources inventory (master P0-11) | Done — 2026-09-25: `data_sources` (migration 0070, RLS, same-tenant composite FKs, no delete), entitlement link, CAN carries data source + classification fallback, audited service/API, `/access/data-sources` |
| ACCESS-P0-14 | Wire SoD checks (codebase-map D5, master P0-25) | Done — 2026-09-25: `enforceSoD()` on request submission, request decision and manual grant; blocking → 409 SOD_CONFLICT (audited failure), flag → proceeds and audited; `checkSoD()` now service-role + matches the agent in object or metadata |
| ACCESS-P0-15 | Application catalog model and inventory | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-16 | Application onboarding: state machine, checklist, validate, simulate, approve, promote | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-17 | Account inventory: correlation, orphan and dormant accounts | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-18 | Self-service request catalog and request policies | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-19 | Approval engine: multi-stage chains, approver scope, no self-approval | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-20 | Access packages | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-21 | Business and IT roles | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-22 | Preventive SoD on entitlement combinations | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-23 | Delegations | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-24 | Access ledger and provenance | Not Started — 2026-09-26, WonderID |
| ACCESS-P0-25 | Imported access classification and drift findings | Not Started — 2026-09-26, WonderID |

### 05 — Runtime Agent

**Module:** Runtime Assurance & SHOULD/CAN/DID  
**Backlog status:** DORMANT — do not start until the user says "Run Runtime Agent"  
**Stories:** 13 done · 0 partial · 0 deferred · 0 not started (13 tracked) · 2 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| RUNTIME-P0-01.1 | Schema | Done |
| RUNTIME-P0-01.2 | Idempotent ingestion (higher bar) | Done |
| RUNTIME-P0-01.3 | Timeline queries | Done |
| RUNTIME-P0-02.1 | DID aggregation (higher bar) | Done |
| RUNTIME-P0-02.2 | Comparison engine (higher bar) | Done |
| RUNTIME-P0-11 | Ingestion Hardening — replay protection & event quarantine | Done — 2026-09-14, live RLS-verified |
| RUNTIME-P0-12 | SHOULD Normalization Model (unknown-safe) | Done — 2026-09-14, unit-tested |
| RUNTIME-P0-13 | Point-in-Time CAN Resolution & Historical Accuracy | Done — 2026-09-16: Risk Agent adopted it. `getFindingAsOfDetection()` (`modules/risk/findings.ts`) calls `compareShouldCanDid(tenantId, agentId, finding.createdAt)`, reconstructing CAN as of when a finding was first detected — the real, non-speculative caller this row was waiting on. Exposed via `GET /api/v1/findings/[id]/historical-context` and a "Show access as of detection time" panel in the Risk finding evidence drawer, see Risk Agent's own audit log |
| RUNTIME-P0-14 | Runtime Data Quality Tracking | Done — 2026-09-14, live-verified against real fixture data |
| RUNTIME-P0-15 | Runtime Gateway endpoint (master P0-26/P0-27/P0-33) | Done — 2026-09-25: `POST /api/gateway/v1/authorize` (agent-key auth, OBSERVE_ONLY, idempotent), migration `0062` `runtime_decisions` applied live, decisions panel on /runtime; 7 unit + 6 live SQL + 8 E2E security cases; p50 1,953 → 859 ms locally after cutting to 3 round trips; see audit log. The per-request runtime *event* moved to RUNTIME-P0-16, where event types exist |
| RUNTIME-P0-16 | Event types, sessions and decision fields (master P0-18) | Done — 2026-09-25: migration `0063` (12 event types, backfill, `session_id`/`decision_id`/`mcp_server`, `gateway` source) applied live; DID reads observed types only; gateway decisions on the timeline; truthful result labels; see audit log |
| RUNTIME-P0-17 | SHOULD tools and NOW (codebase-map D7, master P0-19) | Done — 2026-09-25: SHOULD carries `allowedTools`; new `unapproved_tool` outcome from observed tools; NOW from the latest gateway decision; four-column comparison with EXPERIENCE-P0-17 wording; see audit log |
| RUNTIME-P0-18 | Emergency controls and tool filtering at the gateway (master P0-34/P0-35) | Done — 2026-09-25: migration `0064` `runtime_emergency_controls` applied live (kill switch, tool/MCP-server suspension, session termination); gateway decisions honour them; revoke-all-keys; `POST /api/gateway/v1/tools/filter` (observe-only reports `wouldHide`); controls card on /runtime; 5 decision + 3 filter + 5 service unit cases, 6/6 live SQL, 6/6 E2E; see audit log |

### 06 — Risk Agent

**Module:** Risk Engine & Rogue Agent Detection  
**Backlog status:** DORMANT — do not start until the user says "Run Risk Agent"  
**Stories:** 13 done · 2 partial · 0 deferred · 1 not started (16 tracked) · 4 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| RISK-P0-01.1 | Schema | Done |
| RISK-P0-01.2 | Detection rules, one per category | Done |
| RISK-P0-01.3 | Explainability | Done |
| RISK-P0-02.1 | Severity/risk score | Done — 2026-09-16: Identity published `updateAgentRiskScore()` (`modules/agent-identity/agents.ts`, service-role write with manual tenant check); `evaluateAgentRisk()` now calls it once per evaluation with the deterministic agent-level score (`base.riskScore`), persisting onto `agents.risk_score` regardless of whether any finding category actually triggered |
| RISK-P0-03.1 | Assignment & recommendation | Done |
| RISK-P0-03.2 | Human-initiated remediation | Done — `remediateFinding()` now calls Access Agent's already-published `revokeAccessGrant()` for every `access_grant`-evidenced grant; honestly `wired: false` for finding categories with no such evidence |
| RISK-P0-03.3 | Re-evaluation & resolution | Done |
| RISK-P0-01.4 | Evaluator version on evidence pack | Done |
| RISK-P0-02.2 | Configurable severity weights & INFO tier | Done |
| RISK-P0-03.4 | Expanded finding lifecycle states (ACKNOWLEDGED/INVESTIGATING/MITIGATED/EXCEPTION) | Done |
| RISK-P0-03.5 | False positive disposition with reason & expiry | Done |
| RISK-P1-05 | Additional deterministic risk factors (privilege level, destructive capability, credential status, attack path) | Partial — 2026-09-19: "Privilege level" fully wired (real data via `getEffectiveAccess()`'s `privilegeLevel`, triggers on elevated/admin); the other three have real names/weights but always contribute 0, each with its own documented missing-contract dependency, per this story's own explicit acceptance allowance — see audit log |
| RISK-P0-04 | Governance Drift detection | Done — 2026-09-16, unit-tested (7 tests), migration `0054` live-applied. New `governance_drift` category diffs current purpose/autonomy/allowed-tools/approved-actions/owners/IAM-identities/effective-access against the agent's state as of its last `APPROVED` lifecycle transition (no new table, reuses `risk_findings`/`risk_evidence`); "new tool/data source beyond `allowedTools`" and "runtime behavior changed" deliberately not built as separate sub-signals — see audit log |
| RISK-P0-11 | Investigations as a first-class record (master P0-37) | Done — 2026-09-25: migration 0071 (investigations, investigation_findings, investigation_events; select-only RLS; composite same-tenant FKs), audited service + API, `/risk/investigations` list/detail with timeline; cannot resolve while a finding is open |
| RISK-P0-12 | New risk signals (master P0-20/P0-21) | Partial — 2026-09-25: suspicious delegation + unapproved tool use findings (migration 0072), certification overdue / destructive capability / credential health factors sourced, Shadow AI signal on /risk; attack-path factor still has no source (needs an Access graph-traversal contract) |
| RISK-P0-13 | Rogue Access management | Not Started — 2026-09-26, WonderID |

### 07 — Compliance Agent

**Module:** Certification, Controls & Compliance  
**Backlog status:** DORMANT — do not start until the user says "Run Compliance Agent"  
**Stories:** 13 done · 0 partial · 0 deferred · 1 not started (14 tracked) · 4 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| COMPLIANCE-P0-01.1 | Schema | Done |
| COMPLIANCE-P0-01.2 | Campaign launch & item population | Done — 2026-09-16: all 5 scope types now have real population logic. `application`/`entitlement` scopes filter every agent's grants by Access Agent's newly-published `AccessGrant.applicationId`/`entitlementId`; `privileged_access` filters by the newly-published `AccessGrant.privilegeLevel` (elevated/admin); `high_risk_agent` filters agents by `agents.risk_score` against Risk Agent's own "high" band threshold (50, `scope.minRiskScore`-overridable). `application`/`entitlement` scope input is validated (existence-checked) before the campaign row is created, so bad input never leaves an orphaned empty campaign. Campaign-launch UI (`app/(customer)/compliance/campaigns/page.tsx`) intentionally left as bare functional scaffolding exposing only `scope_type`/`criticality` for this pass — form inputs for the other 4 scopes' parameters are Experience Agent's to compose per CLAUDE.md §13 |
| COMPLIANCE-P0-01.3 | Reviewer decision flow | Done — 2026-09-16: Access Agent published `request_type` (migration `0060`, `'grant'`/`'modify'`) plus `getAccessGrant()`/`getEntitlement()`; `modify` now resolves the item's grant → entitlement → application and calls `createAccessRequest(..., "modify")`, setting `remediationId` to the new request's id (same pattern `revoke` already used for `access_grants`) |
| COMPLIANCE-P0-01.4 | Certification detail panel data | Done |
| COMPLIANCE-P0-02.1 | Schema (higher bar) | Done |
| COMPLIANCE-P0-02.2 | Status computation, never a compliance claim (higher bar) | Done — 2026-09-16: Access Agent published `hasOpenPolicyViolation(tenantId, policyId)` (each evaluated agent's most-recent `policy_evaluations` result, so a stale/since-fixed violation never keeps a mapping flagged); `addControlEvidence()` now computes `non_compliant` when the mapped policy has an open violation, unless an explicit manual attestation overrides it |
| COMPLIANCE-P0-03 | Evidence snapshot (contract/policy versions) | Done |
| COMPLIANCE-P0-04 | Reviewer authorization & Segregation of Duties | Done |
| COMPLIANCE-P0-05 | Escalation of overdue certification items | Done — 2026-09-16: `escalateOverdueItemsForAllTenants()` sweeps every active tenant and is wired to a real daily Vercel Cron job (`vercel.json` → `app/api/cron/compliance-escalate-overdue/route.ts`, secured by a `CRON_SECRET` bearer-token check with constant-time comparison); the operator/API-triggered per-tenant sweep from the original implementation still exists alongside it for on-demand use |
| COMPLIANCE-P0-06 | Tamper-evident evidence export package | Done — export file/delivery mechanism built via Operations' `exportCampaignEvidencePackage()` (`?format=csv` on the existing export route), now that COMPLIANCE-P0-09/OPERATIONS-P0-07 resolved the Compliance-vs-Operations ownership question |
| COMPLIANCE-P0-07 | Governance Posture (composite score, distinct from risk) | Done — computed read-model across 12 dimensions, `getGovernancePosture()`, `GET /api/v1/compliance/agents/[id]/posture` |
| COMPLIANCE-P0-08 | Governance Attestation (broad: approver/decision/evidence) | Done — `governance_attestations` table, `recordAttestation()`/`listAttestationsForAgent()`/`getLatestAttestation()`, `GET/POST /api/v1/compliance/agents/[id]/attestations` |
| COMPLIANCE-P0-09 | Governance Evidence Pack assembly | Done — `assembleGovernanceEvidencePack()`; export handed to Operations' `OPERATIONS-P0-07` via `POST /api/v1/compliance/agents/[id]/evidence-pack` |
| COMPLIANCE-P0-10 | Certification campaigns for every identity type | Not Started — 2026-09-26, WonderID |

### 08 — Experience Agent

**Module:** Customer UI/UX & Product Experience  
**Backlog status:** DORMANT — do not start until the user says "Run Experience Agent"  
**Stories:** 20 done · 2 partial · 0 deferred · 4 not started (26 tracked) · 4 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| EXPERIENCE-P0-01.0 | Design tokens & theming foundation (light/dark) | **Done** — 2026-09-16: the sandbox's Supabase egress blocker lifted, so authenticated in-app screens were finally verified in a real browser. Signed in for real through Supabase Auth as a seeded `TENANT_SUPER_ADMIN` with real tenant data and walked 16 routes × 3 widths × 2 themes (78 renders): the OKLCH token layer resolves correctly under `data-theme` everywhere — `body` background `lab(96.75 -0.66 -2.15)` light vs `lab(3.66 -0.38 -3.77)` dark on every route — with Overview eyeballed in both themes (cards, Recharts severity chart, severity badges, topbar all correct). See audit log |
| EXPERIENCE-P0-01.1 | Shell layout | Done — restructured per EXPERIENCE-P0-09: topbar left group (nav trigger, logo, tenant name), right group (search, notifications only, no avatar); account menu relocated into the nav drawer |
| EXPERIENCE-P0-01.2 | Responsive behavior | **Done** — 2026-09-16: authenticated screens measured at mobile 390 / tablet 768 / desktop 1440 in both themes across 16 real routes. **Horizontal overflow was 0px on every one of the 78 renders** — no clipping, no sideways scroll at 390px, no error boundary or placeholder anywhere. See audit log |
| EXPERIENCE-P0-01.3 | Loading/empty/error states & skeleton loaders | Done — `app/(customer)/loading.tsx`/`error.tsx` give every route a real skeleton and a designed, retry-able error state by default; every page now also uses `EmptyState`/`TableSkeleton`/`DetailSkeleton` directly where relevant |
| EXPERIENCE-P0-02.1 | Overview dashboard cards | Done — all nine cards, real queries, parallel fetch |
| EXPERIENCE-P0-02.2 | Risk trend charts & action queue | Done |
| EXPERIENCE-P0-03 | Domain Screens (Agent/Access/Runtime/Rogue/Certification/etc.) | Done — the four per-agent worked layouts (Agent Detail/Access/Runtime/Risk) are one coherent tabbed experience; every remaining domain screen (Access, Policies, Integrations, Compliance campaigns, Audit, Search, Reports, Settings, Identity's new/discovery/duplicates) is restyled onto Card/Table/DataTable; the PRD §37 Rogue Agent Detail worked layout is now built at `/risk/rogue` (list) and `/risk/rogue/:agentId` (dedicated investigation view: why-flagged findings, SHOULD/CAN/DID deviation, ownership/accountability) — see audit log for the reused, documented rogue-category definition |
| EXPERIENCE-P0-04 | Action Safety (confirmation, scope preview, bulk-action reporting) | Partial — `ConfirmActionDialog` now wired to six real destructive/consequential actions across four modules (Risk's remediate, Identity's duplicate-merge, Compliance's revoke decision, Foundation's role removal, Access's direct grant revocation); SSO connection deletion was checked and confirmed to not exist as a feature at all (no `DELETE` route, no server action) — building it would be Foundation Agent's scope, not an Experience Agent confirmation-dialog retrofit, so it is correctly out of scope, not a gap; bulk-action reporting still has no real bulk endpoint to prove itself against — see audit log |
| EXPERIENCE-P0-05 | Accessibility Foundation (keyboard nav, focus management, ARIA, contrast) | Done — global focus-visible styles, skip-link, `aria-current`, accessible dialog/drawer patterns (via Radix), and shared `Field` label associations applied across `modules/ui/*` and every restyled page; WCAG contrast now verified with a real computed audit tool (`scripts/contrast-check.mjs`, WCAG relative-luminance formula) across every token pair in both themes — found and fixed two real failures (`success`/`warning` text-on-background in light mode, `input` component-boundary contrast in both themes), all pairs now pass |
| EXPERIENCE-P0-06 | Evidence Drawer & Investigation Deep Links | Done — `EvidenceDrawer`/`useEvidenceDrawerParam` now consumed by four real surfaces: Risk finding evidence, Access's `explainAccessPath()` (why-can-X-access-Y, deep-linkable `?path=`), Runtime's event detail (`?event=`), and Compliance's certification evidence snapshot (`?snapshot=`) — each namespaced so more than one drawer can coexist on a page |
| EXPERIENCE-P0-07 | Shell Global Search & Notifications | Done — `ShellGlobalSearch`/`ShellNotifications` now genuinely compose Operations Agent's real `/api/v1/search` and `/api/v1/notifications` endpoints (debounced live search, unread-count badge, mark-as-read) — corrects an earlier overclaim in this same row that described this as done while the components still rendered `NotYetAvailable`, see audit log |
| EXPERIENCE-P0-08 | Data Table Primitive (sort/filter/pagination/saved URL state/responsive card transform) | Partial — `DataTable`/`useTableState`, plus `SimpleDataTable`, now consumed by eight real screens (Agent Inventory, Access Applications, Policies, the Risk index's agent/finding-count table, Integrations, Access Requests, Compliance Campaign Items); pagination/sort/filter still run client-side over the already-fetched full list since the underlying `list*()` contracts have no server-side pagination parameters yet (a documented stopgap, not the primitive's own limitation); Audit intentionally kept on the plain `Table` primitive since it already has real server-side cursor pagination (`listAuditLogs`) — converting it to `SimpleDataTable`'s client-side model would be a §15 regression, not an improvement; a few smaller lists remain on plain `Table`, reasonable for their current size |
| EXPERIENCE-P0-09 | Locked Product Design System v2 (shadcn/Radix + CVA + OKLCH tokens + drawer-only nav + restructured topbar/account menu) | **Done** — adopted in full 2026-09-14 by explicit user approval (see the earlier Requirements Refresh addendum's four flagged questions, all resolved "adopt fully"): tokens re-keyed to OKLCH under shadcn's naming scheme, `Button`/`Badge` rebuilt on `class-variance-authority` with the exact default/outline/secondary/ghost/destructive/link variant set, left nav is now a drawer at every width (no desktop docked rail), topbar restructured (no avatar; tenant name in the left group), account menu relocated to the bottom of the nav drawer. One deliberate, disclosed deviation: dark mode was kept (re-implemented in OKLCH), not demoted to unsupported — see audit log for why |
| EXPERIENCE-P0-09.1 | Visual-language reskin (color/roundness/shadow retune against 6 user-supplied reference screenshots) | Done — 2026-09-14, by explicit user confirmation ("just match the visual language"), scoped to token values only (same shadcn token names/architecture, same CVA components, same nav/layout structure): cooler light-gray background, more vivid blue-indigo primary, larger base radius, shadow-forward `Card` (rounded-xl + shadow-md, was rounded-lg + shadow-sm); dark mode re-derived proportionally, not dropped. WCAG contrast re-verified via `scripts/contrast-check.mjs` after retuning — 4 severity-color pairs initially failed 4.5:1 post-retune and were darkened until they cleared it (all pairs pass in both themes); visually verified via a real-CSS component swatch render, and as of 2026-09-16 confirmed on real authenticated screens in both themes at three widths (see EXPERIENCE-P0-01.0/01.2 and the audit log) — see audit log |
| EXPERIENCE-P0-10 | Tenant Selection / Onboarding Screen (PRD §34 screen #2) | Done — re-verified 2026-09-16: `app/onboarding/page.tsx` already fully composed from `modules/ui/*` (`Card`/`CardHeader`/`CardBody`/`Button`/`TextField`), no raw inline styles remain; restyled by a prior parallel session, this row was simply stale |
| EXPERIENCE-P0-11 | Effective Access Graph Visualization (PRD §34 screen #6; CLAUDE.md §2 stack: "a graph visualization library (for the effective-access graph)") | Done — `modules/ui/AccessGraphView.tsx` (reactflow), wired into the Access/CAN tab above the flat grant table |
| EXPERIENCE-P0-12 | Agent Detail Header Fields & Primary Action Bar (PRD §35 worked layout) | Done — header fields (Business/Technical Owner, IAM Identity, Last Activity, Next Certification) + `AgentPrimaryActionBar` (Certify Access, Restrict, Suspend, Request Change, Investigate, View Access Graph) added to `app/(customer)/agents/[id]/page.tsx` |
| EXPERIENCE-P0-13 | Rogue Agent Detail Action Set (PRD §37 worked layout) | Done — `RogueAgentActionBar` (Restrict/Suspend/Assign owner; Create exception disabled, see audit log) + per-finding `FindingActions` (Create remediation/Mark false positive) added to `/risk/rogue/[agentId]` |
| EXPERIENCE-P0-14 | Public landing page + restyled auth screens | **Done** — 2026-09-17: `app/welcome/*` (hero, SHOULD/CAN/DID model with a worked FinanceBot finding, six-capability grid, four-step how-it-works, closing CTA, footer), served at `/` for signed-out visitors via a rewrite in `proxy.ts` so the marketing page and the authenticated Overview share the root path without two route groups declaring it. `/sign-in` and `/sign-up` moved off raw inline-styled scaffolding onto `AuthShell` + `TextField`/`Button`. Also wired the Geist fonts the tokens already referenced but nothing defined. Verified: 0px horizontal overflow at 320/390/430/768/1024/1440/1920 in both themes, and `tests/e2e/welcome.spec.ts` (10 assertions) plus the full auth + navigation-smoke specs (48) pass |
| EXPERIENCE-P0-15 | Landing page product imagery, problem/solution narrative, animated flow | **Done** — 2026-09-17: real desktop + mobile screenshots of the running app (`assets/product/*`, regenerated by `scripts/capture-landing-shots.mjs`, captured against a purpose-seeded Northwind Financial demo tenant), framed by new `BrowserFrame`/`PhoneFrame` primitives with layered OKLCH shadows; every shot captured light AND dark and swapped by new `.theme-light-only`/`.theme-dark-only` CSS guards that mirror the token blocks; new `FlowDiagram` animating contract/entitlements/runtime → deterministic comparison → finding (CSS stroke-dash + pulse ring, both disabled under `prefers-reduced-motion`); explicit problem section preceding the re-framed solution. 0px overflow at all seven widths; 53 E2E passing |
| EXPERIENCE-P0-14 | AI-Assisted Investigation UI (read-only summaries) | Done — `AiSummaryPanel` shared component wired into Rogue Agent Detail (finding + SHOULD/CAN/DID summaries); shows "not configured" until FOUNDATION-P0-16 has a provider |
| EXPERIENCE-P0-16 | Light-console screens 4–12 and the MCP boards | Not Started — 2026-09-25, master stories |
| EXPERIENCE-P0-17 | Access wording: friendly label with the technical term | Done — 2026-09-25: one `ACCESS_VIEW` source in `modules/ui`, applied to runtime, rogue, Agent 360, access, help, welcome, AI settings and the evidence pack |
| EXPERIENCE-P0-18 | WonderID brand and dark navy navigation shell | Not Started — 2026-09-26, WonderID |
| EXPERIENCE-P0-19 | WonderID Home and My Access self-service portal | Not Started — 2026-09-26, WonderID |
| EXPERIENCE-P0-20 | WonderID AI assistant | Not Started — 2026-09-26, WonderID |

### 09 — Platform Agent

**Module:** Vendor Platform Administration  
**Backlog status:** DORMANT — do not start until the user says "Run Platform Agent"  
**Stories:** 12 done · 1 partial · 1 deferred · 1 not started (15 tracked) · 4 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| PLATFORM-P0-01.1 | Route isolation (higher bar) | Done |
| PLATFORM-P0-01.2 | Seeding & bootstrap | Done |
| PLATFORM-P0-02.1 | Schema | Done |
| PLATFORM-P0-02.2 | Tenant lifecycle actions | Done — the CRITICAL `current_tenant_ids()` gap was fixed by Foundation (migration `0039`, applied live) on 2026-09-14; re-verified 2026-09-16 that the fix is applied to the dev Supabase project and the function now filters on `tenants.status = 'active'` — row was simply stale, no new work needed |
| PLATFORM-P0-02.3 | Feature flags | Done |
| PLATFORM-P0-03.1 | Global branding | Done |
| PLATFORM-P0-03.2 | Platform health surface | Done |
| PLATFORM-P0-04.1 | `platform_audit_logs` | Done |
| PLATFORM-P0-04.2 | Support access (higher bar) | Deferred — no time-bound/audited support-access infrastructure exists; the backlog explicitly forbids shipping an unbounded shortcut, so nothing was built |
| PLATFORM-P0-05.1 | Usage & Limits tracking/enforcement | Done — `checkUsageLimit()`/`getUsageSummary()` published; not yet called by any other module's create path (same as `isFeatureEnabled()` itself) |
| PLATFORM-P0-05.2 | AI Provider Configuration | Done — resolved 2026-09-16 via `AskUserQuestion` (provider = OpenAI; key scope = both platform-wide default and per-tenant BYOK, tenant chooses). Gemini added the same day per a follow-up user request. `platform_ai_provider_configs` (migrations `0057`/`0058`), `modules/platform-admin/aiProviderConfig.ts`, `/settings/ai` UI (provider selector), and `lib/ai/summarize.ts` now call the real OpenAI or Gemini REST API depending on the tenant's configured provider |
| PLATFORM-P0-05.3 | Global Configuration Versioning | Done |
| PLATFORM-P0-05.4 | Maintenance Mode & Platform Announcements | Done — Experience Agent's customer-facing `AnnouncementsBanner` now renders `getActiveAnnouncements()` in the shared customer shell (`app/(customer)/layout.tsx`), 2026-09-16 |
| PLATFORM-P0-12 | Enforce feature flags (codebase-map D8, master §26) | Partial — 2026-09-25: 13 master rollout flags seeded (`0065`, safe-rollout defaults); flags now enforced at the gateway (`runtime_observe`/`runtime_enforce`/`tool_filtering` — ENFORCE really enforces, per tenant) and at runtime ingestion, remediation, connector creation and certification launch; batched `getFeatureFlags()`. Remaining: `ai_assistant` (defaults OFF while AI summaries are live — needs a platform decision before enforcing) and the not-yet-built features' flags; see audit log |
| PLATFORM-P0-13 | Configuration Studio | Not Started — 2026-09-26, WonderID |

### 10 — Operations Agent

**Module:** Audit, Reporting, Notifications & Search  
**Backlog status:** DORMANT — do not start until the user says "Run Operations Agent"  
**Stories:** 11 done · 1 partial · 0 deferred · 2 not started (14 tracked) · 4 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| OPERATIONS-P0-01.1 | Audit log viewer | Done |
| OPERATIONS-P0-01.2 | Evidence export | Done |
| OPERATIONS-P0-02.1 | Schema & channels | Done — 2026-09-16: user picked Resend. Both channels real: in-app (unchanged) plus `modules/operations/email.ts`'s `sendNotificationEmail()`, called from `notify()` for every event. Targets the specific `userId` when set, otherwise broadcasts to every active tenant member (same semantics the in-app channel already used), honoring each recipient's `notification_preferences.email_enabled` (defaults to on when no row exists) |
| OPERATIONS-P0-02.2 | `notify(event)` and trigger wiring | Done — 2026-09-19: all 7 event types now wired. The 3 remaining ones each needed a real, user-directed product decision the backlog left open (which this pass made explicitly, not guessed): `certification_due` fires from Identity's existing on-read `ACTIVE -> CERTIFICATION_DUE` transition (no scheduler needed — the transition itself is the one genuine write event); `ownership_missing` fires from `removeOwner()` when it's the removal that takes a required owner type to zero (the "since agent creation" sub-case is intentionally not covered — see audit log); `lifecycle_expiry` fires from a new daily cron sweep (`app/api/cron/access-exception-expiry-reminders`) over expired-but-still-active `policy_exceptions`, deduped via a new `wasRecentlyNotified()` helper — see audit log |
| OPERATIONS-P0-03.1 | Global search (higher bar) | Done — 2026-09-19: all 9 named object types implemented. Identity Agent published `listOwnersForTenant()`/`listIdentitiesForTenant()` and Access Agent published `listEntitlementsForTenant()` (each the tenant-wide counterpart of an already-published per-agent/per-application list), wired into `search()` for the previously-missing identity/owner/entitlement types — see audit log |
| OPERATIONS-P0-03.2 | Search traceability & role-based field masking | Done |
| OPERATIONS-P0-04.1 | P0 report set | Done |
| OPERATIONS-P0-04.2 | Report traceability (linked records + data freshness) | Done |
| OPERATIONS-P0-05.1 | Notification preferences | Partial — schema/CRUD and mandatory-type enforcement done and live-verified; every P0 notification type is mandatory in this build, so there is no actual optional preference to toggle yet (not a bug — documented) |
| OPERATIONS-P0-06.1 | Operational job reporting (connector/sync/job status) | Done — customer-facing `/integrations/jobs` page built, composing `getJobStatusSummary()`, added to the Integrations nav group |
| OPERATIONS-P0-07 | Governance Evidence Pack export (PDF/CSV/JSON delivery) | Done — 2026-09-16: PDF renderer added (`pdf-lib`, user-approved new dependency); `exportGovernanceEvidencePack()` now produces all 3 formats, all sharing the same SHA-256 content hash. The narrower campaign-scoped `exportCampaignEvidencePackage()` (COMPLIANCE-P0-06) intentionally stays JSON/CSV-only — its format parameter type now explicitly excludes "pdf" |
| OPERATIONS-P0-08 | Runtime and approval notifications (master P0-41) | Done — 2026-09-25: enforced DENY → `runtime_alert`, enforced REQUIRE_APPROVAL → `approval_required` (mandatory, throttled per agent); search covers gateway decisions and (with RISK-P0-11) investigations |
| OPERATIONS-P0-09 | Workflow designer and runs | Not Started — 2026-09-26, WonderID |
| OPERATIONS-P0-10 | WonderID insights, reports and identity graph views | Not Started — 2026-09-26, WonderID |

### 11 — QA Agent

**Module:** Final Integration, QA & Security Hardening  
**Backlog status:** DORMANT — do not start until the user says "Run QA Agent". This agent  
**Stories:** 13 done · 12 partial · 0 deferred · 3 not started (28 tracked) · 7 P1 / 3 P2 ahead

| Story | Title | Status |
|---|---|---|
| QA-P0-01.1 | Repository & contract inventory | Done — `INTEGRATION_STATUS.md` §1, cross-referenced from every module's own Progress Tracker/audit log |
| QA-P0-01.2 | Route map & permission matrix | Done — `INTEGRATION_STATUS.md` §2; found and fixed a stale route-prefix drift in `docs/design/ownership-map.md` (Compliance/Runtime/Risk) |
| QA-P0-02.1 | Full cross-tenant sweep | Partial — DB/API/search/reports/jobs layers all verified live; `tests/operations/tenant-isolation.sql` and (2026-09-16) `tests/compliance/governance-attestation-tenant-isolation.sql` (new — closes `COMPLIANCE-P0-08`'s missing isolation test) both run live and passing; `platform_config_versions`/`platform_announcements` confirmed to have zero client-facing policies at all (no customer-session isolation test needed — no customer session can read them), see `INTEGRATION_STATUS.md` §3/§9 |
| QA-P0-02.2 | RBAC boundary sweep | Partial — orphaned-permission check clean (0 found); negative-permission proof is generic (the shared gate function itself), not per-permission-key enumerated; SSO JIT mapping unit-tested, real IdP round-trip unverified (sandbox) |
| QA-P0-02.3 | Platform-admin isolation sweep | Done — live smoke test against every current `/platform-admin/*` page and `/api/platform/v1/*` route, all correctly denied unauthenticated |
| QA-P0-03.1 | The FinanceBot acceptance scenario, executed live | Partial — SQL-fixture-level proof (6 of 8 steps, see `INTEGRATION_STATUS.md` §4) unchanged; 2026-09-16 added a full 8-step browser-driven proof, `tests/e2e/financebot-central-scenario.spec.ts` (see `QA-P0-16`), covering every PRD §11 step including remediation-request and grant-revocation-then-resolve — still `Partial` because that spec has not yet had a first real CI run (see `QA-P0-16`'s own notes on why it couldn't run live in this pass) |
| QA-P0-04.1 | Pipeline sweep | Done — re-verified 2026-09-16: typecheck/lint/214 tests/cold-cache build all green repo-wide, `npm audit --production` 0 vulnerabilities, contrast-check all pairs pass both themes; see `INTEGRATION_STATUS.md` §9 |
| QA-P0-04.2 | Migration validation | Done — re-verified 2026-09-16: 56 migrations, no duplicate prefixes; found and fixed one real gap (`governance_attestations_agent_id_fkey` unindexed, migration `0056`), re-checked advisors clean; see `INTEGRATION_STATUS.md` §9 |
| QA-P0-04.3 | Responsive & performance spot-check | Partial — the responsive half is now **done for real** (2026-09-16): authenticated, real-browser sweep of 16 customer routes × mobile 390/tablet 768/desktop 1440 × light+dark = 78 renders against the live deployment with real tenant data — horizontal overflow 0px on every render, correct theme token resolution everywhere, no error boundary or placeholder (see `docs/design/experience-agent-backlog-audit.md`). The pagination gap this row named was closed 2026-09-16 via the shared `DEFAULT_LIST_LIMIT` (`lib/shared/pagination.ts`) across 15 `list*()` functions plus Risk's `getFindings()`; 4 completeness-dependent aggregates left uncapped with an inline reason each. Still `Partial` only for the *performance* half — no timing/Lighthouse measurement has been taken against a loaded tenant |
| QA-P0-04.4 | Regression fixes only, smallest safe change | Done — both fixes this pass were minimal, logged in Foundation's audit log, re-verified |
| QA-P0-05 | Clean install verification | Partial — 2026-09-16: a genuine from-scratch `git clone` + `npm ci` + typecheck/lint/full test suite (260/260)/production build all verified clean in an isolated directory (no carried-over `node_modules`/`.env.local`); the fresh-database migration-apply half still deliberately not attempted — creating a Supabase branch is a real billable action, and the user chose to skip it rather than incur the cost for this verification pass |
| QA-P0-06 | Authentication suite (SAML/OIDC/session) | Partial — role-mapping and session-expiry still only unit-tested (idle/absolute-expiry timing isn't practically E2E-testable without waiting real clock time); 2026-09-16 added real browser coverage for what was previously fully uncovered: sign-in success/failure, sign-up (including the already-registered-email and under-minlength-password paths), logout, unauthenticated redirect, and negative-permission/tenant-isolation checks (`tests/e2e/auth.spec.ts`, part of `QA-P0-16`). SAML/OIDC real IdP exchange and wrong-tenant/domain SSO paths remain out of scope (no test IdP available) |
| QA-P0-07 | Connector contract tests | Partial — Generic REST connector partially covered across existing unit tests; not all 8 named properties independently tested per connector; Saviynt/MCP contract tests not built |
| QA-P0-08 | Runtime test corpus | Done — 2026-09-19: `tests/runtime/should-can-did-corpus.ts`, six deterministic cases (one per named category), reused (not re-authored) by both `modules/runtime-assurance/compare.test.ts` (QA-P0-09) and `modules/risk/rules.test.ts` — see audit log |
| QA-P0-09 | SHOULD/CAN/DID reproducibility | Done — `compare.test.ts` directly asserts identical repeated output and evaluator-version stability |
| QA-P0-10 | Risk regression suite | Partial — 1 positive + 1 negative test exist, covering 3 of 8 categories; the full 5-kind × 8-category matrix is not built (deferred to Risk Agent's own further work, not duplicated here per non-negotiable #18) |
| QA-P0-11 | Certification regression | Done — 2026-09-19: added the missing fast self-review/SoD unit test (`decisions.test.ts`, 4 new cases: blocked without override, allowed+audited with override, not applied to a non-owner, not applied to a non-approve decision); the "no escalation regression test" half of this row was stale — `escalation.test.ts` already covers it in full (added alongside COMPLIANCE-P0-05's real Vercel Cron scheduler, after this row was last written) — see audit log |
| QA-P0-12 | Security scanning | Partial — live advisor scan run, one real finding fixed (security-definer over-grant); `npm audit` now run (prod + full scope), 0 vulnerabilities either way; no static-analysis pass beyond ESLint, `auth_leaked_password_protection` still disabled (dashboard-only setting, flagged for follow-up) |
| QA-P0-13 | Failure recovery (retry/idempotency) | Partial — dedupe-key idempotency unit-tested; no end-to-end forced-failure-and-retry test built |
| QA-P0-14 | Observability sweep | Partial — schema-level correlation/status/timestamp fields confirmed present; no field-by-field checklist run against every async operation type |
| QA-P1-07 | Release record completeness standard | Done — 2026-09-19: `INTEGRATION_STATUS.md` now opens with a Release identifier (commit + date) and an explicit P0/P1/P2 status summary (P0 detail is the table-level status below; P1/P2 are the modules' own prose `## P1`/`## P2` bullets, ~52/32 combined, overwhelmingly Not Started by design per CLAUDE.md §3) — see audit log |
| QA-P0-16 | Playwright E2E suite (browser-driven, real Supabase Auth) | Partial — 2026-09-16 (later): the sandbox's Supabase egress blocker is gone, so the suite was pointed at the live production deployment and **the framework is now proven against a real server** — `authenticate as platformAdmin` signed in end-to-end through real Supabase Auth and saved storage state. The four tenant-user logins failed on a **genuine product bug the suite existed to catch**: `getTenantContext()` returned every colleague's `tenant_memberships` row (RLS there is tenant-scoped, not user-scoped), so a single-tenant user resolved as a member of three organizations and was bounced to `/onboarding`; fixed in Foundation + Experience, proven at the data layer (3 rows → 1). A full run is still blocked, but on **credentials, not the network**: Vercel's Supabase env vars are Production-scoped so every preview 500s, and all five GitHub Actions secrets resolve empty in the job log. Needs `SUPABASE_SERVICE_ROLE_KEY` + `SECRET_ENCRYPTION_KEY` as repo secrets or Preview env vars — see `docs/design/qa-agent-backlog-audit.md` |
| QA-P0-17 | RLS-only read sweep (codebase-map D10) | Done — 2026-09-25: every tenant read filtered explicitly (≈25 sites), by-id writes check the parent, 0076 same-tenant keys on 13 references, org switcher fixed; `multi-org-isolation.spec` with a two-organization identity |
| QA-P0-18 | Runtime Gateway security suite (master §24) | Not Started — 2026-09-25, master stories |
| QA-P0-19 | Harden the FinanceBot scenario's final step | Done — 2026-09-25: each server action now awaits its own response before the next step; passes under two workers (22/22) and in the full suite; see audit log |
| QA-P0-20 | WonderID baseline lock, contract amendment and roadmap | Done — 2026-09-26: baseline in `docs/implementation/wonderid-baseline.json`; CLAUDE.md amended; spec and mockups in `docs/requirements/`; `docs/plan/WONDERID-ROADMAP.md`; 36 stories added across 10 backlogs |
| QA-P0-21 | WonderID security hardening pass | Not Started — 2026-09-26, WonderID |
| QA-P0-22 | Brownfield migration fixture | Not Started — 2026-09-26, WonderID |

