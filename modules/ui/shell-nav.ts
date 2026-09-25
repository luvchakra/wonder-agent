/**
 * The customer shell's primary navigation, as plain serializable data so
 * the server layout can compute badge counts and hand them to the client
 * sidebar / tab bar / drawer without three copies of the list.
 *
 * WonderID information architecture (EXPERIENCE-P0-18, 2026-09-26, the
 * user's WonderID mockups and specification §2): sections in the order
 * Home, My Access, Identities, Applications, Access Governance,
 * Certifications, Governance & Policies, Risk & Security, AI Agents,
 * Authentication, Workflows & Automation, Insights, Integrations,
 * Permissions (WonderID), Administration.
 *
 * Three levels: section → page, or section → group → page (the third
 * level opens as a flyout). Only pages that exist are listed; a section
 * with no page yet (My Access, Workflows & Automation) is left out
 * entirely. A link to an empty shell would be a fabricated capability
 * (spec, "Do not expose menu items whose underlying route/capability is
 * not implemented"). Each WonderID story adds its pages here in the same
 * commit that ships them.
 *
 * Every route appears once, so exactly one page and one section can be
 * current. `badge` names a counter the layout supplies at render time
 * (see app/(customer)/layout.tsx), so this stays a static constant.
 */
export type ShellNavLink = {
  label: string;
  href: string;
};

/** A second-level entry: a page, or a named group of pages (third level). */
export type ShellNavEntry =
  | ({ kind: "link" } & ShellNavLink)
  | { kind: "group"; label: string; icon?: string; children: ShellNavLink[] };

export type ShellNavItem = {
  label: string;
  /** The section's landing page (its first page when it has children). */
  href: string;
  icon: string;
  badge?: "discovery" | "risk";
  /**
   * Extra URL prefixes that belong to this section without a link of
   * their own (detail routes such as /access/agents/:id). The section's
   * pages count automatically.
   */
  match?: string[];
  children?: ShellNavEntry[];
};

const link = (label: string, href: string): ShellNavEntry => ({ kind: "link", label, href });
const group = (label: string, children: ShellNavLink[], icon?: string): ShellNavEntry => ({ kind: "group", label, icon, children });

export const SHELL_NAV: ShellNavItem[] = [
  { label: "Home", href: "/", icon: "Home" },
  {
    label: "Identities",
    href: "/identities",
    icon: "Users",
    children: [
      link("Overview", "/identities"),
      link("All Identities", "/identities/all"),
      link("People", "/identities/humans"),
      link("External Identities", "/identities/external"),
      link("Machine Identities", "/identities/machines"),
      link("Non-human Identities", "/agents/identities"),
    ],
  },
  {
    label: "Applications",
    href: "/access",
    icon: "Box",
    children: [link("Application Inventory", "/access"), link("Data Sources", "/access/data-sources")],
  },
  {
    label: "Access Governance",
    href: "/access/requests",
    icon: "KeyRound",
    match: ["/access/agents"],
    children: [link("Access Requests", "/access/requests")],
  },
  {
    label: "Certifications",
    href: "/compliance/campaigns",
    icon: "ShieldCheck",
    match: ["/compliance"],
    children: [link("Certification Campaigns", "/compliance/campaigns")],
  },
  {
    label: "Governance & Policies",
    href: "/policies",
    icon: "FileText",
    children: [link("Policies", "/policies")],
  },
  {
    label: "Risk & Security",
    href: "/risk",
    icon: "TriangleAlert",
    badge: "risk",
    children: [link("Risk Overview", "/risk"), link("Investigations", "/risk/investigations")],
  },
  {
    label: "AI Agents",
    href: "/agents",
    icon: "Bot",
    badge: "discovery",
    children: [
      group("Agent Inventory", [
        { label: "All Agents", href: "/agents" },
        { label: "Register Agent", href: "/agents/new" },
      ], "Bot"),
      group("Agent Discovery", [
        { label: "Discovery Inbox", href: "/agents/discovery" },
        { label: "Duplicate Review", href: "/agents/duplicates" },
      ], "Search"),
      group("Agent Monitoring", [
        { label: "Runtime Activity", href: "/runtime" },
        { label: "Rogue Agents", href: "/risk/rogue" },
      ], "Activity"),
    ],
  },
  {
    label: "Authentication",
    href: "/settings/security",
    icon: "Fingerprint",
    children: [link("Sign-in Security", "/settings/security"), link("Single Sign-On", "/settings/sso")],
  },
  {
    label: "Insights",
    href: "/reports",
    icon: "BarChart3",
    children: [link("Reports", "/reports"), link("Audit Trail", "/audit")],
  },
  {
    label: "Integrations",
    href: "/integrations",
    icon: "Link2",
    children: [link("Connectors", "/integrations"), link("MCP Servers", "/integrations/mcp"), link("Sync Jobs", "/integrations/jobs")],
  },
  {
    label: "Permissions (WonderID)",
    href: "/settings/roles",
    icon: "UserCog",
    children: [link("WonderID Roles", "/settings/roles")],
  },
  {
    label: "Administration",
    href: "/settings",
    icon: "Settings",
    children: [
      link("Organization", "/settings"),
      link("Identity Attributes", "/identities/attributes"),
      link("Notifications", "/settings/notifications"),
      link("AI Assistance", "/settings/ai"),
    ],
  },
];

