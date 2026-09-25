/**
 * The customer shell's primary navigation, as plain serializable data so
 * the server layout can compute badge counts and hand them to the client
 * sidebar / tab bar / drawer without three copies of the list.
 *
 * Structure (2026-09-25 light-console redesign, following the user's
 * mockups and the master requirements' DISCOVER → UNDERSTAND → GOVERN →
 * PROTECT → ASSURE grouping): ten sections, each with the sub-pages that
 * actually exist today. The mockups also show sub-pages with no backing
 * route yet (Shadow AI, Runtime Gateway, JIT & Credentials,
 * Emergency Controls, ...). Those are deliberately NOT listed — a nav link
 * to an empty shell would be a fabricated capability. They are tracked as
 * gaps in docs/implementation/codebase-map.md and get a link here in the
 * same commit that ships their page.
 *
 * `badge` names a counter the layout supplies at render time (see
 * app/(customer)/layout.tsx) rather than a number, so this stays a static
 * module-level constant.
 */
export type ShellNavLink = {
  label: string;
  href: string;
};

export type ShellNavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: "discovery" | "risk";
  /**
   * URL prefixes that belong to this section, for active state. Defaults
   * to the section's own href. The longest matching prefix across every
   * section wins, so /agents/discovery belongs to Discover, not Agents.
   */
  match?: string[];
  /** Sub-pages, shown under the section while it is active. */
  children?: ShellNavLink[];
};

export const SHELL_NAV: ShellNavItem[] = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  {
    label: "Discover",
    href: "/agents/discovery",
    icon: "Search",
    badge: "discovery",
    match: ["/agents/discovery", "/agents/duplicates", "/agents/identities"],
    children: [
      { label: "Agent Discovery", href: "/agents/discovery" },
      { label: "Non-human Identities", href: "/agents/identities" },
      { label: "Duplicates", href: "/agents/duplicates" },
    ],
  },
  {
    label: "Agents",
    href: "/agents",
    icon: "Bot",
    children: [
      { label: "All Agents", href: "/agents" },
      { label: "Register Agent", href: "/agents/new" },
    ],
  },
  {
    label: "Access Intelligence",
    href: "/access",
    icon: "Network",
    children: [
      { label: "Effective Access", href: "/access" },
      { label: "Access Requests", href: "/access/requests" },
    ],
  },
  {
    label: "Governance",
    href: "/policies",
    icon: "Landmark",
    match: ["/policies", "/compliance"],
    children: [
      { label: "Policies", href: "/policies" },
      { label: "Certifications", href: "/compliance/campaigns" },
    ],
  },
  { label: "Runtime Protection", href: "/runtime", icon: "ShieldCheck" },
  {
    label: "Risk & Investigations",
    href: "/risk",
    icon: "TriangleAlert",
    badge: "risk",
    children: [
      { label: "Risk Overview", href: "/risk" },
      { label: "Rogue Agents", href: "/risk/rogue" },
    ],
  },
  {
    label: "Audit & Compliance",
    href: "/audit",
    icon: "ClipboardCheck",
    match: ["/audit", "/reports"],
    children: [
      { label: "Audit Trail", href: "/audit" },
      { label: "Reports", href: "/reports" },
    ],
  },
  {
    label: "Integrations",
    href: "/integrations",
    icon: "Plug",
    children: [
      { label: "Connectors", href: "/integrations" },
      { label: "Sync Jobs", href: "/integrations/jobs" },
    ],
  },
  {
    label: "Administration",
    href: "/settings",
    icon: "Settings",
    children: [
      { label: "Organization", href: "/settings" },
      { label: "Roles & Permissions", href: "/settings/roles" },
      { label: "Security", href: "/settings/security" },
      { label: "Single Sign-On", href: "/settings/sso" },
      { label: "Notifications", href: "/settings/notifications" },
      { label: "AI Assistance", href: "/settings/ai" },
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

export type ShellBadgeCounts = Partial<Record<NonNullable<ShellNavItem["badge"]>, number>>;

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

/**
 * Active-state rule, shared so the sidebar, the tab bar and the drawer
 * can never disagree about which item is current: of all `candidates`,
 * the one owning the longest prefix of the path wins. "/" only matches
 * exactly.
 */
export function isNavItemActive(item: ShellNavItem, pathname: string, candidates: ShellNavItem[]): boolean {
  const mine = bestPrefix(item.match ?? [item.href], pathname);
  if (mine < 0) return false;
  return !candidates.some((other) => other !== item && bestPrefix(other.match ?? [other.href], pathname) > mine);
}

/** Which sub-page of an active section is current (longest href match), if any. */
export function activeChildHref(item: ShellNavItem, pathname: string): string | null {
  let best: ShellNavLink | null = null;
  for (const child of item.children ?? []) {
    if (prefixMatches(child.href, pathname) && (!best || child.href.length > best.href.length)) best = child;
  }
  return best?.href ?? null;
}
