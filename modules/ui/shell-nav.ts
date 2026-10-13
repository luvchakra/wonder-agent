/**
 * The customer shell's navigation, as plain serializable data so the server
 * layout can filter it by the viewer's permissions and compute badge counts,
 * then hand it to the client sidebar / tab bar / drawer.
 *
 * Arrangement (owner decision, 2026-10-13, from the owner's sheet
 * "WonderID: proposed navigation", industry-standard names instead of the
 * 10-10 arrangement):
 * - **The main sidebar:** Home, My Workspace (what waits on me, my own
 *   settings), Access, AI Agents, Access Reviews, Risk & Detection, Self
 *   Service (what anyone can start), then Administration last.
 * - **The Admin sidebar** (opened from Administration): Identities,
 *   Applications, Policies & Controls, Reports & Audit, Users & Roles,
 *   Integrations, Organization Settings, Privacy & Audit.
 * - An area opens its own menu in the sidebar; an area with a single page
 *   opens that page. Which area shows follows the page, so a link into an
 *   admin page shows the Admin menu.
 *
 * Every entry names the permission its page requires (any of a list), and
 * the layout shows only what the viewer may open; an area appears only when
 * at least one of its pages does, so Administration is absent for a member
 * without administration rights. Pages still check permissions themselves:
 * this only decides what is listed.
 *
 * Three levels: area → page, or area → group → page. Only pages that exist
 * are listed. A page's href is unique; two pages may share a route and
 * differ by a view in the query (My Requests and Approvals are views of the
 * requests page), and the current page is the one whose route and query
 * both match (`matchScore`). `badge` names a counter the layout supplies.
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

/** The Admin sidebar (owner decision, 2026-10-13): administering the organization, opened from Administration. */
export const ADMIN_AREA: ShellNavItem = {
  label: "Administration",
  href: "/identities",
  icon: "Settings",
  children: [
    group(
      "Identities",
      [
        page("Identity Overview", "/identities", "identity.read"),
        page("All Identities", "/identities/all", "identity.read"),
        page("Workforce", "/identities/humans", "identity.read"),
        page("External Identities", "/identities/external", "identity.read"),
        page("Non-Human Identities", "/identities/machines", "identity.read"),
        page("Accounts", "/access/accounts", "access.read"),
        page("Groups", "/settings/groups", "groups.view"),
        page("Joiner-Mover-Leaver", "/identities/lifecycle", "identity.read"),
        page("Identity Matching", "/integrations/correlations", "integration.read"),
        page("Orphaned Identities", "/identities/unowned", "identity.read"),
      ],
      "IdCard",
    ),
    group(
      "Applications",
      [
        page("Application Catalog", "/access", "access.read"),
        page("Onboarding Reviews", "/access?status=onboarding", "access.read"),
        page("Discovered Applications", "/integrations/discovery", "integration.read"),
        page("Data Sources", "/access/data-sources", "access.read"),
      ],
      "Box",
    ),
    group(
      "Policies & Controls",
      [page("Governance Policies", "/policies", "policy.read"), page("Separation of Duties Rules", "/sod", "policy.read"), page("Controls Dashboard", "/controls", "policy.read")],
      "Scale",
    ),
    group("Reports & Audit", [page("Reports", "/reports", "report.read"), page("Audit Log", "/audit", "audit.read")], "FileBarChart"),
    group(
      "Users & Roles",
      [
        page("Users", "/settings/users", "users.view"),
        page("Roles", "/settings/roles", "roles.view", "role.manage"),
        page("Permissions", "/settings/permissions", "permissions.view"),
        page("Authorization Policies", "/settings/authorization-policies", "permissions.view", "tenant.security.manage"),
        page("Single Sign-On", "/settings/sso", "sso.manage"),
        page("API Clients", "/settings/automation", "automation.manage"),
      ],
      "UserCog",
    ),
    group(
      "Integrations",
      [
        page("Connections", "/integrations", "integration.read"),
        page("Connector Library", "/integrations/types", "integration.read"),
        page("Authoritative Sources", "/integrations/sources", "integration.read"),
        page("Sync Jobs", "/integrations/jobs", "integration.read"),
        page("Connector Gateway", "/integrations/gateway", "integration.read"),
        page("MCP Servers", "/integrations/mcp", "integration.read"),
      ],
      "Link2",
    ),
    group(
      "Organization Settings",
      [
        page("Organization Profile", "/settings", "tenant.settings"),
        page("Governance Settings", "/settings/configuration", "tenant.settings", "tenant.security.manage"),
        page("Identity Attributes", "/identities/attributes", "identity.manage"),
        page("Notifications", "/settings/notifications", "notification.manage"),
        page("AI Assistance", "/settings/ai", "ai.manage"),
        page("Billing & Subscription", "/settings/billing", "billing.view"),
      ],
      "SlidersHorizontal",
    ),
    group("Privacy & Audit", [page("Privacy & Data Protection", "/settings/privacy", "privacy.view"), page("Audit Integrity", "/audit/integrity", "audit.read")], "FileText"),
  ],
};

