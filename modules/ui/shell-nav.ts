/**
 * The customer shell's navigation, as plain serializable data so the server
 * layout can filter it by the viewer's permissions and compute badge counts,
 * then hand it to the client sidebar / tab bar / drawer.
 *
 * Two sidebars (owner decision, 2026-10-10):
 * - **The main sidebar** is what a member uses day to day. It starts with
 *   Home and My Access (their own requests, privacy and sign-in security),
 *   then the governance work areas. "Admin" is always its last entry.
 * - **The Admin sidebar** holds everything that administers the
 *   organization: settings, users and permissions, authentication,
 *   integrations, identity configuration, and policies. Opening Admin
 *   re-renders the sidebar with "Admin" at the top and a back button to
 *   Home. Which sidebar shows follows the page, so a link to an admin page
 *   opens the Admin sidebar too.
 *
 * Every entry names the permission its page requires (any of a list), and
 * the layout shows only what the viewer may open; Admin appears only when at
 * least one admin page does. Pages still check permissions themselves: this
 * only decides what is listed.
 *
 * Three levels: section → page, or section → group → page (the third level
 * opens as a flyout). Only pages that exist are listed (spec, "Do not expose
 * menu items whose underlying route/capability is not implemented"). Every
 * route appears once across both sidebars, so exactly one page and one
 * section can be current. `badge` names a counter the layout supplies.
 */
