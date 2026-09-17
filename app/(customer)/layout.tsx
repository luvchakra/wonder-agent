import { redirect } from "next/navigation";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { isPlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { selectTenantAction, signOutAction } from "@/app/actions/tenant";
import { getFindings } from "@/modules/risk/service";
import { AppSidebar, MobileNavDrawer, MobileNavTrigger } from "@/modules/ui/AppSidebar";
import { MobileTabBar } from "@/modules/ui/MobileTabBar";
import { WorkspaceSwitcher } from "@/modules/ui/WorkspaceSwitcher";
import { Avatar } from "@/modules/ui/Avatar";
import { ShellGlobalSearch, ShellNotifications } from "@/modules/ui/ShellSearchAndNotifications";
import { AnnouncementsBanner } from "@/modules/ui/AnnouncementsBanner";
import { getActiveAnnouncements } from "@/modules/platform-admin/service";
import type { ShellBadgeCounts } from "@/modules/ui/shell-nav";

/** `TENANT_SUPER_ADMIN` → `Tenant Super Admin`, for the sidebar's user block. */
function humanizeRole(role: string | undefined): string | null {
  if (!role) return null;
  return role
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// EXPERIENCE-P0-01.1. The one shared customer-facing shell every domain
// module's pages mount into (app/(customer)/* — a Next.js route group, so
// URLs are unaffected). The customer layout never grants or checks
// Platform Administration access itself — CLAUDE.md non-negotiable #3 —
// it only asks the separate, service-role-backed isPlatformAdmin() gate
// (lib/rbac/requirePlatformAdmin.ts) whether to *show* the account menu's
// "Admin console" link (UX-004), matching the same never-a-customer-role
// check /platform-admin's own routes already enforce.
//
// Layout: a permanent navy navigation rail from `lg` up with a slim page
// header beside it (search, notifications, help, organization, account),
// and below `lg` a bottom tab bar whose "More" slot opens the same rail
// as a drawer. See modules/ui/AppSidebar.tsx.
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
  const [{ data: profile }, { data: memberships }, isAdmin, announcements, openFindings] = await Promise.all([
    supabase.from("users").select("display_name").eq("id", user.id).maybeSingle<{ display_name: string | null }>(),
    // Tenant-switcher list: the user's own active memberships, RLS-scoped —
    // read directly here (display-only, not a mutation) since Foundation
    // publishes getTenantContext() for the *current* tenant but not a
    // "list all my memberships" contract; flagged in the audit log.
    supabase
      .from("tenant_memberships")
      .select("tenant_id, tenants(name, slug)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .returns<{ tenant_id: string; tenants: { name: string; slug: string } | null }[]>(),
    isPlatformAdmin(),
    // PLATFORM-P0-05.4 — Experience Agent's half of Platform's already-
    // published getActiveAnnouncements(): every customer page sees any
    // active global/tenant-scoped maintenance/notice banner.
    getActiveAnnouncements(ctx.tenantId),
    // Nav badge for "Risks & Alerts" — Risk Agent's own published
    // contract, one indexed query. The matching "Discovery" badge is
    // deliberately NOT wired up: the only published source for it,
    // buildDiscoveryInbox(), scans every agent and identity on each call,
    // and paying that on every page render would break CLAUDE.md §15. It
    // needs a cheap count contract from the Identity Agent first —
    // recorded in the Experience audit log rather than worked around.
    getFindings(ctx.tenantId, { status: "open" }),
  ]);

  const tenantOptions = (memberships ?? []).map((m) => ({
    id: m.tenant_id,
    name: m.tenants?.name ?? m.tenant_id,
    slug: m.tenants?.slug ?? "",
    current: m.tenant_id === ctx.tenantId,
  }));

  const badges: ShellBadgeCounts = { risk: openFindings.length };
  const sidebarUser = {
    email: user.email ?? "",
    displayName: profile?.display_name ?? null,
    roleLabel: humanizeRole(ctx.roles[0]),
    isPlatformAdmin: isAdmin,
  };
  const shellProps = {
    badges,
    tenants: tenantOptions,
    user: sidebarUser,
    onSelectTenant: selectTenantAction,
    onSignOut: signOutAction,
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* EXPERIENCE-P0-05 — skip-link for keyboard/screen-reader users to
          bypass the nav and jump straight to page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <AppSidebar {...shellProps} />
      <MobileNavDrawer {...shellProps} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:gap-3 lg:px-6">
          <MobileNavTrigger />
          <div className="min-w-0 max-w-xl flex-1">
            <ShellGlobalSearch />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <ShellNotifications />
            <Link
              href="/reports"
              aria-label="Help and reporting"
              className="hidden size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:flex"
            >
              <CircleHelp className="size-5" aria-hidden="true" />
            </Link>
            <WorkspaceSwitcher tenants={tenantOptions} onSelectTenant={selectTenantAction} />
            <span className="hidden lg:inline-flex">
              <Avatar name={sidebarUser.displayName} email={sidebarUser.email} size="sm" />
            </span>
          </div>
        </header>

        <AnnouncementsBanner announcements={announcements} />

        {/* The bottom tab bar is fixed, so the page reserves room under its
            content (plus the home indicator) rather than letting the last
            row sit behind it. */}
        <main
          id="main-content"
          className="flex-1 px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-10"
        >
          <div className="mx-auto w-full max-w-[1560px]">{children}</div>
        </main>
      </div>

      <MobileTabBar badges={badges} />
    </div>
  );
}