/**
 * The four destinations the mobile tab bar exposes. "More" is not a route
 * — it opens the drawer, which carries the full list above.
 */
export const MOBILE_TABS: ShellNavItem[] = [
  { label: "Home", href: "/", icon: "Home" },
  { label: "Agents", href: "/agents", icon: "Bot" },
  { label: "Discover", href: "/agents/discovery", icon: "Radar", badge: "discovery", match: ["/agents/discovery", "/agents/duplicates"] },
  { label: "Risk", href: "/risk", icon: "ShieldAlert", badge: "risk" },
];

/**
 * The sidebar's collapsed/expanded choice, remembered per viewer. Defined
 * here (a plain module) rather than in the client sidebar, because a
 * constant imported from a "use client" module into a Server Component
 * arrives as a client reference, not its value.
 */
export const NAV_COOKIE = "wa_nav";

export type ShellBadgeCounts = Partial<Record<NonNullable<ShellNavItem["badge"]>, number>>;

/** Every page of a section, in order, flattened through its groups. */
export function sectionPages(item: ShellNavItem): ShellNavLink[] {
  return (item.children ?? []).flatMap((e) => (e.kind === "link" ? [{ label: e.label, href: e.href }] : e.children));
}

function prefixMatches(prefix: string, pathname: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Length of the longest of `prefixes` that contains `pathname`, or -1. */
function bestPrefix(prefixes: string[], pathname: string): number {
  let best = -1;
  for (const p of prefixes) if (prefixMatches(p, pathname) && p.length > best) best = p.length;
  return best;
}

/** The prefixes a section owns: its own href, its pages and its extra matches. */
function sectionPrefixes(item: ShellNavItem): string[] {
  return [item.href, ...sectionPages(item).map((p) => p.href), ...(item.match ?? [])];
}

/**
 * Active-state rule, shared so the sidebar, the tab bar and the drawer
 * can never disagree about which item is current: of all `candidates`,
 * the one owning the longest prefix of the path wins. "/" only matches
 * exactly.
 */
export function isNavItemActive(item: ShellNavItem, pathname: string, candidates: ShellNavItem[]): boolean {
  const mine = bestPrefix(sectionPrefixes(item), pathname);
  if (mine < 0) return false;
  return !candidates.some((other) => other !== item && bestPrefix(sectionPrefixes(other), pathname) > mine);
}

/** Which page of a section is current (longest href match), if any. */
export function activeChildHref(item: ShellNavItem, pathname: string): string | null {
  let best: ShellNavLink | null = null;
  for (const page of sectionPages(item)) {
    if (prefixMatches(page.href, pathname) && (!best || page.href.length > best.href.length)) best = page;
  }
  return best?.href ?? null;
}
