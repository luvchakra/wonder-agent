import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { getProfile, getSessionUser } from "@/lib/tenant/session";
import { getMyMemberships, getTenantContext } from "@/lib/tenant/getTenantContext";
import { isPlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { selectTenantAction, signOutAction } from "@/app/actions/tenant";
import { getHostTenant, urlForTenant } from "@/lib/tenant/hostTenant";
import { getFindings } from "@/modules/risk/service";
import { AppSidebar, MobileNavDrawer, MobileNavTrigger } from "@/modules/ui/AppSidebar";
import { MobileTabBar } from "@/modules/ui/MobileTabBar";
import { AccountPanel } from "@/modules/ui/AccountPanel";
import { ShellGlobalSearch, ShellNotifications } from "@/modules/ui/ShellSearchAndNotifications";
import { AnnouncementsBanner } from "@/modules/ui/AnnouncementsBanner";
import { getActiveAnnouncements } from "@/modules/platform-admin/service";
import { NAV_COOKIE, type ShellBadgeCounts } from "@/modules/ui/shell-nav";
import { brandTitle, wonderIdBrand } from "@/modules/ui/brand";
import { WonderIDLogo } from "@/modules/ui/Logo";

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
// Layout (WonderID, EXPERIENCE-P0-18, 2026-09-26): a dark navy sidebar
// from `lg` up (expanded accordion or collapsed icon rail with flyouts),
// and a slim page header beside it (search, notifications, help, then the
// account menu with name and role). Below `lg` a bottom tab bar whose
// "More" slot opens the same navigation as a drawer. See
// modules/ui/AppSidebar.tsx.
// Organization switching lives only at the foot of the rail (user
// decision, 2026-09-18: a header chip duplicated it).
//
// Data: the session check is local (lib/tenant/session.ts) and the tenant
// context, membership list and platform-admin check are all request-cached,
// so the page rendering beside this layout reuses them instead of
// repeating them. Everything below is one parallel wave of queries.
// BRAND-005/§18 — organization-first tab titles inside the product:
// "ACME · Agents · WonderID". Reuses the request-cached tenant context and
// membership list, so it costs no extra query.
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getTenantContext();
  const name = ctx.tenantId ? (await getMyMemberships()).find((m) => m.tenantId === ctx.tenantId)?.name : null;
  if (!name) return {};
  // `absolute`: the root layout's "WonderID · %s" template must not wrap it.
  return { title: { absolute: brandTitle(null, name), template: `${name} · %s · ${wonderIdBrand.name}` } };
}

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    // FOUNDATION-P0-22 — on an organization's own address there is nothing
    // to create or pick: the user either belongs there or has no access.
    const host = await getHostTenant();
    redirect(host.target.kind === "subdomain" || host.target.kind === "invalid" ? "/no-access" : "/onboarding");
  }

  const [profile, memberships, isAdmin, announcements, openFindings, cookieStore] = await Promise.all([
    getProfile(),
    // Already resolved by getTenantContext() above — the cache hands back
    // the same promise, so this costs nothing.
    getMyMemberships(),
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
    // EXPERIENCE-P0-18: the sidebar's collapsed/expanded choice, so the
    // server renders the width the user left it at.
    cookies(),
  ]);

  // FOUNDATION-P0-22 — each organization's own address, so the rail always shows where you are.
  const tenantUrls = await Promise.all(memberships.map((m) => (m.slug ? urlForTenant(m.slug) : Promise.resolve(null))));
  const tenantOptions = memberships.map((m, i) => ({
    id: m.tenantId,
    name: m.name,
    slug: m.slug,
    current: m.tenantId === ctx.tenantId,
    url: tenantUrls[i],
  }));

  const badges: ShellBadgeCounts = { risk: openFindings.length };
  const sidebarUser = {
    email: user.email ?? "",
    displayName: profile?.displayName ?? null,
    roleLabel: humanizeRole(ctx.roles[0]),
    isPlatformAdmin: isAdmin,
  };
  const shellProps = {
    badges,
    tenants: tenantOptions,
    onSelectTenant: selectTenantAction,
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

      <AppSidebar {...shellProps} initialCollapsed={cookieStore.get(NAV_COOKIE)?.value === "collapsed"} />
      <MobileNavDrawer {...shellProps} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:gap-3 lg:px-6">
          <MobileNavTrigger />
          {/* BRAND-004/§54 — below lg the rail is hidden, so the header carries the W mark. */}
          <Link href="/" aria-label="WonderID home" className="flex shrink-0 items-center rounded-md lg:hidden">
            <WonderIDLogo showWordmark={false} size={26} alt="" />
          </Link>
          <div className="min-w-0 max-w-xl flex-1">
            <ShellGlobalSearch />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <ShellNotifications />
            <Link
              href="/help"
              aria-label="Get Help"
              className="hidden size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:flex"
            >
              <CircleHelp className="size-5" aria-hidden="true" />
            </Link>
            <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <AccountPanel
              email={sidebarUser.email}
              displayName={sidebarUser.displayName}
              subtitle={sidebarUser.roleLabel}
              isPlatformAdmin={sidebarUser.isPlatformAdmin}
              onSignOut={signOutAction}
            />
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
