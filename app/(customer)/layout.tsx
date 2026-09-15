import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { isPlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { selectTenantAction, signOutAction } from "@/app/actions/tenant";
import { Nav, type NavGroup } from "@/modules/ui/Nav";
import { AccountPanel } from "@/modules/ui/AccountPanel";
import { WorkspaceSwitcher } from "@/modules/ui/WorkspaceSwitcher";
import { ShellGlobalSearch, ShellNotifications } from "@/modules/ui/ShellSearchAndNotifications";

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", href: "/", icon: "◧" },
  {
    label: "AI Identity",
    href: "/agents",
    icon: "◈",
    children: [{ label: "Agents", href: "/agents" }],
  },
  {
    label: "Access Governance",
    href: "/access",
    icon: "◇",
    children: [
      { label: "Effective Access", href: "/access" },
      { label: "Access Requests", href: "/access/requests" },
      { label: "Policies", href: "/policies" },
    ],
  },
  {
    label: "Runtime Assurance",
    href: "/runtime",
    icon: "◎",
    children: [{ label: "Activity & SHOULD/CAN/DID", href: "/runtime" }],
  },
  {
    label: "Risk & Compliance",
    href: "/risk",
    icon: "▲",
    children: [
      { label: "Risk Findings", href: "/risk" },
      { label: "Rogue Agents", href: "/risk/rogue" },
      { label: "Certifications", href: "/compliance/campaigns" },
    ],
  },
  {
    label: "Integrations",
    href: "/integrations",
    icon: "⬡",
    children: [{ label: "Connected Systems", href: "/integrations" }],
  },
  { label: "Search", href: "/search", icon: "🔍" },
  {
    label: "Audit & Reports",
    href: "/reports",
    icon: "▤",
    children: [
      { label: "Reports", href: "/reports" },
      { label: "Audit Trail", href: "/audit" },
    ],
  },
  { label: "Administration", href: "/settings", icon: "⚙" },
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
  const [{ data: profile }, { data: memberships }, isAdmin] = await Promise.all([
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
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-background px-4 lg:px-6">
        {/* EXPERIENCE-P0-09 (UX-P0-15), UX-P0-02/03 — left group: nav
            trigger, logo, and the current tenant (a full switcher lives at
            the top of the nav drawer — WorkspaceSwitcher — and again in
            AccountPanel, not a separate topbar control). Right group:
            search and notifications only — no user avatar. */}
        <div className="flex items-center gap-3">
          <Nav
            groups={NAV_GROUPS}
            topSwitcher={<WorkspaceSwitcher tenants={tenantOptions} onSelectTenant={selectTenantAction} />}
            footer={
              <AccountPanel
                email={user.email ?? ""}
                displayName={profile?.display_name ?? null}
                tenants={tenantOptions}
                isPlatformAdmin={isAdmin}
                onSelectTenant={selectTenantAction}
                onSignOut={signOutAction}
              />
            }
          />
          <Link href="/" className="text-sm font-semibold text-foreground">
            WonderAgent
          </Link>
          <span className="hidden text-xs text-muted-foreground sm:inline">/ {ctx.tenantSlug}</span>
        </div>
        <div className="flex items-center gap-2">
          <ShellGlobalSearch />
          <ShellNotifications />
        </div>
      </header>
      <main id="main-content" className="flex-1 bg-background px-4 py-6 lg:px-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
