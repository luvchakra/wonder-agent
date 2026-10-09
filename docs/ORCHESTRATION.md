# WonderAgent — Standing Orchestration Policy

This is how development runs across the 11 module agents. It applies to every agent,
in every session, regardless of which module it owns. `CLAUDE.md` governs *what* can
be built; this document governs *how* work moves from a story to merged code.

**Resolved (2026-09-14):** the user's updated master requirements package includes a
`00_MODULAR_EXECUTION_GUIDE.md` whose "Mandatory execution model" states a different
process — "Only the agent explicitly activated by the user may start work. Agents
must never launch another agent automatically" — than the auto-chain policy in §2
below. The user has explicitly confirmed: operate as before, no change to this
policy. The auto-chain/autopilot model in §2 remains the standing policy in full;
the execution guide's alternate process model is not adopted.

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

**Since 2026-10-09 (explicit user decision, `CLAUDE.md` §19): every change ships
through a pull request.**
- One branch per task, created from the latest `main`.
- Commit, push the branch, open a pull request, and share its Vercel preview URL.
- Squash-merge as soon as CI (`security.yml`, `e2e.yml`) is green. No need to ask
  first.
- Then confirm the production deploy is ready, and move to the next story.
- **Never push directly to `main`.** This replaces the earlier auto-merge and
  "also fast-forward `main` after every push" instructions.

**Never force-push. Never rewrite history on `main` or on someone else's branch.**
On a branch only you push to, follow the merge-or-rebase rule of `CLAUDE.md` §4.

**Auto-chaining across modules is now the standing policy (see `CLAUDE.md` §7):**
once an agent finishes every story in its own backlog, it starts the next dormant
agent per `docs/RUN_ORDER.md`'s order automatically — no need to ask the user
first. This replaced the original "user must manually dispatch every agent" rule.
What still holds: only one agent's work is ever in flight at a time (auto-chaining
starts the next agent only after the current one has fully finished, verified, and
reported — never concurrently), and an agent never invokes another module's agent
mid-story to help with its own work.

## 3. Verification before every push and merge

Before every push, run the fast, relevant checks (`CLAUDE.md` §19.6):

- `npm run typecheck`
- eslint on the files you changed
- the unit tests for the areas you touched (`npx vitest run <paths>`)
- for a migration: apply it to a **dev** Supabase project only (never a read-only
  reference project, never production), then re-check its security and
  performance advisories

CI runs the full suite on the pull request, including the whole Playwright suite.
Do not merge until CI is green. Run end-to-end tests locally only when asked or
when the change is genuinely risky.

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
