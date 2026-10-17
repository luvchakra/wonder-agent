# WonderAgent — Agent Run Order

This is the recommended dispatch order for the 11 module agents defined in
[`CLAUDE.md`](../CLAUDE.md) §2 and §7. It follows the dependency chains stated in
each module's own backlog (`docs/plan/*-BACKLOG.md`) and the ownership map
(`docs/design/ownership-map.md`) — not an arbitrary sequence.

**Standing autopilot policy** (per the user's instruction — see `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md`): once an agent finishes every story in its own backlog, it
automatically starts the next **dormant** agent below, in order, without waiting for
the user. The user can still type an agent's name at any time to jump out of order
or resume after a stop. Auto-chaining only ever runs one agent at a time — the next
one starts after the current one has fully finished, verified, and reported, never
concurrently. The only reasons to stop instead of auto-chaining: a genuine blocker,
or a key architecture/security decision the backlog doesn't specify (the
stop-and-report rule always wins).

**2026-10-09 — how work ships (explicit user decision, `CLAUDE.md` §19).**
- Every change goes through its own branch and a pull request.
- It is squash-merged as soon as CI (`security.yml`) is green.
- It is never pushed directly to `main`.
- Local checks before a push are the fast ones: typecheck, lint on the changed
  files, and the unit tests for the touched areas.
- CI runs the feature-specific checks on the pull request; the full Playwright
  suite runs nightly.
- §19 also adds the real-data, AI-governance and minimal-UI rules.
- Autopilot chaining above is unchanged.

## Run order

