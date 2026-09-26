# WonderID — Brand Identity & Application-Wide Branding Implementation Specification

**Document:** WonderID Brand System & Application Branding Requirements  
**Product:** WonderID — AI Identity Security & Agent Control Plane  
**Purpose:** Implement the approved WonderID visual identity consistently across the entire application  
**Base App URL:** `Base App URL`  
**Implementation target:** Existing WonderID web application  
**Primary UI direction:** Light enterprise security-console experience  
**Status:** Implementation-ready

---

# 1. Executive Summary

WonderID is an enterprise identity-security platform governing:

- Human identities
- AI agents
- Non-human identities
- Applications
- Access
- Runtime authorization
- Governance
- Risk
- Audit and compliance

The brand should communicate:

```text
Trust
Identity
Security
Intelligence
Modern enterprise technology
Human + AI identity
```

The approved visual direction uses a distinctive **W identity mark** with a central human/identity form.

The primary visual system consists of:

- WonderID wordmark
- W identity symbol
- Deep Navy
- Electric Blue
- Sky Blue
- Violet
- Slate
- Mist
- Clean white surfaces
- Light enterprise-security-console UI
- Compact, highly legible typography
- Restrained use of gradients
- Strong blue interaction states

The branding must be implemented as a reusable design system rather than manually styling individual pages.

---

# 2. Brand Identity

## 2.1 Brand Name

Always display the product name as:

```text
WonderID
```

Correct:

```text
WonderID
```

Incorrect:

```text
Wonder Id
Wonder-ID
WonderID™
Wonder Identity
WONDERID
```

Unless a specific technical/legal context requires uppercase text, use the canonical casing:

```text
WonderID
```

---

# 3. Brand Meaning

The W symbol should represent:

```text
W = Wonder
ID = Identity
```

The visual identity should communicate that WonderID governs identities across both human and AI environments.

The central identity form in the logo can be interpreted as:

```text
Human identity
Identity
Agent
Trust
Access
```

Do not add explanatory text around the logo in normal product UI.

---

# 4. Primary Brand Lockup

The preferred horizontal lockup is:

```text
[ WonderID W Mark ] WonderID
```

The W mark appears to the left of the wordmark.

The wordmark uses:

```text
Wonder
```

in the primary dark text color and:

```text
ID
```

in the primary blue brand treatment.

Recommended conceptual treatment:

```text
WonderID
^^^^^^  ^^
dark    blue
```

Do not manually recreate the wordmark with arbitrary fonts if official logo assets are available.

---

# 5. Tagline

The approved brand messaging shown with the identity system is:

```text
IDENTITIES • AGENTS • ACCESS • SECURITY
```

Use the tagline in:

- Marketing landing pages
- Brand guidelines
- Login/tenant entry experience where appropriate
- Presentation materials
- Product splash/loading experience where useful

Do **not** place the tagline beneath the logo in every application screen.

The application navigation should prioritize product usability over decorative branding.

---

# 6. Secondary Brand Message

The brand board also supports:

```text
Secure Every Identity.
Human and AI.
```

This may be used as a product/marketing statement.

Recommended usage:

- Login page
- Marketing website
- Empty state for the main platform
- Security overview
- Presentation/marketing surfaces

Do not use it as a replacement for the WonderID product name.

---

# 7. Logo System

The implementation must support these logo variants.

## 7.1 Primary Full-Color Logo — Light Background

Use on:

```text
White
Mist
Very light gray/blue
Light application surfaces
```

Composition:

```text
[W Mark] WonderID
```

The W mark uses the approved blue/cyan/violet visual treatment.

The wordmark uses dark navy with blue `ID`.

---

## 7.2 Full-Color Logo — Dark Background

Use on:

```text
Deep Navy
Dark authentication surfaces
Marketing hero sections
Dark footer sections
```

Composition:

```text
[W Mark] WonderID
```

The wordmark should use a light/white treatment where necessary while retaining the blue `ID` accent.

---

## 7.3 Symbol-Only Logo

Use when the wordmark is unnecessary or insufficient space exists.

Examples:

- Browser favicon
- Mobile app icon
- Compact sidebar
- Avatar-like product mark
- Loading indicator
- Small navigation surfaces

Symbol:

```text
W + central identity form
```

Do not use an arbitrary `W` text character as a substitute.

---

## 7.4 Monochrome Dark

Use on:

```text
White backgrounds
Print
Documents
High-contrast situations
```

---

## 7.5 Monochrome Light

Use on:

```text
Deep Navy
Black/dark media
Dark presentation surfaces
```

---

# 8. Required Asset Set

