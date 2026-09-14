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
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. This
agent is dormant; every story is Not Started until "Run Experience Agent" is
issued.

| Story | Title | Status |
|---|---|---|
| EXPERIENCE-P0-01.0 | Design tokens & theming foundation (light/dark) | Not Started |
| EXPERIENCE-P0-01.1 | Shell layout | Not Started |
| EXPERIENCE-P0-01.2 | Responsive behavior | Not Started |
| EXPERIENCE-P0-01.3 | Loading/empty/error states & skeleton loaders | Not Started |
| EXPERIENCE-P0-02.1 | Overview dashboard cards | Not Started |
| EXPERIENCE-P0-02.2 | Risk trend charts & action queue | Not Started |
| EXPERIENCE-P0-03 | Domain Screens (Agent/Access/Runtime/Rogue/Certification/etc.) | Not Started |

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

## P1

Saved views/filters. Bulk actions beyond single-item decisions. Keyboard-shortcut
power-user mode.

Note: dark mode is **P0**, not P1 — see EXPERIENCE-P0-01.0 and `CLAUDE.md` §13.

## DO NOT IMPLEMENT

- Any business logic, authorization decision, or data mutation beyond calling an
  existing module's published API/service function.
- Platform Admin UI (Platform Agent).
- New database tables of any kind.
