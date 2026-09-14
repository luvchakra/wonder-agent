# WonderAgent UI/UX Design Rules

## Purpose

This rule defines the mandatory UI/UX quality bar for WonderAgent.

WonderAgent is an enterprise AI Identity Governance and Runtime Assurance product. Its interface must look and behave like a mature, premium enterprise security product — not like a generic AI/SaaS starter project, admin template, dashboard kit, CRUD application, or AI-generated prototype.

Every Claude Code agent that creates or modifies UI MUST follow these rules.

---

## 1. Core Design Principles

Build interfaces that are:

- Sleek
- Elegant
- Subtle
- Professional
- Calm
- Information-dense without feeling crowded
- Highly responsive
- Accessible
- Fast to understand
- Consistent
- Enterprise-grade
- Appropriate for security, IAM, governance and risk users

The design should communicate:

> Trust, control, intelligence and clarity.

Avoid visual noise, excessive decoration, unnecessary gradients, oversized cards, childish illustrations, excessive rounded corners, and generic SaaS-template aesthetics.

---

## 2. Enterprise Quality Bar

Before completing any UI story, ask:

1. Would this look credible in front of a CISO?
2. Would an IAM architect comfortably use this every day?
3. Does it look like a mature enterprise security product?
4. Can the user understand the most important information within seconds?
5. Is the information hierarchy obvious?
6. Does it work on desktop, tablet and mobile?
7. Does it remain usable with long names and large datasets?
8. Does it avoid looking like a generic Tailwind/shadcn starter application?
9. Is every visual element serving a purpose?
10. Does the page feel polished even with little data?

If not, improve it before completing the story.

---

## 3. Responsive Design Is Mandatory

WonderAgent MUST be fully responsive.

Supported experiences:

- Large desktop
- Standard desktop/laptop
- Tablet
- Mobile

Do not simply shrink desktop UI.

### Desktop

For data-heavy screens:

- Prefer tables/proto-tables.
- Use meaningful columns.
- Use comfortable row density.
- Use sticky headers where appropriate.
- Use contextual side panels/drawers.
- Avoid unnecessary horizontal scrolling.

### Tablet

Adapt intelligently:

- Reduce secondary columns.
- Collapse navigation where appropriate.
- Reduce multi-column layouts.
- Preserve primary actions.
- Use drawers and stacked sections where useful.

### Mobile

Mobile must be a deliberate experience.

Use:

- Stacked layouts
- Compact cards
- Collapsible sections
- Bottom sheets/drawers where appropriate
- Touch-friendly controls
- Clear primary actions

Never allow:

- Text clipping
- Overlap
- Buttons outside containers
- Desktop tables destroying the layout
- Tiny unreadable text
- Fixed-width layouts
- Horizontal page overflow

Use CSS responsive behavior rather than JavaScript viewport detection wherever possible.

---

## 4. Light and Dark Mode

WonderAgent MUST support:

- Light mode
- Dark mode

Dark mode must be designed intentionally, not created by simply inverting the light theme.

Use semantic design tokens:

- background
- surface
- surface-elevated
- border
- text-primary
- text-secondary
- text-muted
- accent
- success
- warning
- danger
- info

Every component must work correctly in both themes.

Check:

- contrast
- borders
- hover states
- selected states
- disabled states
- badges
- charts
- graphs
- dialogs
- dropdowns
- tooltips
- tables

Avoid pure-white and pure-black extremes everywhere. Prefer sophisticated neutral surfaces with restrained contrast.

---

## 5. Visual Language

WonderAgent should feel like a premium combination of:

- Enterprise IAM
- Identity security
- Cybersecurity
- Governance
- Modern cloud platforms
- Intelligent security operations

It should NOT feel like:

- A consumer AI chatbot
- A CRM
- A gaming interface
- A cryptocurrency dashboard
- A template marketplace dashboard
- A basic CRUD admin panel

Prefer:

- subtle borders
- layered surfaces
- restrained shadows
- controlled contrast
- meaningful typography
- small status indicators
- clear hierarchy
- subtle motion
- purposeful whitespace

Avoid:

- huge gradient backgrounds
- excessive glassmorphism
- neon/glowing effects
- decorative blobs
- excessive shadows
- giant rounded cards
- unnecessary illustrations
- emoji as UI
- visual gimmicks

---

## 6. Layout System

Use a consistent spacing and layout system.

Maintain:

