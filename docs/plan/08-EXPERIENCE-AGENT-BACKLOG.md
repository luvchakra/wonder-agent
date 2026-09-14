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
| EXPERIENCE-P0-01.0 | Design tokens & theming foundation (light/dark) | Partial — tokens/theme toggle real and working; no authenticated real-browser visual verification performed (sandbox constraint, see audit log) |
| EXPERIENCE-P0-01.1 | Shell layout | Done — every existing route moved under the shell; two missing index pages (`/risk`, `/runtime`) found and fixed |
| EXPERIENCE-P0-01.2 | Responsive behavior | Partial — nav collapses below 1024px; not manually verified at all six named widths with real screenshots |
| EXPERIENCE-P0-01.3 | Loading/empty/error states & skeleton loaders | Partial — primitives built and used on new pages; not yet retrofitted into every existing domain module page |
| EXPERIENCE-P0-02.1 | Overview dashboard cards | Done — all nine cards, real queries, parallel fetch |
| EXPERIENCE-P0-02.2 | Risk trend charts & action queue | Done |
| EXPERIENCE-P0-03 | Domain Screens (Agent/Access/Runtime/Rogue/Certification/etc.) | Partial — only new Risk/Runtime index pages built; every other domain module's existing bare page is unrestyled and the PRD's specific worked layouts (Agent Detail/Risk/Rogue) are not implemented — substantial remaining work, see audit log |
| EXPERIENCE-P0-04 | Action Safety (confirmation, scope preview, bulk-action reporting) | Not Started — new story, see Requirements Refresh below |
| EXPERIENCE-P0-05 | Accessibility Foundation (keyboard nav, focus management, ARIA, contrast) | Not Started — new story, see Requirements Refresh below |
| EXPERIENCE-P0-06 | Evidence Drawer & Investigation Deep Links | Not Started — new story, see Requirements Refresh below |
| EXPERIENCE-P0-07 | Shell Global Search & Notifications | Not Started — new story, see Requirements Refresh below |
| EXPERIENCE-P0-08 | Data Table Primitive (sort/filter/pagination/saved URL state/responsive card transform) | Not Started — new story, see Requirements Refresh below |

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
confirmation/result UX consistently. **Not started.**

### EXPERIENCE-P0-05 — Accessibility Foundation

`docs/design/UI-UX-DESIGN-RULES.md` already requires accessibility, but there is no
tracked story auditing/implementing it as a first-class deliverable: keyboard
navigation across nav/tables/dialogs, visible focus states, semantic labels and
landmark roles, accessible dialog/drawer patterns (focus trap, `Escape` to close,
labelled by/described by), WCAG AA contrast in both themes, and screen-reader-
friendly status/severity badges and tables (not color-only). Today only a handful
of `aria-label`s exist on the nav toggle; this story is to make accessibility a
verified property of `modules/ui/*` rather than incidental. **Not started.**

### EXPERIENCE-P0-06 — Evidence Drawer & Investigation Deep Links

A shared contextual side-drawer primitive (built on the existing
`@radix-ui/react-dialog` dependency, not a new library) that opens evidence
(runtime events, access-path detail, finding evidence, certification evidence)
without navigating away from — or losing scroll/filter/pagination position in —
the underlying list. Deep links (a shareable URL) into a specific evidence item
must restore that same investigation context (which list, which filters, which
item) rather than dropping the user on a bare detail page. **Not started.**

### EXPERIENCE-P0-07 — Shell Global Search & Notifications

The PRD's Enterprise Shell (§33, EXPERIENCE-P0-01.1, already `Done`) built the top
bar's logo/tenant-selector/user-menu, but not a global search entry point or a
notifications affordance — both are explicitly named in the new doc's UX-P0-01.
This is scoped as its own new story rather than reopening the `Done` P0-01.1: a
top-bar search entry point and a notifications indicator/panel, both composing
Operations Agent's published search/notifications contracts once available (a
"Not yet available" placeholder until then, per the same pattern used elsewhere in
this backlog) — Experience Agent renders, Operations Agent supplies the data and
matching logic. **Not started.**

### EXPERIENCE-P0-08 — Data Table Primitive

`modules/ui/Table.tsx` today is a bare table shell (container, head, row, cell)
with no built-in sorting, filtering, pagination or responsive card-transform
behavior — each consuming page would otherwise reinvent these. Publish a shared
data-table primitive (sortable columns, filter affordances, keyset or
limit/offset pagination controls wired to the calling page's query per `CLAUDE.md`
§15, saved-URL-state for the current sort/filter/page, and a responsive
card-transform for narrow viewports) that EXPERIENCE-P0-03's domain screens (Agent
Inventory, Access, Findings, etc.) consume instead of hand-rolling their own.
**Not started.**

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

Note: dark mode is **P0**, not P1 — see EXPERIENCE-P0-01.0 and `CLAUDE.md` §13.

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

## DO NOT IMPLEMENT

- Any business logic, authorization decision, or data mutation beyond calling an
  existing module's published API/service function.
- Platform Admin UI (Platform Agent).
- New database tables of any kind.