The repository should contain a dedicated brand asset directory.

Recommended:

```text
/public/brand/
```

Structure:

```text
/public/brand/
  logo/
    wonderid-logo.svg
    wonderid-logo-dark.svg
    wonderid-logo-light.svg
    wonderid-mark.svg
    wonderid-mark-dark.svg
    wonderid-mark-light.svg
    wonderid-monochrome.svg
    wonderid-monochrome-light.svg

  favicon/
    favicon.svg
    favicon-16.png
    favicon-32.png
    apple-touch-icon.png

  social/
    wonderid-og.png
    wonderid-twitter.png

  product/
    wonderid-login.png
```

Prefer SVG for logos.

Do not use rasterized screenshots of the logo inside the application.

---

# 9. Logo Technical Requirements

SVG logos must:

- Use vector paths.
- Have no unnecessary embedded raster images.
- Scale cleanly.
- Work on retina/high-density screens.
- Preserve aspect ratio.
- Support light and dark backgrounds.
- Have accessible alternative text when rendered as an image.
- Avoid inline styles that conflict with application theming.

Where possible, use CSS-controlled color variants only if this does not alter the approved mark.

---

# 10. Clear Space

Maintain clear space around the logo.

Use:

```text
X = width of the central identity circle/form unit
```

Minimum clear space:

```text
Top       ≥ X
Bottom    ≥ X
Left      ≥ X
Right     ≥ X
```

Do not allow:

- Text
- Icons
- Borders
- Buttons
- Cards
- Images

to visually collide with the mark.

---

# 11. Minimum Size

For the symbol:

```text
Desktop:
minimum practical size ≈ 24 px

Mobile:
minimum practical size ≈ 24 px
```

For the complete horizontal logo:

```text
Prefer ≥ 100–120 px width
```

Do not render the full lockup so small that `WonderID` becomes illegible.

At very small sizes, use the mark only.

---

# 12. Logo Placement

## Application Header

Preferred:

```text
[ W Mark / WonderID ]   [Tenant / Workspace]   [Search] [Notifications] [Account]
```

The logo should anchor the navigation.

Do not create a huge marketing-style logo in the application header.

Recommended desktop height:

```text
56 px
```

Logo visual height:

```text
24–30 px
```

---

# 13. Sidebar Branding

Desktop sidebar:

```text
┌─────────────────────────┐
│ [W] WonderID            │
│                         │
│ Overview                │
│                         │
│ DISCOVER                │
│  Discovery              │
│  AI Inventory           │
│  NHI Inventory          │
│  Shadow AI              │
│                         │
│ UNDERSTAND              │
│  Agents                 │
│  Access Intelligence   │
│                         │
└─────────────────────────┘
```

Expanded sidebar:

```text
[W Mark] WonderID
```

Collapsed sidebar:

```text
[W Mark]
```

The collapsed state must use the actual WonderID mark.

---

# 14. Login Experience

The login experience is one of the most important brand surfaces.

Recommended structure:

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    [WonderID Logo]                           │
│                                                             │
│                    Sign in to WonderID                       │
│                                                             │
│             Secure access for every identity.               │
│                                                             │
│        Work email                                          │
│        ┌───────────────────────────────────────┐             │
│        │ you@company.com                       │             │
│        └───────────────────────────────────────┘             │
│                                                             │
│        [ Continue ]                                         │
│                                                             │
│                         or                                  │
│                                                             │
│        [ Continue with SSO ]                                │
│                                                             │
│        IDENTITIES • AGENTS • ACCESS • SECURITY              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

For tenant-specific login:

```text
ACME Corporation

Sign in to WonderID
```

The tenant identity should be visible.

---

# 15. Tenant Branding

WonderID supports tenant-specific branding while preserving the WonderID master identity.

Tenant may configure:

```text
Organization Name
Organization Logo
Primary Brand Color
Login Message
Custom Domain
```

However:

```text
WonderID
```

must remain identifiable as the platform.

Tenant branding must not overwrite the core WonderID identity in a way that creates ambiguity.

Recommended login:

```text
[Customer Logo]

ACME Corporation
Secure access powered by WonderID
```

or:

```text
[WonderID]
ACME Corporation

Sign in to your organization
```

---

# 16. Tenant URL Branding

The application must consistently support:

```text
https://<tenant-slug>.Base App URL
```

Example:

```text
https://acme.Base App URL
```

The browser title may use:

```text
ACME Corporation · WonderID
```

Generic product title:

```text
WonderID · AI Identity Security
```

---

# 17. Browser Favicon

Use the WonderID W identity mark.

Requirements:

