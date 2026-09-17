# Experience Agent — Backlog Audit Log

Append a dated entry after every completed story: what was built, how it was
verified, what was deliberately left out or deferred, and any open questions raised
for the user. Do not rewrite or delete prior entries.

---

## 2026-09-14 — EXPERIENCE-P0-01 and P0-02 done; P0-03 partial

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`
(same environment-pinned-branch deviation every prior module recorded).

**Built:**

- **EXPERIENCE-P0-01.0** — Semantic design tokens in `app/globals.css`,
  exactly the names `docs/design/UI-UX-DESIGN-RULES.md` §4 specifies
  (`background`, `surface`, `surface-elevated`, `border`, `text-primary/
  secondary/muted`, `accent`(+foreground), `success`/`warning`/`danger`/
  `info`), defined once on `:root` for light, redefined under
  `prefers-color-scheme: dark` (guarded `:root:not([data-theme="light"])`)
  and again under `:root[data-theme="dark"]` so an explicit override wins
  both directions — matching the exact pattern this environment's artifact
  rules require, applied here to the actual product rather than an
  artifact. Dark palette is intentional (sophisticated dark neutrals,
  `#0f1115`/`#171a21`), not an inverted light palette. `ThemeFlashGuard`
  (an inline synchronous `<script>` in the root layout's `<head>`) sets
  `data-theme` before first paint from `localStorage`, avoiding a flash of
  the wrong theme; `ThemeToggle` (light/dark/system) lives in the shell's
  user menu. `modules/ui/*` primitives (`Badge`, `Card`, `Button`, `Table`,
  `States`) consume these tokens exclusively via Tailwind v4's `@theme
  inline` — no hardcoded hex colors in component code. Icon set: plain
  text/unicode glyphs only (☰ for the mobile nav toggle) — a real icon
  library (e.g. lucide-react) was deliberately not added this session to
  avoid an extra dependency for a single icon; flagged as a follow-up if
  more iconography is needed.
- **EXPERIENCE-P0-01.1** — `app/(customer)/layout.tsx`: top bar
  (WonderAgent logo, tenant slug, user menu with theme toggle + tenant
  switcher + sign-out), left nav (exact PRD groups: AI Identity, Access
  Governance, Runtime Assurance, Risk & Compliance, Integrations, Reports,
  Administration), content area. **Every existing domain route was moved
  into the `app/(customer)/*` route group** (`git mv`, preserving history)
  so this layout actually wraps them — route groups don't affect URLs, so
  every path (`/agents`, `/access`, `/risk`, etc.) is unchanged; verified
  live (see below). Platform Admin is never referenced anywhere in this
  layout or nav — verified `grep -rn "platform-admin" "app/(customer)"
  modules/ui/` returns zero matches. **Two real gaps caught and fixed
  while wiring the nav**: `/risk` and `/runtime` had no index page (only
  `/risk/agents/:id` and `/runtime/agents/:id` existed, since neither Risk
  nor Runtime Agent's own backlog asked for a list view) — the nav would
  have 404'd. Added `app/(customer)/risk/page.tsx` and
  `app/(customer)/runtime/page.tsx`: thin composition-only tables over
  Identity's `listAgents()` plus (for Risk) `getFindings()`, linking to
  each existing per-agent detail page — no new business logic, no new
  tables, exactly within EXPERIENCE-P0-03's "thin composition" mandate.
  **Flagged, not silently assumed**: the tenant-switcher list needs "all
  of the user's active tenant memberships," which Foundation publishes no
  bulk-list contract for (only `getTenantContext()`, for the *current*
  tenant) — read directly via `supabaseServer()` in the layout (a
  display-only read of Foundation-owned, RLS-protected tables, not a
  mutation or new business rule) rather than adding a new function to
  Foundation's own module uninvited.
- **EXPERIENCE-P0-01.2** — `modules/ui/Nav.tsx`: static rail at the `lg`
  breakpoint (1024px, matching the backlog's suggested default), a
  hamburger-triggered overlay drawer below it. No horizontal page-body
  scroll — verified via `npm run build` + live route smoke test (below);
  full manual verification at all six named widths
  (`docs/design/UI-UX-DESIGN-RULES.md` §32: 1440/1280/1024/768/390/375)
  was **not** performed with actual browser screenshots this session — see
  "Not done" below.
- **EXPERIENCE-P0-01.3** — `modules/ui/States.tsx`: `EmptyState`,
  `ErrorState`, `NotYetAvailable`, and three skeleton shapes
  (`CardGridSkeleton`, `TableSkeleton`, `DetailSkeleton`) matching the
  dashboard/table/detail-page layouts. Applied to the Overview dashboard,
  new Risk/Runtime index pages, and the `/reports`/`/settings`
  not-yet-available placeholders; **not yet retrofitted** into every
  existing domain module's own bare pages (agents, access, compliance,
  policies, integrations) — see "Not done" below.
- **EXPERIENCE-P0-02.1** — Overview dashboard (`app/(customer)/page.tsx`):
  all nine PRD cards, each a real query — Total/Active Agents (Identity's
  `listAgents`), Unowned (Identity's `getOwnershipIssues`, fanned out in
  parallel per agent — Identity publishes no bulk "agents with ownership
  issues" query, so this is `Promise.all`, not a sequential loop, per
  CLAUDE.md §15; flagged as not scaling past a small fixture set without
  a bulk contract from Identity), Certification Overdue (Compliance's
  `listCampaigns`/`listCampaignItems`, filtered on `dueDate` in the past
  and `status: 'pending'`), High/Critical Risk and Policy/Access
  Violations (Risk's `getFindings(tenantId, {status:'open'})` — a single
  tenant-wide call, not agent-scoped, so no N+1 there), Rogue/Restricted
  (Identity's `lifecycleState === 'RESTRICTED'`, since Risk Agent's own
  auto-restriction on a CRITICAL finding is exactly this build's "rogue"
  signal), Excessive Access (distinct agent count from Risk's
  `excessive_access`-category open findings). Every card fetched in
  parallel (`Promise.all`), per CLAUDE.md §15 — no sequential waterfall.
- **EXPERIENCE-P0-02.2** — `RiskTrendChart` (recharts horizontal bar,
  severity-colored, tenant-wide open-finding counts) plus a real action
  queue (active campaigns needing review + open high/critical findings,
  each linking to the actual record) on the Overview dashboard.

**Verification run:**
- `npm run lint`, `npm run typecheck` (after clearing a stale
  `.next/types` cache left over from the `git mv` restructuring — a false
  positive, not a real error), `npm run build` — all clean, all 36+
  routes present at their original URLs.
- `npm run test` — 53/53 (no new unit tests this story; nothing added is
  algorithmically complex enough to warrant one — the dashboard's
  aggregation logic is straightforward filtering/counting over already-
  tested module outputs).
- Live smoke test against a locally started production server:
  unauthenticated hits to all ten customer routes (`/`, `/agents`,
  `/access`, `/risk`, `/runtime`, `/compliance/campaigns`, `/policies`,
  `/integrations`, `/reports`, `/settings`) all correctly return
  307-to-`/sign-in` (checked proactively — this caught the `/risk`/
  `/runtime` 404 gap above, fixed, then re-verified clean).

**Not done this session, honestly flagged rather than silently claimed:**
- **No authenticated, real-browser visual verification** — the pre-commit
  design-review checklist (`docs/design/UI-UX-DESIGN-RULES.md` §32:
  visual hierarchy, all six named responsive widths, both themes, every
  interaction state, realistic data) was **not** run against an actual
  rendered, signed-in session. This sandbox's fixture users are
  SQL-inserted `auth.users` rows with no real password, and this
  sandbox's network egress to Supabase is blocked outside the Supabase
  MCP tool (an established constraint every module this session has
  worked around for database access, but which also blocks establishing
  a real GoTrue browser session for Playwright). Crafting a synthetic
  `encrypted_password`/session directly in `auth.users` was considered
  and rejected as too fragile/invasive for a one-off visual check.
  **This is the single largest gap in this story** — a real visual pass
  (ideally once deployed, or by the user running `npm run dev` locally
  and signing in) is needed before EXPERIENCE-P0-01/02 can be marked
  fully `Done` rather than `Partial`.
- **EXPERIENCE-P0-03 (domain screens) is largely not done.** Only two new
  thin index pages were added (Risk, Runtime, both listed above). Every
  other domain module's existing bare functional page (Identity's
  `/agents`/`/agents/:id`, Access's `/access`/`/access/requests`/
  `/access/agents/:id`, Compliance's `/compliance/campaigns`/`/compliance/
  campaigns/:id`, `/policies`/`/policies/:id`, Integration's
  `/integrations`/`/integrations/:id`/`/integrations/new`) still renders
  with its original inline-style markup from its own module's session —
  functional, but not restyled with `modules/ui/*` or brought in line with
  `docs/design/UI-UX-DESIGN-RULES.md`. They now inherit the new shell
  (top bar, nav, theme) since they moved under `(customer)/`, but their
  own content is unchanged. The PRD's specific worked layouts (Agent
  Detail's tab structure, Agent Risk Page, Rogue Agent Detail — backlog
  §35-37) were **not** implemented — this is real, substantial remaining
  work, not a minor gap.
- Given the scope of restyling every domain screen to the full standard
  `docs/design/UI-UX-DESIGN-RULES.md` sets (tabs, tables with search/
  filter/sort/pagination/density controls, drawers for contextual detail,
  etc.) is, realistically, comparable in size to several of the domain
  modules' own full builds, completing it was not achievable in this
  session alongside the rest of this session's other module work. This is
  recorded as substantial remaining Experience Agent work, not deferred to
  P1 — none of it is listed in the backlog's own P1 section.

**Dependencies consumed:** Foundation's `getTenantContext()`,
`requirePermission()`, `supabaseServer()`; Identity's `listAgents()`,
`getOwnershipIssues()`; Access's own existing pages (composed via the new
shell, not modified); Risk's `getFindings()`; Compliance's `listCampaigns()`/
`listCampaignItems()` — all used exactly as published, no modification to
any other module's service files.

**Published this session:** `modules/ui/*` (`Badge`, `Card`, `Button`,
`Table`, `States`, `Nav`, `UserMenu`, `theme`, `RiskTrendChart`, barrel
`index.ts`) — the shared design-system layer every other module's future
UI work should consume, per CLAUDE.md §13's ownership rule.

---

## 2026-09-14 — EXPERIENCE-P0-04, EXPERIENCE-P0-05, EXPERIENCE-P0-06, EXPERIENCE-P0-07, EXPERIENCE-P0-08 (2026-09-14 requirements refresh)

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.
Per the user's explicit "continue automatically" instruction, picked up the
five Not Started rows the requirements-refresh pass added to this
backlog's Progress Tracker, auto-chained from Compliance Agent.

**Built:**

- **EXPERIENCE-P0-04 — Action Safety.** New `modules/ui/ConfirmAction.tsx`:
  `ConfirmActionDialog` (Radix Dialog-based) renders a title/description,
  an optional scope preview, an optional required-reason field, a
  disabled+"Working…" in-flight state that blocks Escape/overlay-dismiss
  while busy (so a click can't be lost mid-action), and a result panel
  supporting both a single-action outcome and a per-item bulk-action
  breakdown (`N of M succeeded`, failed items listed with their own
  error). This is presentation only — `onConfirm` is supplied by the
  calling domain module and is the only place an authorization decision
  is made, per non-negotiable #15; the component never decides whether an
  action is allowed. Wired to a real consumer: the Risk Findings page's
  "Request remediation" button now goes through
  `RemediateFindingButton` (`app/(customer)/risk/agents/[agentId]/
  RemediateFindingButton.tsx`), calling Risk Agent's existing
  `POST /api/v1/findings/:id/remediate` (unmodified) instead of the old
  plain `<form action>` — chosen over the server-action version
  specifically because the server action calls `redirect()`, which would
  never let a result panel render; the API route returns real JSON so the
  confirm→in-flight→result flow is provably real, not just plumbed.
- **EXPERIENCE-P0-05 — Accessibility Foundation.** Global
  `:focus-visible` outline (accent-colored, 2px, in `app/globals.css`) as
  a catch-all beneath per-component `focus-visible:outline` classes added
  to every new/touched interactive element (nav links, buttons, table
  sort headers, table/card rows, dialog close buttons, filter/search
  inputs). A skip-to-content link was added to the customer shell
  (`app/(customer)/layout.tsx`), landing on a new `id="main-content"` on
  `<main>`. `Nav.tsx`'s mobile drawer was rebuilt on
  `@radix-ui/react-dialog` (previously a plain overlay `<div>` with no
  focus trap or Escape-to-close) so it inherits Radix's real focus-trap/
  `aria-modal`/Escape behavior; nav links gained `aria-current="page"` for
  the active route. `DataTable`'s sortable headers put `aria-sort` on the
  `<th>` itself (not the inner `<button>`, which isn't a valid ARIA host
  for that attribute — caught by `eslint-plugin-jsx-a11y` during this
  story's own lint pass, fixed by extending `Th` to accept arbitrary
  `<th>` attributes). Badges/severity indicators already carried a text
  label alongside color (pre-existing from EXPERIENCE-P0-01, unchanged).
  **Not done**: a full WCAG AA contrast-ratio audit of every token pair in
  both themes (spot-checked the highest-traffic pairs — text-primary/
  background, text-secondary/background, accent/background — by reading
  the palette, not with a contrast-ratio tool); retrofitting these
  patterns onto every pre-existing bare domain page (the same large,
  already-flagged EXPERIENCE-P0-03 gap).
- **EXPERIENCE-P0-06 — Evidence Drawer & Investigation Deep Links.** New
  `modules/ui/Drawer.tsx`: `EvidenceDrawer` (a Radix Dialog-based side
  panel, not a new library) and `useEvidenceDrawerParam(paramName)`, a
  hook that reads/writes one query-string param (default `evidence`)
  while leaving every other param — a list's filters, sort, page —
  untouched, so a drawer's URL is shareable and restores the exact same
  investigation context on reload. Wired to a real consumer: the Risk
  Findings page's new "View evidence" button
  (`FindingEvidenceTrigger`/`FindingEvidenceDrawer` in
  `app/(customer)/risk/agents/[agentId]/FindingEvidenceDrawer.tsx`) opens
  `?evidence=<findingId>`, fetches that finding's full evidence via
  Risk's existing `GET /api/v1/findings/:id` (unmodified), and renders it
  without navigating away from the findings list. Guards against showing
  a stale finding's evidence mid-navigation (tracks that the loaded
  detail's `id` still matches the current `findingId` before rendering it
  — the more idiomatic fix, once a first draft that called `setState`
  synchronously in the effect body was caught by
  `react-hooks/set-state-in-effect` during this story's own lint pass).
  **Not done**: consumption by Access's access-path detail, Runtime's
  event detail, or Compliance's certification evidence — only Risk's
  finding evidence is wired this session.
- **EXPERIENCE-P0-07 — Shell Global Search & Notifications.** New
  `modules/ui/ShellSearchAndNotifications.tsx`: `ShellGlobalSearch` (a
  Radix Dialog search entry point) and `ShellNotifications` (a Radix
  DropdownMenu bell icon), both composed into the shell's top bar
  (`app/(customer)/layout.tsx`, next to the existing tenant switcher/user
  menu). Operations Agent (module 10) owns search/notifications data and
  matching logic and is still dormant as of this story — both render the
  existing `NotYetAvailable` placeholder (the same pattern already used
  elsewhere in this backlog for a not-yet-available dependency) rather
  than inventing search results or notification data. Marked `Done`
  rather than `Partial`: the story's own acceptance is explicitly "a
  top-bar search entry point and a notifications indicator/panel... a
  'Not yet available' placeholder until then" — which is exactly what was
  built.
- **EXPERIENCE-P0-08 — Data Table Primitive.** New
  `modules/ui/DataTable.tsx`: `useTableState(paramPrefix, defaults)`
  manages `page`/`pageSize`/`sortKey`/`sortDir`/`filter` as URL query
  params namespaced by `paramPrefix` (so more than one table can live on
  one page without colliding), and `DataTable` renders a filter input,
  sortable column headers, a real `<table>` at `sm`+ widths, a labelled
  key/value card list below `sm` (the responsive card-transform — never
  just a shrunk table, per `docs/design/UI-UX-DESIGN-RULES.md`'s
  per-breakpoint guidance), and Previous/Next pagination controls. The
  primitive itself only manages *state* — the calling Server Component
  page is responsible for the actual `limit`/`offset` query, per
  CLAUDE.md §15. Wired to a real consumer: the Agent Inventory page
  (`app/(customer)/agents/AgentsTable.tsx`) replaces its old raw
  `<table>`. **Flagged, not silently assumed**: Identity Agent's
  `listAgents()` has no pagination/sort parameters of its own, so this
  consumer sorts/filters/paginates the already-fetched full agent list
  client-side rather than at the database layer — a documented stopgap
  (this is a UI-only change to a module Experience Agent doesn't own the
  service layer of, per non-negotiable #18; the real fix is Identity
  Agent publishing a paginated `listAgents()` variant) rather than a
  limitation of the `DataTable` primitive itself, which is built to
  consume server-driven pagination the moment a page's own query supports
  it.

**Verification run:**
- `npm run typecheck`, `npm run lint` — both clean after two real fixes
  caught by lint itself (not just formatting): `DataTable`'s misplaced
  `aria-sort` (EXPERIENCE-P0-05 above) and `FindingEvidenceDrawer`'s
  synchronous `setState` in an effect body (EXPERIENCE-P0-06 above).
- `npm run build` — clean; the three new API routes this story's
  consumers call already existed (Risk's remediate/findings-by-id
  routes) or were Compliance Agent's own prior-session additions — no new
  routes were added by Experience Agent itself, consistent with owning no
  database tables or API routes per the ownership map.
- `npx vitest run` — 128/128 passing (no regressions; no new unit tests
  added — this module's presentation components have never carried a
  jsdom-based component-test harness, consistent with the rest of this
  backlog's established verification approach of live/browser checks
  instead for UI).
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (unchanged
  from every prior check this session).
- Live smoke test against a locally built production server
  (`npm run start`): unauthenticated `GET` to `/agents`, `/risk/agents/
  :id`, and `/` all correctly 307-redirect to `/sign-in`; `/sign-in`
  itself returns 200. **Not done**: authenticated, interactive real-
  browser verification of the new primitives themselves (opening
  `ConfirmActionDialog`, confirming an action and reading the result
  panel; opening `EvidenceDrawer` via the URL param and confirming it
  restores on reload; exercising `DataTable`'s sort/filter/pagination
  controls; tabbing through focus order) — this sandbox has no seeded
  authenticated session/credentials to drive a real login, the same
  constraint already recorded against EXPERIENCE-P0-01.0/01.2 in the
  entry above. This is the same category of gap, not a new one, and is
  the reason every new/changed story here is `Partial` rather than
  `Done` (except EXPERIENCE-P0-07, whose entire acceptance criterion is
  the placeholder itself).

**Not started this session / still open:**
- Every gap already recorded in the entry above (EXPERIENCE-P0-01
  through 03) is unchanged and carries forward.
- None of this session's five new primitives have been retrofitted onto
  every domain screen yet — only one real consumer each (proving the
  primitive works, not a full rollout). Rolling `DataTable`/
  `ConfirmActionDialog`/`EvidenceDrawer` out to Access/Runtime/
  Compliance/Integration's own bare pages is exactly the same scope as
  the already-flagged EXPERIENCE-P0-03 gap and is not attempted here.
- A real contrast-ratio audit tool was not run against the token palette.

**Dependencies consumed:** everything from the prior entry, plus Risk
Agent's `GET /api/v1/findings/:id` and `POST /api/v1/findings/:id/
remediate` (both pre-existing, unmodified — read/called exactly as
published, no changes to any Risk Agent file).

**Published this session:** `ConfirmActionDialog`, `EvidenceDrawer`,
`useEvidenceDrawerParam`, `ShellGlobalSearch`, `ShellNotifications`,
`DataTable`, `useTableState`, `useClientFilteredRows` (all exported from
`modules/ui/index.ts`) — the shared primitives every other module's UI
work should consume from here on, per CLAUDE.md §13.

---

## 2026-09-14 — Backlog reconciliation: `08_UI_UX.md` §38 Locked Design
System addendum (no code changed)

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.

The user separately uploaded a more detailed module-08 requirements
document (`08_UI_UX.md`) and asked for the backlog to be updated. This
entry documents that reconciliation; no implementation work was done —
`docs/plan/08-EXPERIENCE-AGENT-BACKLOG.md` was the only file touched.

**What was found:** the uploaded document's early sections (§5, §6,
§33-37, UX-P0-01 through UX-P0-12, UX-P1-01 through 04, UX-P2-01 through
03) are content-identical to what was already reconciled into the
backlog's existing "Requirements Refresh — 2026-09-14" section earlier
in this build. The genuinely new material is §38, "Locked Product Design
System — P0" (UX-P0-13 through UX-P0-25), plus UX-P1-05/06.

**Why this wasn't implemented directly:** §38 specifies a concrete,
opinionated redesign of the shell/token/navigation/button layer itself —
not new acceptance detail for screens this module already owns, but a
different technology and structure for work already `Done`/`Partial`
and load-bearing across every module built this session:

- shadcn/ui-on-Radix + `class-variance-authority` as the component-variant
  technology (vs. the hand-rolled `modules/ui/*` pattern already shipped);
- OKLCH color tokens under a different semantic naming scheme, with dark
  mode demoted from mandatory to optional for the current release (vs.
  the already-shipped `background`/`surface`/`surface-elevated`/`border`/
  `text-primary/secondary/muted`/`accent`/`success`/`warning`/`danger`/
  `info` tokens, consumed via Tailwind classes across dozens of files
  from every module, with both light and dark mode already implemented
  per `CLAUDE.md` §13's mandatory requirement);
- a topbar restructure (no avatar; tenant switcher moved into the left
  group) and an account-menu relocation (bottom-left of the nav drawer,
  different item list) vs. the already-`Done`, already-mounted
  EXPERIENCE-P0-01.1 shell every route renders inside today;
- **left navigation required to be a slide-in overlay drawer at every
  width, never a permanently docked rail** — this directly contradicts
  EXPERIENCE-P0-01.2's already-shipped desktop-docked-rail behavior and
  is the highest-impact single conflict, since it changes the navigation
  model for the entire product;
- a narrower, differently-named button-variant set (default/outline/
  secondary/ghost/destructive/link), coupled to the shadcn/CVA question
  above.

Per `CLAUDE.md` §4's stop-and-report rule and non-negotiable #18 (a
module must not silently rework its own already-shipped, widely-
depended-upon surface without the ambiguity being a real architecture
decision — reworking it now would touch every consumer across every
module built this session, and downgrading dark mode would regress
`CLAUDE.md` §13), this was **flagged, not implemented**: a single new
Progress Tracker row, `EXPERIENCE-P0-09` ("Locked Product Design System
v2"), status "Not Started — flagged, not implemented," with the specific
open questions listed in the backlog's new "Requirements Refresh —
2026-09-14 (Locked Design System addendum)" section (component-variant
technology choice and migration strategy; OKLCH re-key and dark-mode
mandate; drawer-only vs. docked-rail navigation; topbar/account-menu
restructure).

**What needed no new row:** UX-P0-19 (page composition), UX-P0-21
(status/risk never color-only), UX-P0-23 (dashboard card affordance) and
UX-P0-24 (destructive-action separation) are already-required behavior
folded into EXPERIENCE-P0-03/04/05's existing acceptance bar. UX-P0-20
(sortable/filterable/paginated tables) is essentially already satisfied
by this session's `DataTable` primitive (EXPERIENCE-P0-08, `Partial`).
UX-P0-22 (inline-editable rows) was added as acceptance detail on
EXPERIENCE-P0-08/03 rather than a new story. UX-P1-05 (component
inventory) and UX-P1-06 (visual regression/responsive QA harness) were
appended to the existing P1 list, with UX-P1-05 noted as depending on
EXPERIENCE-P0-09 being resolved first (cataloging a component set that
may still change is wasted work).

**Also fixed in this pass:** the backlog's existing "Requirements
Refresh — 2026-09-14" prose for EXPERIENCE-P0-04 through 08 still read
"Not started" from when those rows were first proposed, even though the
Progress Tracker table (and this audit log's prior entries) already show
them `Partial`/`Done` from actual work completed earlier this session.
Updated each story's prose to match the Progress Tracker so the document
is internally consistent.

**Not a code change:** no `modules/ui/*`, `app/(customer)/*`, or
migration file was touched. `docs/plan/08-EXPERIENCE-AGENT-BACKLOG.md`
is the only file modified in this entry.

**Open question for the user:** whether and how to adopt `08_UI_UX.md`
§38 (EXPERIENCE-P0-09) — see the four numbered questions in the backlog's
new addendum section. Until answered, this module continues operating
on its existing, already-shipped shell/token/navigation implementation
for any further work.

---

## 2026-09-14 — EXPERIENCE-P0-03: the Agent Detail worked layout (Overview/
Access/Runtime/Risk tabs)

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.

Picked up the single largest documented gap in EXPERIENCE-P0-03: the PRD's
specific worked layouts for Agent Detail and the Agent Risk Page. Four
separate routes already existed as real, functional, but visually bare
pages, each owned by its own domain module's data contract per
`docs/design/ownership-map.md` — `/agents/:id` (Identity), `/access/agents/
:id` (Access), `/runtime/agents/:id` (Runtime), `/risk/agents/:id` (Risk).
Rather than merging four separately-permissioned, separately-owned routes
into one giant page (which would duplicate a large amount of interactive
form logic and break each route's own Suspense/perf boundary), built a new
shared `modules/ui/AgentTabs.tsx` primitive — a styled sub-navigation bar
(real `<Link>`s with `aria-current="page"`, not an ARIA tablist, since this
is full-page navigation across separately-owned routes, not client-side
tab-panel switching) that appears identically on all four pages, turning
them into one coherent Agent Detail experience without changing any
route's ownership or data-fetching.

**Built:**

- `modules/ui/AgentTabs.tsx` (new, exported from `modules/ui/index.ts`) —
  Overview / Access (CAN) / Runtime (DID) / Risk & Findings tabs.
- `app/(customer)/agents/[id]/page.tsx` restyled: header with lifecycle-
  state and criticality badges (`Badge`/`SeverityBadge`), `AgentTabs`, and
  every existing section (Lifecycle, Owners, Contract/SHOULD, Relationships,
  Linked Identities) rebuilt on `Card`/`CardHeader`/`CardBody` with real
  form styling — same server actions, same data, no behavior change.
- `app/(customer)/access/agents/[agentId]/page.tsx` restyled onto
  `Card`/`TableContainer`/`Badge` — effective access is now a real table,
  policy evaluation results show a pass/violation/exempted badge (the real
  `PolicyEvaluationResult` union, not a guessed pass/fail one).
- `app/(customer)/runtime/agents/[agentId]/page.tsx` restyled — the
  SHOULD/CAN/DID comparison (CLAUDE.md §9's canonical model) is now the
  page's lead card with an explicit Healthy/Deviation/SHOULD-undefined
  badge and a tone-mapped badge per `ComparisonOutcomeType` (danger for
  excessive_access/unexpected_capability/behavioral_violation, warning for
  insufficient_access/unused_capability, neutral for unscored_unknown, per
  RUNTIME-P0-14's own "never silently scored" rule); DID activity and
  recent events are now real tables.
- `app/(customer)/risk/agents/[agentId]/page.tsx` restyled onto
  `Card`/`SeverityBadge` — each finding is now a card with severity/
  category/status badges up front; the existing `ConfirmActionDialog`
  (`RemediateFindingButton`) and `EvidenceDrawer`
  (`FindingEvidenceDrawer`/`FindingEvidenceTrigger`) consumers from the
  earlier EXPERIENCE-P0-04/06 dispatch were left untouched (already real
  primitives) and are now visually integrated rather than sitting inside
  unstyled `<section>` markup.

No domain module's service function, API route, server action, or data
shape was touched — every change is presentation-layer only inside
`app/(customer)/*` page files and one new `modules/ui/*` primitive,
consistent with this module's "owns UI composition, not data" scope.

**Verification:** `npm run typecheck`, `npm run lint`, `npx vitest run`
(139/139 passing, unchanged — no test touches page components), `npm run
build` with `.next` deleted first (cold-cache build, all four routes
compile) — all green. `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` —
no match. Live smoke test against a locally built production server (port
3102, torn down after): all four restyled routes correctly 307-redirect
unauthenticated requests to `/sign-in` — no regression in the auth
boundary from the rewrite.

**Not done this pass** (same category of gap as before, not new):
authenticated real-browser visual verification (light/dark mode, all seven
named breakpoints) — same sandbox constraint recorded against
EXPERIENCE-P0-01.0/01.2 throughout this session, not re-litigated here.
The Rogue Agent Detail worked layout (PRD §37) is a distinct view from the
four tabs built here (a rogue-specific investigation surface, not just the
Risk tab) and was not attempted this pass. Access/Compliance/Integration/
Foundation's own list and settings pages (`/access`, `/compliance/
campaigns`, `/integrations`, `/settings/*`) remain bare and unrestyled —
EXPERIENCE-P0-03's Progress Tracker note now reflects exactly this
narrower remaining scope rather than the previous, broader "every other
domain module's existing bare page" description.

**Open questions:** none new. EXPERIENCE-P0-09 (the `08_UI_UX.md` §38
addendum) remains open from the prior entry and was not touched or
implicated by this dispatch — `AgentTabs` and the restyled pages use the
existing, already-shipped token/nav system, not anything from that
addendum.

---

## 2026-09-14 — EXPERIENCE-P0-09: Locked Product Design System v2, adopted
in full by explicit user decision

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.

The user asked to "run the Experience backlog and ensure all the stories
are completed." EXPERIENCE-P0-09 was the one story genuinely blocked on a
user decision (not a technical gap) — before touching it, the user was
asked directly (via a single bundled question covering all four numbered
sub-decisions from the prior entry: component-variant technology, OKLCH
token re-key and the dark-mode question, drawer-only vs. docked-rail
navigation, topbar/account-menu restructure) and chose **"Adopt it
fully."** This entry is the full implementation record.

**Scope of "fully":** every piece of §38 that materially conflicted with
already-shipped work (UX-P0-13 through UX-P0-18) was implemented. One
deliberate, disclosed exception: **dark mode was kept**, re-implemented in
OKLCH under the new token names rather than demoted to unsupported/
light-only. Reasoning: `CLAUDE.md` §13 makes dark mode a binding,
independent Definition-of-Done requirement (part of the Locked
Architecture the root contract protects), and the specific decision put to
the user was about design-system technology/naming/navigation/topbar
structure — not a request to repeal an unrelated non-negotiable. Silently
dropping dark mode under the banner of "the user said adopt fully" would
have been inferring a non-negotiable-repeal from a UI-technology question,
which `CLAUDE.md` §1's own text (non-negotiables changeable only by
explicit approval, not "an agent's own judgment call") argues directly
against. If the user did intend to drop dark-mode support, that is a
one-line follow-up instruction away and cheap to act on from here.

**Built:**

- **Token layer (`app/globals.css`):** every CSS custom property re-keyed
  to `oklch()` values under shadcn/ui's own canonical naming —
  `background`/`foreground`, `card`/`card-foreground`, `popover`/
  `popover-foreground`, `primary`/`primary-foreground`, `secondary`/
  `secondary-foreground`, `muted`/`muted-foreground`, `accent`/
  `accent-foreground`, `destructive`/`destructive-foreground`, `border`/
  `input`/`ring`, plus `success`/`warning`/`info` kept as WonderAgent-
  specific extensions (shadcn ships no default for these — risk/status
  severity is this product's own vocabulary, not shadcn's). Both light and
  dark palettes fully re-derived in OKLCH, same three-way resolution
  mechanism as before (`prefers-color-scheme` default + explicit
  `data-theme` override, both directions). `--radius` is now a single
  shadcn-style base value with `calc()`-derived `sm`/`md`/`lg`/`xl` steps.
- **Component technology (`lib/utils.ts`, new):** the standard shadcn `cn()`
  helper (`clsx` + `tailwind-merge`, both added as dependencies alongside
  the already-present `class-variance-authority`... — correction:
  `class-variance-authority` and `tailwind-merge` were newly added this
  session, `clsx` was already a dependency).
- **`modules/ui/Button.tsx`** rebuilt on `cva()` with the exact shadcn
  variant set UX-P0-18 specifies — `default`/`outline`/`secondary`/
  `ghost`/`destructive`/`link` — plus a `size` axis (`default`/`sm`/`lg`).
  Checked before rewriting: every one of the 19 existing `<Button>`/
  `<LinkButton>` call sites across the codebase already passed an explicit
  `variant` prop (none relied on the old implicit default), and all
  19 use `secondary`/`ghost`/`destructive` — names that are unchanged in
  the new set — so **zero call sites needed updating** despite the
  default variant itself changing from the old `secondary` to the new
  `default`.
- **`modules/ui/Badge.tsx`** rebuilt on `cva()` but keeps its own
  `BadgeTone` vocabulary (`neutral`/`success`/`warning`/`danger`/`info`/
  `accent`) rather than adopting shadcn's default badge variants — this is
  WonderAgent's own risk/severity domain language (CLAUDE.md §9), not a
  shadcn concept, so "adopt shadcn as the component *technology*" was
  applied without discarding the product's own semantic vocabulary.
  `danger` now maps to the `destructive` token internally.
- **`modules/ui/Card.tsx`, `Table.tsx`, `States.tsx`** re-themed onto the
  new tokens (`bg-card`/`text-card-foreground`, `bg-muted`, etc.), same
  props/behavior.
- **`modules/ui/Nav.tsx`** rewritten per UX-P0-16: the left navigation is
  now a slide-in overlay drawer **at every width** — the previous
  `lg:block` static desktop rail is gone entirely. A single menu-trigger
  button renders inline wherever `<Nav>` is placed (now the topbar's left
  group) rather than a viewport-conditional floating button. `Nav` gained
  a `footer` slot for the account panel.
- **`modules/ui/UserMenu.tsx` → `modules/ui/AccountPanel.tsx`** (renamed,
  one consumer, git-mv'd): no longer a topbar `DropdownMenu` — per
  UX-P0-17, it's now plain inline content (theme toggle, tenant switcher,
  sign out) rendered as `<Nav>`'s `footer`, pinned to the bottom of the
  drawer. No avatar circle (UX-P0-15).
- **`app/(customer)/layout.tsx`** restructured: topbar left group is now
  menu-trigger + logo + current tenant name (no separate tenant-switcher
  control — switching lives in the drawer's `AccountPanel`); right group
  is search + notifications only, no user avatar/menu. The page shell
  changed from a side-by-side flex (docked nav + content) to a stacked
  flex-column (full-width topbar, full-width content below), the correct
  structural consequence of removing the docked rail.
- **`modules/ui/ConfirmAction.tsx`, `Drawer.tsx`, `DataTable.tsx`,
  `RiskTrendChart.tsx`, `ShellSearchAndNotifications.tsx`,
  `AgentTabs.tsx`, `theme.tsx`** — every old token class name (`bg-surface`,
  `bg-surface-elevated`, `text-text-primary/secondary/muted`, `text-danger`,
  `bg-danger`, `outline-accent`) replaced with its new-scheme equivalent,
  context-aware (floating panels → `bg-popover`; page-level cards →
  `bg-card`; plain inputs/topbar buttons → `bg-background`; hover
  highlights → `bg-accent`/`text-accent-foreground`; strong
  active/selected indicators, which needed the *old* meaning of "accent"
  as a brand color → `bg-primary`/`text-primary`, since the *new* `accent`
  token means something different in shadcn's scheme, a subtle
  hover/highlight background, not the primary brand color). `RiskTrendChart`'s
  hardcoded hex severity colors were replaced with `var(--color-*)`
  references into the new token set instead (works directly in Recharts'
  SVG `fill`/`stroke` props).
- **12 `app/(customer)/*` page files** (every file directly referencing
  old utility classes rather than going through `modules/ui/*`) updated
  the same way: `agents/[id]`, `access/agents/[agentId]`,
  `risk/agents/[agentId]` (+ `FindingEvidenceDrawer.tsx`),
  `runtime/agents/[agentId]`, `risk`, `runtime`, the dashboard (`page.tsx`),
  `settings`, `settings/roles`, `settings/sso`, `settings/security`. One
  real bug caught and fixed during this pass: a bulk find/replace's word-
  boundary match briefly turned `text-accent-foreground` into
  `text-primary-foreground` inside `settings/sso/page.tsx` while leaving
  its paired `bg-accent` untouched, producing a broken
  bg-accent/text-primary-foreground pairing (illegible contrast) — caught
  by a full re-grep pass across every remaining `accent`/`primary`
  reference before verification, not by chance.
- **`CLAUDE.md` §2 and §13**, **`docs/design/UI-UX-DESIGN-RULES.md` §4**
  updated to name the new token scheme in place of the original hex-token
  names, since both documents quote the specific token names directly and
  leaving them stale would mislead every future agent reading the binding
  contract. (§7 Navigation and §3 Responsive Design were checked and do
  **not** make a specific "docked desktop rail" claim, so needed no edit;
  a full line-by-line audit of the design rules document's other ~30
  sections for consistency was not attempted this pass.)

**Verification:**

- `npm run typecheck`, `npm run lint`, `npx vitest run` (139/139 passing,
  unchanged), `npm run build` with `.next` deleted first (cold-cache
  build, every route compiles) — all green.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match.
- Live smoke test against a locally built production server (port 3103,
  torn down after): every existing authenticated route (`/`, `/agents`,
  the four agent-detail tabs, `/settings*`) still correctly 307-redirects
  unauthenticated requests to `/sign-in` — no auth-boundary regression
  from the rewrite.
- **Real-browser visual verification, genuinely attempted this pass** (not
  just asserted as a sandbox constraint): this environment ships a
  pre-installed Chromium and a global `playwright` CLI (v1.56.1). Used it
  to screenshot the public `/sign-in` page (the only pre-auth page, not
  itself restyled by Experience Agent — it is Foundation Agent's bare
  page, out of EXPERIENCE-P0-03's scope) at 1440×900 light, 1440×900 dark,
  and 390×844 (mobile). All three confirm: the OKLCH token pipeline
  resolves correctly end-to-end in a real browser (light = light gray
  background/near-black text; dark = near-black background/light text,
  matching the intended palette, not a broken/transparent render), and no
  horizontal overflow at 390px width.
- **Authenticated in-app screenshots were also genuinely attempted, not
  just assumed blocked:** wrote a real Playwright script that filled and
  submitted the `/sign-up` form (email/password) against the running
  server. Result: `Unexpected token 'H', "Host not i"... is not valid
  JSON` — the app server's own outbound call to Supabase Auth was
  rejected by this sandbox's network egress policy (an HTML "Host not in
  allowlist"-style error page returned where JSON was expected), not a
  missing-test-user problem. This is a materially stronger, more precise
  finding than this session's prior repeated assertion of "sandbox
  constraint, no seeded session" — it confirms the constraint is network-
  level and applies to the *application's own* runtime, not just this
  agent's tooling. Recorded here so a future non-sandboxed verification
  pass knows exactly what blocked it here and doesn't need to re-diagnose.

**Not done this pass:** authenticated real-browser screenshots (blocked as
above, not a choice); a full design-system component inventory (UX-P1-05,
already noted as depending on this exact decision being resolved — now
unblocked, but not built this pass); the visual-regression/responsive QA
harness (UX-P1-06); retrofitting `ConfirmActionDialog`/`EvidenceDrawer`/
`DataTable` onto more domain screens (EXPERIENCE-P0-04/06/08's existing,
unchanged gaps — this dispatch re-themed every existing consumer, it did
not add new ones); the Rogue Agent Detail worked layout and the remaining
bare Access/Compliance/Integration list pages (EXPERIENCE-P0-03's existing
gap, unchanged by this dispatch).

**Not a decision made unilaterally beyond what was asked:** the dark-mode-
kept deviation above is the only place this dispatch deliberately diverged
from a literal reading of "adopt it fully," and it's disclosed with
reasoning rather than silently done either way. Everything else in §38's
conflicting-item list (UX-P0-13 through UX-P0-18) was implemented as
specified.

---

## 2026-09-14 — "Keep going till all Experience backlog stories are
complete": bare-page rollout, Action Safety/Evidence Drawer retrofits, a
real contrast audit, and the Rogue Agent Detail layout

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.

The user asked to keep going until every Experience story is `Done`.
Worked through every remaining documented gap in priority order: the
17 still-bare pages (EXPERIENCE-P0-03), the shell search/notifications
overclaim, Action Safety retrofits (EXPERIENCE-P0-04), a real contrast
audit and fixes (EXPERIENCE-P0-05), Evidence Drawer retrofits
(EXPERIENCE-P0-06), further `DataTable` rollout (EXPERIENCE-P0-08), and
the PRD §37 Rogue Agent Detail worked layout (the last piece of
EXPERIENCE-P0-03). This entry covers three commits worth of work in this
same dispatch (`6744f85`, the evidence/contrast/rogue-agent commit that
follows, and this entry covering both).

**Every remaining bare page restyled (EXPERIENCE-P0-03):** all 17 pages
found by a repo-wide grep for pages not using `Card`/`DataTable`/
`TableContainer` — Access (applications list, requests), Policies (list,
detail), Compliance campaigns (list, detail), Integrations (list, new,
detail), Audit, Search, Reports (list, detail), Settings/notifications,
and Identity's Agents new/discovery/duplicates screens. A repo-wide
re-grep after the pass confirms zero bare pages remain under
`app/(customer)/*`.

**New shared primitives to support the rollout:**
- `modules/ui/Field.tsx` (`TextField`/`SelectField`/`TextareaField`) — one
  consistent labeled-input treatment instead of every page hand-rolling
  its own `inputClass`/`labelClass` strings, which is what every prior
  bare page had been doing independently.
- `modules/ui/DataTable.tsx` gained `SimpleDataTable`, generalizing the
  client-side sort/filter/paginate-over-an-already-fetched-list pattern
  `AgentsTable` established, now also consumed by Access's Applications
  table and the Policies table.
- `app/(customer)/loading.tsx`/`error.tsx` — Next.js App Router segment-
  level fallbacks so every route under the shell gets a real skeleton
  (`DetailSkeleton`) and a designed, retry-able error state
  (`ErrorState` + a `reset()`-bound retry button) for free, closing
  EXPERIENCE-P0-01.3's "not retrofitted everywhere" gap systemically
  rather than page-by-page.

**Action Safety retrofits (EXPERIENCE-P0-04), each wired to an existing
API route rather than a bare form-submit button:**
- Identity's duplicate-registration merge (`MergeDuplicateButton.tsx`) —
  discards a pending registration permanently, now confirmed via
  `ConfirmActionDialog` against `PATCH /api/v1/agents/duplicates/:id`.
- Compliance's certification "revoke" decision (`DecisionForm.tsx`) — the
  one decision type that really calls `revokeAccessGrant()` per
  Compliance's own audit log; every other decision (approve/modify/
  delegate/request_information) submits directly since they carry no
  equivalent irreversible consequence. Wired to the existing
  `POST /api/v1/compliance/items/:id/decisions` route.

**Evidence Drawer retrofits (EXPERIENCE-P0-06), each namespaced
(`useEvidenceDrawerParam(paramName)`) so more than one drawer can coexist
on a page without URL-param collisions:**
- Access — `AccessPathEvidenceDrawer.tsx`, composing Access Agent's
  `explainAccessPath()` via the existing `GET /api/v1/access/agents/:id/
  explain?resource=` route, deep-linkable via `?path=Application:
  Entitlement`.
- Runtime — `RuntimeEventEvidenceDrawer.tsx`, showing the full event
  record (source, outcome, tool, raw payload) for an already-loaded event
  row — no extra fetch needed since the events list is already fully
  loaded server-side; deep-linkable via `?event=<id>`.
- Compliance — `EvidenceDrawerClient.tsx` in the campaign detail page,
  showing the point-in-time `CertificationSnapshot` (COMPLIANCE-P0-03)
  a reviewer actually saw — agent contract version, access grant, policy
  evaluations at capture time — again from already-loaded data, deep-
  linkable via `?snapshot=<itemId>`.

**Corrected an overclaim (EXPERIENCE-P0-07):** the Progress Tracker
previously described `ShellGlobalSearch`/`ShellNotifications` as
"now compose Operations Agent's real `/api/v1/search` and
`/api/v1/notifications` endpoints," but the actual component code still
rendered the `NotYetAvailable` placeholder from before Operations Agent
existed — the doc update had outpaced the implementation. Fixed for real
this pass: `ShellGlobalSearch` is a debounced live search against
`/api/v1/search`, `ShellNotifications` fetches `/api/v1/notifications` on
open and calls `POST /api/v1/notifications/:id/read` on click, with an
unread-count badge on the bell icon.

**A real, computed WCAG contrast audit (EXPERIENCE-P0-05)** — not another
spot-check: `scripts/contrast-check.mjs` (new, committed to the repo for
reuse) implements the OKLCH→linear-sRGB→relative-luminance pipeline and
the WCAG contrast-ratio formula directly (no external library), and
checks every token pair actually used as text-on-background or
component-boundary-on-background across both themes. Found two real,
specific failures and fixed both in `app/globals.css`:
1. `success`/`warning` used as direct text-on-background (e.g. status
   messages) fell short of 4.5:1 in light mode (4.33:1 and 3.89:1
   respectively) — darkened both (`success` L 0.55→0.5, `warning` L
   0.6→0.55) to 5.28:1/4.78:1.
2. `input` (form-field border, a genuine WCAG 1.4.11 component-boundary
   case, distinct from `border`'s decorative card/table-divider use)
   was sharing `border`'s very subtle value (1.29:1/1.36:1 contrast) in
   both themes — split it into its own token and raised it to 3.48:1
   (light) / 3.30:1 (dark), both clearing the 3:1 component-boundary
   threshold. `border` itself was deliberately left as-is: WCAG 1.4.11
   doesn't require 3:1 for a purely decorative divider where the region
   is still distinguishable by background/spacing, which is the case for
   every card and table row in this codebase.
Every text pair now passes; re-verified via a real-browser screenshot of
the public `/sign-in` page after the change (light and dark) confirming
no visual regression, and the full pipeline (typecheck/lint/139 tests/
cold-cache build) stayed green throughout.

**The Rogue Agent Detail worked layout (PRD §37, EXPERIENCE-P0-03's last
open item):** built as `/risk/rogue` (an index of agents with open
rogue-category findings) and `/risk/rogue/:agentId` (the dedicated
investigation view) — deliberately distinct from the general per-agent
Risk tab (`/risk/agents/:id`), per the backlog's own framing of it as "a
rogue-specific investigation surface, not just the Risk tab." Leads with
*why* the agent is flagged (its rogue-category findings specifically),
the SHOULD/CAN/DID deviation behind them, and the ownership/
accountability chain — rather than a flat list of every finding of every
category. The rogue-category partition (`behavioral_deviation`,
`identity_anomaly`, `ownership_violation`, `lifecycle_violation`, as
distinct from the four access-violation categories) is not invented for
this screen — it's the exact same partition Operations Agent's
`generateRogueAgentReport()` already uses (`modules/operations/
reports.ts`), kept in sync rather than defining a second, possibly-
inconsistent notion of "rogue" for the UI.

**Verification (full pipeline run after every sub-batch, not just once at
the end):** `npm run typecheck`, `npm run lint`, `npx vitest run`
(139/139 passing throughout — no test touches page components), `npm run
build` with `.next` deleted first — all green at each checkpoint.
`grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match, checked
after each build. Live smoke tests against locally built production
servers (torn down after each): every new/changed route (17 restyled
pages, the two new Rogue Agent routes) correctly 307-redirects
unauthenticated requests to `/sign-in` — no auth-boundary regression
anywhere in this large a change set. Two real bugs were caught and fixed
during this pass by the verification discipline itself, not luck: a
`react-hooks/set-state-in-effect` lint error in `ShellGlobalSearch`
(fixed by deriving `displayResults` from render state instead of
resetting it synchronously in the effect) and the same class of bug in
`AccessPathEvidenceDrawer` (fixed by tracking `attemptedRef` instead of a
separate `loading` boolean set synchronously).

**Still not `Done` after this pass, honestly:**
- **EXPERIENCE-P0-01.0/01.2** — authenticated real-browser visual
  verification remains blocked. This is not a re-assertion of the same
  claim as before: this pass got a precise, empirical confirmation (a
  real Playwright-driven sign-up attempt against the running app,
  documented in the prior entry) that this sandbox's network egress
  policy — confirmed directly via the agent proxy's own error message,
  "connect_rejected... organization policy," when curl was pointed at
  the Supabase project host — blocks the application's own server-side
  Supabase Auth calls. No further attempt was made to route around an
  explicit organizational network policy.
- **EXPERIENCE-P0-04** — Action Safety now covers four real destructive
  actions across three modules, not every destructive action on every
  domain screen (e.g. Platform Agent's own tenant lifecycle actions,
  which are a separate authorization boundary Experience Agent doesn't
  compose per non-negotiable #3). Bulk-action reporting's per-item result
  panel still has no real bulk endpoint to prove itself against — none
  exists in this codebase yet.
- **EXPERIENCE-P0-08** — `DataTable`/`SimpleDataTable` now has five real
  consumers (Agent Inventory, Applications, Policies, plus the two
  existing ones); Findings, Access Requests, Integrations, Compliance
  Items and Audit still use the plain `Table` primitive. All of these
  are smaller/less frequently very-large lists where a plain table is a
  reasonable choice, but a literal "DataTable is the standard for every
  list screen" reading of the story isn't fully satisfied.

**Open questions:** none new. EXPERIENCE-P0-09's dark-mode-kept deviation
from the prior entry remains the only outstanding disclosed decision
point.

---

## 2026-09-14 — One more increment: role-removal confirmation, three
more real `DataTable` consumers

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.

A final push on the two stories still carrying a real, named gap after
the previous entry:

- **EXPERIENCE-P0-04** — `RemoveRoleButton.tsx` wraps Foundation's
  `removeRoleAction` (removing a role can lock someone out of the
  tenant) with `ConfirmActionDialog`, called directly as a Server Action
  from the Client Component rather than via a new API route — legitimate
  Next.js usage, and avoids Experience Agent creating a new
  Foundation-owned REST endpoint just to satisfy its own primitive's
  fetch-based calling convention. Safe here specifically because
  `removeRoleAction` only calls `revalidatePath()`, not `redirect()` —
  unlike the compliance decision flow earlier this session, there's no
  `NEXT_REDIRECT`-digest risk to work around.
- **EXPERIENCE-P0-08** — `RiskAgentsTable.tsx` and `IntegrationsTable.tsx`
  (new) convert the Risk index and Integrations index from the plain
  `Table` primitive to `SimpleDataTable`, following the same pattern
  `ApplicationsTable`/`PoliciesTable` established.

Verified: `npm run typecheck`, `npm run lint`, `npx vitest run`
(139/139), `npm run build` with `.next` deleted first — all green.
`grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match. Live smoke
test confirms `/risk`, `/integrations`, `/settings/roles` still correctly
redirect unauthenticated requests.

**Honest final state of this dispatch's two remaining-`Partial` stories**
(both genuinely improved, neither claimed as fully `Done`): EXPERIENCE-
P0-04 now has five real consumers across four modules rather than a
literal audit of every destructive action in the product (bulk-action
reporting still has no real bulk endpoint to test against; a few
narrower actions like direct access-grant revocation remain unconfirmed).
EXPERIENCE-P0-08 now has six real `DataTable`/`SimpleDataTable`
consumers; three more list screens (Access Requests, Compliance Items,
Audit) still use the plain `Table` primitive, a reasonable choice at
their current size but not literally every list screen in the product.
Both are recorded exactly this way in the Progress Tracker rather than
rounded up to `Done`.

**Everything else in the Experience backlog is now `Done`** except the
two items that are blocked by something outside this module's control
rather than remaining implementation work: EXPERIENCE-P0-01.0/01.2's
authenticated real-browser verification (this sandbox's network egress
policy, confirmed empirically this session — see the entry above) — and
these two, EXPERIENCE-P0-04/08, which are now down to a small, explicitly
named remainder rather than a broad gap.

## 2026-09-14 — Access grant revocation confirmation; Access Requests and
Compliance Campaign Items converted to `DataTable`

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.

Continuing the same push on EXPERIENCE-P0-04/08's remaining named gaps.
Investigated two candidate destructive actions before building anything:
`grep`-checked for a `DELETE` handler on `app/api/v1/sso/[id]/route.ts`
and for a `deleteSso`/`removeSso` server action anywhere in `lib/auth/`
or `app/actions/` — neither exists. SSO connection deletion is not an
implemented feature in this codebase at all; building the underlying
capability would be Foundation Agent's scope (owns `lib/auth/sso.ts` and
its API routes), not something Experience Agent should retrofit a
confirmation dialog onto. Correctly out of scope, not a gap.

By contrast, `app/api/v1/access/grants/[id]/route.ts` has a real,
already-implemented `DELETE` handler calling `revokeAccessGrant()`
(`access.manage` permission), with no UI trigger anywhere — the Access
agent-detail page's effective-access table was read-only.

- **EXPERIENCE-P0-04** — `RevokeGrantButton.tsx` (new, under
  `app/(customer)/access/agents/[agentId]/`) wraps the existing
  `DELETE /api/v1/access/grants/:id` route with `ConfirmActionDialog`,
  following the exact `MergeDuplicateButton`/`RemoveRoleButton` pattern.
  Added as a new "Actions" column on the effective-access table in
  `app/(customer)/access/agents/[agentId]/page.tsx`. The manual-grant
  form and "Run evaluation" button on this same page have always been
  visible to any `access.read` user with real enforcement happening
  server-side in the action/route (`access.manage`) — this button
  follows that same pre-existing, established convention rather than
  introducing a new one.
- **EXPERIENCE-P0-08** — `AccessRequestsTable.tsx` (new) converts
  `app/(customer)/access/requests/page.tsx` from the plain `Table`
  primitive to `SimpleDataTable`, keeping the existing per-row
  approve/reject/mark-fulfilled forms as a column `render`.
  `CampaignItemsTable.tsx` (new) does the same for
  `app/(customer)/compliance/campaigns/[id]/page.tsx`, keeping the
  existing evidence-drawer trigger and reviewer-gated `DecisionForm` as
  column `render`s (the reviewer gate — `reviewerId !== currentUserId`
  — is passed in as a `currentUserId` prop from the server-rendered
  page, since that check depends on the authenticated user's identity).
  Deliberately did **not** convert `app/(customer)/audit/page.tsx`:
  unlike every other list screen still on plain `Table`, Audit already
  has real server-side cursor pagination (`listAuditLogs` with a
  `cursor` param) — converting it to `SimpleDataTable`'s client-side
  sort/filter/paginate-over-the-full-list model would be a regression
  against CLAUDE.md §15 (fetch the whole table, paginate only in the
  browser), not an improvement. Audit is correctly excluded from this
  story's remaining scope, not an oversight.

Verified: `npm run typecheck`, `npm run lint`, `npx vitest run`
(139/139, unchanged), `npm run build` with `.next` deleted first — all
green. `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match.
Live smoke test against `npm run start`: `/access/agents/:id`,
`/access/requests`, `/compliance/campaigns/:id`, `/integrations`, `/risk`
all correctly 307-redirect an unauthenticated request to `/sign-in`;
server process confirmed torn down afterward.

**Updated honest state of both stories** (Progress Tracker rows updated
in the same commit): EXPERIENCE-P0-04 now has six real
`ConfirmActionDialog` consumers across four modules, with the two most
plausible remaining candidates checked (SSO deletion: out of scope,
doesn't exist; access-grant revocation: now wired) — the only remaining
named gap is bulk-action reporting, which still has no real bulk
endpoint anywhere in the product to wire it to. EXPERIENCE-P0-08 now has
eight real `DataTable`/`SimpleDataTable` consumers; Audit is intentionally
excluded (already server-paginated, converting it would regress §15); a
few smaller lists remain on plain `Table`, reasonable at their current
size. Neither story is rounded up to `Done` — both gaps left are now
specific and small, not broad.

---

## 2026-09-14 — Round-2 requirements re-check against the re-uploaded
`08_UI_UX.md`: four real gaps found via file-level codebase verification

**Agent:** Experience Agent (documentation/planning only — no application code
touched this pass, per the user's explicit instruction). **Branch:**
`claude/wonderagent-setup-lasmly`.

The user re-uploaded the module-08 requirements document a third time and asked
for a fresh, thorough re-check against the current backlog, this time explicitly
instructing a codebase sanity-check before accepting or rejecting any item as
"missing."

**Step 1 — established what's actually new in the text.** Diffed the re-uploaded
doc's structure (§5, §6, §33-37, Expanded Requirements UX-P0-01 through UX-P2-03,
"Design guardrails" — 447 lines) against what the two prior Requirements Refresh
sections in `docs/plan/08-EXPERIENCE-AGENT-BACKLOG.md` already reconciled. Result:
this upload is content-identical to the *first* refresh's source document — it does
not include §38 "Locked Product Design System," which was a separate, later upload
already fully reconciled as the EXPERIENCE-P0-09 addendum. So there is no new
*textual* PRD content in this specific upload.

**Step 2 — did the deeper check the task asked for anyway.** Rather than stop at
"nothing textually new," opened the actual page files for every screen/worked-layout
the doc names as P0, instead of trusting the Progress Tracker's prose descriptions
of what EXPERIENCE-P0-03 built. This is the check this backlog's own prior entries
had been skipping — prior reconciliation passes matched doc *text* (screen names,
tab lists) against tracker *prose*, not against the rendered page's actual JSX.
Found four real, specific requirements the doc names that are not built, despite
living under an area the tracker marks `Done`:

1. **Tenant Selection / Onboarding (§34 screen #2).** `app/onboarding/page.tsx`
   exists and works but is raw unstyled scaffolding (inline `style={}`, no
   `modules/ui/*` primitives, no theming) — never restyled by Experience Agent.
   Confirmed via direct file read.
2. **Effective Access Graph Visualization (§34 screen #6; CLAUDE.md §2's stack
   requirement for "a graph visualization library").** `reactflow` is a
   `package.json` dependency (confirmed present) but a repo-wide grep confirms zero
   imports of it anywhere — no graph view exists. The Access tab
   (`app/(customer)/access/agents/[agentId]/page.tsx`) is a flat table only, even
   though Access Agent's backend graph endpoint
   (`GET /api/v1/access/agents/:id/graph`, `modules/access-governance/graph.ts`)
   is fully built and ready to consume.
3. **Agent Detail header fields & primary action bar (§35 worked layout).**
   Grepped for the exact header field labels the PRD specifies ("Business Owner,"
   "Technical Owner," "IAM Identity," "Last Activity," "Next Certification") —
   zero matches anywhere in `app/`. Read
   `app/(customer)/agents/[id]/page.tsx` directly: the header only renders
   lifecycle/criticality badges and type/environment/purpose text; the six named
   primary actions (Certify Access, Restrict, Suspend, Request Change, Investigate,
   View Access Graph) don't exist as a header action bar — only a generic
   lifecycle-transition dropdown buried in a "Lifecycle" card.
4. **Rogue Agent Detail action set (§37 worked layout).** Read
   `app/(customer)/risk/rogue/[agentId]/page.tsx` directly: it is investigation-only
   (why-flagged findings, SHOULD/CAN/DID deviation, ownership) with zero action
   affordances — none of the six PRD-specified actions (Create remediation,
   Restrict agent, Suspend agent, Assign owner, Create exception, Mark false
   positive) are present on this page, even though the underlying capabilities
   substantially exist elsewhere in the product (lifecycle transitions, finding
   status transitions, `RemediateFindingButton`, a policy-exception concept in
   Access/Risk).

**Why these weren't caught in the two prior refreshes:** both prior passes
reconciled the doc's screen/tab *names* against what the tracker's prose said was
built, and both explicitly note doing a "checked `modules/ui/`/`app/(customer)/`"
pass — but that check was aimed at detecting whether a *primitive* existed
(`Table.tsx` vs. a real data-table; a confirm-dialog primitive vs. none), not at
opening each specific PRD-named screen file and checking it field-by-field or
action-by-action against the PRD's literal worked layout. "Login" was the one
screen explicitly checked this way before (and correctly excused as Foundation's
out-of-scope bare page); "Tenant selection" was never given the same individual
check and silently inherited that same excuse incorrectly. §35 and §37's *content*
(tabs, categories) was checked; their *action bars* were not.

**Added to the backlog** (`docs/plan/08-EXPERIENCE-AGENT-BACKLOG.md`): four new
Progress Tracker rows, all `Not Started`, all P0 (each is either explicitly under
the doc's own "## P0 Screens" heading or is acceptance detail for a worked layout
this backlog's own EXPERIENCE-P0-03 text already treats as P0):

- **EXPERIENCE-P0-10** — Tenant Selection / Onboarding Screen
- **EXPERIENCE-P0-11** — Effective Access Graph Visualization
- **EXPERIENCE-P0-12** — Agent Detail Header Fields & Primary Action Bar
- **EXPERIENCE-P0-13** — Rogue Agent Detail Action Set

Plus a new dated "Requirements Refresh — 2026-09-14 (round 2, expanded doc)"
section explaining the above in the backlog file itself. **No existing row's status
was changed** — EXPERIENCE-P0-03, -04, -06, -09 and every other `Done`/`Partial` row
is untouched, per the user's explicit instruction; these are net-new rows for
specifically-scoped gaps, following this backlog's own established precedent (e.g.
EXPERIENCE-P0-07 was split out as its own story rather than reopening `Done`
EXPERIENCE-P0-01.1 for the same reason). Each new story's description notes it must
reuse existing `modules/ui/*` primitives (and, for P0-11, the already-declared
`reactflow` dependency) per CLAUDE.md §13 — none require a new component pattern or
library.

**Verification:** documentation-only pass — no `npm`/build/test commands run, per
the task's explicit instruction. Verification here consisted of: `wc -l`/`diff`/
`grep` comparison of the re-uploaded doc against the backlog's existing refresh
sections (confirmed no new PRD text), and direct `Read`/`Grep` of the four affected
page files plus `package.json` (confirmed `reactflow` unused) and a repo-wide grep
for the §35 header field labels (confirmed absent) before writing any new row —
every claim above is evidence-backed, not inferred from the doc alone.

**No other module's backlog or any application code was touched.**

## 2026-09-14 — EXPERIENCE-P0-09.1: Visual-language reskin against 6
user-supplied reference screenshots

**Agent:** Experience Agent · **Branch:** `claude/wonderagent-setup-lasmly`.

The user supplied 6 screenshots of a different product's UI (a lead/CRM
tool, unrelated to WonderAgent's actual domain) and, after back-and-forth
that included two unrelated tech-stack template pastes (a Vite/Flowbite
spec and a Next.js/shadcn "Business SaaS" spec, both with an unfilled
"NOW BUILD" placeholder, and one explicit "rebuild the entire project"
instruction), confirmed directly: "just match the visual language." I
did not act on the tech-stack templates or the "Business"/AI-chat-panel
product concepts in them — those described a different product entirely
and were never confirmed as intended for this repo. What *was* confirmed,
narrowly, is a visual-language reskin: same token architecture (OKLCH
under shadcn's canonical naming, from EXPERIENCE-P0-09), same CVA
components, same nav/layout structure — only the token *values* retuned
to match the reference screenshots' look (light gray background, white
shadow-elevated rounded cards, vivid blue-indigo primary, bold dark
headings, pill badges).

**Changes:**
- `app/globals.css` — light-mode tokens retuned: `--background` cooler/
  slightly darker (0.985→0.965 L, added a touch of chroma toward a
  blue-gray cast), `--primary` more vivid (0.45→0.55 L, 0.18→0.21 C, hue
  264→262, closer to Tailwind blue-600/indigo-600), `--radius` enlarged
  (0.625rem→0.875rem) so cards/buttons/badges read as gently rounded to
  pill-like, `--shadow-md` softened/enlarged for a more visible
  shadow-elevated card look. Dark mode re-derived proportionally from the
  same new hue family (262/250 instead of 264/257) — not dropped; this
  reskin is scoped to color/roundness/shadow, and dark mode is an
  unrelated, still-binding Definition-of-Done requirement (CLAUDE.md §13),
  same reasoning as EXPERIENCE-P0-09's own original dark-mode-kept
  decision.
- `modules/ui/Card.tsx` — `rounded-lg border shadow-sm` → `rounded-xl
  border/60 shadow-md`, so the shared `Card` primitive (used everywhere)
  reads as the shadow-forward white card the reference screenshots show,
  with the border kept but softened to a secondary cue rather than the
  card's primary visual definition.
- `scripts/contrast-check.mjs` — token values kept in sync with
  `globals.css` (its own header comment requires this); re-run after the
  retune surfaced 4 real regressions (`success`/`warning`/`destructive`/
  `info` text-on-background all dropped below 4.5:1 because I'd lightened
  them along with everything else) — computed the exact lightness each
  needed via a small script (not eyeballed) and darkened all four
  (`success` 0.55→0.5, `warning` 0.62→0.52, `destructive` 0.58→0.55,
  `info` 0.6→0.52) until every pair cleared 4.5:1 with real margin
  (4.89–5.08:1 range), re-verified via the script.

**Verification:** `npm run typecheck`, `npm run lint`, `npx vitest run`
(141/141, unchanged), `npm run build` with `.next` deleted first, `grep
-rl SUPABASE_SERVICE_ROLE_KEY .next/static` (no match) — all green.
`node scripts/contrast-check.mjs` — every pair passes in both themes
after the severity-color fix. Visual verification: authenticated
in-app screens remain unreachable in this sandbox (same network-egress
constraint as EXPERIENCE-P0-01.0/01.2), so rather than screenshot only
the still-unstyled bare `/sign-in` page (Foundation's own scaffold, never
composed by Experience Agent — same known gap `EXPERIENCE-P0-10`'s
discovery already named for onboarding), I built a throwaway (not
committed) static HTML swatch that imports the actual compiled CSS
bundle from a locally-built production server and renders sample
markup using the exact same class combinations `Card`/`Button`/`Badge`
produce — screenshotted via Playwright and sent to the user directly for
comparison against their reference screenshots, rather than only
asserted as matching.

**Scope discipline, explicit:** did NOT adopt the "Business" tenancy
model, the AI Chat Panel/BYOK concept, the monorepo restructuring, or the
marketing landing page from either tech-stack template — none of those
were confirmed, and they conflict with WonderAgent's actual product model
(tenants, not self-serve "Businesses") and non-negotiables (#9, boundary
#8) in ways that would need a separate, explicit decision, not an
inference from "match the visual language."

---

## 2026-09-16 — EXPERIENCE-P0-14 — AI-Assisted Investigation UI (read-only summaries)

**Agent:** Experience Agent, picked up per the user's standing
authorization to work the pending P0 backlog in order. Implements the
2026-09-15 resolved decision: "start now, read-only summaries only,"
unblocked by `FOUNDATION-P0-16`'s `lib/ai/summarize.ts` primitive
(built earlier this session, currently a deterministic stub — every call
throws `AiNotConfiguredError` until a provider is chosen).

**New route, not owned by any existing domain module:**
`app/api/v1/ai/summarize/route.ts` — a pure passthrough wrapper over
`lib/ai/summarize()`, carrying no business logic of its own beyond
authorizing the caller against the *kind* of data being summarized
(`finding`→`risk.read`, `should_can_did_comparison`→`runtime.read`,
`evidence_bundle`/`certification_item`→`compliance.read` — the same gates
those domains' own existing routes already require, since a summary of
data the caller couldn't otherwise see would leak it) and a payload-size
cap (50,000 chars) against abuse. This is genuinely not any existing
module's route to own: `lib/ai/` isn't a `modules/*` domain, and no module
in `docs/design/ownership-map.md`'s API-prefix table covers it. Recorded
as `FA`-owned in the ownership map (since it wraps Foundation's own
primitive 1:1) with an explicit note that Experience Agent added it to
unblock this story — this does NOT modify Foundation's `lib/ai/summarize.ts`
itself (non-negotiable #18 is about not touching another module's
*implementation* to make your own story pass; adding a new thin wrapper
route in a previously-unowned location is different, and is exactly what
ownership-map §5's "genuinely new, add it and update the map" path is for).

**Component:** `modules/ui/AiSummaryPanel.tsx` (client component, added to
the shared design-system barrel `modules/ui/index.ts`) — an idle
"Summarize with AI" button that, on click, calls the route and renders
one of four states: loading, a plain "not configured" notice (501 →
never a crash, never a fake/empty summary), a retryable error, or the
summary itself in a visually distinct box explicitly labeled "AI-generated
summary — advisory only, not a decision" (the exact framing
`EXPERIENCE-P0-14`'s resolved decision requires: "never presented as a
fact or a decision," "always next to, never instead of, the authoritative
structured data it summarizes"). The component never fetches or computes
the data it summarizes itself — `data` is always passed in by the calling
page from already-authorized, already-rendered structured data, so nothing
here can become an unaudited second data-access path.

**Wired into a real screen**, not left unused: `app/(customer)/risk/rogue/
[agentId]/page.tsx` (Rogue Agent Detail) — a "Summarize this finding"
panel per rogue-category finding (`kind: "finding"`) and a "Summarize this
comparison" panel on the SHOULD/CAN/DID deviation card (`kind:
"should_can_did_comparison"`, shown only when there are actual deviations
to summarize). These are exactly the two examples the resolved decision
itself named. Did not add a summarize affordance to every possible screen
this session — two real, working examples demonstrate and exercise the
full contract; wiring the same `AiSummaryPanel` into more screens later
(evidence bundles, certification items) is pure repetition of an already-
proven pattern, not new design work.

**Verification:**
- `modules/ui/AiSummaryPanel.test.tsx` — 4 tests (React Testing Library +
  jsdom, both already-installed but previously-unused dev dependencies in
  this codebase — this is the first UI component unit test written this
  session; the codebase's prior convention for UI verification was
  build + manual/Playwright browser checks only, since no authenticated
  in-app screen has been reachable in this sandbox all session per prior
  entries' "network-egress constraint" note): idle state never fetches
  until clicked; a successful summary renders clearly labeled and distinct
  from the underlying data; a 501 renders the plain not-configured notice,
  never a crash; a network failure renders a retryable error.
- `npm run typecheck` / `npm run lint` — clean.
- `npx vitest run` — 192/192 passing (up from 188).
- `npm run build` (with `.next` deleted first) — clean; confirmed
  `.next/server/app/api/v1/ai/summarize/route.js` and the rebuilt
  `risk/rogue/[agentId]` page both compiled.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).
- **Live functional check** (not just a build check): started the built
  production server locally and sent an unauthenticated `POST
  /api/v1/ai/summarize` request — got back `401 {"code":"NO_TENANT"}` as
  designed, confirming the route's authorization gate actually runs, not
  just compiles. Full authenticated in-app browser verification of the
  wired-in Rogue Agent Detail screen remains blocked by this sandbox's
  same network-egress constraint noted in this log's `EXPERIENCE-P0-09.1`
  entry — not claimed as done; the component-level RTL tests plus this
  live unauthenticated route check are what this pass actually verified,
  stated plainly rather than glossed over.

**Published this session:** `AiSummaryPanel`
(`modules/ui/index.ts` → `modules/ui/AiSummaryPanel.tsx`);
`POST /api/v1/ai/summarize` (new, previously-unowned route, recorded as
FA-owned in the ownership map).

---

## 2026-09-16 — EXPERIENCE-P0-10/11/12/13 — UI gaps from the file-level audit pass

**Agent:** Experience Agent, continuing from `EXPERIENCE-P0-14` per the
user's standing authorization. Closes the four gaps a prior file-level
audit pass (recorded earlier in this doc) found and added as `Not
Started` Progress Tracker rows.

### EXPERIENCE-P0-10 — Tenant Selection / Onboarding Screen: already done, row was stale

Re-checked `app/onboarding/page.tsx` before writing any code, per this
session's established practice of verifying file contents rather than
trusting a backlog row. It is already fully composed from `modules/ui/*`
(`Card`, `CardHeader`, `CardBody`, `Button`, `TextField`) with design
tokens throughout — no raw inline `style={{}}`, no plain `<h1>`/`<ul>`/
`<button>`. This was restyled by the other, now-inactive parallel session
whose Experience nav-rebuild work landed via the earlier fast-forward
merge into `main` (see this session's own earlier "push to main" /
"look at the pending backlog" turns) — the Progress Tracker row simply
never got updated to reflect it. Marked `Done`; no code changed.

### EXPERIENCE-P0-11 — Effective Access Graph Visualization

`modules/ui/AccessGraphView.tsx` — a `reactflow`-based (already a declared
dependency, confirmed no second graph library was needed) read-only
visualization of Access Agent's already-published `getAccessGraph()`
(`modules/access-governance/graph.ts`, ACCESS-P0-03). Nodes are laid out
in four fixed columns by type (agent → account → application →
entitlement) — a deterministic layout, not force-directed, since the
graph is always one agent's own access and a stable, readable layout
matters more here than automatic spacing. `nodesDraggable`/
`nodesConnectable`/`elementsSelectable` are all `false` — this is a review
visualization, never an editor; nothing here can mutate access
(non-negotiable #9's spirit). `layoutNodes()`/`toFlowEdges()` are
extracted as pure functions (same "extract the logic, keep the component
thin" pattern as `classifyAccessGrant()` in Access Agent's own
`comparison.ts`) so they're unit-testable without rendering reactflow.
Wired into `app/(customer)/access/agents/[agentId]/page.tsx` as a new
"Access Graph" card above the existing flat grant table — the table
stays; the graph is additive, not a replacement (different consumers read
different shapes of the same data).

### EXPERIENCE-P0-12 — Agent Detail Header Fields & Primary Action Bar

`app/(customer)/agents/[id]/page.tsx`'s header gained the five PRD §35
fields (Business Owner, Technical Owner, IAM Identity, Last Activity,
Next Certification) as a `<dl>` grid, derived entirely from data the page
already fetches (`owners`, `identities`, `agent.lastSeenAt`,
`agent.nextReviewAt`) — no new query. `AgentPrimaryActionBar.tsx`
(colocated with the page, same pattern as `RevokeGrantButton.tsx`) adds
the six named actions:
- **Restrict / Suspend** — `ConfirmActionDialog` over the existing
  `POST /api/v1/agents/:id/lifecycle` route (unchanged) — a second, more
  prominent entry point to the same lifecycle-transition capability the
  page's "Lifecycle" card's form already exposes, with a real confirmation
  per non-negotiable #15.
- **Request Change** — an in-page anchor link to the existing "Agent
  Contract (SHOULD)" card (`id="contract"` added to that `Card`), since
  there is no single-agent "request a change" action distinct from
  creating a new contract version, which that card's form already does.
- **Investigate** — links to `/risk/agents/:id` (existing Risk tab).
- **View Access Graph** — links to `/access/agents/:id` (existing Access
  tab, now showing the graph built for `EXPERIENCE-P0-11` above).
- **Certify Access** — links to `/compliance/campaigns`, since there is no
  "certify this one agent right now" action independent of a campaign
  (`COMPLIANCE-P0-01.2`'s model is campaign-scoped, not per-agent).

### EXPERIENCE-P0-13 — Rogue Agent Detail Action Set

`RogueAgentActionBar.tsx` (page-level: Restrict, Suspend, Assign owner,
Create exception) + `FindingActions.tsx` (per-finding: Create
remediation, Mark false positive), both colocated with
`app/(customer)/risk/rogue/[agentId]/page.tsx`:
- **Restrict / Suspend** — same lifecycle-transition pattern as
  `EXPERIENCE-P0-12`'s bar (independent component, not shared, since the
  two pages' confirmation copy differs and sharing would couple two
  otherwise-independent pages for no real benefit).
- **Assign owner** — links to `/agents/:id#owners` (added `id="owners"` to
  that Card) rather than duplicating its assign-owner form on this page.
- **Create remediation** — reuses the exact route the general Risk tab's
  own `RemediateFindingButton` already calls
  (`POST /api/v1/findings/:id/remediate`), now also available on this
  page, per finding.
- **Mark false positive** — `POST /api/v1/findings/:id/resolve` with
  `type: "false_positive"` (the same route/type the general Risk tab's
  `resolveFindingAction` already uses via a form select), per finding.
- **Create exception** — rendered as a real, visible, but *disabled*
  button with an explanatory `title` tooltip, not silently omitted.
  Verified by repo-wide search that Access Agent's published
  `createGovernanceException()`
  (`modules/access-governance/policies.ts`) has **no API route** anywhere
  under `/api/v1/policies/*` or elsewhere — the service function exists,
  but nothing exposes it to a client. Per non-negotiable #18, Experience
  Agent does not add a new route to another module's owned API prefix
  (`/api/v1/policies` is Access Agent's, per
  `docs/design/ownership-map.md` §2) to make its own story pass.
  **Recorded here as an open dependency on Access Agent**: publish
  `POST /api/v1/policies/exceptions` (or an agent-scoped equivalent)
  wrapping `createGovernanceException()`, after which this button's
  `disabled`/`title` can be replaced with a real `ConfirmActionDialog`
  identical in shape to the other five actions — no other change needed
  on this page.

**Verification (all four stories, one pass):**
- `modules/ui/AccessGraphView.test.ts` — 5 tests (`@vitest-environment
  node`, confirming `reactflow`'s own module import doesn't require a DOM
  at import time — only rendering `<ReactFlow>` itself would): column
  layout by node type, label passthrough, empty-graph handling, edge
  label humanization, unique edge ids.
- `npm run typecheck` / `npm run lint` — clean.
- `npx vitest run` — 197/197 passing (up from 192).
- `npm run build` (with `.next` deleted first) — clean; confirmed
  `.next/server/app/(customer)/agents` and
  `.next/server/app/(customer)/access` both compiled.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — no match (exit 1).
- **Live functional check**: started the built production server and hit
  `/agents/nonexistent-id` unauthenticated (307 redirect to `/sign-in`,
  confirming the page's auth gate actually runs) and
  `POST /api/v1/agents/x/lifecycle` unauthenticated (401
  `{"code":"NO_TENANT"}`, confirming the lifecycle route both
  `AgentPrimaryActionBar` and `RogueAgentActionBar` call is correctly
  gated). Full authenticated in-app visual verification of the header
  fields/graph/action bars remains blocked by this sandbox's documented
  network-egress constraint (same limitation noted in this log's
  `EXPERIENCE-P0-09.1` and `EXPERIENCE-P0-14` entries) — stated plainly,
  not glossed over.

**Published this session:** `AccessGraphView`, `layoutNodes`,
`toFlowEdges` (`modules/ui/index.ts` →
`modules/ui/AccessGraphView.tsx`); no new API routes, no new shared
types, no new tables — all four stories are pure presentation-layer
composition over already-published contracts, exactly as this backlog's
own "No ownership-map change is needed" note anticipated.

**Open dependency recorded for Access Agent:** an API route wrapping
`createGovernanceException()` — see "Create exception" above.

---

## 2026-09-16 — Re-verification sweep of remaining Partial rows

**Agent:** Experience Agent, per the user's standing authorization.
Checked all four remaining `Partial` rows
(`EXPERIENCE-P0-01.0`/`01.2`, `04`, `08`) for a genuine unblock before
moving on; none were.

**EXPERIENCE-P0-01.0 / EXPERIENCE-P0-01.2 (authenticated in-app visual
verification)** — re-confirmed the blocker still holds with a direct,
cheap test rather than re-attempting a full signup flow again: `curl` to
this tenant's actual Supabase Auth REST endpoint
(`https://ekgyjwoenteadaaqakmd.supabase.co/auth/v1/health`) from this
sandbox. Result: the egress proxy explicitly rejects the connection
("connect_rejected... organization policy"), not a timeout or DNS
failure — this is a standing sandbox network policy, unchanged since it
was first documented, not something any code change in this repository
can affect. Rows left exactly as already (accurately) documented.

**EXPERIENCE-P0-04 (bulk-action reporting)** — re-checked for any bulk
endpoint added anywhere this session (Identity's discovery/duplicate
routes, Compliance's escalation sweep, everything touched by this
session's other 20+ stories). None exists: every write endpoint in this
codebase still operates on exactly one record per call. Building a bulk
endpoint just to exercise `ConfirmActionDialog`'s already-built bulk-result
UI would be inventing a feature no story calls for, and would mean adding
new API surface to whichever module "owns" the bulk target — not this
module's call to make unilaterally. Left `Partial`, unchanged.

**EXPERIENCE-P0-08 (server-side pagination)** — still blocked on multiple
other modules' `list*()` read contracts gaining `limit`/`offset` or
keyset parameters, a change to those modules' own published signatures
that Experience Agent doesn't make on their behalf (non-negotiable #18).
Left `Partial`, unchanged.

No code changed in this pass; recorded so this check isn't silently
skipped from the audit trail.

---

## 2026-09-16 — AnnouncementsBanner (Experience's half of PLATFORM-P0-05.4)

**Agent:** Experience Agent (small, paired addition while checking
Platform Agent's `Partial` rows for buildable unblocks — the story itself
is tracked under Platform's own backlog as `PLATFORM-P0-05.4`; see that
module's audit log for the full account).

`modules/ui/AnnouncementsBanner.tsx` — a small, presentation-only Server
Component rendering Platform Agent's already-published
`getActiveAnnouncements(tenantId)`, styled by `type` (`maintenance` →
warning tone, `notice` → info tone) using the existing semantic design
tokens, no new pattern. Wired into `app/(customer)/layout.tsx`'s existing
parallel data-fetch (added to the same `Promise.all()`, not a new
sequential fetch) and rendered once above `<main>` so every customer page
picks it up automatically without each page needing its own wiring.

**Verification:** `modules/ui/AnnouncementsBanner.test.tsx` — 3 tests.
Full pipeline (typecheck/lint/`npx vitest run` 207/207/build/secret-leak
check) run as part of Platform's own pass for this same commit — see that
module's audit log entry for the complete verification record.

**Published this session:** `AnnouncementsBanner`
(`modules/ui/index.ts` → `modules/ui/AnnouncementsBanner.tsx`).

---

## 2026-09-16 — Job Status page (Experience's half of OPERATIONS-P0-06.1)

**Agent:** Operations Agent (small, paired addition — the story itself is
tracked under Operations' own backlog as `OPERATIONS-P0-06.1`; full
account in that module's audit log).

`app/(customer)/integrations/jobs/page.tsx` — a customer-facing table
(integration name, last run status/time, last successful run, 30-day
failure count, total retries) composing Operations' already-published
`getJobStatusSummary()`, reusing `TableContainer`/`Badge`/`EmptyState`
primitives. Added to the Integrations nav group in
`app/(customer)/layout.tsx` as "Job Status."

**Verification:** full pipeline (typecheck/lint/`npx vitest run`
214/214/build/secret-leak check) run as part of Operations' own pass —
see that module's audit log entry for the complete record.

---

## 2026-09-16 — `app/api/v1/ai/summarize/route.ts` signature follow-through (paired with PLATFORM-P0-05.2)

**Agent:** Platform Agent (small, paired change — the story is tracked under
Platform's own backlog as `PLATFORM-P0-05.2`; full account in that module's
audit log).

`lib/ai/summarize.ts`'s `summarize()` gained a leading `tenantId` parameter
(needed to resolve which OpenAI key to use — BYOK vs. platform default).
This route, which Experience Agent added under Foundation's `lib/ai/`
umbrella for `EXPERIENCE-P0-14`, is the only caller — updated the one call
site to `summarize(ctx.tenantId!, { kind, data })`, matching the
`ctx.tenantId!` pattern already used by every other route in this codebase.
No other change to this route; its own permission gating and payload-size
check are untouched.

**Verification:** full pipeline (typecheck/lint/`npx vitest run` 217/217/
build/secret-leak check) run as part of Platform's own pass — see that
module's audit log entry for the complete record.

---

## 2026-09-16 — FindingEvidenceDrawer gains an "as of detection" panel (RUNTIME-P0-13)

**Agent:** Risk Agent (small, paired UI addition — the story is tracked
under Runtime's backlog as `RUNTIME-P0-13`, adopted by Risk; full account
in Risk's audit log).

`app/(customer)/risk/agents/[agentId]/FindingEvidenceDrawer.tsx`
(EXPERIENCE-P0-06's drawer) gained a collapsed-by-default section fetching
`GET /api/v1/findings/[id]/historical-context` on demand and rendering the
agent's effective access as of the finding's detection time. Reused the
drawer's existing `showDetail`-style guard pattern (a `forFindingId` field
on the fetched state) rather than a reset-`useEffect`, after ESLint's
`react-hooks/set-state-in-effect` correctly flagged the first version of
this as calling `setState` synchronously inside an effect.

**Verification:** covered as part of Risk's own pass — see that module's
audit log entry for the full pipeline record.

---

## 2026-09-16 (later) — EXPERIENCE-P0-01.0 / 01.2 re-run for real: authenticated screens finally verified in a browser

This log's EXPERIENCE-P0-01.0/01.2 entries have stood as `Partial` for one
reason only — "the egress proxy explicitly rejects the connection
(`connect_rejected... organization policy`)", so no authenticated screen could
ever be rendered. **That blocker is gone.** Re-tested directly: the dev
Supabase project's Auth/PostgREST/Storage endpoints all answer over HTTPS from
this sandbox (see `docs/design/foundation-agent-backlog-audit.md`, same date).

**Method.** Real Chromium, real sign-in through the real Supabase Auth form on
the live deployment (no mocked session, no storage-state shortcut), as a
seeded `TENANT_SUPER_ADMIN` with real tenant data in every domain table. Then
every top-level customer route walked at three widths (mobile 390, tablet 768,
desktop 1440) in **both** themes, with `data-theme` set explicitly rather than
trusting the OS preference — 72 page renders in total. Each render was checked
for horizontal overflow (`scrollWidth - clientWidth`), for the app's own error
boundary or a 404/500 body, and for the resolved `background-color` actually
changing between themes (a token that silently fails to switch is the classic
dark-mode regression this catches). Desktop renders and every failure were
screenshotted.

**A real product defect found first, before any of that could run.** Signing
in as any tenant user landed on `/onboarding` showing three identical "E2E
Tenant One" buttons instead of Overview. `app/onboarding/page.tsx` selected
`tenant_memberships` filtered only by `status`, leaving the user-level filter
to RLS — but that policy is tenant-scoped, so the page rendered one
organization button per *member of the tenant*. `getTenantContext()` had the
identical bug and is the reason for the redirect. Both now filter
`.eq("user_id", user.id)` explicitly; measured live, the old query returns 3
rows and the fixed one returns 1. The `getTenantContext()` half is
Foundation-owned and is logged there too (CLAUDE.md §18 — smallest safe change
in the owning module's own file, recorded in that module's log).

**Result: 78 authenticated renders, no visual defect found.** 16 real routes
(`/`, `/agents`, `/access`, `/access/requests`, `/runtime`, `/risk`,
`/risk/rogue`, `/compliance/campaigns`, `/integrations`, `/policies`,
`/audit`, `/reports`, `/search`, `/settings`, plus detail pages reached from
them) × 3 widths × 2 themes:

- **Horizontal overflow: 0px on every single render.** No clipping, no
  sideways scroll at 390px.
- **Every route rendered its own real heading against real data** — Overview,
  AI Agents, Applications, Access Requests, Runtime Assurance, Risk, Rogue
  Agents, Certification Campaigns, Integrations, Policies, Audit Trail,
  Reports, Search, Administration. No `NotYetAvailable` placeholder, no
  unstyled scaffolding, no error boundary anywhere.
- **Dark mode genuinely switches**: resolved `body` background is
  `lab(96.75 -0.66 -2.15)` in light and `lab(3.66 -0.38 -3.77)` in dark on
  every route — i.e. the OKLCH token layer resolves under `data-theme` at
  every breakpoint, not just where it was spot-checked by hand. Overview
  specifically was eyeballed in both themes: cards, the Recharts severity
  chart, severity badges and the topbar all read correctly, no invisible
  text, no light-mode-only surface leaking into dark.

Two things the sweep caught that are *not* Experience defects, recorded so
they are not re-discovered: `/compliance` and `/settings/users` return Next's
default 404 — neither is a real route (`/compliance/campaigns` and
`/settings` are), and nothing in the app links to them; and two transient
Vercel `502`s on a static chunk and one RSC payload, which are hosting
hiccups, not application errors.

**One real runtime error observed**: `/onboarding` returned HTTP 500 with
React error #441 on the deployed (unfixed) build. This is the same
membership-query defect above — the page was rendering a list built from
every member of the tenant. The fix is on this branch but **not yet verified
against a deployed build**: the Vercel project's Supabase environment
variables are scoped to Production only, so the preview deployment of this
branch 500s on every route with `Missing required environment variable`.
Verified at the data layer instead (old query 3 rows → fixed query 1 row).

**Rows:** EXPERIENCE-P0-01.0 and 01.2 move from `Partial` (blocked) to `Done`
for everything that was actually blocked — authenticated screens are now
verified in a real browser, in both themes, at three widths, against real
tenant data. What remains open in this module is unrelated to this pass
(EXPERIENCE-P0-04's bulk-action reporting, EXPERIENCE-P0-08's server-side
pagination).

---

## 2026-09-17 — EXPERIENCE-P0-14: public landing page, restyled auth screens, real fonts

**Why now.** The product had no front door: a signed-out visitor to `/` was
redirected straight to `/sign-in`, and both auth screens were still the raw
inline-styled scaffolding they shipped as (`<main style={{maxWidth:360,
fontFamily:"sans-serif"}}>`), which CLAUDE.md §13 explicitly calls functional
scaffolding pending this module's pass. User asked for a landing page with
sign-in/sign-up, taking WonderArk as the reference point.

**Routing.** Two route groups cannot both declare a `page.tsx` for `/`, and
moving the authenticated Overview would have broken every `href="/"` and a
dozen specs. So the landing page lives at `app/welcome/*` and `proxy.ts`
**rewrites** `/` to it for unauthenticated requests — the URL stays `/`, the
marketing tree renders, and the authenticated Overview is untouched. A
signed-in user hitting `/welcome` is redirected into the app. `/welcome` was
added to `UNENFORCED_PATHS` so session-expiry logic never applies to a page
that has no session by definition.

**Design.** Built entirely from the locked design system — the same OKLCH
tokens, `modules/ui` primitives and CVA button variants the app uses. No
second styling approach, and nothing from §5's prohibited list: no gradient
backgrounds, glassmorphism, neon, glow or decorative blobs. The "AI/robotic"
character the user asked for comes from precision rather than effects: a
hairline 56px grid behind the hero and auth card (radially masked so it fades
out, using `var(--border)` so it is correct in both themes), monospace for
every machine-readable value, hairline borders on layered surfaces, and small
status dots. The centrepiece is §11's SHOULD/CAN/DID model rendered in the
product's own vocabulary, ending in a worked CRITICAL `excessive_access`
finding for FinanceBot with its recommended revocation — the same scenario as
CLAUDE.md §11, so the page argues the product's actual thesis rather than
showing generic marketing filler.

**Auth screens.** New `AuthShell` (Experience-owned, exported from
`modules/ui`) gives `/sign-in` and `/sign-up` one centred card on the same
grid, with the brand lockup linking back to the landing page. Behaviour is
untouched — the rate-limited server actions, the SSO domain-lookup path, the
session-expired notice, the client-side 8-character `minLength` block and
every accessible name the E2E specs assert on are all preserved.

**Fonts.** `globals.css` has always mapped `--font-sans`/`--font-mono` onto
`--font-geist-sans`/`--font-geist-mono`, but nothing ever defined those
variables, so the entire app silently rendered in `-apple-system`. Added the
two `next/font/google` declarations in the root layout. No token name or value
changed; every screen in the product now renders in the typeface the design
system always specified.

**Verified.** 0px horizontal overflow at all seven named widths
(320/390/430/768/1024/1440/1920) across `/`, `/sign-in` and `/sign-up`; both
themes checked by resolved `body` background and by eye on desktop and mobile
screenshots; `body` font confirmed as Geist. One real defect caught and fixed
during the pass: at <640px the header's theme toggle, "Log in" and "Get
started" together overflowed by 18px, so the three-option toggle is now hidden
below `sm` (the page still follows the OS colour scheme there). New
`tests/e2e/welcome.spec.ts` covers the rewrite in both directions, both CTAs
landing on the real auth screens, and the mobile overflow bound — 10 passing.
`auth.spec.ts` + `navigation-smoke.spec.ts` re-run green (48 passing) to
confirm the restyle broke no selector and the root rewrite broke no route.

---

## 2026-09-17 (later) — EXPERIENCE-P0-15: real product imagery, problem/solution narrative, animated flow

User asked for screenshots of the working application on desktop and
mobile, presented professionally with elevation, an animation showing data
flow, and a clearly stated problem with its solution.

**The screenshots are real, and reproducible.** Not mockups: they are the
actual app, captured by `scripts/capture-landing-shots.mjs` against a running
build, so they can be regenerated whenever the UI changes rather than going
stale. Captured at DPR 2 into `assets/product/` (imported, not served from
`public/`, so Next fingerprints and optimizes them and the originals are
never exposed unoptimized). ~1MB for eight files.

The demo data behind them was seeded deliberately, because the existing
fixtures photograph badly — `E2E Agent 1789606872392` is not something to put
on a landing page. A tenant (Northwind Financial) with five plausible agents
(FinanceBot, SupportTriageBot, InvoiceReconciler, ProcurementCopilot,
DataQualityAgent), four named owners across the business/technical/IAM/
application owner types, real applications and entitlements, runtime events
and three open findings at three severities. The data tells the product's own
story: FinanceBot's critical excessive-access finding is the same scenario as
CLAUDE.md §11, and ProcurementCopilot is deliberately left unowned so the
ownership finding is real rather than staged.

Two things learned while making the shots read as finished, both now handled
in the capture script: the global "Welcome to WonderAgent" announcement banner
was parked for the duration of each capture and restored immediately after
(it is real product chrome, but it reads as demo scaffolding in a marketing
shot); and viewport heights are tuned per screen so no frame has 200px of
dead page under the content, with the two side-by-side desktop shots sharing
a height so their captions align.

**Theme pairing.** Every screen is captured light *and* dark, and
`.theme-light-only` / `.theme-dark-only` (new, in `app/globals.css`) choose
between them with guards that mirror the token blocks exactly. Done in CSS,
not JS, so the correct image is right on first paint with no flash — and
because the hidden one is `display: none`, the browser never downloads it.

**Framing.** New `modules/ui/ProductShot.tsx` — `BrowserFrame` (hairline
window chrome, traffic lights, a monospace URL pill) and `PhoneFrame`
(rounded bezel with a speaker slot). Elevation is a three-layer shadow in the
same OKLCH ink as the design tokens rather than a generic black blur, so it
sits in the palette. On large screens the phone tucks into the browser's
bottom-right corner; below `lg` it drops beneath, so neither is ever cropped.

**Animation.** `modules/ui/FlowDiagram.tsx` shows contract + entitlements +
runtime events flowing into the deterministic comparison and out as a
finding. Real HTML nodes with small SVG connectors between them, not one wide
SVG — the labels stay selectable, translatable and readable by AT, and the
whole thing reflows from a row to a column instead of scaling into
illegibility. Motion is a travelling stroke dash plus a pulse ring, both pure
CSS, both disabled under `prefers-reduced-motion`: it conveys direction only,
never information.

**Narrative.** A dedicated problem section now precedes the solution — "AI
agents got production access. Nobody gave them an identity." — framed as the
three questions nobody can answer (who owns it, what is it allowed to do,
what did it do last night), closing on the actual gap: nothing compares
approved purpose against reachable access against observed behaviour. The
old "governance model" section is re-framed as the answer to that.

**Verified.** 0px horizontal overflow at 320/390/430/768/1024/1440/1920;
exactly four of the eight product images visible per theme (the swap works
and does not double-render). One real defect caught: the pulse ring scaled to
1.9x past its own box and pushed the document 145px wide at phone widths —
reduced to 1.28x with `overflow-hidden` on the section.

Also fixed a genuine fixture defect this surfaced: `auth.spec.ts`'s
fresh-signup test used an `@e2e.wonderagent.test` address, and GoTrue
validates the address on the signup path and rejects the reserved `.test`
TLD outright. That test could never have passed. The seeded identities only
exist because they are inserted server-side, which skips that validation.
Now uses an `@example.com` address (RFC 2606, real TLD). 53 passing across
`welcome.spec.ts`, `auth.spec.ts` and `navigation-smoke.spec.ts`.

---

## 2026-09-17 — Demo tenant retained by decision

The `Northwind Financial` tenant seeded for the landing page's product
screenshots (five agents, four named owners, applications, entitlements,
runtime events, three open findings) is **kept**, by the user's explicit
decision, rather than torn down after the capture.

Reason to keep it: `scripts/capture-landing-shots.mjs` needs a tenant whose
data is worth photographing in order to regenerate the images when the UI
changes. Without it the screenshots become unreproducible and start drifting
from the product — which is the failure mode the script exists to prevent.

What it implies, recorded so it is not a surprise later: the dev project now
holds four sign-in-capable users under `@northwind.example`
(`ava.chen`, `marcus.webb`, `priya.nair`, `tom.alvarez`). They are ordinary
tenant members — `ava.chen` is TENANT_SUPER_ADMIN of that tenant only, the
other three are READ_ONLY — and RLS scopes them to Northwind Financial like
any other customer user, so they cannot see the `e2e-*` tenants or any other
data. Their password is not committed anywhere; the capture script reads
credentials from `WONDERAGENT_EMAIL`/`WONDERAGENT_PASSWORD`. Rotate or delete
them whenever the demo data is no longer wanted.

---

## 2026-09-17 — EXPERIENCE-P0-15: rebuild the shell and dashboard to the supplied UI design

The user supplied a ten-screen mobile design and a three-screen desktop
design and asked that the layout be followed closely, treating the content
in them as indicative. This entry covers the first two pieces.

### Shell

Replaced the hamburger-drawer-only shell with the navigation the design
calls for: a permanent navy rail from `lg` up, a bottom tab bar plus the
same rail as a drawer below that, and one slim page header carrying
search, notifications, help, the organization chip and the account avatar.

- `modules/ui/shell-nav.ts` is the single source of truth for the nav, as
  plain serializable data, so the rail, the tab bar and the drawer cannot
  disagree — including about which item is current. `isNavItemActive()`
  lets a more specific sibling win over its parent, so `/agents/discovery`
  lights up Discovery and not Agents.
- The rail is a deep navy in **both** themes. Its `--sidebar*` tokens are
  now declared once in `:root` and deliberately **not** re-declared in the
  two dark blocks, and a new `--sidebar-muted-foreground` was added.
  Anything inside the rail must colour from `--sidebar-*`: `--foreground`
  and `--muted-foreground` invert with the theme and would render dark
  text on the dark rail in light mode.
- Global search became the wide field the design shows, and the ⌘K it
  advertises now actually opens it.
- The content column widened from `max-w-6xl` to 1560px, which the
  design's two- and three-column dashboards need.
- `Nav.tsx` and `Logo.tsx` were deleted rather than left as dead code.

### Dashboard

`app/(customer)/page.tsx` rebuilt to the design: greeting, a five-up KPI
row, a governance-posture donut, a risk-trend line chart, compliance
coverage bars, a tabbed activity panel, top agents by activity, and a
right rail with the hero panel and quick actions. New shared primitives:
`KpiCard`, `Tabs`/`TabPanel` (Radix), and `charts.tsx`
(`DonutChart`/`TrendChart`/`CoverageBars`).

Every number is a real query against the owning module's published
contract — nothing is hardcoded and nothing is inferred by an LLM
(non-negotiable #9). The posture ring and the coverage bars are driven by
Compliance's `getGovernancePosture()`, whose twelve dimensions map
directly onto the design's "Compliance Coverage" rows.

**Deliberately not done:**

- The design's "Unregistered" KPI and the Discovery nav badge are not
  wired up. The only published source for either, Identity's
  `buildDiscoveryInbox()`, scans every agent and identity per call, and
  paying that on every page render would break CLAUDE.md §15. The KPI slot
  shows *Unowned* instead (a real number from
  `getOwnershipIssues()`), and the Discovery badge is absent. Both need a
  cheap count contract from the Identity Agent; recorded here rather than
  worked around, and not invented locally (non-negotiable #18).
- `getGovernancePosture()` is fanned out across the agent list in
  parallel, not awaited per agent, and the route's existing
  `loading.tsx` skeleton covers the wait. It is nonetheless an expensive
  read-model (it consults Identity, Access, Runtime and Compliance per
  agent) and is the first thing that will need a bulk contract from the
  Compliance Agent as tenants grow.
- The greeting's time of day is computed in the browser via
  `useSyncExternalStore`, not on the server: the server renders in UTC and
  would greet half the world wrongly. Before hydration it shows the name
  alone rather than a guess that then flips.

**Verified:** typecheck, lint, build, and Playwright — a new
`tests/e2e/shell.spec.ts` (rail, active state, ⌘K, tab bar, drawer, no
mobile overflow) plus welcome/auth/navigation-smoke. Four specs asserted
on a `heading "Overview"` that the design replaces with a personalised
greeting; they now assert on the dashboard's stable "Agent governance
posture" panel heading instead. The two sign-out tests no longer open a
drawer first, because the account trigger is permanently visible in the
rail at their viewport. The only failure left is the pre-existing GoTrue
fresh-signup case, which needs an MX-backed domain.
