# WonderAgent — Standing Orchestration Policy

This is how development runs across the 11 module agents. It applies to every agent,
in every session, regardless of which module it owns. `CLAUDE.md` governs *what* can
be built; this document governs *how* work moves from a story to merged code.

## 1. One agent per module, isolated

Each module is developed by one agent, in its own git worktree, on its own branch.
Never interleave two modules' work in one agent's context — they must not share git
state, in-flight edits, or context.

Branch naming: `module/<module-slug>` (e.g. `module/foundation`, `module/identity`).
Each module's worktree checks out its own branch.

The **integration branch** is the shared trunk all module branches merge into. Unless
the user specifies otherwise for a given environment, treat the branch the session
was started on (or `main`, once the session's designated branch has been merged) as
the integration branch for that environment.

### Worktree hazard

A fresh git worktree with no installed dependencies can silently resolve
shared-package imports to a **different** checkout's stale build via normal module
resolution, producing misleading errors. Install dependencies fresh in every new
worktree before the first build/test run. If an error looks inconsistent with what's
actually on disk, verify which copy of a shared package is actually being resolved.

## 2. Merge mechanics

**Auto-merge after every single story — no need to ask first.** Commit, push the
feature branch, merge into the integration branch, continue to the next story
immediately.

If checking out the integration branch fails because another concurrent agent has it
locked in its own worktree, don't get stuck:

1. Fetch the integration branch fresh.
2. Create/reset a throwaway scratch branch tracking it.
3. Merge your feature branch into that scratch branch.
4. Push the scratch branch directly to the integration branch.
5. Delete the scratch branch.
6. Continue.

If that push is ever rejected as non-fast-forward, re-fetch and redo the whole
sequence.

**Never force-push. Never rewrite history on the integration branch or any feature
branch.**

**IMPORTANT: auto-merge does not mean auto-start another module.** After completing
its own story or backlog, an agent must never start or invoke another module's agent.
Only the user decides when another agent starts (see `CLAUDE.md` §7).

## 3. Full verification before every commit and merge

Before every commit and merge, run:

- Typecheck
- Lint
- Any import-boundary/architecture lint script
- Any migration-lint script
- The module's own test suite
- If a real dev database is available: apply migrations live to a **dev** Supabase
  project only (never a read-only reference project, never production), then
  re-check its security/performance advisories
- Build the app if UI/routes changed

A push that turns the pipeline red costs every other module's agent trust in the
integration branch. Do not merge until everything above is clean.

## 4. Shared database changes require ownership discipline

An agent may modify only tables owned by its module (see
`docs/design/ownership-map.md`). If a story requires a change to a table owned by
another module:

1. First determine whether the change can be implemented through an existing
   published contract (a view, function, API, or type that module already exposes).
2. If not, do **not** silently modify it. Record the required contract/schema change
   in the audit log and stop for user direction.

## 5. Shared contracts are versioned

If an agent publishes or changes a shared API/type/service contract:

- Document the change (what changed, why, in the audit log and in the contract's own
  comments/docstring).
- Preserve backward compatibility where possible (additive fields, new optional
  parameters) rather than breaking existing consumers.
- Identify which other modules are affected.

## 6. Budget awareness

Track your own usage as you work. Once you're at roughly 80% of your budget for the
session, stop picking up new stories — finish whichever one is in progress fully
(implement, verify, update the audit log, commit, push, merge), then stop yourself.

It's fine to stop earlier, at a natural story/epic boundary, if the next piece can't
be finished and verified cleanly in one sitting. That's preferred over starting
something that can't be finished.

## 7. Stop and report instead of guessing

If a story's correct behavior depends on a real architecture or security decision
that the backlog doc doesn't fully specify — not a layout choice, not "which existing
pattern to reuse," but something that would be wrong to invent unreviewed — write the
precise open question(s) into the module's audit log and end the turn instead of
merging a guess. The user will give a concrete decision and the agent resumes from
exactly that point.

This is a hard rule, not a suggestion: every time an agent has stopped and asked
instead of guessing on a real ambiguity, it has been the right call. Guessing on
anything touching authorization, secrets, tenant isolation, or billing is never
acceptable — those stories are explicitly flagged as "higher bar" in the owning
module's backlog, and hitting genuine ambiguity there always means stop, not guess.

## 8. Do not use a dependency as an excuse to block independent work

If a dependency on another module is genuinely required to complete a story, record
it and stop that specific story. If the required shared contract already exists,
consume it. If the dependency is merely optional or a nice-to-have, implement the
story without inventing additional functionality to work around the "missing" piece.

## 9. Reporting

Every agent, when started, reports:

- Agent name
- Module owned
- Current branch/worktree
- Current story
- Dependencies being consumed
- Tables/entities it owns
- Tables/entities it is consuming
- Verification status

Reply/report cadence during a run should be light: an update when a story completes,
when something is blocked, or when a stop-and-report condition is hit — not a
narration of every intermediate step.
