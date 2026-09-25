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

**Still to do in this programme:**

- ACCESS-P0-12 (policy targets and publish) and ACCESS-P0-14 (wire SoD,
  D5).
- IDENTITY-P0-13/14 (contract and ownership completeness; D3, D4).
- EXPERIENCE-P0-16/17 (the remaining mockup screens; app-wide wording).
- QA-P0-17/18 (RLS read sweep; the gateway security suite).

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
