import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { selectTenantAction, signOutAction } from "@/app/actions/tenant";
import { Nav, type NavGroup } from "@/modules/ui/Nav";
import { UserMenu } from "@/modules/ui/UserMenu";
import { ShellGlobalSearch, ShellNotifications } from "@/modules/ui/ShellSearchAndNotifications";

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", href: "/" },
  {
    label: "AI Identity",
    href: "/agents",
    children: [{ label: "Agents", href: "/agents" }],
  },
  {
    label: "Access Governance",
    href: "/access",
    children: [
      { label: "Effective Access", href: "/access" },
      { label: "Access Requests", href: "/access/requests" },
      { label: "Policies", href: "/policies" },
    ],
  },
  {
    label: "Runtime Assurance",
    href: "/runtime",
    children: [{ label: "Activity & SHOULD/CAN/DID", href: "/runtime" }],
  },
  {
    label: "Risk & Compliance",
    href: "/risk",
    children: [
      { label: "Risk Findings", href: "/risk" },
      { label: "Certifications", href: "/compliance/campaigns" },
    ],
  },
  {
    label: "Integrations",
    href: "/integrations",
    children: [{ label: "Connected Systems", href: "/integrations" }],
  },
  { label: "Reports", href: "/reports" },
  { label: "Administration", href: "/settings" },
];

// EXPERIENCE-P0-01.1. The one shared customer-facing shell every domain
// module's pages mount into (app/(customer)/* — a Next.js route group, so
// URLs are unaffected). Platform Admin is never referenced here, in any
// state, for any role — CLAUDE.md non-negotiable #3.
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const ctx = await getTenantContext();
  if (!ctx.tenantId) redirect("/onboarding");

  // Tenant-switcher list: the user's own active memberships, RLS-scoped —
  // read directly here (display-only, not a mutation) since Foundation
  // publishes getTenantContext() for the *current* tenant but not a
  // "list all my memberships" contract; flagged in the audit log.
  const { data: memberships } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants(name, slug)")
    .eq("status", "active")
    .returns<{ tenant_id: string; tenants: { name: string; slug: string } | null }[]>();

  const tenantOptions = (memberships ?? []).map((m) => ({
    id: m.tenant_id,
    name: m.tenants?.name ?? m.tenant_id,
    slug: m.tenants?.slug ?? "",
    current: m.tenant_id === ctx.tenantId,
  }));

  return (
    <div className="flex min-h-screen">
      {/* EXPERIENCE-P0-05 — skip-link for keyboard/screen-reader users to
          bypass the nav and jump straight to page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-foreground"
      >
        Skip to content
      </a>
      <Nav groups={NAV_GROUPS} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3 pl-8 lg:pl-0">
            <Link href="/" className="text-sm font-semibold text-text-primary">
              WonderAgent
            </Link>
            <span className="hidden text-xs text-text-muted sm:inline">/ {ctx.tenantSlug}</span>
          </div>
          <div className="flex items-center gap-2">
            <ShellGlobalSearch />
            <ShellNotifications />
            <UserMenu email={user.email ?? ""} tenants={tenantOptions} onSelectTenant={selectTenantAction} onSignOut={signOutAction} />
          </div>
        </header>
        <main id="main-content" className="flex-1 bg-background px-4 py-6 lg:px-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