- consistent page margins
- consistent card padding
- consistent section spacing
- consistent form spacing
- consistent table density
- consistent alignment

Every screen should have intentional hierarchy:

Page
- Page header
  - Title
  - Description/context
  - Primary actions
- Key summary/KPI area
- Main content
- Secondary/contextual content

Do not fill every available space merely because it exists.

Whitespace is a design element.

---

## 7. Navigation

Maintain one consistent application navigation across modules.

Primary navigation:

- Overview
- AI Identity
  - Agents
  - Agent Lifecycle
  - Ownership
  - Agent Relationships
  - Agent Discovery
- Access Governance
  - Effective Access
  - Entitlements
  - Access Requests
  - Certifications
  - Access Violations
- Runtime Assurance
  - Activity
  - Runtime Events
  - SHOULD vs CAN vs DID
  - Anomalies
  - Rogue Agents
- Risk & Compliance
  - Risk Dashboard
  - Policies
  - Control Frameworks
  - Compliance
  - Findings
  - Evidence
- Integrations
  - Catalog
  - Connected Systems
  - Connectors
  - API / REST
  - MCP
  - Webhooks
  - Jobs
- Reports
- Administration

Do not invent a different navigation paradigm for individual modules.

---

## 8. Tables and Enterprise Data

Enterprise users may work with thousands of objects.

Tables must support serious operational use.

Where appropriate provide:

- Search
- Filtering
- Sorting
- Pagination
- Column visibility
- Density controls
- Status indicators
- Risk indicators
- Row actions
- Bulk actions
- Selection
- Export
- Loading states
- Empty states

Desktop should generally use a sophisticated table/proto-table when users need to compare records.

Mobile should transform rows into stacked cards or detail views where appropriate.

Do not create dozens of tiny columns. Prioritize information.

---

## 9. Cards

Cards must have a clear purpose.

Good uses:

- Risk summary
- Agent summary
- KPI
- Finding
- Integration status
- Certification item
- Important insight

Avoid:

> Everything is a card.

Do not place cards inside cards inside cards.

Use spacing, typography and surface hierarchy instead of borders around every piece of information.

---

## 10. Agent Detail Experience

The AI Agent is the primary entity of WonderAgent.

Agent pages should feel like enterprise identity records.

Recommended structure:

Agent Header
- Agent name
- Status
- Risk
- Owner
- Identity
- Primary actions

Tabs
- Overview
- Identity
- Ownership
- Lifecycle
- Access
- Effective Access
- Runtime
- SHOULD vs CAN vs DID
- Risk
- Certifications
- Policies
- Findings
- Audit

The most important information must appear above the fold.

---

## 11. SHOULD vs CAN vs DID

This is one of WonderAgent's defining concepts.

Never represent SHOULD, CAN and DID as three identical generic cards.

The UI must communicate:

SHOULD = approved intent and policy
CAN = effective technical capability
DID = observed runtime behavior

The user should immediately understand:

- what the agent is supposed to do
- what it can technically do
- what it actually did

When a mismatch exists, make the relationship visually obvious and evidence-backed.

---

## 12. Risk UX

Risk must be understandable, not merely colorful.

Every important risk score should have an explanation.

Example:

CRITICAL

Why:
- Agent has access outside approved contract
- CustomerDB accessed at runtime
- Owner certification is overdue

Evidence:
- 3 runtime events
- 2 effective entitlements
- 1 policy violation

Do not rely on color alone.

Combine:

- severity label
- icon/indicator
- explanatory text
- evidence
- recommended action

Use red sparingly. If everything is red, nothing feels critical.

---

## 13. Status and Severity

Use consistent status patterns:

- Active
- Pending
- Approved
- Restricted
- Suspended
- Retired
- Discovered
- Certification Due

Risk:

- Critical
- High
- Medium
- Low
- Informational

Do not invent different badge styles across pages.

---

## 14. Forms

Enterprise forms must be easy to scan.

Use:

- clear labels
- helpful descriptions
- logical grouping
- inline validation
- meaningful errors
- sensible defaults
- required-field indicators
- keyboard accessibility

Avoid one enormous form.

Example:

Agent Identity
- Name
- Description
- Type

Ownership
- Business Owner
- Technical Owner
- IAM Owner

Purpose
- Business Purpose
- Approved Data
- Approved Actions

Governance
- Risk Level
- Certification Frequency
- Expiry

---

## 15. Modals and Drawers

