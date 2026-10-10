/**
 * The customer shell's navigation, as plain serializable data so the server
 * layout can filter it by the viewer's permissions and compute badge counts,
 * then hand it to the client sidebar / tab bar / drawer.
 *
 * Arranged in areas (owner decision, 2026-10-10, after the way Saviynt
 * Identity Cloud arranges its menu; only the arrangement was taken, every
 * menu and name is WonderID's own):
 * - **The area list** is the sidebar's first level: Home, then the
 *   governance work areas, and "Admin" always last. Each area opens its own
 *   menu in the sidebar; an area with a single page opens that page.
 * - **An area's menu** shows the area's name at the top with a back arrow
 *   to the area list, then its pages. A page is a plain row; a group of
 *   pages folds open in place. Which area shows follows the page, so a link
 *   into an admin page shows the Admin menu.
 * - **Home** holds a member's day-to-day work: the dashboard, their own
 *   access (requests, privacy, sign-in security) and access governance.
 * - **Admin** holds everything that administers the organization, as
 *   groups: organization settings, users and permissions, authentication,
 *   integrations, identity configuration, and policies.
 *
 * Every entry names the permission its page requires (any of a list), and
 * the layout shows only what the viewer may open; an area appears only when
 * at least one of its pages does, so Admin is absent for a member without
 * administration rights. Pages still check permissions themselves: this
 * only decides what is listed.
 *
 * Three levels: area → page, or area → group → page. Only pages that exist
 * are listed (spec, "Do not expose menu items whose underlying
 * route/capability is not implemented"). Every route appears once, so
 * exactly one page and one area can be current. `badge` names a counter
 * the layout supplies.
 */
export type ShellNavLink = {
  label: string;
  href: string;
  /** Any one of these permissions lets the viewer open the page; none listed: every member. */
  permission?: string[];
  /** The page's icon in its area's menu (a direct page of the area; pages inside a group have none). */
  icon?: string;
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
  /** For a section without children: the permission its page requires. */
  permission?: string[];
  /**
   * Extra URL prefixes that belong to this section without a link of
   * their own (detail routes such as /access/agents/:id). The section's
   * pages count automatically.
   */
  match?: string[];
  children?: ShellNavEntry[];
};

const link = (label: string, href: string, icon: string, ...permission: string[]): ShellNavEntry => ({
  kind: "link",
  label,
  href,
  icon,
  ...(permission.length ? { permission } : {}),
});
const page = (label: string, href: string, ...permission: string[]): ShellNavLink => ({ label, href, ...(permission.length ? { permission } : {}) });
const group = (label: string, children: ShellNavLink[], icon?: string): ShellNavEntry => ({ kind: "group", label, icon, children });

/**
 * The Admin area: administering the organization, always the last area.
 * Its four object lists come first as its own pages (owner request,
 * 2026-10-10); identities, applications and policies are groups inside it.
 */
export const ADMIN_AREA: ShellNavItem = {
  label: "Admin",
  href: "/access/accounts",
  icon: "Settings",
  children: [
    link("Accounts", "/access/accounts", "IdCard", "access.read"),
    link("Entitlements", "/access/entitlements", "KeyRound", "access.read"),
    link("Roles", "/settings/roles", "UserCog", "roles.view", "role.manage"),
    link("User Groups", "/settings/groups", "Users", "groups.view"),
    link("Global Configuration", "/settings/configuration", "SlidersHorizontal", "tenant.settings", "tenant.security.manage"),
    group(
      "Identities",
      [
        page("Overview", "/identities", "identity.read"),
        page("All Identities", "/identities/all", "identity.read"),
        page("People", "/identities/humans", "identity.read"),
        page("External Identities", "/identities/external", "identity.read"),
        page("Machine Identities", "/identities/machines", "identity.read"),
        page("Lifecycle Work", "/identities/lifecycle", "identity.read"),
        page("Identity Attributes", "/identities/attributes", "identity.manage"),
      ],
      "UserRound",
    ),
    group("Applications", [page("Application Inventory", "/access", "access.read"), page("Data Sources", "/access/data-sources", "access.read")], "Box"),
    group(
      "Policies",
      [
        page("Policies", "/policies", "policy.read"),
        page("Request Policies", "/access/request-policies", "access.manage"),
        page("Authorization Policies", "/settings/authorization-policies", "permissions.view", "tenant.security.manage"),
      ],
      "Scale",
    ),
    group(
      "Organization",
      [
        page("Organization", "/settings", "tenant.settings"),
        page("Notifications", "/settings/notifications", "notification.manage"),
        page("AI Assistance", "/settings/ai", "ai.manage"),
        page("Billing", "/settings/billing", "billing.view"),
      ],
      "Building2",
    ),
    group("Users & Permissions", [page("Users", "/settings/users", "users.view"), page("Permission Catalog", "/settings/permissions", "permissions.view")], "UserCog"),
    group("Authentication", [page("Single Sign-On", "/settings/sso", "sso.manage")], "Fingerprint"),
    group(
      "Integrations",
      [
        page("Connections", "/integrations", "integration.read"),
        page("Connection Types", "/integrations/types", "integration.read"),
        page("Gateway", "/integrations/gateway", "integration.read"),
        page("Identity Sources", "/integrations/sources", "integration.read"),
        page("MCP Servers", "/integrations/mcp", "integration.read"),
        page("Sync Jobs", "/integrations/jobs", "integration.read"),
      ],
      "Link2",
    ),
    group(
      "Compliance",
      [page("Privacy & Data Protection", "/settings/privacy", "privacy.view"), page("Audit Integrity", "/audit/integrity", "audit.read")],
      "FileText",
    ),
  ],
};

