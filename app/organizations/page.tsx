import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getSessionUser } from "@/lib/tenant/session";
import { getHostTenant, urlForTenant } from "@/lib/tenant/hostTenant";
import { getMyMemberships } from "@/lib/tenant/getTenantContext";
import { getMyTenantEnvironments } from "@/lib/tenant/environments";
import { environmentFamilyKey } from "@/lib/tenant/environmentFamily";
import { isPlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { signOutAction } from "@/app/actions/tenant";
import { AuthShell, Button, EnvironmentBadge } from "@/modules/ui";

export const metadata = { title: "Your organizations" };
export const dynamic = "force-dynamic";

const ORDER = ["production", "development", "test", "staging", "sandbox"];

/**
 * Owner request (2026-10-13): on the main address the product does not
 * open; a signed-in person picks the organization and environment to go
 * to, each at its own address, where they sign in (sessions are per
 * address). Only their own active memberships are listed.
 */
export default async function OrganizationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  // On an organization's own address this list has no purpose.
  const host = await getHostTenant();
  if (host.target.kind === "subdomain") redirect("/");

  const [memberships, environments, admin] = await Promise.all([getMyMemberships(), getMyTenantEnvironments(), isPlatformAdmin()]);
  const members = memberships
    .filter((m) => !m.automation)
    .map((m) => ({ ...m, environment: environments.get(m.tenantId)?.environment ?? "production", parentTenantId: environments.get(m.tenantId)?.parentTenantId ?? null }));
  const all = members.map((m) => ({ tenantId: m.tenantId, slug: m.slug, environment: m.environment, parentTenantId: m.parentTenantId }));
  // An organization's environments together, production first.
  const sorted = [...members].sort((a, b) => {
    const fa = environmentFamilyKey(a, all);
    const fb = environmentFamilyKey(b, all);
    return fa === fb ? ORDER.indexOf(a.environment) - ORDER.indexOf(b.environment) : fa.localeCompare(fb);
  });
  const urls = await Promise.all(sorted.map((m) => (m.slug ? urlForTenant(m.slug) : Promise.resolve(null))));

  return (
    <AuthShell title="Your organizations" subtitle="Choose the organization and environment to open. Each has its own address, where you sign in." footer={<>Signed in as {user.email ?? "your account"}.</>}>
      <div className="space-y-4">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">You don&apos;t belong to an organization yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sorted.map((m, i) => (
              <li key={m.tenantId}>
                {urls[i] ? (
                  <a href={`${urls[i]}/sign-in`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{m.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{urls[i]!.replace(/^https?:\/\//, "")}</span>
                    </span>
                    <EnvironmentBadge environment={m.environment} />
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="flex items-center gap-3 px-3 py-2.5 text-sm text-foreground">{m.name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Link href="/onboarding" className="text-sm font-medium text-primary hover:underline">
            Create or join an organization
          </Link>
          {admin ? (
            <Link href="/platform-admin" className="text-sm font-medium text-primary hover:underline">
              Platform console
            </Link>
          ) : null}
          <form action={signOutAction} className="ml-auto">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