Prefer drawers for contextual enterprise information where users should retain their current context.

Use modals for:

- confirmation
- destructive actions
- short focused forms
- important decisions

Avoid giant modals that contain entire application pages.

Destructive actions must clearly state:

- what will happen
- what object is affected
- whether it is reversible
- required confirmation

---

## 16. Loading, Empty and Error States

Never show blank screens while data loads.

Use appropriate skeletons and progressive loading.

Empty states should explain:

1. What is missing
2. Why it matters
3. What the user can do next

Example:

No AI agents registered

Connect your IAM platform or register an agent to begin governing AI identities.

[Connect Integration] [Register Agent]

Errors must be actionable.

Bad:
> Something went wrong.

Better:

Unable to synchronize Saviynt

The connection succeeded, but the entitlement endpoint returned an authorization error.

Check the configured API permissions.

[View Integration] [Retry]

Never expose secrets, tokens or sensitive implementation details.

---

## 17. Micro-interactions

Use subtle animation for:

- hover transitions
- button feedback
- drawer transitions
- skeleton loading
- status changes
- graph transitions
- toast notifications

Avoid excessive animation, bouncing UI and attention-grabbing effects.

Animation should communicate, not decorate.

---

## 18. Typography

Use a restrained type scale.

Hierarchy:

- Page title
- Section heading
- Card heading
- Body
- Secondary text
- Metadata

Avoid excessively large headings on enterprise screens.

Long enterprise names must wrap gracefully.

Never allow text to overlap controls.

---

## 19. Accessibility

Accessibility is mandatory.

Follow WCAG-oriented practices:

- keyboard navigation
- visible focus states
- semantic HTML
- sufficient contrast
- accessible labels
- accessible dialogs
- accessible dropdowns
- accessible tables
- screen-reader-friendly status messages
- no color-only meaning
- reasonable touch targets

Do not sacrifice accessibility for aesthetics.

---

## 20. Data Visualization

Charts must answer a question.

Do not add charts merely to make a dashboard look impressive.

Useful WonderAgent visualizations include:

- Agent risk distribution
- Access growth
- Runtime activity
- SHOULD/CAN/DID comparison
- Violations over time
- Certification status
- Integration health
- Effective access paths
- Agent relationships

Charts must:

- work in light and dark mode
- have readable labels
- have meaningful legends
- remain usable on mobile
- avoid unnecessary decoration
- use consistent semantic colors

---

## 21. Graph Visualization

Effective Access Graph and agent relationship views must prioritize comprehension.

Nodes may represent:

- Agent
- Identity
- Application
- Role
- Entitlement
- Resource
- Tool
- MCP Server
- Owner

Edges must communicate meaningful relationships.

Provide where appropriate:

- zoom
- pan
- search
- filtering
- focus on selected node
- contextual details
- sensible default zoom

Provide a usable mobile fallback.

---

## 22. Security UX

Security actions require extra clarity.

For:

- revoke access
- suspend agent
- disable integration
- change policy
- approve certification
- remediate finding

show:

- target
- current state
- proposed change
- impact
- actor
- confirmation

Prefer:

> Revoke CustomerDB Access

over:

> Apply

Consequential actions must never be hidden behind ambiguous labels.

---

## 23. Buttons and Actions

Use clear action hierarchy.

Each screen should have:

- one obvious primary action where appropriate
- secondary actions
- contextual actions
- destructive actions separated visually

Avoid multiple equally prominent actions.

Prefer specific labels:

- Register Agent
- Start Certification
- Review Access
- Revoke Access
- Run Sync
- View Evidence

instead of generic labels such as Submit, Continue or Apply.

---

## 24. Search and Filtering

Enterprise search should feel powerful but simple.

Where relevant support:

- global search
- contextual search
- filters
- saved filters
- recent searches
- clear-all
- active filter chips

Do not hide active filters behind multiple dialogs.

---

## 25. Responsive Tables / Proto-Tables

Desktop example:

Agent | Owner | Lifecycle | Risk | Access | Last Activity | Actions

Mobile example:

FinanceBot
Critical · Active

Owner
Finance Operations

Access
12 entitlements

Last Activity
2 minutes ago

[View Agent]

The mobile representation must preserve information hierarchy rather than merely shrinking the table.

---

## 26. Design Consistency

Before creating a component, search the existing application.

Reuse:

- buttons
- badges
- inputs
- tables
- dialogs
- drawers
- tabs
- cards
- typography
- spacing
- icons
- status indicators

