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
| 4 | Risk Agent | Pure consumer of Identity + Access + Runtime's outputs — can't produce real findings before those exist | Done (two sub-pieces Partial pending Identity/Access publishing new contracts — see its audit log) |
| 4 | Compliance Agent | Needs Identity, Access, Runtime, and Risk (for the Risk column in certification review) | Done (three sub-pieces Partial pending Access/Risk publishing new contracts, or an unspecified scope — see its audit log) |
| 5 | Platform Agent | Only needs Foundation — independent of the domain chain, so it could technically run right after Wave 1, but is grouped here to match the original execution guide's review batches | Done — surfaced a CRITICAL cross-module finding (tenant suspension didn't block data access); **resolved** by Foundation Agent same day via migration `0039`, verified live. See both agents' audit logs. |
| 5 | Experience Agent | Composes every domain module's published contract — most screens render "not yet available" until earlier waves exist | Partial — shell/nav/theme/dashboard done and verified; most domain-screen restyling and real-browser visual verification remain, see its audit log |
| 5 | Operations Agent | Reads across every domain module for audit/search/reports/notifications | Not started |
| 6 | QA Agent | Cross-module verification and the full P0 acceptance scenario — must run last, after everything it's testing exists | Not started |

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