```text
16 × 16
32 × 32
48 × 48
180 × 180 Apple Touch
```

The favicon must remain recognizable at small sizes.

Do not use the full wordmark as favicon.

---

# 18. Browser Tab Titles

Use a consistent convention:

```text
WonderID
WonderID · Dashboard
WonderID · Agents
WonderID · Access Intelligence
WonderID · Governance
WonderID · Runtime Protection
WonderID · Risk & Investigations
WonderID · Audit & Compliance
WonderID · Administration
```

Tenant-aware:

```text
ACME · Agents · WonderID
```

---

# 19. Brand Color System

The approved brand board establishes the following primary colors.

## Deep Navy

```text
#08122C
```

Purpose:

```text
Primary dark text
Dark backgrounds
Brand depth
Dark logo presentation
```

---

## Electric Blue

```text
#2538FF
```

Purpose:

```text
Primary brand
Primary CTA
Links
Active navigation
Focus
Primary interaction
```

---

## Sky Blue

```text
#06B6DA
```

Purpose:

```text
Accent
Secondary highlights
Identity/runtime visualizations
Data visualization accents
```

---

## Violet

```text
#8B5CF6
```

Purpose:

```text
AI
Advanced intelligence
Premium/advanced states
Secondary visualization
```

Use sparingly.

---

## Slate

```text
#94A3B8
```

Purpose:

```text
Secondary UI
Borders
Metadata
Disabled states
Supporting text
```

---

## Mist

```text
#F1F5F9
```

Purpose:

```text
Page background
Secondary surfaces
Input background where appropriate
Subtle containers
```

---

# 20. Existing Application Design Tokens

The WonderID application already uses a light enterprise design language.

The brand implementation must preserve the existing design philosophy:

- White cards
- Soft gray-blue background
- Clean blue accent
- Subtle borders
- Minimal shadows
- Compact enterprise UI
- Strong information hierarchy

Do not replace the application's established usability-oriented tokens with marketing gradients.

The brand colors should be mapped into the existing design-token architecture.

---

# 21. Recommended Semantic Color Tokens

Use semantic tokens rather than hardcoding hex values throughout components.

Example:

```css
:root {
  --brand-navy: #08122C;
  --brand-blue: #2538FF;
  --brand-sky: #06B6DA;
  --brand-violet: #8B5CF6;
  --brand-slate: #94A3B8;
  --brand-mist: #F1F5F9;
}
```

Then map to application semantics:

```css
--color-brand-primary: var(--brand-blue);
--color-brand-secondary: var(--brand-sky);
--color-brand-ai: var(--brand-violet);

--color-text-primary: var(--brand-navy);
--color-text-secondary: #475569;

--color-surface-page: var(--brand-mist);
--color-surface-card: #FFFFFF;
--color-border: #E2E8F0;
```

Do not scatter:

```css
#2538FF
```

through individual components.

---

# 22. Tailwind Integration

If the application uses Tailwind, expose semantic tokens.

Example conceptual configuration:

```text
brand:
  navy
  blue
  sky
  violet
  slate
  mist

semantic:
  primary
  secondary
  ai
  surface
  border
  foreground
```

Components should preferably use:

```text
bg-primary
text-primary
border-border
text-muted-foreground
```

rather than raw brand hex values.

---

# 23. shadcn/ui Integration

The existing shadcn/ui components should remain the foundation.

Branding should be applied through:

```text
CSS variables
+
semantic tokens
+
component variants
```

Do not fork every shadcn component simply to add WonderID colors.

---

# 24. Buttons

Primary button:

```text
Electric Blue background
White text
```

Example:

```text
[ + Create Agent ]
```

Hover:

```text
Slightly darker blue
```

Focus:

```text
Visible accessible focus ring
```

Secondary:

```text
White/light surface
Blue or navy text
Subtle border
```

Destructive:

```text
Use semantic destructive red
```

Do not replace security/destructive colors with WonderID blue.

---

# 25. Links

Normal links:

```text
Electric Blue
```

Hover:

```text
Darker blue
```

Visited links should remain sufficiently distinguishable without creating inconsistent branding.

---

# 26. Navigation

Active navigation:

```text
Blue accent
Soft blue-tinted background
Bold/medium text
```

Example:

```text
┌─────────────────────────────┐
│ ● Agents                    │
└─────────────────────────────┘
```

Do not use strong gradient backgrounds for normal navigation.

---

# 27. AI Visual Language

Violet should have a specific semantic role.

Use violet for:

```text
AI
AI explanations
AI-assisted investigation
AI recommendations
Advanced intelligence
```

