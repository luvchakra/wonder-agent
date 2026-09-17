/**
 * The customer shell's primary navigation, as plain serializable data so
 * the server layout can compute badge counts and hand them to the client
 * sidebar / tab bar / drawer without three copies of the list.
 *
 * `badge` names a counter the layout supplies at render time (see
 * app/(customer)/layout.tsx) rather than a number, so this stays a static
 * module-level constant.
 */
export type ShellNavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: "discovery" | "risk";
  /** Also treat these prefixes as "inside" this item, for active state. */
  match?: string[];
};

export const SHELL_NAV: ShellNavItem[] = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { label: "Agents", href: "/agents", icon: "Bot", match: ["/agents"] },
  { label: "Discovery", href: "/agents/discovery", icon: "Radar", badge: "discovery" },
  { label: "Governance", href: "/policies", icon: "Scale" },
  { label: "Access & Permissions", href: "/access", icon: "KeyRound" },
  { label: "Runtime Activity", href: "/runtime", icon: "Activity" },
  { label: "Risks & Alerts", href: "/risk", icon: "ShieldAlert", badge: "risk" },
  { label: "Certification", href: "/compliance/campaigns", icon: "ClipboardCheck" },
  { label: "Audit Trail", href: "/audit", icon: "ScrollText" },
  { label: "Reports", href: "/reports", icon: "FileBarChart" },
  { label: "Integrations", href: "/integrations", icon: "Plug" },
  { label: "Settings", href: "/settings", icon: "Settings" },
];

/**
 * The five destinations the mobile tab bar exposes. "More" is not a route
 * — it opens the drawer, which carries the full list above.
 */
export const MOBILE_TABS: ShellNavItem[] = [
  { label: "Home", href: "/", icon: "Home" },
  { label: "Agents", href: "/agents", icon: "Bot", match: ["/agents"] },
  { label: "Discover", href: "/agents/discovery", icon: "Radar", badge: "discovery" },
  { label: "Alerts", href: "/risk", icon: "ShieldAlert", badge: "risk" },
];

export type ShellBadgeCounts = Partial<Record<NonNullable<ShellNavItem["badge"]>, number>>;

/**
 * Active-state rule, shared so the sidebar, the tab bar and the drawer
 * can never disagree about which item is current. "/" only matches
 * exactly; everything else matches its own subtree, except that a more
 * specific sibling (e.g. /agents/discovery) wins over its parent.
 */
export function isNavItemActive(item: ShellNavItem, pathname: string, all: ShellNavItem[]): boolean {
  if (item.href === "/") return pathname === "/";
  const inSubtree = pathname === item.href || pathname.startsWith(`${item.href}/`);
  if (!inSubtree) return false;
  return !all.some(
    (other) =>
      other.href !== item.href &&
      other.href.startsWith(`${item.href}/`) &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
  );
}
