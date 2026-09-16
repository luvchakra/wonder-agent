import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { isPlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { selectTenantAction, signOutAction } from "@/app/actions/tenant";
import { Nav, type NavGroup } from "@/modules/ui/Nav";
import { AccountPanel } from "@/modules/ui/AccountPanel";
import { WorkspaceSwitcher } from "@/modules/ui/WorkspaceSwitcher";
import { Logo } from "@/modules/ui/Logo";
import { ShellGlobalSearch, ShellNotifications } from "@/modules/ui/ShellSearchAndNotifications";
import { AnnouncementsBanner } from "@/modules/ui/AnnouncementsBanner";
import { getActiveAnnouncements } from "@/modules/platform-admin/service";

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", href: "/", icon: "LayoutDashboard" },
  {
    label: "AI Identity",
    href: "/agents",
    icon: "Bot",
    children: [{ label: "Agents", href: "/agents" }],
  },
  {
    label: "Access Governance",
    href: "/access",
    icon: "ShieldCheck",
    children: [
      { label: "Effective Access", href: "/access" },
      { label: "Access Requests", href: "/access/requests" },
      { label: "Policies", href: "/policies" },
    ],
  },
  {
    label: "Runtime Assurance",
    href: "/runtime",
    icon: "Activity",
    children: [{ label: "Activity & SHOULD/CAN/DID", href: "/runtime" }],
  },
  {
    label: "Risk & Compliance",
    href: "/risk",
    icon: "ShieldAlert",
    children: [
      { label: "Risk Findings", href: "/risk" },
      { label: "Rogue Agents", href: "/risk/rogue" },
      { label: "Certifications", href: "/compliance/campaigns" },
    ],
  },
  {
    label: "Integrations",
    href: "/integrations",
    icon: "Plug",
    children: [{ label: "Connected Systems", href: "/integrations" }],
  },
  { label: "Search", href: "/search", icon: "Search" },
  {
    label: "Audit & Reports",
    href: "/reports",
    icon: "ClipboardList",
    children: [
      { label: "Reports", href: "/reports" },
      { label: "Audit Trail", href: "/audit" },
    ],
  },
  { label: "Administration", href: "/settings", icon: "Settings" },
];

// EXPERIENCE-P0-01.1. The one shared customer-facing shell every domain
// module's pages mount into (app/(customer)/* — a Next.js route group, so
// URLs are unaffected). The customer layout never grants or checks
// Platform Administration access itself — CLAUDE.md non-negotiable #3 —
// it only asks the separate, service-role-backed isPlatformAdmin() gate
// (lib/rbac/requirePlatformAdmin.ts) whether to *show* the account menu's
// "Admin console" link (UX-004), matching the same never-a-customer-role
// check /platform-admin's own routes already enforce.
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const ctx = await getTenantContext();
  if (!ctx.tenantId) redirect("/onboarding");

  // Independent reads, fetched in parallel (CLAUDE.md §15 — no sequential
  // waterfalls for a page's independent data).
  const [{ data: profile }, { data: memberships }, isAdmin, announcements] = await Promise.all([
    supabase.from("users").select("display_name").eq("id", user.id).maybeSingle<{ display_name: string | null }>(),
    // Tenant-switcher list: the user's own active memberships, RLS-scoped —
    // read directly here (display-only, not a mutation) since Foundation
    // publishes getTenantContext() for the *current* tenant but not a
    // "list all my memberships" contract; flagged in the audit log.
    supabase
      .from("tenant_memberships")
      .select("tenant_id, tenants(name, slug)")
      .eq("status", "active")
      .returns<{ tenant_id: string; tenants: { name: string; slug: string } | null }[]>(),
    isPlatformAdmin(),
    // PLATFORM-P0-05.4 — Experience Agent's half of Platform's already-
    // published getActiveAnnouncements(): every customer page sees any
    // active global/tenant-scoped maintenance/notice banner.
    getActiveAnnouncements(ctx.tenantId),
  ]);

  const tenantOptions = (memberships ?? []).map((m) => ({
    id: m.tenant_id,
    name: m.tenants?.name ?? m.tenant_id,
    slug: m.tenants?.slug ?? "",
    current: m.tenant_id === ctx.tenantId,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      {/* EXPERIENCE-P0-05 — skip-link for keyboard/screen-reader users to
          bypass the nav and jump straight to page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="relative z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:gap-4 sm:px-6">
        {/* UX-P0-02/03 (12_ADVANCED_PRODUCT_UX_REQUIREMENTS.md), ported
            structurally from WonderArk's AppTopbar (packages/core/src/
            components/shell/app-topbar.tsx, luvchakra/founder-collab): nav
            trigger + logo + workspace switcher grouped on the left. The
            drawer's own bottom content is AccountPanel only — no tenant
            list duplicated there, the topbar's WorkspaceSwitcher is the
            only tenant-switching surface. Right group: search and
            notifications — no user avatar in the topbar. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Nav groups={NAV_GROUPS} footer={<AccountPanel email={user.email ?? ""} displayName={profile?.display_name ?? null} isPlatformAdmin={isAdmin} onSignOut={signOutAction} />} />
          <Logo />
          <WorkspaceSwitcher tenants={tenantOptions} onSelectTenant={selectTenantAction} />
        </div>
        <div className="flex items-center gap-2">
          <ShellGlobalSearch />
          <ShellNotifications />
        </div>
      </header>
      <AnnouncementsBanner announcements={announcements} />
      <main id="main-content" className="flex-1 bg-background px-4 py-6 lg:px-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