Do not use violet randomly as a decorative color.

Example:

```text
AI Insight
[ violet AI icon ]
```

The AI color should not imply that an AI recommendation is authoritative.

Security decisions remain deterministic.

---

# 28. Identity Visual Language

Blue/cyan should represent:

```text
Identity
Access
Authentication
Runtime authorization
Connectivity
```

Example:

```text
Agent Identity
● Active

Identity mapped to:
Saviynt
```

---

# 29. Risk Visual Language

Risk must remain semantically distinct from brand colors.

Recommended:

```text
Critical → destructive/red
High     → orange
Medium   → amber
Low      → blue/neutral
Info     → blue
```

Do not make every risk state blue simply because blue is the WonderID brand color.

---

# 30. Success and Status

Use standard semantic colors:

```text
Success → green
Warning → amber
Error → red
Info → blue
```

Brand blue is not a replacement for semantic status colors.

---

# 31. Cards

Default:

```text
background: white
border: subtle gray
radius: existing application radius
shadow: minimal
```

Brand accent may appear as:

```text
small icon
top border
status indicator
metric accent
```

Avoid large blue gradient cards throughout the application.

---

# 32. Dashboard Branding

The dashboard should use WonderID brand identity subtly.

Header:

```text
WonderID
AI Identity Security & Agent Control Plane
```

Metrics:

```text
AI Agents
NHI Identities
Applications
Open Findings
Runtime Decisions
High-Risk Agents
```

Use the brand palette consistently in charts.

Do not make every chart a different random color.

---

# 33. Product Module Visual Identity

Maintain the five product pillars:

```text
DISCOVER
UNDERSTAND
GOVERN
PROTECT
ASSURE
```

Recommended visual semantics:

```text
DISCOVER
Blue / Sky

UNDERSTAND
Blue / Cyan

GOVERN
Navy / Blue

PROTECT
Blue / Violet accents

ASSURE
Navy / Violet / semantic risk colors
```

These are not separate brands.

The WonderID logo remains the parent identity.

---

# 34. Agent 360 Branding

Agent 360 should be visually unmistakable as a WonderID security object.

Example:

```text
┌──────────────────────────────────────────────┐
│ [Agent icon] Customer Support Agent          │
│ ● ACTIVE             HIGH RISK               │
│                                              │
│ Owner: John Smith                            │
│ Purpose: Resolve customer support cases     │
└──────────────────────────────────────────────┘
```

Use blue/cyan for identity and connection information.

Use semantic risk colors for risk.

---

# 35. Runtime Protection Branding

Runtime Gateway should feel like a security control plane, not a generic networking product.

Example:

```text
RUNTIME PROTECTION

Gateway Status
● Operational

Runtime Decisions
  12,482 Allowed
  182 Denied
  31 Approval Required
```

Use:

```text
Blue → normal authorization
Green → allowed/success
Red → denied/security violation
Amber → approval required
```

---

# 36. Login Background

The logo board demonstrates a clean enterprise login experience.

Recommended:

```text
Light background
Subtle architectural/security visual
White authentication card
WonderID logo
Minimal decorative elements
```

Do not use overly futuristic or cyberpunk imagery.

The product should feel trustworthy and enterprise-ready.

---

# 37. Empty States

Empty states should include the WonderID visual identity subtly.

Example:

```text
[ W mark ]

No agents discovered yet

Connect your identity or runtime sources
to begin discovering AI agents.

[ Connect Integration ]
```

Do not use the full large logo in every empty state.

---

# 38. Loading State

Use the W mark as the branded loading identity where appropriate.

Preferred:

```text
[ W mark ]
Loading WonderID...
```

For normal in-app loading, use standard skeletons rather than repeatedly displaying the logo.

---

# 39. Error Pages

Example:

```text
[ W mark ]

Something went wrong

WonderID could not complete this request.

[ Try Again ]
[ Return to Dashboard ]
```

Do not make error pages overly decorative.

---

# 40. 404 Page

Example:

```text
[ W mark ]

Page not found

The page you're looking for doesn't exist
or you don't have access to it.

[ Return to Dashboard ]
```

Do not reveal whether a resource exists in another tenant.

---

# 41. Authentication Error

Example:

```text
Sign-in unavailable

Your organization currently does not allow
this authentication method.

Contact your WonderID administrator.
```

Use the brand identity while maintaining security-neutral messaging.

---

# 42. Email Branding

All WonderID system emails should use:

```text
WonderID logo
WonderID name
Deep Navy
Electric Blue
White
Mist
```

Examples:

```text
You have been invited to ACME Corporation on WonderID
Your access review is due
A runtime security policy was triggered
Your account was suspended
New high-risk agent discovered
```

Email footer:

```text
WonderID
IDENTITIES • AGENTS • ACCESS • SECURITY
```

Where legally/commercially required, include company/legal information separately.

---

# 43. Email CTA

Primary CTA:

```text
Electric Blue button
White text
```

Example:

```text
[ Open WonderID ]
```

The URL must use the correct tenant URL:

```text
https://acme.Base App URL/...
```

Never use a generic tenant URL when the email is tenant-specific.

---

# 44. Notification Branding

In-app notifications should use the WonderID icon system.

Examples:

```text
● Agent approval required
● Runtime policy blocked an action
● Access certification due
● New agent discovered
```

Do not use the full logo inside every notification.

---

# 45. Reports and Evidence

Generated reports should include:

```text
WonderID logo
Report title
Tenant name
Report date
Classification if configured
```

Example:

```text
[WonderID]

AI Agent Security Posture Report

ACME Corporation
26 September 2026
```

Footer:

```text
Generated by WonderID
```

---

# 46. PDF / Evidence Branding

Evidence packages should maintain consistent:

```text
Header
Logo
Document title
Tenant
Generated timestamp
Page numbers
Footer
```

Branding must never obscure audit evidence.

---

# 47. Charts

Charts should use a controlled WonderID palette.

Preferred sequence:

```text
Electric Blue
Sky Blue
Violet
Navy
Slate
```

Semantic states:

```text
Success
Warning
Critical
```

must use semantic colors.

Charts must remain accessible to users with color-vision deficiencies.

---

# 48. Data Visualization Rules

Never encode critical information using color alone.

For example:

Bad:

```text
red = denied
green = allowed
```

Better:

```text
✕ Denied
✓ Allowed
```

with color as reinforcement.

---

# 49. Typography

Use the application's existing modern system sans/Geist-style typography.

Recommended hierarchy:

```text
Page Title
20–28 px

Section Heading
16–20 px

Card Heading
14–16 px

Body
14 px

Dense table text
13–14 px

Metadata
12–13 px
```

Do not introduce a second unrelated font family.

---

# 50. Wordmark Typography

The official logo asset must be used for the brand wordmark.

Do not reproduce:

```text
WonderID
```

with an arbitrary application font and treat it as the official logo.

The application can use normal text:

```text
WonderID
```

in places where a logo is unnecessary, but branded lockups must use the approved logo asset.

---

# 51. Iconography

Use the existing application icon library consistently.

Recommended characteristics:

- Simple
- Line-based
- Enterprise
- Compact
- Consistent stroke width

Do not mix:

```text
3D icons
Emoji
Random SVG styles
Illustrative icons
```

inside normal navigation.

---

# 52. W Mark as Product Icon

Use the W mark for:

```text
favicon
app icon
sidebar collapsed state
loading identity
browser icon
system notification identity
avatar placeholder
```

Do not use it as a generic icon for unrelated actions.

---

# 53. Avatar Placeholder

When a user has no avatar, do not automatically use a giant WonderID logo.

Prefer:

```text
Initials
```

Example:

```text
PS
```

The WonderID mark should remain product identity rather than user identity.

---

# 54. Mobile Branding

Mobile header:

```text
[W] WonderID          [Menu]
```

or compact:

```text
[W]                   [Profile]
```

The W mark must remain legible.

Do not use the full horizontal logo where it causes navigation compression.

---

# 55. Responsive Behavior

Desktop:

```text
Full logo
Persistent sidebar
Dense navigation
```

Tablet:

```text
Full/compact logo
Collapsible navigation
```

Mobile:

```text
W mark
Drawer navigation
Compact header
```

The brand must remain visually consistent across all breakpoints.

---

# 56. Dark Mode

The current application design is light-first.

If dark mode is supported later, the WonderID logo system must include the approved dark-background version.

Dark mode should use:

```text
Deep Navy
dark surface variants
Electric Blue
Sky Blue
Violet
light text
```

Do not automatically invert the light logo.

Use the approved dark-background logo asset.

---

# 57. Accessibility

Brand implementation must meet WCAG-oriented accessibility requirements.

Requirements:

- Text contrast must remain accessible.
- Blue text on white must be tested.
- Violet must not be the only indicator.
- Risk states must use icons/text as well as color.
- Logo images must have meaningful alt text when informational.
- Decorative logos must use empty alt text where appropriate.
- Focus states must be visible.
- Keyboard navigation must remain unaffected.
- Reduced-motion preferences must be respected.

---

# 58. Motion

The brand may use subtle motion.

