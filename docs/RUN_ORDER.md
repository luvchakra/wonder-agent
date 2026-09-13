# WonderAgent — Agent Run Order

This is the recommended dispatch order for the 11 module agents defined in
[`CLAUDE.md`](../CLAUDE.md) §2 and §7. It follows the dependency chains stated in
each module's own backlog (`docs/plan/*-BACKLOG.md`) and the ownership map
(`docs/design/ownership-map.md`) — not an arbitrary sequence.

Dispatch is by name, per `CLAUDE.md` §7: type the exact phrase below in this
session. There is no shell command involved — the harness starts the named agent,
which then reads `CLAUDE.md`, its own backlog, and the tail of its own audit log
before doing anything, exactly as it would on a fresh session.

**Never start more than the current wave's agents at once**, and never start an
agent whose wave hasn't been reached yet — per `CLAUDE.md` §7, an agent must never
auto-start another agent, and the user controls when each one begins.

## Run order

| Wave | Agent | Why this position | Command to type |
|---|---|---|---|
| 1 (done) | Foundation Agent | Everything depends on tenant/RBAC/RLS/audit — already active | *(already running — no need to re-issue; say `Run Foundation Agent` again later to pick up its deferred P0 items)* |
| 2 | Identity Agent | Only needs Foundation; defines the canonical agent + Agent Contract (SHOULD) every later module reads | `Run Identity Agent` |
| 2 | Integration Agent | Only needs Foundation; can build its connector framework against manual data without waiting on Identity | `Run Integration Agent` |
| 3 | Access Agent | Needs Identity's contract + (ideally) Integration's normalized access data to compute CAN | `Run Access Agent` |
| 3 | Runtime Agent | Needs Identity's contract + Access's CAN to run the SHOULD/CAN/DID comparison | `Run Runtime Agent` |
| 4 | Risk Agent | Pure consumer of Identity + Access + Runtime's outputs — can't produce real findings before those exist | `Run Risk Agent` |
| 4 | Compliance Agent | Needs Identity, Access, Runtime, and Risk (for the Risk column in certification review) | `Run Compliance Agent` |
| 5 | Platform Agent | Only needs Foundation — independent of the domain chain, so it could technically run right after Wave 1, but is grouped here to match the original execution guide's review batches | `Run Platform Agent` |
| 5 | Experience Agent | Composes every domain module's published contract — most screens render "not yet available" until earlier waves exist | `Run Experience Agent` |
| 5 | Operations Agent | Reads across every domain module for audit/search/reports/notifications | `Run Operations Agent` |
| 6 | QA Agent | Cross-module verification and the full P0 acceptance scenario — must run last, after everything it's testing exists | `Run QA Agent` |

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
- Foundation Agent's first run deferred some P0 items (SSO handshake, MFA
  enrollment UI, role-management UI, baseline security headers/rate limiting) —
  see `docs/design/foundation-agent-backlog-audit.md`. None of them block Wave 2+;
  pick them up later with `Run Foundation Agent`.