Do not create near-duplicate components.

If a new reusable pattern is genuinely required, add it to the shared design system.

---

## 27. Avoid Generic AI UI

Do not make WonderAgent look like an AI chatbot.

AI functionality should appear as intelligent enterprise capability.

Good:

Risk Explanation
Why is this agent high risk?

[Evidence-backed explanation]

Good:

Recommended Remediation

Remove:
Snowflake / CustomerDB / READ

Reason:
Access is outside the approved agent contract.

[Review Change]

Avoid:

- giant chatbot interfaces
- excessive sparkle icons
- "Ask AI" buttons everywhere
- conversational UI for deterministic workflows
- AI-generated-looking copy

Use AI where it improves investigation, explanation and decision support.

---

## 28. Enterprise Density

WonderAgent is an operational enterprise product.

Do not optimize every screen for minimal information density.

The target is:

> High information density + excellent hierarchy + sufficient whitespace.

Experienced IAM and security users should be able to scan many relevant records quickly.

---

## 29. Real Data

Do not design only around toy examples.

Test with:

- long agent names
- long owner names
- long application names
- hundreds of entitlements
- many findings
- multiple risk levels
- missing owners
- missing data
- failed integrations
- long policy names
- empty states
- error states

The UI must remain stable.

---

## 30. No Broken Layouts

A UI story is NOT complete if there is:

- overlapping text
- clipped text that should wrap
- buttons outside containers
- broken responsive grids
- inconsistent spacing
- misaligned icons
- inaccessible controls
- horizontal page overflow
- inconsistent modal sizing
- broken dark mode
- broken tablet layout
- broken mobile layout

Fix these before committing.

---

## 31. Do Not Copy Competitors

Use mature enterprise products as inspiration for usability patterns, not as sources to copy.

Do not reproduce:

- proprietary logos
- exact layouts
- proprietary assets
- screenshots
- trademarked visual identities

WonderAgent must have its own recognizable design language.

---

## 32. Design Review Before Commit

Every UI story must perform a visual review before commit.

### Visual
- [ ] Hierarchy is clear
- [ ] Spacing is consistent
- [ ] Typography is consistent
- [ ] No unnecessary decoration
- [ ] Looks premium and enterprise-grade

### Responsive
- [ ] 1440px desktop
- [ ] 1280px laptop
- [ ] 1024px tablet landscape
- [ ] 768px tablet
- [ ] 390px mobile
- [ ] 375px mobile
- [ ] No horizontal overflow
- [ ] No clipping
- [ ] No overlap

### Themes
- [ ] Light mode
- [ ] Dark mode
- [ ] Contrast
- [ ] Status colors
- [ ] Charts/graphs

### Interaction
- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Success
- [ ] Disabled
- [ ] Hover
- [ ] Focus
- [ ] Keyboard navigation

### Data
- [ ] Long values
- [ ] Large datasets
- [ ] Missing values
- [ ] Realistic enterprise data

### Security
- [ ] No sensitive data exposed accidentally
- [ ] Authorization enforced server-side
- [ ] Destructive actions clearly confirmed

---

## 33. Mandatory Claude Code Behavior

When implementing UI:

1. Inspect existing components before creating new ones.
2. Inspect existing design tokens before choosing colors, spacing or typography.
3. Reuse the existing design system.
4. Check the module ownership map.
5. Do not modify another module's UI without an explicit shared-contract reason.
6. Implement responsive behavior from the beginning, not as a final patch.
7. Implement light and dark mode together.
8. Test realistic data, not only short placeholder strings.
9. Test loading, empty and error states.
10. Run the application and visually inspect changed screens when possible.
11. Fix console errors and layout issues before committing.
12. Do not accept "looks okay" as the quality bar.
13. If existing UI directly related to the story violates these rules, improve it as part of the story.
14. Do not perform broad visual refactors unrelated to the current story.
15. When uncertain between decorative choice and functional enterprise UX, choose functional enterprise UX.

---

## 34. Final Design Principle

Every WonderAgent screen should feel like it belongs to the same product.

The desired impression is:

> "This is a serious enterprise identity-security platform built for organizations that trust it with their AI agents."

The UI should be:

**Sleek. Elegant. Subtle. Intelligent. Responsive. Trustworthy. Enterprise-grade.**

Never:

**Generic. Template-like. Cluttered. Over-designed. Childish. Unresponsive.**