Good uses:

```text
Logo entrance
Page transition
Loading identity
Interactive graph transitions
```

Avoid:

```text
Continuous logo animation
Pulsing everywhere
Large particle effects
Excessive gradients
```

Enterprise security applications should feel stable and controlled.

---

# 59. Brand Gradient

The logo itself contains a multi-color blue/cyan/violet visual treatment.

Gradients should primarily remain inside branded assets.

For application UI, use gradients sparingly.

Approved conceptual gradient:

```text
Electric Blue
     ↓
Sky Blue
     ↓
Violet
```

Do not use this gradient as the default background for:

- Tables
- Forms
- Navigation
- Buttons
- Cards

---

# 60. Marketing vs Product Branding

Separate the two.

## Marketing

Can use:

```text
large W mark
gradient
dark navy hero
large typography
brand imagery
tagline
```

## Product

Should use:

```text
small W mark
white cards
light background
blue interaction
dense information
subtle brand accents
```

The application should feel like a premium enterprise security console rather than a marketing website.

---

# 61. Tenant Administration Branding

Tenant administrators should see:

```text
WonderID
ACME Corporation
```

in the application shell.

The tenant name should never replace the WonderID identity entirely.

Correct:

```text
[W] WonderID
ACME Corporation
```

Incorrect:

```text
ACME Security Platform
```

unless the tenant explicitly configures a custom branded experience in a future feature.

---

# 62. Platform Administration Branding

Platform administrators should see:

```text
WonderID
Platform Administration
```

Platform UI may use the brand more strongly than tenant UI because it is the product-owner control plane.

---

# 63. Administration Permission UI Branding

The permission management experience should follow the same design system.

Example:

```text
Administration

Users
Groups
Roles
Permissions
Authentication
Security
Audit
```

Use blue for:

```text
active state
primary actions
links
selected permissions
```

Use semantic colors for:

```text
suspended
dangerous
denied
expired
```

---

# 64. Permission Chips

Recommended:

```text
agents.view
agents.approve
runtime.view
audit.export
```

as compact neutral/blue chips.

Privileged permission:

```text
runtime.kill_switch
```

may use an elevated/destructive visual indicator.

---

# 65. Security Warnings

Example:

```text
⚠ This role grants runtime policy publishing access.
```

The warning should use the existing warning semantic color.

Do not use brand violet or blue to represent danger.

---

# 66. Product Screens to Update

The branding implementation must cover all major surfaces.

## Global

- Application shell
- Header
- Sidebar
- Mobile navigation
- Account menu
- Tenant switcher
- Command palette
- Notifications
- Loading
- Error pages
- 404

## DISCOVER

- Discovery
- AI Inventory
- NHI Inventory
- Shadow AI
- MCP & Tools
- Models
- Applications
- Data Sources

## UNDERSTAND

- Agents
- Agent 360
- Access Intelligence
- Access Graph
- Delegation
- Effective Access

## GOVERN

- Registration
- Ownership
- Lifecycle
- Policies
- Approvals
- Certifications
- Exceptions

## PROTECT

- Runtime Gateway
- Authorization
- Tool & MCP Control
- JIT & Credentials
- Data Protection
- Emergency Controls

## ASSURE

- Runtime Activity
- Risk
- Findings
- Investigations
- Behavioral Security
- Evidence
- Audit

## ADMINISTRATION

- Users
- Groups
- Roles
- Permissions
- Authentication
- Security
- Audit
- Tenant Settings

---

# 67. Branding Architecture

Implement a centralized brand provider/configuration.

Conceptual:

```typescript
export const wonderIdBrand = {
  name: "WonderID",

  tagline: "IDENTITIES • AGENTS • ACCESS • SECURITY",

  colors: {
    navy: "#08122C",
    blue: "#2538FF",
    sky: "#06B6DA",
    violet: "#8B5CF6",
    slate: "#94A3B8",
    mist: "#F1F5F9",
  },

  assets: {
    logo: "/brand/logo/wonderid-logo.svg",
    logoDark: "/brand/logo/wonderid-logo-dark.svg",
    logoLight: "/brand/logo/wonderid-logo-light.svg",
    mark: "/brand/logo/wonderid-mark.svg",
    favicon: "/brand/favicon/favicon.svg",
  },
};
```

Do not duplicate these values across pages.

---

# 68. Brand Component

Create a reusable:

```text
<WonderIDLogo />
```

component.

Props should conceptually support:

```text
variant
size
showWordmark
showTagline
className
alt
```

Example:

```tsx
<WonderIDLogo
  variant="default"
  size="md"
  showWordmark
/>
```

