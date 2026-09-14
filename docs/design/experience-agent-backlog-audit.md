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
