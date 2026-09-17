# 08 — Experience Agent Backlog

**Agent name:** `Experience Agent`
**Module:** Customer UI/UX & Product Experience
**Branch:** `module/experience`
**Status:** DORMANT — do not start until the user says "Run Experience Agent"

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every row is in `docs/design/experience-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| EXPERIENCE-P0-01.0 | Design tokens & theming foundation (light/dark) | **Done** — 2026-09-16: the sandbox's Supabase egress blocker lifted, so authenticated in-app screens were finally verified in a real browser. Signed in for real through Supabase Auth as a seeded `TENANT_SUPER_ADMIN` with real tenant data and walked 16 routes × 3 widths × 2 themes (78 renders): the OKLCH token layer resolves correctly under `data-theme` everywhere — `body` background `lab(96.75 -0.66 -2.15)` light vs `lab(3.66 -0.38 -3.77)` dark on every route — with Overview eyeballed in both themes (cards, Recharts severity chart, severity badges, topbar all correct). See audit log |
| EXPERIENCE-P0-01.1 | Shell layout | Done — restructured per EXPERIENCE-P0-09: topbar left group (nav trigger, logo, tenant name), right group (search, notifications only, no avatar); account menu relocated into the nav drawer |
| EXPERIENCE-P0-01.2 | Responsive behavior | **Done** — 2026-09-16: authenticated screens measured at mobile 390 / tablet 768 / desktop 1440 in both themes across 16 real routes. **Horizontal overflow was 0px on every one of the 78 renders** — no clipping, no sideways scroll at 390px, no error boundary or placeholder anywhere. See audit log |
| EXPERIENCE-P0-01.3 | Loading/empty/error states & skeleton loaders | Done — `app/(customer)/loading.tsx`/`error.tsx` give every route a real skeleton and a designed, retry-able error state by default; every page now also uses `EmptyState`/`TableSkeleton`/`DetailSkeleton` directly where relevant |
| EXPERIENCE-P0-02.1 | Overview dashboard cards | Done — all nine cards, real queries, parallel fetch |
| EXPERIENCE-P0-02.2 | Risk trend charts & action queue | Done |
| EXPERIENCE-P0-03 | Domain Screens (Agent/Access/Runtime/Rogue/Certification/etc.) | Done — the four per-agent worked layouts (Agent Detail/Access/Runtime/Risk) are one coherent tabbed experience; every remaining domain screen (Access, Policies, Integrations, Compliance campaigns, Audit, Search, Reports, Settings, Identity's new/discovery/duplicates) is restyled onto Card/Table/DataTable; the PRD §37 Rogue Agent Detail worked layout is now built at `/risk/rogue` (list) and `/risk/rogue/:agentId` (dedicated investigation view: why-flagged findings, SHOULD/CAN/DID deviation, ownership/accountability) — see audit log for the reused, documented rogue-category definition |
| EXPERIENCE-P0-04 | Action Safety (confirmation, scope preview, bulk-action reporting) | Partial — `ConfirmActionDialog` now wired to six real destructive/consequential actions across four modules (Risk's remediate, Identity's duplicate-merge, Compliance's revoke decision, Foundation's role removal, Access's direct grant revocation); SSO connection deletion was checked and confirmed to not exist as a feature at all (no `DELETE` route, no server action) — building it would be Foundation Agent's scope, not an Experience Agent confirmation-dialog retrofit, so it is correctly out of scope, not a gap; bulk-action reporting still has no real bulk endpoint to prove itself against — see audit log |
| EXPERIENCE-P0-05 | Accessibility Foundation (keyboard nav, focus management, ARIA, contrast) | Done — global focus-visible styles, skip-link, `aria-current`, accessible dialog/drawer patterns (via Radix), and shared `Field` label associations applied across `modules/ui/*` and every restyled page; WCAG contrast now verified with a real computed audit tool (`scripts/contrast-check.mjs`, WCAG relative-luminance formula) across every token pair in both themes — found and fixed two real failures (`success`/`warning` text-on-background in light mode, `input` component-boundary contrast in both themes), all pairs now pass |
| EXPERIENCE-P0-06 | Evidence Drawer & Investigation Deep Links | Done — `EvidenceDrawer`/`useEvidenceDrawerParam` now consumed by four real surfaces: Risk finding evidence, Access's `explainAccessPath()` (why-can-X-access-Y, deep-linkable `?path=`), Runtime's event detail (`?event=`), and Compliance's certification evidence snapshot (`?snapshot=`) — each namespaced so more than one drawer can coexist on a page |
| EXPERIENCE-P0-07 | Shell Global Search & Notifications | Done — `ShellGlobalSearch`/`ShellNotifications` now genuinely compose Operations Agent's real `/api/v1/search` and `/api/v1/notifications` endpoints (debounced live search, unread-count badge, mark-as-read) — corrects an earlier overclaim in this same row that described this as done while the components still rendered `NotYetAvailable`, see audit log |
| EXPERIENCE-P0-08 | Data Table Primitive (sort/filter/pagination/saved URL state/responsive card transform) | Partial — `DataTable`/`useTableState`, plus `SimpleDataTable`, now consumed by eight real screens (Agent Inventory, Access Applications, Policies, the Risk index's agent/finding-count table, Integrations, Access Requests, Compliance Campaign Items); pagination/sort/filter still run client-side over the already-fetched full list since the underlying `list*()` contracts have no server-side pagination parameters yet (a documented stopgap, not the primitive's own limitation); Audit intentionally kept on the plain `Table` primitive since it already has real server-side cursor pagination (`listAuditLogs`) — converting it to `SimpleDataTable`'s client-side model would be a §15 regression, not an improvement; a few smaller lists remain on plain `Table`, reasonable for their current size |
| EXPERIENCE-P0-09 | Locked Product Design System v2 (shadcn/Radix + CVA + OKLCH tokens + drawer-only nav + restructured topbar/account menu) | **Done** — adopted in full 2026-09-14 by explicit user approval (see the earlier Requirements Refresh addendum's four flagged questions, all resolved "adopt fully"): tokens re-keyed to OKLCH under shadcn's naming scheme, `Button`/`Badge` rebuilt on `class-variance-authority` with the exact default/outline/secondary/ghost/destructive/link variant set, left nav is now a drawer at every width (no desktop docked rail), topbar restructured (no avatar; tenant name in the left group), account menu relocated to the bottom of the nav drawer. One deliberate, disclosed deviation: dark mode was kept (re-implemented in OKLCH), not demoted to unsupported — see audit log for why |
| EXPERIENCE-P0-09.1 | Visual-language reskin (color/roundness/shadow retune against 6 user-supplied reference screenshots) | Done — 2026-09-14, by explicit user confirmation ("just match the visual language"), scoped to token values only (same shadcn token names/architecture, same CVA components, same nav/layout structure): cooler light-gray background, more vivid blue-indigo primary, larger base radius, shadow-forward `Card` (rounded-xl + shadow-md, was rounded-lg + shadow-sm); dark mode re-derived proportionally, not dropped. WCAG contrast re-verified via `scripts/contrast-check.mjs` after retuning — 4 severity-color pairs initially failed 4.5:1 post-retune and were darkened until they cleared it (all pairs pass in both themes); visually verified via a real-CSS component swatch render, and as of 2026-09-16 confirmed on real authenticated screens in both themes at three widths (see EXPERIENCE-P0-01.0/01.2 and the audit log) — see audit log |
| EXPERIENCE-P0-10 | Tenant Selection / Onboarding Screen (PRD §34 screen #2) | Done — re-verified 2026-09-16: `app/onboarding/page.tsx` already fully composed from `modules/ui/*` (`Card`/`CardHeader`/`CardBody`/`Button`/`TextField`), no raw inline styles remain; restyled by a prior parallel session, this row was simply stale |
| EXPERIENCE-P0-11 | Effective Access Graph Visualization (PRD §34 screen #6; CLAUDE.md §2 stack: "a graph visualization library (for the effective-access graph)") | Done — `modules/ui/AccessGraphView.tsx` (reactflow), wired into the Access/CAN tab above the flat grant table |
| EXPERIENCE-P0-12 | Agent Detail Header Fields & Primary Action Bar (PRD §35 worked layout) | Done — header fields (Business/Technical Owner, IAM Identity, Last Activity, Next Certification) + `AgentPrimaryActionBar` (Certify Access, Restrict, Suspend, Request Change, Investigate, View Access Graph) added to `app/(customer)/agents/[id]/page.tsx` |
| EXPERIENCE-P0-13 | Rogue Agent Detail Action Set (PRD §37 worked layout) | Done — `RogueAgentActionBar` (Restrict/Suspend/Assign owner; Create exception disabled, see audit log) + per-finding `FindingActions` (Create remediation/Mark false positive) added to `/risk/rogue/[agentId]` |
| EXPERIENCE-P0-14 | Public landing page + restyled auth screens | **Done** — 2026-09-17: `app/welcome/*` (hero, SHOULD/CAN/DID model with a worked FinanceBot finding, six-capability grid, four-step how-it-works, closing CTA, footer), served at `/` for signed-out visitors via a rewrite in `proxy.ts` so the marketing page and the authenticated Overview share the root path without two route groups declaring it. `/sign-in` and `/sign-up` moved off raw inline-styled scaffolding onto `AuthShell` + `TextField`/`Button`. Also wired the Geist fonts the tokens already referenced but nothing defined. Verified: 0px horizontal overflow at 320/390/430/768/1024/1440/1920 in both themes, and `tests/e2e/welcome.spec.ts` (10 assertions) plus the full auth + navigation-smoke specs (48) pass |
| EXPERIENCE-P0-15 | Landing page product imagery, problem/solution narrative, animated flow | **Done** — 2026-09-17: real desktop + mobile screenshots of the running app (`assets/product/*`, regenerated by `scripts/capture-landing-shots.mjs`, captured against a purpose-seeded Northwind Financial demo tenant), framed by new `BrowserFrame`/`PhoneFrame` primitives with layered OKLCH shadows; every shot captured light AND dark and swapped by new `.theme-light-only`/`.theme-dark-only` CSS guards that mirror the token blocks; new `FlowDiagram` animating contract/entitlements/runtime → deterministic comparison → finding (CSS stroke-dash + pulse ring, both disabled under `prefers-reduced-motion`); explicit problem section preceding the re-framed solution. 0px overflow at all seven widths; 53 E2E passing |
| EXPERIENCE-P0-14 | AI-Assisted Investigation UI (read-only summaries) | Done — `AiSummaryPanel` shared component wired into Rogue Agent Detail (finding + SHOULD/CAN/DID summaries); shows "not configured" until FOUNDATION-P0-16 has a provider |

---

## Dependencies

Every domain module's published service contract
(`modules/*/service.ts`)/API routes. Experience Agent composes; it never invents
business logic or reads a domain module's tables directly (it always goes through
the module's service functions or API routes) — this keeps the boundary in
non-negotiable #6 real, not just a naming convention.

## Owned entities

None. This module owns UI composition code (`modules/ui/*`, `app/(customer)/*`
layout/pages), not data.

## Consumed entities

Read-only, via each domain module's published contract:
Foundation (`getTenantContext`), Identity, Integration, Access, Runtime, Risk,
Compliance, Operations (for notifications/search/reports surfaces).

## Published contracts

- `modules/ui/*`: shared layout shell, navigation, design-system primitives (badges,
  tables, cards, side panels) other modules' pages compose with. Domain modules may
  *use* these primitives in their own route files but do not modify them — changes
  to `modules/ui/*` are Experience Agent's alone.

---

## Higher-bar stories

None of this module's stories are individually higher-bar in the security sense, but
EXPERIENCE-P0-01.1 (navigation shell) is a shared surface every other module's UI
mounts into — get its route/slot contract right or every module's UI story breaks.

---

## Epic EXPERIENCE-P0-01 — Application Shell & Navigation

Every story in this epic (and every other Experience Agent story) must follow
`docs/design/UI-UX-DESIGN-RULES.md` in full (referenced from `CLAUDE.md` §13) —
the enterprise-grade quality bar (§2 of that doc: "would this look credible in
front of a CISO?"), mandatory desktop/tablet/mobile responsiveness (§3), mandatory
light **and** dark mode via semantic tokens (§4), and the pre-commit design-review
checklist (§32). Read it in full before starting EXPERIENCE-P0-01.0.

### EXPERIENCE-P0-01.0 — Design tokens & theming foundation

Before any screen is built, establish the shared design-token layer every other
Experience story and every domain module's bare pages consume, per
`docs/design/UI-UX-DESIGN-RULES.md` §4:

- A single source of truth for color, spacing, radius, shadow and typography
  tokens (CSS variables or a Tailwind theme extension), covering both a light and a
  dark palette, using the semantic token names that document specifies —
  `background`, `surface`, `surface-elevated`, `border`, `text-primary`,
  `text-secondary`, `text-muted`, `accent`, `success`, `warning`, `danger`, `info`
  — each WCAG AA-contrasted in both modes. Dark mode is designed intentionally
  (sophisticated neutral surfaces, not pure black), not produced by inverting light
  mode.
- Theme resolution: default to the visitor's `prefers-color-scheme`, with an
  explicit light/dark/system toggle in the user menu, persisted per user (e.g. a
  cookie or `localStorage` value read before first paint to avoid a flash of the
  wrong theme).
- `modules/ui/*` primitives (badges, cards, tables, side panels, buttons, inputs)
  are built or refactored to consume these tokens exclusively — no hardcoded hex
  colors in component code. Verify hover/selected/disabled states and badges in
  both themes, not just the default static appearance.
- One consistent, restrained type scale and one icon set (document the choice here
  or in the audit log) adopted across every primitive.

This story blocks EXPERIENCE-P0-01.1 — the shell must be built on top of these
tokens, not styled ad hoc and retrofitted later.

### EXPERIENCE-P0-01.1 — Shell layout

Build the shell described in the PRD (§33): top bar (WonderAgent logo, tenant
selector reading from `getTenantContext()`, user menu with sign-out), left
navigation, breadcrumb row, page title + actions row, content area. Implement as
`app/(customer)/layout.tsx` wrapping every customer route. Left navigation items
route to paths owned by their respective modules but **rendered by Experience**:

```text
Overview                          -> /
AI Identity                       -> /agents, /agents/:id (Identity)
  Agents, Lifecycle, Ownership, Relationships, Discovery
Access Governance                 -> /access/* (Access)
  Effective Access, Entitlements, Access Requests, Certifications, Violations
Runtime Assurance                 -> /runtime/* (Runtime)
  Activity, Events, SHOULD vs CAN vs DID, Anomalies, Rogue Agents
Risk & Compliance                 -> /risk/*, /compliance/* (Risk, Compliance)
  Risk Dashboard, Policies, Control Frameworks, Compliance, Findings, Evidence
Integrations                      -> /integrations/* (Integration)
  Catalog, Connected Systems, Connectors, API/REST, MCP, Webhooks, Jobs
Reports                           -> /reports/* (Operations)
Administration                    -> /settings/* (Foundation, mostly)
  Users, Roles, SSO, Tenant Settings, Notifications, Audit Logs
```

Nav items for a route whose owning module doesn't exist yet render but the target
page shows a plain "Not yet available" state rather than a broken link/404 — this
lets Experience Agent build the full shell before every domain module exists.
Platform Admin is **never** shown in this navigation, in any state, for any customer
role (non-negotiable #3 / Foundation's platform-admin boundary) — do not add a
conditional "show if platform admin" branch here at all; `/platform-admin` is a
wholly separate layout Platform Agent owns.

### EXPERIENCE-P0-01.2 — Responsive behavior

Left nav collapses to an icon rail or a drawer below a defined breakpoint (document
the breakpoint chosen, e.g. 1024px, in this file's next revision or the audit log).
No horizontal scroll of the page body at any width down to 375px; tables that must
stay wide scroll within their own container. Verify at the widths named in
`docs/design/UI-UX-DESIGN-RULES.md` §32: 1440px, 1280px, 1024px, 768px, 390px,
375px.

### EXPERIENCE-P0-01.3 — Loading/empty/error states & skeleton loaders

Shared `modules/ui/*` primitives for the three states every data-backed screen
needs, per `CLAUDE.md` §13 and §15 (Performance & Responsiveness Standards):

- A skeleton-loader primitive matching each primary layout shape (card grid, table,
  detail page) shown during initial data fetch — never a bare spinner-only page and
  never a blank white screen.
- An inline loading affordance for button-triggered actions (disabled state +
  spinner) so a click always has visible feedback.
- A designed empty state (not just an empty table) and a designed error state
  (with a retry action where applicable) for every list/detail view.

Domain modules' own bare functional pages adopt these primitives as soon as they
exist, rather than each inventing its own loading/empty/error markup.

---

## Epic EXPERIENCE-P0-02 — Dashboard

### EXPERIENCE-P0-02.1 — Overview dashboard cards

Cards (PRD §6), each backed by a real query against the owning module's contract —
never a hardcoded/mock number:

```text
Total AI Agents, Active, Unowned, Certification Overdue, High Risk, Critical Risk,
Policy Violations, Rogue/Potentially Compromised, Agents with Excessive Access
```

If the owning module (Identity for counts, Risk for risk/violation counts,
Compliance for certification-overdue) isn't implemented yet, the card shows a
"Not yet available" placeholder rather than a fabricated number — never invent
sample data that could be mistaken for real tenant data.

### EXPERIENCE-P0-02.2 — Risk trend charts & action queue

Risk-by-severity, by business unit, by application, by agent type, by owner (Risk
Agent's data, grouped). Action queue: a real list of open items (certifications
awaiting approval, unowned agents, excessive-privilege findings, sensitive-data
violations, lifecycle reviews due) each linking to the actual record.

---

## Epic EXPERIENCE-P0-03 — Domain Screens

Build the P0 screens listed in the PRD (§34), each a thin composition over its
owning module's contract, once that module publishes it: Agent inventory/detail
(Identity), Access graph/Effective access (Access), Runtime activity/SHOULD-CAN-DID
(Runtime), Rogue agent findings/detail (Risk), Certification campaign
list/review (Compliance), Policy list/editor (Access), Integration
catalog/setup/health (Integration), Users/Roles/SSO/Audit log (Foundation),
Tenant settings (Foundation). Follow the PRD's exact worked layouts for Agent Detail
(§35), Agent Risk Page (§36) and Rogue Agent Detail (§37) — these are specified in
enough detail (tabs, header fields, actions) to build directly; do not invent a
different structure.

**DO NOT IMPLEMENT** the Platform Admin dashboard here — Platform Agent owns
`/platform-admin` end-to-end, including its own UI.

---

## Critical acceptance test

A user can navigate Overview → AI Identity → Agent → Access → Runtime →
SHOULD/CAN/DID → Risk → Certification without broken routes, layout overlap, or
unauthorized data exposure (verify no page ever renders another tenant's data by
testing as Tenant A while Tenant B has records in every domain table). Repeat the
same walkthrough in both light and dark mode, and at mobile/tablet/desktop widths,
per `CLAUDE.md` §13 — no visual regression, no unstyled/generic fallback in either
mode at any width.

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc `08_UI_UX.md`) that
expands this module's P0/P1/P2 scope beyond what was already tracked above.
Reconciled against the existing Progress Tracker (nothing already `Done` or
`Partial` was reopened or marked down — EXPERIENCE-P0-03's existing large,
honestly-flagged gap already absorbs most of the new doc's domain-screen detail).
Checked `modules/ui/` and `app/(customer)/` before adding any row: no shared
data-table primitive with sort/filter/pagination exists (`modules/ui/Table.tsx` is
a bare table shell), no shell slot for global search or notifications exists in
`modules/ui/Nav.tsx`/`UserMenu.tsx`, no confirmation/`AlertDialog` primitive exists
despite `@radix-ui/react-dialog` already being a dependency, and no evidence-drawer
component exists — so the following are tracked `Not Started` rather than assumed
`Done`. The following are genuinely new stories added to the tracker:

### EXPERIENCE-P0-04 — Action Safety

Shared `modules/ui/*` primitives for destructive/high-impact actions (certify,
restrict, suspend, remediate, bulk operations): a confirmation dialog showing a
scope preview (what/how many records are affected), an optional reason field where
the calling module's contract requires one, a disabled+spinner in-flight state, and
a clear post-action result (success/partial-failure with per-item detail for bulk
operations). This is a presentation primitive only — the underlying
authorization/approval decision remains the owning domain module's (non-negotiable
#15); Experience Agent never decides whether an action is allowed, only renders the
confirmation/result UX consistently. **Partial** — `ConfirmActionDialog`
(`modules/ui/ConfirmAction.tsx`) is built and wired to a real consumer (Risk's
remediate-finding action); not yet retrofitted onto every other destructive action,
and bulk-action reporting has no real bulk endpoint yet to prove it against. See
Progress Tracker and the audit log.

### EXPERIENCE-P0-05 — Accessibility Foundation

`docs/design/UI-UX-DESIGN-RULES.md` already requires accessibility, but there is no
tracked story auditing/implementing it as a first-class deliverable: keyboard
navigation across nav/tables/dialogs, visible focus states, semantic labels and
landmark roles, accessible dialog/drawer patterns (focus trap, `Escape` to close,
labelled by/described by), WCAG AA contrast in both themes, and screen-reader-
friendly status/severity badges and tables (not color-only). Today only a handful
of `aria-label`s exist on the nav toggle; this story is to make accessibility a
verified property of `modules/ui/*` rather than incidental. **Partial** — global
`:focus-visible` styles, a skip-to-content link, `aria-current` on nav, and
accessible dialog/drawer patterns (focus trap, `Escape`-to-close via Radix) are
applied across `modules/ui/*` and the mobile nav; WCAG AA contrast spot-checked but
not exhaustively audited with a contrast-ratio tool, and not yet retrofitted onto
every existing bare domain page. See Progress Tracker and the audit log.

### EXPERIENCE-P0-06 — Evidence Drawer & Investigation Deep Links

A shared contextual side-drawer primitive (built on the existing
`@radix-ui/react-dialog` dependency, not a new library) that opens evidence
(runtime events, access-path detail, finding evidence, certification evidence)
without navigating away from — or losing scroll/filter/pagination position in —
the underlying list. Deep links (a shareable URL) into a specific evidence item
must restore that same investigation context (which list, which filters, which
item) rather than dropping the user on a bare detail page. **Partial** —
`EvidenceDrawer`/`useEvidenceDrawerParam` (`modules/ui/Drawer.tsx`) are built and
wired to a real consumer (Risk finding evidence, deep-linkable via
`?evidence=<id>`); not yet consumed by Access/Runtime/Compliance's own evidence
surfaces. See Progress Tracker and the audit log.

### EXPERIENCE-P0-07 — Shell Global Search & Notifications

The PRD's Enterprise Shell (§33, EXPERIENCE-P0-01.1, already `Done`) built the top
bar's logo/tenant-selector/user-menu, but not a global search entry point or a
notifications affordance — both are explicitly named in the new doc's UX-P0-01.
This is scoped as its own new story rather than reopening the `Done` P0-01.1: a
top-bar search entry point and a notifications indicator/panel, both composing
Operations Agent's published search/notifications contracts once available (a
"Not yet available" placeholder until then, per the same pattern used elsewhere in
this backlog) — Experience Agent renders, Operations Agent supplies the data and
matching logic. **Done** — `ShellGlobalSearch`/`ShellNotifications`
(`modules/ui/ShellSearchAndNotifications.tsx`) are built and composed into the
topbar; both correctly showed `NotYetAvailable` until Operations Agent published
its search/notifications contracts, and now compose Operations Agent's real
`/api/v1/search` and `/api/v1/notifications` endpoints. See Progress Tracker and
the audit log.

### EXPERIENCE-P0-08 — Data Table Primitive

`modules/ui/Table.tsx` today is a bare table shell (container, head, row, cell)
with no built-in sorting, filtering, pagination or responsive card-transform
behavior — each consuming page would otherwise reinvent these. Publish a shared
data-table primitive (sortable columns, filter affordances, keyset or
limit/offset pagination controls wired to the calling page's query per `CLAUDE.md`
§15, saved-URL-state for the current sort/filter/page, and a responsive
card-transform for narrow viewports) that EXPERIENCE-P0-03's domain screens (Agent
Inventory, Access, Findings, etc.) consume instead of hand-rolling their own.
**Partial** — `DataTable`/`useTableState` (`modules/ui/DataTable.tsx`) are built
(sort, filter, saved-URL-state, responsive card-transform) and wired to a real
consumer (`app/(customer)/agents/AgentsTable.tsx`); pagination/sort/filter run
client-side over the already-fetched full list since `listAgents()` has no
server-side pagination parameters yet (a documented stopgap, not the primitive's
own limitation); not yet consumed by Access/Findings/other domain screens. See
Progress Tracker and the audit log.

### Already covered, no new tracker row needed

- UX-P0-01 (Enterprise Shell) — the nav/tenant-selector/user-menu portion maps onto
  EXPERIENCE-P0-01.1 (`Done`); the global-search/notifications portion is newly
  tracked separately as EXPERIENCE-P0-07 above rather than reopening a `Done` row.
- UX-P0-02 (Light/Dark Themes) maps onto EXPERIENCE-P0-01.0 (`Partial`) — no scope
  change.
- UX-P0-03 (Agent Inventory), UX-P0-04 (Agent Detail), UX-P0-05 (SHOULD/CAN/DID
  Visualization) and UX-P0-06 (Risk UX) all map onto EXPERIENCE-P0-03 (`Partial`,
  already carrying a large, honestly-flagged known gap covering exactly these
  worked layouts) — no new row; the new doc's detail is additional acceptance
  detail for that existing story, not new scope.
- UX-P0-09 (Loading/Empty/Error) maps onto EXPERIENCE-P0-01.3 (`Partial`).
- UX-P0-12 (Responsive Navigation) maps onto EXPERIENCE-P0-01.2 (`Partial`).

No ownership-map addition is needed for this refresh: Experience Agent owns no
database tables per `docs/design/ownership-map.md` (UI composition only), and every
new item above is either a `modules/ui/*` presentation primitive or a shell slot
that composes another module's already-owned contract (Operations Agent's
notifications/search for EXPERIENCE-P0-07; Risk/Compliance/Runtime's evidence for
EXPERIENCE-P0-06) rather than a new table, route or shared type.

**Not a decision made unilaterally:** the new requirements package's "Modular
Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a different
*process* model ("Only the agent explicitly activated by the user may start work.
Agents must never launch another agent automatically") than this repository's
standing autopilot/auto-chain policy in `CLAUDE.md` §7 and `docs/ORCHESTRATION.md`
§2. That is a meta/process question, not a product requirement, and is called out
to the user separately rather than silently changed here.

## Requirements Refresh — 2026-09-14 (Locked Design System addendum)

The user separately uploaded a more detailed module-08 requirements document
(`08_UI_UX.md`) after the refresh above was already reconciled. Its early sections
(§5, §6, §33-37, UX-P0-01 through UX-P0-12, UX-P1-01 through 04, UX-P2-01 through 03)
are content-identical to what the refresh above already covers — no changes needed
there. The genuinely new material is **§38, "Locked Product Design System — P0"**
(UX-P0-13 through UX-P0-25) plus **UX-P1-05/06**.

§38 specifies a concrete, opinionated design-system implementation — not just
acceptance criteria for screens this module already owns, but a specific
technology and structure for the shell/token/navigation/button layer itself. Several
of its items **materially conflict** with work already `Done`/`Partial` and in active
use by every module built so far this session:

- **UX-P0-13 (technology foundation: shadcn/ui component patterns on Radix +
  `class-variance-authority` for variant styling)** conflicts with the hand-rolled
  `modules/ui/*` component set already built (badges, tables, cards, dialogs) under
  EXPERIENCE-P0-01.0, which is plain Tailwind + Radix primitives with no CVA layer.
  Swapping the variant-styling approach now would touch every consumer across every
  module.
- **UX-P0-14 (OKLCH color tokens with a different semantic naming scheme; light
  theme only required for the current release)** conflicts with EXPERIENCE-P0-01.0
  (`Partial`, `Done` enough to be load-bearing): the already-shipped token set uses
  the semantic names mandated by `docs/design/UI-UX-DESIGN-RULES.md` §4
  (`background`/`surface`/`surface-elevated`/`border`/`text-primary`/`text-secondary`/
  `text-muted`/`accent`/`success`/`warning`/`danger`/`info`) and already implements
  **both** light and dark mode, consumed via Tailwind utility classes
  (`text-primary`, `bg-surface`, etc.) across dozens of files from every module.
  Re-keying to OKLCH under a different naming scheme, and downgrading dark mode to
  optional, would be a breaking rename across the whole codebase and a regression
  against `CLAUDE.md` §13's mandatory-dark-mode requirement — not something this
  module can decide to accept on its own.
- **UX-P0-15 (topbar: no user avatar; tenant switcher moved into the left group)**
  conflicts with EXPERIENCE-P0-01.1's already-`Done`, already-mounted shell
  structure (`app/(customer)/layout.tsx`, `modules/ui/Nav.tsx` /
  `UserMenu.tsx`) — every existing route renders inside that shell today.
- **UX-P0-16 (left navigation MUST be a slide-in overlay drawer only, never
  permanently docked, even at desktop widths)** directly contradicts
  EXPERIENCE-P0-01.2's already-verified, already-`Partial`/working responsive
  behavior, which docks the nav as a static rail at desktop widths (`lg:block`) and
  only collapses to a drawer below the documented breakpoint. This is the highest-
  impact single conflict in §38 — it changes the navigation model for the entire
  product, not just its styling.
- **UX-P0-17 (account/user menu relocated to the bottom-left of the nav drawer,
  with a different item list)** — same conflict source as UX-P0-15, compounded by
  UX-P0-16's drawer-only requirement.
- **UX-P0-18 (button system restricted to shadcn/CVA's specific variant set:
  default/outline/secondary/ghost/destructive/link)** is a narrower, differently-
  named variant set than whatever button primitive already exists in
  `modules/ui/*`; adopting it is coupled to the UX-P0-13 technology-foundation
  question above, not separable from it.

None of the above five/six items were implemented at the time this addendum was
first written. Per `CLAUDE.md` §4's stop-and-report rule and non-negotiable #18 (a
module never silently reworks its own already-shipped, widely-depended-upon surface
without the ambiguity being a real architecture decision), this was tracked as a
single new row, **EXPERIENCE-P0-09** (Progress Tracker above), pending explicit user
direction on four numbered questions (component-variant technology; OKLCH re-key and
the dark-mode question; drawer-only vs. docked-rail navigation; topbar/account-menu
restructure).

**Resolved 2026-09-14, same day:** the user was asked directly (all four questions
bundled into one decision) and chose **"Adopt it fully."** EXPERIENCE-P0-09 is now
**Done** — see the Progress Tracker above and the audit log for the full
implementation record. One deliberate, disclosed deviation from a literal full
adoption: dark mode was **kept** (re-implemented in OKLCH under the new token names)
rather than demoted to unsupported, since `CLAUDE.md` §13's dark-mode mandate is a
separate, binding Definition-of-Done requirement the approved question did not ask
to repeal — see the audit log entry for the full reasoning.

The remaining §38 items do **not** conflict with existing work and need no new
tracker row — they are additional acceptance detail folded into stories already
tracked above:

- **UX-P0-19 (page composition/layout conventions)**, **UX-P0-21 (status/risk
  color communicated with both color and text/icon, never color-only)**,
  **UX-P0-23 (dashboard card hover/click affordance)**, **UX-P0-24 (destructive
  actions visually separated/confirmed, never adjacent to a primary action without
  distinction)** and **UX-P0-25 (universal component consistency across
  screens)** are all already-required behavior under EXPERIENCE-P0-03 (domain
  screens), EXPERIENCE-P0-04 (Action Safety) and EXPERIENCE-P0-05 (Accessibility
  Foundation, which already requires non-color-only status communication) — no
  scope increase, folded into those stories' existing acceptance bar.
- **UX-P0-20 (sortable/filterable/paginated tables with a defined empty/loading
  state)** is essentially already satisfied by the `DataTable`/`useTableState`
  primitive built this session under EXPERIENCE-P0-08 (`Partial`) — no new row;
  remaining work is that primitive's existing documented gap (server-side
  pagination, rollout to more consumers), not new scope.
- **UX-P0-22 (inline-editable table rows for lightweight attribute edits, e.g.
  agent ownership)** is new acceptance detail for EXPERIENCE-P0-08's `DataTable`
  primitive and/or EXPERIENCE-P0-03's domain screens — added there as detail, not
  a new row, since it's an extension of an existing primitive rather than a new
  system.

No ownership-map or database-table change is implied by any of §38 — it is entirely
presentation-layer scope within `modules/ui/*`, consistent with this module's
"owns no database tables" position elsewhere in this file.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-uploaded the module-08 requirements document (`08_UI_UX.md`) a third
time and asked for a fresh, thorough re-check. First established what this specific
upload actually contains: byte-for-byte the same PRD §5, §6, §33-37 and Expanded
Requirements (UX-P0-01 through UX-P2-03, "Design guardrails") content as the
original refresh above — it does **not** include §38 "Locked Product Design
System" (already reconciled separately as the addendum above / EXPERIENCE-P0-09).
So no new *textual* requirements exist in this upload beyond what the two prior
refreshes already reconciled.

What this pass instead surfaced is real: per this module's own instructions to
sanity-check the doc's claims against the actual codebase (not just against prior
paperwork) before declaring something covered, four requirements that the doc
explicitly specifies — and that the existing Progress Tracker's language implied
were satisfied by an already-`Done` EXPERIENCE-P0-03 — turned out, on inspection of
`app/(customer)/*` and `modules/ui/*`, not to be actually built. Each is a specific,
named PRD requirement (a numbered P0 screen or an exact worked layout CLAUDE.md §13
requires be followed, "not invented differently"), not a vague gap, and none of them
had a tracked row anywhere in this backlog before now — they were never caught
because prior reconciliation passes matched the doc's *text* (screen names, tab
lists) against the Progress Tracker's *prose descriptions* of what was built, without
opening the actual page files to confirm the described widget/action/graph was
literally present. This pass did that file-level check instead, per this task's
explicit instruction, and found:

- **EXPERIENCE-P0-10 — Tenant Selection / Onboarding Screen.** PRD §34 lists
  "Tenant selection" as P0 screen #2. `app/onboarding/page.tsx` is a real,
  functionally-wired screen (Foundation Agent's bare page) but was never restyled
  onto the design system — still raw inline `style={}` and generic HTML. Missed
  before because EXPERIENCE-P0-01.0's audit-log entry explicitly checked and
  excused "Login" as Foundation's out-of-scope bare page, and "Tenant selection"
  was never separately checked and silently fell into the same (incorrect)
  assumption.
- **EXPERIENCE-P0-11 — Effective Access Graph Visualization.** PRD §34 screen #6
  and CLAUDE.md §2's locked stack both call for a graph visualization library for
  the effective-access graph. `reactflow` is a declared dependency but is never
  imported or rendered anywhere; the Access tab is a flat table. Missed before
  because EXPERIENCE-P0-03's epic text mentions "Access graph" in the same breath
  as "Effective access" as if one screen, and only the table half was ever built.
- **EXPERIENCE-P0-12 — Agent Detail Header Fields & Primary Action Bar.** PRD §35's
  worked layout (header fields, six primary actions) is specific and was already
  flagged in this backlog as something to build "directly, not invent a different
  structure" — but the actual header only shows lifecycle/criticality badges, and
  the six named actions don't exist as a header action bar. Missed before because
  EXPERIENCE-P0-03 was marked `Done` based on the tab structure being correct,
  without a field-by-field check against §35's exact spec.
- **EXPERIENCE-P0-13 — Rogue Agent Detail Action Set.** PRD §37's worked layout
  specifies six actions; the built `/risk/rogue/:agentId` page is investigation-only
  with zero action affordances. Missed before for the same reason as P0-12 — the
  page's *structure* (why-flagged, deviation, ownership) matched the PRD's content
  spec closely enough to read as complete, but the *actions* half of the same
  worked layout was never checked against the actual rendered page.

All four are added to the Progress Tracker above as `Not Started`, each with the
specific file-level evidence for why it isn't done. None reopen or downgrade
EXPERIENCE-P0-03 (still `Done`) or any other existing row — per this backlog's own
established pattern (e.g. EXPERIENCE-P0-07 was split out as its own new story
rather than reopening the `Done` EXPERIENCE-P0-01.1), a specifically-scoped gap in a
PRD worked layout gets its own new row instead. All four are P0: each is either
explicitly listed under the doc's own "## P0 Screens" heading (§34) or is acceptance
detail for a worked layout this backlog's own EXPERIENCE-P0-03 text already treats
as P0 ("specified in enough detail... to build directly") — not a judgment call
toward P1/P2 under CLAUDE.md §3's "when unsure, treat as scope creep" guidance,
since there is no real ambiguity here about tier. Any UI built for these four
stories must reuse existing `modules/ui/*` primitives (`Card`, `Badge`,
`ConfirmActionDialog`, `DataTable`, etc.) per CLAUDE.md §13 — none of them require a
new component pattern; EXPERIENCE-P0-11 specifically should use the already-declared
`reactflow` dependency rather than introducing a second graph library.

No ownership-map change is needed: all four are presentation-layer composition over
already-published contracts (Foundation's tenant actions for P0-10, Access Agent's
existing graph endpoint for P0-11, Identity's existing lifecycle/ownership contract
for P0-12, Risk's existing finding/remediation contract plus Access's exception
concept for P0-13) — no new table, route, or shared type.

## P1

Saved views/filters. Bulk actions beyond single-item decisions. Keyboard-shortcut
power-user mode.

Additions from the 2026-09-14 requirements refresh (`08_UI_UX.md` UX-P1-03,
UX-P1-04 — UX-P1-01 "Saved Views" and UX-P1-02 "Bulk Governance" already match the
items above, so no duplicate entry was added for them):

- Natural-language command search across agents/findings/access paths, with every
  result linking to the authoritative structured record rather than standing alone
  as an LLM-generated answer (non-negotiable #9).
- Personalization: role-aware dashboard defaults, user-configurable table columns,
  and a density preference (compact/comfortable).

Added from the `08_UI_UX.md` §38 addendum (UX-P1-05, UX-P1-06):

- **Design-system component inventory** — a documented, versioned catalog of every
  `modules/ui/*` primitive (props, variants, states, usage examples) so domain
  modules consume a known surface instead of re-deriving component shape from
  reading source. Depends on the EXPERIENCE-P0-09 technology-foundation question
  being resolved first (cataloging a component set that may still change is wasted
  work).
- **Visual regression / responsive QA harness** — automated screenshot-diff
  coverage across the seven named breakpoints (`docs/design/UI-UX-DESIGN-RULES.md`
  §32) and both themes, to catch layout/token regressions before they ship, rather
  than relying solely on manual spot-checks (this session's sandbox constraint noted
  throughout the audit log).

Note: dark mode is **P0**, not P1 — see EXPERIENCE-P0-01.0 and `CLAUDE.md` §13. This
is unchanged by the `08_UI_UX.md` §38 addendum's UX-P0-14, which is flagged as a
conflict (EXPERIENCE-P0-09) rather than accepted.

## P2

Added from the 2026-09-14 requirements refresh (`08_UI_UX.md` UX-P2-01 through
UX-P2-03) — strategic scope, not to be built ahead of P0/P1:

- **Investigation Workspace** — a multi-pane workspace combining the access graph,
  runtime timeline, evidence and findings for one agent, with persistent
  investigation state across a session.
- **Advanced Graph Exploration** — filter the effective-access graph by identity,
  application, entitlement, resource, policy, runtime and risk dimensions, with an
  accessible tabular fallback for anything the graph view can't render accessibly.
- **Executive Command Center** — a high-level risk-posture/certification-health/
  rogue-trend/coverage/remediation-outcome view for executive stakeholders, without
  losing the ability to drill down into evidence.

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. Its
P0-24 ("Customer Governance UX") expands the Governance Dashboard's metric
set and the Agent Detail tab list (adding Governance/Certifications/
Policies/Compliance/Findings tabs beyond today's four-tab `AgentTabs`) —
but every one of those surfaces reads data from a concept that doesn't
exist yet (Governance Posture, Attestation, Exceptions, Drift — all open
decisions, see the reconciliation doc). Not added as a new row: this
module's own `EXPERIENCE-P0-10` through `-13` (Not Started) already cover
the concrete, buildable-today UI gaps; the governance-tab expansion is a
forward pointer for once those upstream concepts land, not new scope to
build blind against.

### EXPERIENCE-P0-14 — AI-Assisted Investigation UI (decision resolved 2026-09-15, later same day)

The user answered via `AskUserQuestion`: **start now, read-only summaries
only.** Surfaces Foundation Agent's new `lib/ai/` primitive
(`FOUNDATION-P0-16`) as a UI affordance — e.g. a "Summarize" action on a
finding, an evidence bundle, or a SHOULD/CAN/DID comparison, rendering the
returned text clearly labeled as AI-generated/advisory (never presented as
a fact or a decision) and always next to, never instead of, the
authoritative structured data it summarizes. No natural-language query box
across the whole app yet (that's the existing, correctly-P1
`UX-P1` search item) — this is the narrower "summarize what I'm already
looking at" affordance the resolved decision scoped. Blocked on
`FOUNDATION-P0-16` existing first. **Not started.**

## DO NOT IMPLEMENT

- Any business logic, authorization decision, or data mutation beyond calling an
  existing module's published API/service function.
- Platform Admin UI (Platform Agent).
- New database tables of any kind.