/** The main sidebar (owner decision, 2026-10-13): Home first, Administration last. */
export const SHELL_NAV: ShellNavItem[] = [
  { label: "Home", href: "/", icon: "Home", children: [link("Dashboard", "/", "LayoutDashboard")] },
  {
    label: "My Workspace",
    href: "/access/requests?view=mine",
    icon: "UserRound",
    children: [
      link("My Requests", "/access/requests?view=mine", "ClipboardList", "access.read"),
      link("Approvals", "/access/requests?view=waiting", "ClipboardCheck", "access.read"),
      link("My Tasks", "/access/fulfilment", "Clock", "access.read"),
      link("My Privacy", "/my-privacy", "Fingerprint"),
      link("Sign-in Security", "/settings/security", "KeyRound"),
    ],
  },
  {
    label: "Access",
    href: "/access/catalog",
    icon: "KeyRound",
    children: [
      link("Request Access", "/access/catalog", "UserSearch", "access.read"),
      link("All Requests", "/access/requests", "ClipboardList", "access.read"),
      link("Provisioning Tasks", "/access/fulfilment?view=all", "Clock", "access.read"),
      link("Access Packages", "/access/packages", "Box", "access.read"),
      link("Entitlements", "/access/entitlements", "KeyRound", "access.read"),
      link("Request Policies", "/access/request-policies", "Scale", "access.manage"),
    ],
  },
  {
    label: "AI Agents",
    href: "/agents",
    icon: "Bot",
    badge: "discovery",
    children: [
      link("Agent Inventory", "/agents", "Bot", "agent.read"),
      link("Agent Discovery", "/agents/discovery", "Radar", "agent.read"),
      link("Duplicate Review", "/agents/duplicates", "Network", "agent.create"),
      link("Agent Identities", "/agents/identities", "Server", "agent.read"),
      link("Agent Activity", "/runtime", "Activity", "runtime.read"),
    ],
  },
  {
    label: "Access Reviews",
    href: "/compliance/campaigns",
    icon: "ShieldCheck",
    match: ["/compliance"],
    children: [
      link("Create Campaigns", "/compliance/campaigns?launch=1", "ClipboardList", "compliance.manage"),
      link("Review Campaigns", "/compliance/campaigns", "ClipboardCheck", "compliance.read"),
    ],
  },
  {
    label: "Risk & Detection",
    href: "/risk",
    icon: "ShieldAlert",
    badge: "risk",
    children: [
      link("Risk Dashboard", "/risk", "ShieldAlert", "risk.read"),
      link("Rogue Accounts", "/risk/rogue-accounts", "UserX", "risk.read"),
      link("Rogue Agents", "/risk/rogue", "Siren", "risk.read"),
      link("SoD Violations", "/sod/conflicts", "TriangleAlert", "audit.read"),
      link("Investigations", "/risk/investigations", "FileSearch", "risk.read"),
    ],
  },
  {
    label: "Self Service",
    href: "/access/applications/new",
    icon: "UserPlus",
    children: [link("Onboard Application", "/access/applications/new", "Box", "access.manage"), link("Register Agent", "/agents/new", "UserPlus", "agent.create")],
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

/** The area a page belongs to: the one whose page matches best (route, then view), first in order on a tie. */
export function activeArea(nav: ShellNavItem[], pathname: string, search?: string): ShellNavItem | null {
  let best: ShellNavItem | null = null;
  let bestScore = -1;
  for (const item of nav) {
    const score = sectionScore(item, pathname, search);
    if (score > bestScore) {
      bestScore = score;
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

/**
 * How well a nav href matches the current page, or -1. Its route must be a
 * prefix of the path; a query in the href (a view such as `?view=mine`)
 * must be present in the current query too. A longer route wins; on the
 * same route, a matching view wins over none.
 */
export function matchScore(href: string, pathname: string, search = ""): number {
  const q = href.indexOf("?");
  const path = q < 0 ? href : href.slice(0, q);
  if (!prefixMatches(path, pathname)) return -1;
  if (q < 0) return path.length * 2;
  const want = new URLSearchParams(href.slice(q + 1));
  const have = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [k, v] of want) if (have.get(k) !== v) return -1;
  return path.length * 2 + 1;
}

/** The best match among a section's own href, its pages and its extra prefixes. */
function sectionScore(item: ShellNavItem, pathname: string, search?: string): number {
  let best = -1;
  for (const h of [item.href, ...sectionPages(item).map((p) => p.href), ...(item.match ?? [])]) best = Math.max(best, matchScore(h, pathname, search));
  return best;
}

/**
 * Active-state rule, shared so the sidebar, the tab bar and the drawer
 * can never disagree about which item is current: of all `candidates`,
 * the one matching best (`matchScore`) wins, the first on a tie. "/" only
 * matches exactly.
 */
export function isNavItemActive(item: ShellNavItem, pathname: string, candidates: ShellNavItem[], search?: string): boolean {
  return activeArea(candidates, pathname, search) === item;
}

/** Which page of a section is current (best match, the first on a tie), if any. */
export function activeChildHref(item: ShellNavItem, pathname: string, search?: string): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const page of sectionPages(item)) {
    const score = matchScore(page.href, pathname, search);
    if (score > bestScore) {
      bestScore = score;
      best = page.href;
    }
  }
  return best;
}
