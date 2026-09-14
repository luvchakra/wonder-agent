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
| 1 | Foundation Agent | Everything depends on tenant/RBAC/RLS/audit | Done (P0 core; a few items deferred — see its audit log) |
| 2 | Identity Agent | Only needs Foundation; defines the canonical agent + Agent Contract (SHOULD) every later module reads | Done |
| 2 | Integration Agent | Only needs Foundation; can build its connector framework against manual data without waiting on Identity | Done |
| 3 | Access Agent | Needs Identity's contract + (ideally) Integration's normalized access data to compute CAN | Not started |
| 3 | Runtime Agent | Needs Identity's contract + Access's CAN to run the SHOULD/CAN/DID comparison | Not started |
| 4 | Risk Agent | Pure consumer of Identity + Access + Runtime's outputs — can't produce real findings before those exist | Not started |
| 4 | Compliance Agent | Needs Identity, Access, Runtime, and Risk (for the Risk column in certification review) | Not started |
| 5 | Platform Agent | Only needs Foundation — independent of the domain chain, so it could technically run right after Wave 1, but is grouped here to match the original execution guide's review batches | Not started |
| 5 | Experience Agent | Composes every domain module's published contract — most screens render "not yet available" until earlier waves exist | Not started |
| 5 | Operations Agent | Reads across every domain module for audit/search/reports/notifications | Not started |
| 6 | QA Agent | Cross-module verification and the full P0 acceptance scenario — must run last, after everything it's testing exists | Not started |

Update the Status column in the same commit that starts or finishes an agent's run,
so this table stays a live, accurate picture of where the build stands.

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
