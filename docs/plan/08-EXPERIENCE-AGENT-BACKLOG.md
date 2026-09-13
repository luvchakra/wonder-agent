# 08 — Experience Agent Backlog

**Agent name:** `Experience Agent`
**Module:** Customer UI/UX & Product Experience
**Branch:** `module/experience`
**Status:** DORMANT — do not start until the user says "Run Experience Agent"

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
stay wide scroll within their own container.

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
testing as Tenant A while Tenant B has records in every domain table).

## P1

Dark mode. Saved views/filters. Bulk actions beyond single-item decisions.
Keyboard-shortcut power-user mode.

## DO NOT IMPLEMENT

- Any business logic, authorization decision, or data mutation beyond calling an
  existing module's published API/service function.
- Platform Admin UI (Platform Agent).
- New database tables of any kind.
