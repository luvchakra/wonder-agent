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