export type ShellNavLink = {
  label: string;
  href: string;
  /** Any one of these permissions lets the viewer open the page; none listed: every member. */
  permission?: string[];
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

const link = (label: string, href: string, ...permission: string[]): ShellNavEntry => ({
  kind: "link",
  label,
  href,
  ...(permission.length ? { permission } : {}),
});
const page = (label: string, href: string, ...permission: string[]): ShellNavLink => ({ label, href, ...(permission.length ? { permission } : {}) });
const group = (label: string, children: ShellNavLink[], icon?: string): ShellNavEntry => ({ kind: "group", label, icon, children });

/** The main sidebar: Home first, then a member's own access, then the governance work areas. */
export const SHELL_NAV: ShellNavItem[] = [
  { label: "Home", href: "/", icon: "Home" },
  {
    label: "My Access",
    href: "/access/catalog",
    icon: "UserRound",
    children: [
      link("Request Access", "/access/catalog", "access.read"),
      link("My Privacy", "/my-privacy"),
      link("Sign-in Security", "/settings/security"),
    ],
  },
  {
    label: "Identities",
    href: "/identities",
    icon: "Users",
    children: [
      link("Overview", "/identities", "identity.read"),
      link("All Identities", "/identities/all", "identity.read"),
      link("People", "/identities/humans", "identity.read"),
      link("External Identities", "/identities/external", "identity.read"),
      link("Machine Identities", "/identities/machines", "identity.read"),
      link("Lifecycle Work", "/identities/lifecycle", "identity.read"),
      link("Non-human Identities", "/agents/identities", "agent.read"),
    ],
  },
  {
    label: "Applications",
    href: "/access",
    icon: "Box",
    children: [
      link("Application Inventory", "/access", "access.read"),
      link("Discovery", "/integrations/discovery", "integration.read"),
      link("Accounts", "/access/accounts", "access.read"),
      link("Data Sources", "/access/data-sources", "access.read"),
    ],
  },
  {
    label: "Access Governance",
    href: "/access/requests",
    icon: "KeyRound",
    match: ["/access/agents"],
    children: [link("Access Requests", "/access/requests", "access.read"), link("Access Packages", "/access/packages", "access.read")],
  },
  {
    label: "Certifications",
    href: "/compliance/campaigns",
    icon: "ShieldCheck",
    match: ["/compliance"],
    children: [link("Certification Campaigns", "/compliance/campaigns", "compliance.read")],
  },
  {
    label: "Risk & Security",
    href: "/risk",
    icon: "TriangleAlert",
    badge: "risk",
    children: [link("Risk Overview", "/risk", "risk.read"), link("Investigations", "/risk/investigations", "risk.read")],
  },
  {
    label: "AI Agents",
    href: "/agents",
    icon: "Bot",
    badge: "discovery",
    children: [
      group("Agent Inventory", [page("All Agents", "/agents", "agent.read"), page("Register Agent", "/agents/new", "agent.create")], "Bot"),
      group("Agent Discovery", [page("Discovery Inbox", "/agents/discovery", "agent.read"), page("Duplicate Review", "/agents/duplicates", "agent.create")], "Search"),
      group("Agent Monitoring", [page("Runtime Activity", "/runtime", "runtime.read"), page("Rogue Agents", "/risk/rogue", "risk.read")], "Activity"),
    ],
  },
  {
    label: "Insights",
    href: "/reports",
    icon: "BarChart3",
    children: [link("Reports", "/reports", "report.read"), link("Audit Trail", "/audit", "audit.read")],
  },
];

/** The Admin sidebar: administering the organization. */
export const ADMIN_NAV: ShellNavItem[] = [
  {
    label: "Organization",
    href: "/settings",
    icon: "Building2",
    children: [
      link("Organization", "/settings", "tenant.settings"),
      link("Notifications", "/settings/notifications", "notification.manage"),
      link("AI Assistance", "/settings/ai", "ai.manage"),
      link("Billing", "/settings/billing", "billing.view"),
    ],
  },
  {
    label: "Users & Permissions",
    href: "/settings/users",
    icon: "UserCog",
    children: [
      link("Users", "/settings/users", "users.view"),
      link("Groups", "/settings/groups", "groups.view"),
      link("WonderID Roles", "/settings/roles", "roles.view", "role.manage"),
      link("Permission Catalog", "/settings/permissions", "permissions.view"),
      link("Authorization Policies", "/settings/authorization-policies", "permissions.view", "tenant.security.manage"),
    ],
  },
  {
    label: "Authentication",
    href: "/settings/sso",
    icon: "Fingerprint",
    children: [link("Single Sign-On", "/settings/sso", "sso.manage")],
  },
  {
    label: "Integrations",
    href: "/integrations",
    icon: "Link2",
    children: [
      link("Connections", "/integrations", "integration.read"),
      link("Connection Types", "/integrations/types", "integration.read"),
      link("Gateway", "/integrations/gateway", "integration.read"),
      link("Identity Sources", "/integrations/sources", "integration.read"),
      link("Pending Matches", "/integrations/correlations", "integration.read"),
      link("MCP Servers", "/integrations/mcp", "integration.read"),
      link("Sync Jobs", "/integrations/jobs", "integration.read"),
    ],
  },
  {
    label: "Identity Configuration",
    href: "/identities/attributes",
    icon: "SlidersHorizontal",
    children: [link("Identity Attributes", "/identities/attributes", "identity.manage")],
  },
  {
    label: "Policies & Compliance",
    href: "/policies",
    icon: "FileText",
    children: [
      link("Policies", "/policies", "policy.read"),
      link("Request Policies", "/access/request-policies", "access.manage"),
      link("Privacy & Data Protection", "/settings/privacy", "privacy.view"),
      link("Audit Integrity", "/audit/integrity", "audit.read"),
    ],
  },
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

/** Where "Admin" leads: the first admin page the viewer may open, or null when there is none (no Admin entry). */
export function adminLanding(adminNav: ShellNavItem[]): string | null {
  return adminNav[0]?.href ?? null;
}

/**
 * Whether a page belongs to the Admin sidebar: the section owning the
 * longest prefix of the path, across both sidebars, is an admin section.
 */
export function isAdminPath(pathname: string): boolean {
  let best = -1;
  let admin = false;
  for (const [nav, isAdmin] of [
    [SHELL_NAV, false],
    [ADMIN_NAV, true],
  ] as const) {
    for (const item of nav) {
      const len = bestPrefix(sectionPrefixes(item), pathname);
      if (len > best) {
        best = len;
        admin = isAdmin;
      }
    }
  }
  return admin;
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