Compact:

```tsx
<WonderIDLogo
  variant="default"
  size="sm"
  showWordmark={false}
/>
```

Dark:

```tsx
<WonderIDLogo
  variant="dark"
/>
```

---

# 69. Logo Component Rules

The component must:

- Preserve aspect ratio.
- Select appropriate asset.
- Support responsive sizes.
- Avoid layout shift.
- Work in SSR.
- Work in Next.js App Router.
- Avoid unnecessary client-side JavaScript.
- Provide accessible labeling.
- Support tenant-independent WonderID identity.
- Never accept arbitrary external logo URLs for the core WonderID logo.

---

# 70. Tenant Logo Component

Create a separate:

```text
<TenantLogo />
```

Do not mix it with:

```text
<WonderIDLogo />
```

This keeps platform identity and customer identity separate.

---

# 71. Brand Configuration

Brand constants should be centrally managed.

Suggested:

```text
src/config/brand.ts
```

or the equivalent existing project location.

Asset paths:

```text
/public/brand
```

Do not introduce a second brand configuration file.

---

# 72. Design Token Migration

Implementation should:

1. Identify existing hardcoded colors.
2. Map them to semantic tokens.
3. Replace brand-related hardcoded values.
4. Preserve semantic status colors.
5. Preserve accessibility.
6. Remove duplicate token definitions.

Do not perform an uncontrolled global color replacement.

---

# 73. Existing UI Compatibility

The brand implementation must preserve the current WonderID UI requirements:

- Light theme
- White cards
- Soft gray-blue background
- Subtle borders
- Minimal shadows
- Modern sans typography
- Compact enterprise UI
- shadcn/ui
- Tailwind
- Responsive behavior

Branding is an enhancement to the existing design system, not a reason to redesign every screen.

---

# 74. Brand QA

Create a brand QA checklist.

## Logo

- [ ] Correct logo asset
- [ ] Correct light variant
- [ ] Correct dark variant
- [ ] Correct mark
- [ ] Correct favicon
- [ ] No distorted logo
- [ ] No manually recreated wordmark
- [ ] Clear space maintained

## Color

- [ ] Brand tokens centralized
- [ ] Primary blue consistent
- [ ] Navy consistent
- [ ] Sky blue consistent
- [ ] Violet used intentionally
- [ ] Semantic status colors preserved
- [ ] Contrast tested

## UI

- [ ] Header branded
- [ ] Sidebar branded
- [ ] Login branded
- [ ] Tenant context visible
- [ ] Dashboard branded
- [ ] All major modules consistent
- [ ] Administration consistent
- [ ] Mobile consistent

---

# 75. Visual Regression

Add visual regression coverage for:

```text
Login
Dashboard
Sidebar expanded
Sidebar collapsed
Agent 360
Runtime Gateway
Risk dashboard
Users
Roles
Permission catalog
Tenant settings
Mobile navigation
```

Brand changes must not cause unintended layout regressions.

---

# 76. Automated Checks

Where possible, add automated checks for:

```text
brand asset existence
logo rendering
favicon existence
CSS token existence
page title convention
contrast-sensitive components
```

---

# 77. Do Not Do

Do not:

- Replace the W mark with a text W.
- Stretch or distort the logo.
- Rotate the logo.
- Add arbitrary shadows.
- Add arbitrary outlines.
- Change logo colors.
- Place the logo on visually noisy backgrounds without sufficient contrast.
- Use violet for normal actions merely because it is a brand color.
- Use gradients on every card.
- Turn the security console into a marketing page.
- Hide tenant identity.
- Allow tenant branding to obscure WonderID identity.
- Use color as the only security/status indicator.
- Hardcode brand colors throughout components.

---

# 78. Implementation Stories

## BRAND-001 — Brand Asset Foundation

**Priority:** P0

Create:

```text
/public/brand/logo
/public/brand/favicon
/public/brand/social
```

Acceptance:

- Required SVG assets exist.
- Correct variants exist.
- Favicon works.
- Assets render at required sizes.

---

## BRAND-002 — Central Brand Configuration

**Priority:** P0

Create a single WonderID brand configuration.

Acceptance:

- Brand colors are centralized.
- Logo asset paths are centralized.
- Product name is centralized.
- Tagline is centralized.
- No duplicate brand configuration.

---

## BRAND-003 — WonderID Logo Component

**Priority:** P0

Implement:

```text
<WonderIDLogo />
```

Acceptance:

- Light/dark variants.
- Mark-only mode.
- Responsive sizing.
- Accessible.
- No layout shift.

---

