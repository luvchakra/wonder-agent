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