/**
 * The area list (owner decisions, 2026-10-10): Home first, then
 * Intelligence, Onboarding, Control Center, SOD and Certifications, AI
 * Agents, and Admin last. Every area opens its own menu.
 */
export const SHELL_NAV: ShellNavItem[] = [
  {
    label: "Home",
    href: "/",
    icon: "Home",
    children: [
      link("Home", "/", "Home"),
      group("My Access", [page("Request Access", "/access/catalog", "access.read"), page("My Privacy", "/my-privacy"), page("Sign-in Security", "/settings/security")], "UserRound"),
      group("Access Governance", [page("Access Requests", "/access/requests", "access.read"), page("Access Packages", "/access/packages", "access.read")], "KeyRound"),
    ],
  },
  {
    label: "Intelligence",
    href: "/risk",
    icon: "BarChart3",
    badge: "risk",
    children: [
      link("Risk Overview", "/risk", "ShieldAlert", "risk.read"),
      link("Investigations", "/risk/investigations", "FileSearch", "risk.read"),
      link("Rogue Agents", "/risk/rogue", "Siren", "risk.read"),
      link("Reports", "/reports", "FileBarChart", "report.read"),
      link("Audit Trail", "/audit", "ScrollText", "audit.read"),
    ],
  },
  {
    label: "Onboarding",
    href: "/access/applications/new",
    icon: "Plug",
    badge: "discovery",
    children: [
      link("New Application", "/access/applications/new", "Box", "access.manage"),
      link("Application Discovery", "/integrations/discovery", "Radar", "integration.read"),
      link("Register Agent", "/agents/new", "UserPlus", "agent.create"),
      link("Agent Discovery", "/agents/discovery", "Search", "agent.read"),
      link("Duplicate Review", "/agents/duplicates", "Network", "agent.create"),
      link("Pending Matches", "/integrations/correlations", "Link2", "integration.read"),
    ],
  },
  {
    label: "Control Center",
    href: "/controls",
    icon: "Gauge",
    children: [link("Overview", "/controls", "LayoutDashboard", "policy.read")],
  },
  {
    label: "SOD",
    href: "/sod",
    icon: "Ban",
    children: [link("SoD Rules", "/sod", "Scale", "policy.read"), link("SoD Conflicts", "/sod/conflicts", "TriangleAlert", "audit.read")],
  },
  {
    label: "Certifications",
    href: "/compliance/campaigns",
    icon: "ShieldCheck",
    match: ["/compliance"],
    children: [link("Certification Campaigns", "/compliance/campaigns", "ClipboardCheck", "compliance.read")],
  },
  {
    label: "AI Agents",
    href: "/agents",
    icon: "Bot",
    children: [
      link("All Agents", "/agents", "Bot", "agent.read"),
      link("Non-human Identities", "/agents/identities", "Server", "agent.read"),
      link("Runtime Activity", "/runtime", "Activity", "runtime.read"),
    ],
  },
  ADMIN_AREA,
];

const allowed = (permission: string[] | undefined, permissions: ReadonlySet<string>) => !permission || permission.some((p) => permissions.has(p));

/**
 * The sections and pages this viewer may open. A section keeps only its
 * allowed pages and is left out when none remain; its href moves to its
 * first allowed page.
 */
export function navFor(nav: ShellNavItem[], permissions: readonly string[]): ShellNavItem[] {
  const has = new Set(permissions);
  const out: ShellNavItem[] = [];
  for (const item of nav) {
    if (!item.children) {
      if (allowed(item.permission, has)) out.push(item);
      continue;
    }
    const children: ShellNavEntry[] = [];
    for (const e of item.children) {
      if (e.kind === "link") {
        if (allowed(e.permission, has)) children.push(e);
      } else {
        const pages = e.children.filter((c) => allowed(c.permission, has));
        if (pages.length) children.push({ ...e, children: pages });
      }
    }
    if (!children.length) continue;
    const first = children[0].kind === "link" ? children[0].href : children[0].children[0].href;
    const pages = children.flatMap((e) => (e.kind === "link" ? [e.href] : e.children.map((c) => c.href)));
    out.push({ ...item, href: pages.includes(item.href) ? item.href : first, children });
  }
  return out;
}

/** The area a page belongs to: the one owning the longest prefix of the path, if any. */
export function activeArea(nav: ShellNavItem[], pathname: string): ShellNavItem | null {
  let best: ShellNavItem | null = null;
  let bestLen = -1;
  for (const item of nav) {
    const len = bestPrefix(sectionPrefixes(item), pathname);
    if (len > bestLen) {
      bestLen = len;
      best = item;
    }
  }
  return best;
}

/** Whether a page belongs to the Admin area (across the whole area list, so a member's own page under /settings does not). */
export function isAdminPath(pathname: string): boolean {
  return activeArea(SHELL_NAV, pathname)?.label === ADMIN_AREA.label;
}

/** A page found by the sidebar's menu search, with where it lives. */
export type NavMatch = { label: string; href: string; trail: string[] };

/**
 * The sidebar's menu search: every page whose name, group or area
 * contains each word of the query, in menu order. It searches the menu
 * only, never the data; the header's search (Ctrl+K) does that.
 */
export function searchNav(nav: ShellNavItem[], query: string, limit = 12): NavMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: NavMatch[] = [];
  for (const area of nav) {
    const entries: { label: string; href: string; trail: string[] }[] = area.children
      ? area.children.flatMap((e) => (e.kind === "link" ? [{ label: e.label, href: e.href, trail: [area.label] }] : e.children.map((c) => ({ label: c.label, href: c.href, trail: [area.label, e.label] }))))
      : [{ label: area.label, href: area.href, trail: [] }];
    for (const e of entries) {
      const hay = [e.label, ...e.trail].join(" ").toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push(e);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

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