| Wave | Agent | Why this position | Status |
|---|---|---|---|
| 1 | Foundation Agent | Everything depends on tenant/RBAC/RLS/audit | Done (all P0 stories complete as of 2026-09-14, including the requirements-refresh additions — SSO/MFA marked Partial pending a real IdP/authenticator device this sandbox can't provide; see its audit log) |
| 2 | Identity Agent | Only needs Foundation; defines the canonical agent + Agent Contract (SHOULD) every later module reads | Done |
| 2 | Integration Agent | Only needs Foundation; can build its connector framework against manual data without waiting on Identity | Done |
| 3 | Access Agent | Needs Identity's contract + (ideally) Integration's normalized access data to compute CAN | Done |
| 3 | Runtime Agent | Needs Identity's contract + Access's CAN to run the SHOULD/CAN/DID comparison | Done |
| 4 | Risk Agent | Pure consumer of Identity + Access + Runtime's outputs — can't produce real findings before those exist | P0 Done (two sub-pieces Partial pending Identity/Access publishing new contracts); its P1 backlog was picked up 2026-09-19 (`RISK-P1-05`, Partial — one of four new factors wired for real, three honestly stubbed pending other modules' contracts) — see its audit log |
| 4 | Compliance Agent | Needs Identity, Access, Runtime, and Risk (for the Risk column in certification review) | Done, including the 2026-09-14 requirements-refresh P0 stories (evidence snapshot, reviewer authorization/SoD, escalation, evidence export) — five sub-pieces Partial pending another module publishing a contract, an unspecified scope, or (export/escalation) this codebase having no scheduler/export-delivery mechanism yet — see its audit log |
| 5 | Platform Agent | Only needs Foundation — independent of the domain chain, so it could technically run right after Wave 1, but is grouped here to match the original execution guide's review batches | Done — surfaced a CRITICAL cross-module finding (tenant suspension didn't block data access); **resolved** by Foundation Agent same day via migration `0039`, verified live. See both agents' audit logs. Also includes the 2026-09-14 requirements-refresh P0 stories (Usage & Limits, Global Configuration Versioning, Maintenance Mode & Announcements — Platform-side); AI Provider Configuration was deliberately deferred as an open product/security question, not guessed. |
| 5 | Experience Agent | Composes every domain module's published contract — most screens render "not yet available" until earlier waves exist | Partial, down to 3 of 12 Progress Tracker rows — 9 are `Done`, including the full Locked Design System v2 rip-and-replace (EXPERIENCE-P0-09, adopted 2026-09-14 by explicit user approval), the Agent Detail worked layout, the Rogue Agent Detail worked layout, and every domain screen restyled onto shared `modules/ui/*` primitives. The 3 remaining `Partial` rows are down to small, explicitly-named remainders, not broad gaps: EXPERIENCE-P0-01.0/01.2 (authenticated real-browser verification) were re-run for real on 2026-09-16 once the sandbox's Supabase egress blocker lifted — see that date's entries in the Experience and QA audit logs for what passed and what did not; EXPERIENCE-P0-04 (Action Safety) has 6 real `ConfirmActionDialog` consumers, missing only bulk-action reporting (no bulk endpoint exists anywhere yet); EXPERIENCE-P0-08 (Data Table) has 8 real consumers, missing only a few smaller lists reasonable at their current size. See its audit log. |
| 5 | Operations Agent | Reads across every domain module for audit/search/reports/notifications | Done — full P0 backlog built in its first dispatch (2026-09-14): audit viewer/export, notifications (in-app channel; email deferred, no provider available), search (6 of 9 object types), reports (all 8), notification preferences, job status. `notify()` is published but no producing module calls it yet — see its audit log. |
| 6 | QA Agent | Cross-module verification and the full P0 acceptance scenario — must run last, after everything it's testing exists | Partial — first dispatch complete; found and fixed two real defects (a flaky test, an over-permissive SECURITY DEFINER grant), found and fixed a stale ownership-map route-prefix drift, ran the FinanceBot scenario live (6/8 steps pass), and produced `INTEGRATION_STATUS.md` as the true current state including a real, named cross-module pagination gap and honestly-partial coverage of the requirements-refresh's extended hardening epics (QA-P0-06–14). Not yet a clean release-gate pass — see `INTEGRATION_STATUS.md` §8. See its audit log. |

Update the Status column in the same commit that starts or finishes an agent's run,
so this table stays a live, accurate picture of where the build stands.

## Release sequencing (2026-09-14 requirements refresh)

The updated master requirements package frames the same dependency chain as four
releases, cross-referenced here for traceability (no change to the Wave table above
or to auto-chain order — this is descriptive, not a new schedule):

- **Release 0 — Secure foundation:** Foundation P0 → Platform Agent's security
  boundary pieces → shared contracts. (Wave 1 + the security-boundary slice of Wave 5.)
- **Release 1 — First agent governed:** Identity P0 → Integration's Saviynt/MCP P0 →
  Access P0 → Runtime P0. (Waves 2-3.)
- **Release 2 — First finding and remediation loop:** Risk P0 → Compliance
  certification P0 → Operations evidence/reporting P0. (Wave 4 + Operations' slice of
  Wave 5.)
- **Release 3 — Enterprise productization:** Experience P0 completion → Platform's
  remaining P0 → QA P0 release gate. (The rest of Wave 5 + Wave 6.)

Each module backlog's own dated "Requirements Refresh" section records the specific
new/expanded P0/P1/P2 stories this package added; P1/P2 items must not destabilize
the releases above (see `CLAUDE.md` §3 "Priority tiers").

## 2026-09-25 — Master P0/P1/P2 stories and the light-console mockups

The user supplied *WonderAgent Master P0/P1/P2 Implementation Stories*: 43 P0
stories under DISCOVER → UNDERSTAND → GOVERN → PROTECT → ASSURE, with MCP
folded in rather than a separate product. It came with light-console
mockups.

[`docs/implementation/codebase-map.md`](implementation/codebase-map.md) maps
every P0 story onto the code: 11 Built, 21 Partial, 11 Gap.

- **The gaps are mainly the whole PROTECT pillar**, the Runtime Gateway and
  real-time authorization (P0-26 to P0-34), plus the NHI and shadow-AI
  inventories.
- **The five decisions were resolved by the user the same day**
  (codebase-map §6, and the ownership map's "Master stories decisions"):
  1. The gateway runs in this app and ships in observe-only mode. Access
     owns the decision function, Runtime owns the endpoint, and agents
     authenticate with per-agent API keys.
  2. Screens show both terms, e.g. "Approved (SHOULD)".
  3. Inventories: Identity owns NHI and shadow AI, Integration owns MCP,
     Access owns data sources.
  4. Only the missing permission keys are added.
  5. Investigations are a new grouped record owned by Risk.

  There are 25 new `Not Started` stories across ten backlogs.

  **Suggested order**, which follows the dependency chain:
  1. FOUNDATION-P0-17/18 (agent keys, permissions).
  2. ACCESS-P0-11 (the decision function).
  3. RUNTIME-P0-15 to 18 (the gateway, observe-only first).
  4. PLATFORM-P0-12 (flags) and OPERATIONS-P0-08 (notifications).
  5. The inventories (IDENTITY-P0-11/12, INTEGRATION-P0-06/07,
     ACCESS-P0-13).
  6. RISK-P0-11/12.
  7. EXPERIENCE-P0-16/17 alongside, as each backend lands.
  8. QA-P0-17 to 19 last.

No Wave table status changes. The UI shell, Dashboard, Agent inventory and
Agent 360 were rebuilt to the mockups, and three defects were fixed:

- D1: revoked policy exceptions still suppressed violations (Access).
- D2: the runtime identity was not tenant-checked (Runtime).
- D10: `listAgents()` spanned every tenant the user belongs to (Identity).

See each module's audit log, 2026-09-25.

### Progress on the suggested order (2026-09-25, same day)

Built on autopilot after the user's go-ahead ("yes, don't ask … all
safe"). Each story below was committed separately, pushed to `main`, and
verified by the full pipeline (eslint, vitest, the **full** Playwright
suite per §17.8). Its migration was applied to the live project with
isolation checks. Detail is in each module's audit log.

| Step | Story | Status | Commit |
|---|---|---|---|
| 1 | FOUNDATION-P0-17/18: agent API keys, permission keys | Done | (earlier) |
| 2 | ACCESS-P0-11: runtime decision function | Done | (earlier) |
| 3 | RUNTIME-P0-15..18: gateway, timeline, NOW, emergency controls | Done | (earlier) |
| 4 | PLATFORM-P0-12: feature flags enforced, per-tenant ENFORCE | Partial (3 broad flags not yet enforced) | `8914e67` |
| 4 | OPERATIONS-P0-08: runtime and approval notifications, search | Done | `6e4c0db`, `9694cb7` |
| 5 | IDENTITY-P0-11/12 + INTEGRATION-P0-07: NHI inventory, Shadow AI, MCP events reach runtime | Done | `b505520` |
| 5 | INTEGRATION-P0-06: MCP servers, tools and resources | Done | `eaff624` |
| 5 | ACCESS-P0-13: data sources inventory feeding CAN | Done | `d3208ea` |
| 6 | RISK-P0-11: investigations | Done | `9694cb7` |
| 6 | RISK-P0-12: new risk signals | Partial (attack-path factor has no source) | see Risk audit |
| + | IDENTITY-P0-14: identity links audited with explicit confidence (D3); ASSESSED reachable (D4) | Done | `73c47b6` |
| + | ACCESS-P0-14: separation-of-duties checks wired (D5) | Done | `1e98e94` |
| + | ACCESS-P0-12: policy targets, priority, draft → publish | Done | `6c1d9af` |
| + | IDENTITY-P0-13: contract and ownership completeness; same-tenant agent references | Done | `9da1e87` |
| + | EXPERIENCE-P0-17: "Approved (SHOULD)" / "Effective Access (CAN)" / "Observed (DID)" / "Current Request (NOW)" wording | Done | `fc6ffb7` |
| + | QA-P0-17: RLS-only read sweep, same-tenant keys (0076), org switcher fix, two-organization E2E | Done | `919d1dc` |
| + | Demo data: `npm run seed:demo` seeded WonderArk across every module (real gateway decisions); Agent 360 decision labels fixed | Done | `84e3dda` |
| W0 | QA-P0-20: WonderID adopted, contract amended, baseline locked, roadmap written | Done | `0a52efa` |
| W0 | EXPERIENCE-P0-18: WonderID brand and dark navy navigation shell | Done | `26a5f1a` |
| W1 | IDENTITY-P0-15/16: unified `identities` reference, attributes, relationships (0077–0079) | Done | `fe6c271` |
| W1 | IDENTITY-P0-17: Identities directory and detail | Partial (Groups/Access/Risk/Activity views wait on later phases) | `fe6c271` |
| W2 | INTEGRATION-P0-08/09: identity sources, reconciliation, pending matches, preview (0080–0083) | 09 Done, 08 Partial (schedules, native SCIM) | `24ef508` |
| W2 | IDENTITY-P0-18: human lifecycle events, governed tasks, ownership transfer (0084/0085) | Partial (auto birthright/deprovisioning wait on ACCESS-P0-20, INTEGRATION-P0-13) | `a2530cb` |
| W3 | ACCESS-P0-15: application catalog and inventory (0086) | Done | `3793c5b` |
| W3 | INTEGRATION-P0-11: outbound SSRF guard, capability model, idempotent write interface (0087) | Partial (write interface's E2E comes with INTEGRATION-P0-13) | `dadd08e` |
| W3 | ACCESS-P0-16: application onboarding — configure, validate, simulate, four-eyes approve, promote (0088) | Done | `386bfb8` |
| + | ACCESS-P0-14 fix: an advisory SoD policy could hide a blocking one | Done | `1a558dc` |
| W3 | ACCESS-P0-17: account inventory — identity correlation, orphan, ambiguous, dormant, reconciliation (0089) | Done | `f7d7b24` |
| W3 | INTEGRATION-P0-10: application discovery — connectors, OpenAPI, SCIM, manual; unrecognized applications and decisions (0090) | Done | `d2c1a0a` |
| + | Risk evaluation pending state; FinanceBot spec waits for the evaluation | Done | `9336cf4` |
| W3 | INTEGRATION-P0-12: AI-assisted onboarding proposals, proposal only (0091) | Done | `c4d0e06` |
| + | Proxy: an unreachable sign-in service answers 503 / "service unavailable", not "session expired" | Done | `e6c9f59` |
| W4 | ACCESS-P0-18: request catalog and request policies; requests for identities (0092) | Done | with P0-19 |
| W4 | ACCESS-P0-19: approval engine — staged chains, approver scope, four-eyes in the database, fingerprint invalidation, escalation/expiry (0093) | Done (named groups deferred) | `a177663` |
| W4 | ACCESS-P0-20: access packages — contents, eligibility-controlled discovery, requests through the approval engine, assignments with work items, expiry and revocation work (0094) | Done | `8332995` |
| 4b | FOUNDATION-P0-22: tenant URL and domain registry — slug policy, `tenant_domains`, `<slug>.<BASE_APP_HOST>` routing, tenant-branded sign-in, suspension (0095) | Done (custom-domain verification P1) | see Foundation audit |
| 4c | EXPERIENCE-P0-22/23: WonderID brand foundation — the supplied brand sheet's artwork, brand configuration and tokens, logo components, shell and sign-in | Done | see Experience audit |
| 4b | FOUNDATION-P0-24: permission catalog — resource, action, module, label and sensitivity on every key, §28 administrative keys, catalog screen (0097) | Done | see Foundation audit |
| 4b | FOUNDATION-P0-25: system and custom roles — the spec's system roles, protected definitions, custom roles with lifecycle and designer, role details, no escalation by design (0098) | Done | see Foundation audit |
| 4c | EXPERIENCE-P0-23 (revised): the branding specification's light console sidebar, by user decision | Done | see Experience audit |
| 4b | FOUNDATION-P0-23: users and membership lifecycle — Users list, Add user wizard, User detail (roles, effective permissions, access history, sessions), suspension with session revocation, invitations, self-protection and last-administrator guard (0096) | Done | see Foundation audit |
| 4b | FOUNDATION-P0-26: groups — groups, members and group roles; effective permissions combine direct and group roles per request; no escalation through groups, in the service and the database; Groups screens, user and role pages, users-list filter (0099) | Done (group scopes wait on P0-19) | see Foundation audit |
| 4b | FOUNDATION-P0-19: scoped assignments and the authorization engine — assignment scope, validity and MFA condition (direct and group), explicit deny/require-approval policies with exemptions, deterministic `authorize()` behind `requirePermission()`, resource-scoped agent routes, Authorization Policies screen (0100) | Done (generic resource scope and application routes with P0-20) | see Foundation audit |

**WonderID (adopted 2026-09-26, explicit user decision).** The product is now
WonderID; the programme continues in `docs/plan/WONDERID-ROADMAP.md`, phase by
phase, after QA-P0-20 locked the baseline. Phase 1 is done except IDENTITY-P0-17's
later-phase views; Phase 2's sources and reconciliation are in. IDENTITY-P0-18's
lifecycle is in. Phase 3 has the catalog (ACCESS-P0-15), the outbound guard and
write interface (INTEGRATION-P0-11), onboarding (ACCESS-P0-16) and the account
inventory (ACCESS-P0-17), application discovery (INTEGRATION-P0-10) and
onboarding proposals (INTEGRATION-P0-12): Phase 3 is complete. Phase 4 has
the request catalog and policies (ACCESS-P0-18) and the approval engine
(ACCESS-P0-19) and access packages (ACCESS-P0-20).

**Phase 4b (added 2026-09-26, user-supplied specifications): tenant & user
permissioning runs next**, ahead of Phase 4's remaining stories. It covers
FOUNDATION-P0-22 through -27, the re-scoped FOUNDATION-P0-19 and -20,
PLATFORM-P0-14, COMPLIANCE-P0-11 and EXPERIENCE-P0-21. The plan, gap
analysis and recorded decisions are in `docs/plan/WONDERID-ROADMAP.md`
§ Phase 4b. FOUNDATION-P0-22 (tenant addresses) is done. **Production
needs `BASE_APP_HOST` set in Vercel and a wildcard domain
`*.<BASE_APP_HOST>` on the project**; until then tenant addresses are
simply off and the app behaves as before.

**Still to do in this programme:**

- EXPERIENCE-P0-16 (the remaining mockup screens).
- QA-P0-18 (the gateway security suite).

**Open items recorded, not decided:**

- The `ai_assistant` flag defaults off while AI features are live
  (Platform).
- The MCP connector's outbound URL has no SSRF guard (Integration → QA
  security suite).
- The integration's one secret serves as both the outbound credential and
  the inbound bearer token (Integration).
- The shared `Table` cell breaks words mid-letter at desktop widths, and
  the Audit and Roles tables rely on that (Experience).
- `assignFinding()` does not check that the assignee is a member (Risk).
- Tenantless users' page renders log a harmless `QUERY_FAILED` before the
  redirect (Experience).

## Notes

- **Waves 2, 3, and 4 pairs can run in either order within the pair**
  (Identity/Integration; Access/Runtime; Risk/Compliance) — they don't block each
  other, only the wave before them.
- **Wave 5's three agents are independent of each other** too — order among
  Platform/Experience/Operations doesn't matter, only that Wave 4 is far enough
  along.
- Each agent reads `CLAUDE.md`, its own backlog, and its own audit-log tail on
  start — no need to re-paste context, just type the phrase.
- If an agent hits a real dependency gap (e.g. Access Agent starts before
  Integration Agent has published real data), its backlog explicitly allows
  building against manual/stub data rather than blocking — it records the gap in
  its own audit log rather than stalling or inventing the missing module's
  architecture (`CLAUDE.md` §7).
- Foundation Agent's first run (2026-09-13) deferred several P0 items; a
  2026-09-14 run picked all of them up (SSO connection foundation, MFA, role
  management UI, baseline security headers/rate limiting) plus the three new
  P0 stories the requirements refresh added (job security, session security,
  input/output safety). SSO and MFA remain `Partial` — the deterministic code
  paths are built and verified, but a real end-to-end IdP handshake and a
  real authenticator-app enrollment need a non-sandboxed environment to
  finish verifying; see `docs/design/foundation-agent-backlog-audit.md`.
  None of this blocks Wave 2+.

---

## 2026-09-16 — Standing "network egress" caveat is obsolete

Every audit log in this repo carries some version of the note that this build
sandbox could not reach `*.supabase.co` (or any non-Supabase host), which is
why module isolation proofs were run through the Supabase MCP with a simulated
JWT and why no authenticated screen was ever verified in a real browser. That
restriction no longer applies to HTTPS: the dev project's PostgREST, GoTrue
and Storage endpoints all answer from the sandbox, from `curl` and from Node's
`fetch`, and general egress is open too.

What is still genuinely blocked, and should not be re-attempted blindly:

- **Raw Postgres** (`db.<ref>.supabase.co:5432`, every pooler endpoint on
  5432/6543) — only 443 escapes, so `psql` and `supabase db push` remain
  unusable; migrations still go through the Supabase MCP.
- **A full Playwright E2E run** — blocked on credentials, not connectivity:
  the Vercel project's Supabase environment variables are Production-scoped
  (previews 500), and all five GitHub Actions secrets resolve empty. See
  `docs/design/qa-agent-backlog-audit.md`.

A session picking up a story that was deferred "because of egress" should
re-test the specific operation rather than trusting the old note.

## 2026-10-01 — Payments, privacy, financial compliance and IT security

On the user's explicit request (outside the auto-chain order), four
capabilities were implemented across three modules, with migrations `0101`–`0105`
applied to the live project:

- **Platform:** `PLATFORM-P1-04` Stripe + Razorpay billing (brought forward from P1).
- **Compliance:** `COMPLIANCE-P0-12` GDPR/DPDP privacy programme;
  `COMPLIANCE-P0-13` SOX, PCI DSS and other financial/privacy control frameworks.
- **Foundation:** `FOUNDATION-P0-28` permission-gated RLS, `P0-29`
  tamper-evident audit trail, `P0-30` IT security hardening.

The binding rules are in `CLAUDE.md` §18. The operator reference is
`docs/security/SECURITY-CONTROLS.md`.

Open items:
- Run the full Playwright suite (the proxy, headers and RLS changed; §17.8).
- Run Stripe and Razorpay in test mode once keys are configured.
- The owner enables Supabase leaked-password protection and sets the real
  `security.txt` contact.
- Do the §32 design review of the new signed-in screens.

## 2026-10-11 — WonderID foundation design (IGA and Agent ID)

On the owner's request, an original design baseline was written:
`docs/WonderID/reference/WONDERID-FOUNDATION-DESIGN.md`. It was built from three sources:
- public standards: SCIM 2.0, NIST SP 800-53 AC/IA/AU, SOX ITGC, RFC 8693,
  DPoP, SPIFFE, AuthZEN, SSF/CAEP and the IETF WIMSE AIMS draft;
- Saviynt's public product pages and training guides, used for capabilities
  only;
- seven Saviynt documents the owner supplied.

The document does these things:
- takes stock of what is built;
- designs the IGA and Agent ID gaps;
- lists the changes needed per module;
- divides the work into phases (first F1–F7; revised the same day to F1–F10,
  next entry);
- lists owner decisions (D1–D9; D10 added the same day).

Documentation only: no code, migration or backlog row changed. New stories are
added to module backlogs only after the owner approves D1. The Saviynt
customer documentation site needs a sign-in and was not used. (First proposed
in #40, carried into #65.)

## 2026-10-11 — IGA delivery order: import, reconciliation and requests first

**Owner direction.** WonderID is IGA for human and non-human identities. Reconciliation, account import and access requests work first.

**Plan of record:** §10 of `docs/WonderID/reference/WONDERID-FOUNDATION-DESIGN.md` (phases F1–F10, revised today).

**Tracked on GitHub:**
- Milestones F1–F10.
- F1 is issue #41 (stories #42–#48), F2 is issue #49 (stories #50–#56).
- F3–F10 are tracking issues #57–#64.
- New stories enter their module backlogs, with Progress Tracker rows, when the owner approves decision D1.
- Until then, §10 is the plan of record.

**Next up, in order:**

| Phase | Stories | Exit test |
|---|---|---|
| **F1 Import and reconciliation** | INTEGRATION-P0-18 (staging reflects the source)<br>INTEGRATION-P0-19 (scheduled import and promotion)<br>ACCESS-P0-27 (entitlement and grant reconciliation)<br>ACCESS-P0-25 (classification, rogue findings)<br>IDENTITY-P0-20 (non-human identities from accounts)<br>EXPERIENCE-P0-28 (reconciliation console)<br>QA-P0-23 | A connected application shows accounts, entitlements and grants for a person, a service account and an agent. A removal at the source is detected. An entitlement added outside WonderID is flagged as rogue. |
| **F2 Access requests end to end** | ACCESS-P0-28 (approval creates pending grants)<br>ACCESS-P0-29 (fulfilment tasks)<br>ACCESS-P0-30 (remove and account requests)<br>ACCESS-P0-31 (non-human subjects, agents within contract)<br>ACCESS-P0-32 (time-bound)<br>EXPERIENCE-P0-29 (request tracking, tasks inbox)<br>QA-P0-24 | Request → approval → task → access added on the target → the next reconciliation marks it verified, for a person, a service account and an agent. Removal and expiry end as revoked. |
| **F3 Provisioning** | Needs decision D3. INTEGRATION-P0-11/13 writes; SCIM; Entra ID, HR and ServiceNow connectors; relay; RISK-P0-13 | Connector writes replace manual tasks. |

**Later:** F4 lifecycle and certification; F5 roles, SoD and delegation; F6 Agent ID credentials (can run in parallel after F1); F7 workflow, forms and configuration; F8 advanced governance; F9 intelligence; F10 release gate.

**Why this order.**
- Requests can only be checked against real target data, and certification, SoD and lifecycle all need trustworthy imported access.
- Provisioning comes third, so manual fulfilment is already verified by reconciliation before connectors start writing.

**What the code does today** (code check, recorded in §10):
- Connector syncs stage data daily, but only CSV promotes entitlements and grants.
- Moving accounts from staging is a manual step.
- Staging is never pruned, so removals at the source go undetected.
- Approval creates no grant or task.
- AI agents are refused in the catalog.

**Open decisions for these phases:**
- D3 (connector writes) gates F3.
- D10 (how often imports run) affects F1, because the free Vercel plan allows cron at most once a day.

**Supporting documents:**
- `docs/WonderID/reference/WONDERID-FOUNDATION-DESIGN.md`: the owner-supplied design; draft baseline pending D1.
- `docs/WonderID/reference/saviynt-reference-study.md`: a read-only reading of the owner's Saviynt v25 training tenant.
  - It maps what was observed to the design's phases and proposes 15 additions (D-1 to D-15).
  - It corrects one claim: duplicate detection over existing identities exists for agents only.

## 2026-10-11 — Integrator configurability review

The owner asked whether the design gives a system integrator enough to
onboard users and applications, write connectors, set up technical, update
and event-driven rules, and manage AI agents, by configuration.

**Found in the code:**
- Custom connectors are already configuration: JSON definitions written and
  tried in the console, versioned per organization (0108).
- Identity sources, application onboarding, request policies, packages,
  custom roles and custom identity attributes are configurable in the console
  and the API.
- Not configurable yet: birthright, attribute and event-driven rules;
  provisioning; agent discovery rules and contract templates; mapping onto
  custom attributes; schedules on non-file connections.
- `/api/v1/*` accepts only a browser session, so nothing can be scripted.
- The SSO handshake waits on a Supabase SSO provider the owner has not
  configured (FOUNDATION-P0-03.3).

**Design changes** (`docs/WonderID/reference/WONDERID-FOUNDATION-DESIGN.md`):
- §5.2.1 one rule model (trigger, scope, condition, effects, mode, priority,
  version) with its catalogues; attribute rules.
- §5.4 entitlement types per application and classification rules.
- §5.8.2 what an integrator builds without code, and the planned extensions.
- §5.10 event subscriptions, outbound webhooks and notification channels.
- §6.1 discovery rules, agent classes, contract templates, tool overrides.
- §8.1 the table of what is configurable today and what each phase adds;
  §8.2 automation credentials; §8.3 integrator role, sandbox and guide.
- Decisions D11 (automation credentials) and D12 (shared rule runtime).
- Eleven stories: FOUNDATION-P0-31/32, INTEGRATION-P0-20/21,
  IDENTITY-P0-21/22, ACCESS-P0-33/34, EXPERIENCE-P0-30, OPERATIONS-P0-11,
  QA-P0-25, placed in F1–F7. F1 and F2 exit tests are unchanged.
- GitHub issues #66–#76, attached to their phase issues (F1 #41, F2 #49,
  F3 #57, F4 #58, F6 #60, F7 #61).

`docs/WonderID/reference/INTEGRATOR-GUIDE.md` is new: what an integrator can
configure today, with paths and permissions.

## 2026-10-11 — Fresh IGA plan set in `docs/WonderID/`

On the owner's request, a fresh, self-contained set of documents for the IGA
and Agent ID work now lives in its own folders, separate from the historical
documents:
- `docs/WonderID/design/DESIGN.md`: the consolidated current design.
- `docs/WonderID/run-order/RUN-ORDER.md`: phases F1–F10 with every story, ID,
  module, issue and exit test. The plan of record for this work.
- `docs/WonderID/progress/PROGRESS.md`: live status per story and decision,
  updated in the same PR as the work.

The older files stay as history and reference; this file keeps recording
programme-level events as before.

## 2026-10-11 — Plan documents moved to `docs/WonderID/`

On the owner's request, every document from the IGA plan work now lives under
`docs/WonderID/`: `design/`, `run-order/` and `progress/` (moved from
`docs/iga/`), and `reference/` holding the foundation design, the Saviynt
study and the integrator guide (moved from `docs/design/` and
`docs/integrations/`). Paths in earlier entries of this file were updated to
the new locations. `docs/WonderID/README.md` is the index.

## 2026-10-11 — D1 approved; F1 started

The owner approved decision D1 (the IGA baseline). The phase F1 and F2
stories now have Progress Tracker rows in their module backlogs (Foundation,
Identity, Integration, Access, Experience, QA), with `docs/PROGRESS.md`
regenerated. F1 started with INTEGRATION-P0-18 (staging reflects the source,
migration 0117), now Done; INTEGRATION-P0-19 is next. Live status:
`docs/WonderID/progress/PROGRESS.md`.

## 2026-10-11 — INTEGRATION-P0-19: imports carry on by themselves

After every full sync, the identity sources reading the connection now
promote its identities, then every application onboarded on it reconciles
its accounts, with each step's counts recorded on the sync job (migration
0118). Identity-source schedules run through the connection cron. ACCESS-P0-27
(entitlements and grants) is next in F1.

## 2026-10-11 — ACCESS-P0-27: entitlements and access from connectors

Connector-imported entitlements and grants now reach `entitlements` and
`access_grants` for onboarded applications (migration 0119), by preview and
apply on the application page or after every full sync. A grant gone from
the source is marked, never revoked, and returns if it reappears, with
ledger events either way. ACCESS-P0-25 (classification and drift findings)
is next in F1.

## 2026-10-11 — ACCESS-P0-25: legacy, authorized, unproven, rogue

Each application now has a baseline from its first reconciliation (migration
0120). Imported access present then is legacy; later access with no WonderID
approval is rogue and gets one Risk finding, resolved when an approval
appears or the access goes. The classification is shown in the ledger and
on the account page. CLAUDE.md §3 also gained the owner's simplicity rules.
IDENTITY-P0-20 is next in F1.

## 2026-10-11 — IDENTITY-P0-20: non-human identities from accounts

Account reconciliation now gives service, shared and machine accounts that
match no person their own governed identity, owned when the source names
the owner and otherwise listed in Onboarding › Unowned Identities. Agents'
accounts link by the identifiers the agent declares. Access cannot be
requested for an unowned non-human identity. EXPERIENCE-P0-28
(reconciliation console) is next in F1.

## 2026-10-11 — EXPERIENCE-P0-28: reconciliation console complete

The connection, application and account pages now together show and
control every step: imports, what went missing, held runs, the post-sync
chain, preview and apply of access, classification and last seen at source.
QA-P0-23 (reconciliation suite) is next in F1.

## 2026-10-11 — QA-P0-23: F1 reconciliation suite; F1 exit test passed

`tests/e2e/f1-reconciliation.spec.ts` drives the F1 chain through the app's
routes for a person, an owned and an unowned service account and an agent,
on connector records seeded into staging. It passed locally (7 tests, plus
sign-in setup). It found one defect, fixed in the same change: an
application whose entitlements come from the connector could never pass
onboarding validation, because its entitlements are only reconciled after
promotion. Every F1 gating story is done and the exit test passed on seeded
staging. INTEGRATION-P0-20 (does not gate) is next; FOUNDATION-P0-31 waits
for D11.

## 2026-10-11 — INTEGRATION-P0-20: custom attributes as targets; schedule on every connection

Identity source mappings can now fill the organization's custom identity
attributes, typed, checked for uniqueness and recorded with provenance, and
every connection that reads has a sync schedule on its page and in the API.
The only F1 story left is FOUNDATION-P0-31, which waits for decision D11. F2
(access requests end to end) is next, starting with ACCESS-P0-28.

## 2026-10-11 — Admin menu by the foundation design's §8; rogue access in Risk Overview

Admin is now seven groups: Identity Repository, Applications, Policies,
Integrations, Users & Permissions, Settings and Compliance (owner decision).
Risk Overview and its badge now include rogue-access findings.

## 2026-10-11 — ACCESS-P0-28: approved requests become pending grants (F2 starts)

An approved request (or package item) is now a grant waiting for
fulfilment. It sits on a placeholder account when the person has none yet,
and it is not counted as access. "Mark fulfilled" makes it unverified; the
next reconciliation that sees it at the source verifies it. ACCESS-P0-29
(fulfilment tasks) is next.

## 2026-10-11 — ACCESS-P0-29: fulfilment tasks

Each grant waiting for fulfilment now has a task for the application's
owner. The task can be claimed, completed (the access is then waiting for
verification) or reported failed with a reason. It is due after the
organization's SLA and reminds its owner daily once overdue, and
reconciliation closes it when the access is found at the source. The tasks
are under Home › Access Governance › Fulfilment Tasks. ACCESS-P0-30
(remove-access and account requests) is next.

## 2026-10-11 — ACCESS-P0-30: remove-access and account requests

A request can now remove access someone holds, ask for a new account, or
disable an account. Each is approved on its own route and becomes a
fulfilment task. It is confirmed by reconciliation: removed access is revoked
once the source no longer lists it; a new account once it appears; a
disabled account once the source shows it disabled. ACCESS-P0-31 (requests
for non-human identities) is next.

## 2026-10-11 — ACCESS-P0-31: requests for non-human identities

The owner of a service account or machine identity can now request access
for it, and an AI agent's business owner can request for the agent, but only
what its contract approves; anything else is refused by the server. These
requests are approved by the owners of the application or entitlement, and
follow the same pending grant and fulfilment task as a person's. ACCESS-P0-32
(time-bound access) is next.

## 2026-10-11 — ACCESS-P0-32: time-bound access

Access with an end date now ends on time. The requester and the person it is
for are reminded before the end (7 days by default, set in Global
Configuration) and can ask to extend it from the request; an extension is
approved like any request. At the end date each grant gets exactly one
removal task, and once the source confirms the removal the ledger shows the
access as expired. Expired or revoked package assignments create removal
tasks the same way. EXPERIENCE-P0-29 (request tracking, one inbox, subject
picker) is next.

## 2026-10-11 — EXPERIENCE-P0-29: request tracking and one inbox

Access Requests now shows where every request line really stands: waiting
for approval, then waiting for fulfilment, not yet verified, verified,
failed or ended. "Waiting for you" lists the fulfilment tasks waiting for
you along with the approvals. The request form lists the people you manage
and what you own under "For". QA-P0-24 (the request-to-verified suite) is
next.

## 2026-10-11 — QA-P0-24: request-to-verified suite; F2 exit test passes

The F2 loop is proven end to end on the seeded test organization. A person,
a service account they own and an AI agent within its contract are each
requested, approved (never by the requester), turned into tasks, added on
the target and verified by the next reconciliation. A removal and an expiry
end revoked. Another organization sees none of it, and a repeated
reconciliation changes nothing. FOUNDATION-P0-32 (bulk invitation) is F2's
last story and does not gate the phase. F3 needs D3, F4 needs D12 and F6
needs D2.

## 2026-10-11 — FOUNDATION-P0-32: bulk invitation; F2 done

Administrators can invite many people at once: Users → Actions → Import
CSV… previews which rows are new, already members or invalid, and invites
only the new ones (the same file again invites nobody). Scripts can use
POST /api/v1/users/invitations, with a dry run; the credential for
unattended scripts comes with FOUNDATION-P0-31, which waits for D11.
Invitations now expire (30 days by default, set in Global Configuration)
and can be sent again from the person's page. Roles given by invitation
never carry permissions the inviter lacks. With this, every F2 story is
done. F3 needs D3, F4 needs D12 and F6 needs D2; F5 (roles, SoD,
delegation) needs no decision.

## 2026-10-12 — Decisions D2, D3, D11 and D12 approved (owner)

The owner approved the recommendations for four open decisions:

- **D3 (connector writes, gates F3):** yes. Writes are per connection,
  declared, tenant-enabled and approval-gated. Disable/enable and remove
  access come first, then create and add.
- **D11 (automation credentials, FOUNDATION-P0-31):** yes, with the §8.2
  controls: hashed, expiring at most a year, role-scoped, four-eyes,
  audited, rate-limited, never for sign-in.
- **D12 (shared rule runtime, F4):** one runtime published by Operations;
  rule tables stay with their owners.
- **D2 (OAuth tokens to agents, F6):** yes, scoped to agents and the
  gateway and opt-in MCP audiences; people's sign-in stays with the
  customer's IdP.

The owner also rotated the Saviynt training password and disconnected the
paused Vercel project. Next: FOUNDATION-P0-31 (F1's last story), then F3.
D7 (relay) and D9 (first connectors) remain open for their F3 stories.

## 2026-10-12 — FOUNDATION-P0-31 done: F1 complete

Automation credentials for the administration API (migrations 0126–0127).
A pipeline or ITSM calls `/api/v1/*` with `Authorization: Bearer wa_ac_…`;
each credential belongs to an application identity, acts through its own
backing automation member (so RLS and the authorization engine apply
unchanged), needs a second administrator to approve it or extend it, expires
within a year, and is audited on every call. Global Configuration has an API
route, and the built-in Configuration Administrator role ships. All nine F1
stories are done. Next: F3 Provisioning (D3 approved).

## 2026-10-12 — F3 started: connectors remove access and disable accounts

INTEGRATION-P0-11 is done and INTEGRATION-P0-13 has its first slice
(migrations 0128–0129):
- Connector definitions may declare writes. A connection makes them only
  after an administrator turns writes on (Connection → Changes in the
  system).
- An approved removal or disable is then made by the connector, retried
  on transient errors, and verified by reading the system again.
- Failures go back to the task's owner with the reason.

Next in F3: grants and account creation (D3's second step), then RISK-P0-13
remediation through the connector for the exit test.


## 2026-10-12 — F3 exit scenario runs against a stub system (RISK-P0-13 core)

A rogue-access finding can now be remediated with "Remove access". This
raises a request under the application's policy. The connector removes the
access, reconciliation verifies it, and the finding resolves as verified
fixed. `connector-provisioning.spec.ts` runs that scenario end to end against
a stub system over HTTP (migration 0130). The real target systems wait on D9.

## 2026-10-12 — Connectors add access and create accounts (INTEGRATION-P0-13 done)

D3's second step. A connection with writes on now also adds approved access
and creates accounts (`grant_access`, `create_account` in a definition's
`write`). Access for someone with no account waits while the connector
creates the account; once the next read brings it in, the access is added
and verified. No migration. Next in F3: QA-P0-26 (provisioning safety
suite, including the mass-change guard), then INTEGRATION-P0-21 and P0-22;
the relay and named connectors wait on D7 and D9.

## 2026-10-12 — Provisioning safety suite (QA-P0-26)

Connector writes now have a mass-change guard: at most
`integration.maxWritesPerHour` changes per connection per hour (Global
Configuration → Connections, default 100). Past it, nothing is sent and the
task goes to its owner with the reason. The suite also proves read-only
connection types cannot write, and that no attempt reaches a system twice.
Next in F3: INTEGRATION-P0-21 (definition extensions), then INTEGRATION-P0-22
(SCIM; LDAP and http writes). The relay and named connectors wait on D7 and
D9.

## 2026-10-12 — Incremental syncs; ticket numbers for rogue access

- Connection types may declare a `changes` request. Scheduled syncs then
  read only what changed since the last good run, with a full read at least
  daily, and incremental runs mark nothing missing (INTEGRATION-P0-21
  slice 2).
- Owner request: every rogue-access finding is a ticket, RA-000001… per
  organization (migration 0131). The removal request quotes it, and it
  resolves with the finding once reconciliation confirms the account is
  fixed.
- The plain-language guide is now `docs/WonderID/KNOWLEDGE-BASE.md`, covering
  the whole product with a dated revision history.

## 2026-10-12 — One rogue-access ticket per account (owner decision)

Tickets are now per account (migration 0132), not per entitlement. An
account's rogue-access findings share one ticket, RA-000001… per
organization. It resolves when the last of them is fixed, and rogue access
found later opens a new ticket. The database opens and resolves tickets
itself.

## 2026-10-12 — Connections sign in with a private key or a client certificate

`oauth2_client_credentials` can sign its token request with the
organization's private key (`private_key_jwt`, or the `jwt_bearer` grant for
service accounts), and the new `client_certificate` auth presents a client
certificate (mutual TLS) to the connection's own address only
(INTEGRATION-P0-21 part 3a). Next: OAuth authorization code.

## 2026-10-12 — Connections sign in with the provider

`oauth2_authorization_code`: an administrator presses Connect on the
connection's page, approves on the provider's own sign-in page, and comes
back through the connection's receiver (non-negotiable #20). Tokens are kept
encrypted with the connection's credentials and refreshed during runs
(INTEGRATION-P0-21 part 3b). Next: export/import of definitions and
connection upgrade.

The owner confirmed that end-to-end tests are nightly; before a merge they
run only for security-related or major changes (CLAUDE.md §17.8).
After every merge, the high-risk findings register
(`docs/WonderID/HIGH-RISK-FINDINGS.md`) is read, and what the next pull
request can fix goes into it (CLAUDE.md §19.12, owner decision).

## 2026-10-12 — Sharing and upgrading connection types; first findings review

INTEGRATION-P0-21 is done: definitions download as files and open in the
editor, and a connection moves to another version of its type after a
preview of what changes. The first post-merge review of the high-risk
findings register (CLAUDE.md §19.12) checked all ten findings against the
code:
- fixed a credential leak on cross-origin redirects (WID-H05);
- sent single matches on former identities to review (WID-H01);
- pinned confirmed behaviour with tests;
- corrected the knowledge base where it promised more than the code.

The rest is recorded per module backlog. Owner decisions are open for
WID-C01, C02, C03, H02, H04 and H06. Next in F3: INTEGRATION-P0-22 (SCIM;
LDAP and http writes).

## 2026-10-12 — Four security decisions; findings tracked separately

The owner approved four safeguards, all shipped together:
- automation credentials never approve or certify;
- emergency controls block in every gateway mode;
- high-risk access always needs a person;
- nobody approves their own agent request.

The owner also decided that the high-risk findings register is read, never
edited. Remediation priorities and status live in
`docs/WonderID/FINDINGS-REMEDIATION.md`, which Claude keeps current and
works through without asking (CLAUDE.md §19.12).

## 2026-10-13 — Claude Code runs the hourly findings audit

Owner decision: the Claude Code hourly audit routine may now maintain the
high-risk findings register, alongside ChatGPT (CLAUDE.md §19.12, rule 2,
replacing the 2026-10-12 rule that Claude Code never edits it). The audit
commits only the register to `main`, and only when something changed. A
session that fixes findings records its work in
`docs/WonderID/FINDINGS-REMEDIATION.md`, never marks its own fix `FIXED` in
the register, and adds no guard against the register's maintainers.

First audit run, 09:06 IST, `main` @ `376473b`:
- 21 unit-test files, 338 tests passed;
- C02, C03, H01, H02, H03, H04, H07 and H08 moved to `FIXED` at
  committed-evidence level;
- C01 `ACCEPTED` on the owner's risk acceptance;
- H05 stays `CHANGED`; H06 stays `FIXED`;
- the full nightly suite has not been green since #119–#132.

## 2026-10-14 — Owner priority: onboarding, requests, approvals, provisioning

The owner asked that stories about application onboarding, access request
creation, approvals and provisioning of accounts and entitlements go first.
Until the owner says otherwise, the order is:

1. ACCESS-P0-33: entitlement types and classification rules (done, #176).
2. ACCESS-P0-34: application onboarding templates per connection type, with
   a questionnaire form.
3. ACCESS-P0-42 (new, owner request later the same day): internal fulfilment
   task assignment.
   - A person or group per application, optionally per entitlement type.
   - Group queues that any member can claim.
   - Reassignment with a reason, audited and notified.
   - A workload view.
4. ACCESS-P0-38: request baskets for many changes and identities,
   model-after, saved drafts and signed approval links.
5. ACCESS-P0-23: delegations of approval, request and administration.
6. QA-P0-22: the brownfield fixture, HR → request → provision → certify →
   revoke → verify.
7. ACCESS-P0-35: approved changes to request policies and the other
   governance objects.
8. QA-P0-07: connector contract tests.
9. EXPERIENCE-P0-30: the guided connector definition editor.

Owner decisions, 14 October (later):
- ACCESS-P0-35's four-eyes publish applies only to organizations with two or
  more administrators.
- Administration delegation (ACCESS-P0-23 part 3) is approved, although it
  changes Foundation's authorization engine.
- `docs/WonderID/ROADMAP-PROGRESS.md` item marks and the knowledge base
  (revision history at the end, newest first) are updated in the same pull
  request as the stories document.

INTEGRATION-P0-26 (ServiceNow ticketing for manual fulfilment) is Low by the
owner's decision of the same day; internal assignment comes first.

RISK-P0-13 (rogue access remediation through approval and provisioning)
stays Partial until the nightly E2E passes. Certification (COMPLIANCE-P0-10,
-11, -14) and the other High items follow this list.

## 2026-10-17 — Owner decisions on the open questions

Asked in chat, the owner decided:
1. **Identity rules that add to a group or assign a package** are built
   (IDENTITY-P0-21). Whether each grant needs approval or applies
   automatically is configurable.
2. **A failed read while resolving access** is said truthfully: "WonderID
   could not check your access just now" (503 `TEMPORARILY_UNAVAILABLE`),
   never 403 "forbidden" or a redirect to onboarding. It still fails closed:
   nothing is permitted.
3. **Identity merge (IDENTITY-P0-23):** write the migration and apply it.
4. **QA-P0-06's SAML/OIDC part is deferred** while Supabase has no SAML on
   this project's plan.
5. **Work order:**
   - close RISK-P0-13 (its E2E passed in the nightly of 17 Oct) and the
     "Full Playwright suite" gate (green on 17 Oct, all four parts);
   - then COMPLIANCE-P0-10's remainder, IDENTITY-P0-21 and IDENTITY-P0-23;
   - then the medium stories: ACCESS-P0-23, ACCESS-P0-35, PLATFORM-P0-13
     and FOUNDATION-P0-03.4.

Later the same day, asked about ACCESS-P0-35 and ACCESS-P0-23, the owner
decided:
6. **Custom role edits** do not wait for a second administrator.
7. **Governance policy edits**, SoD rules included, get the same output as
   request policies (a numbered version with what changed), without
   waiting for a second administrator.
8. **Delegation to and from AI agents** is enforced at the Runtime Gateway,
   not only recorded. Asked further:
   - the directions are person→agent and agent→agent;
   - a request on someone's behalf with no covering delegation requires
     approval;
   - a person→agent delegation takes effect once an owner of the agent
     approves it.