## BRAND-004 — Application Shell

**Priority:** P0

Update:

```text
Header
Sidebar
Mobile Header
Account Menu
```

Acceptance:

- WonderID identity appears consistently.
- Collapsed sidebar uses W mark.
- Header dimensions remain stable.
- Tenant context remains visible.

---

## BRAND-005 — Login Branding

**Priority:** P0

Update login and authentication surfaces.

Acceptance:

- WonderID logo.
- Tagline where appropriate.
- Light enterprise visual style.
- Tenant identity.
- Correct browser title.
- Responsive layout.

---

## BRAND-006 — Design Tokens

**Priority:** P0

Implement:

```text
Navy
Electric Blue
Sky Blue
Violet
Slate
Mist
```

as centralized tokens.

Acceptance:

- Components consume semantic tokens.
- No uncontrolled hardcoded brand colors.
- Existing semantic colors preserved.

---

## BRAND-007 — Core UI Components

**Priority:** P0

Apply brand tokens to:

```text
buttons
links
tabs
navigation
inputs
cards
badges
dialogs
dropdowns
tables
pagination
```

Acceptance:

- Consistent states.
- Accessible contrast.
- No visual regressions.

---

## BRAND-008 — Product Modules

**Priority:** P0

Apply brand system to:

```text
Discover
Understand
Govern
Protect
Assure
```

Acceptance:

- All modules look like one product.
- Brand hierarchy is consistent.
- Module colors do not become separate brands.

---

## BRAND-009 — Administration Branding

**Priority:** P0

Update:

```text
Users
Groups
Roles
Permissions
Authentication
Security
Audit
Tenant Settings
```

Acceptance:

- Consistent WonderID identity.
- Permission states readable.
- Security warnings use semantic colors.

---

## BRAND-010 — Email Branding

**Priority:** P1

Apply brand identity to system email templates.

Acceptance:

- Logo.
- Colors.
- CTA.
- Tenant-aware links.
- Footer.
- Responsive rendering.

---

## BRAND-011 — Reports and Evidence

**Priority:** P1

Apply brand to:

```text
PDF reports
Evidence packages
Exports
```

Acceptance:

- Logo.
- Tenant.
- Report metadata.
- Page numbering.
- Consistent footer.

---

## BRAND-012 — Visual Regression

**Priority:** P0

Create screenshot tests for key screens.

Acceptance:

- Light theme baseline.
- Desktop.
- Mobile.
- Login.
- Administration.
- Agent 360.
- Runtime.
- Dashboard.

---

# 79. Recommended Implementation Order

```text
1. Add official brand assets
        ↓
2. Add centralized brand configuration
        ↓
3. Add CSS/design tokens
        ↓
4. Build WonderIDLogo component
        ↓
5. Update application shell
        ↓
6. Update authentication/login
        ↓
7. Update shared shadcn components
        ↓
8. Update dashboards and core modules
        ↓
9. Update Administration
        ↓
10. Update tenant branding
        ↓
11. Update email/reporting
        ↓
12. Run accessibility QA
        ↓
13. Run visual regression
        ↓
14. Remove duplicate/hardcoded branding
```

---

# 80. Final Brand Architecture

```text
                    WONDERID
                       │
          ┌────────────┴────────────┐
          │                         │
       BRAND                     PRODUCT
          │                         │
    ┌─────┼─────┐          ┌───────┼────────┐
    │     │     │          │       │        │
   W    Colors  Type     Discover Understand Govern
   │                      Protect  Assure
   │
   ├── Full Logo
   ├── Mark
   ├── Favicon
   └── Dark/Light variants
```

---

# 81. Final Visual Principle

WonderID should look:

```text
Trusted
Modern
Precise
Secure
Intelligent
Enterprise-ready
```

It should **not** look:

```text
Cyberpunk
Overly futuristic
Gaming-oriented
Consumer-social
Overly colorful
Marketing-heavy
```

The logo provides the personality.

The application provides the trust.

---

# 82. Definition of Done

Brand implementation is complete when:

```text
WonderID logo
        ↓
Central brand configuration
        ↓
Design tokens
        ↓
Application shell
        ↓
Authentication
        ↓
All product modules
        ↓
Administration
        ↓
Tenant experience
        ↓
Notifications
        ↓
Reports
        ↓
Mobile
        ↓
Accessibility
        ↓
Visual regression
```

all use one coherent WonderID design system.

The final product experience should make the relationship immediately clear:

```text
WonderID
IDENTITIES • AGENTS • ACCESS • SECURITY
```

while retaining the dense, professional interaction model required for an enterprise identity-security control plane.
