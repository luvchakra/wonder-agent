import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { selectTenantAction } from "@/app/actions/tenant";
import { baseAppHost } from "@/lib/tenant/host";
import { OrganizationSetupForm } from "./OrganizationSetupForm";
import { acceptInvitationAction } from "@/app/actions/users";
import { listMyInvitations } from "@/lib/users/users";
import { Card, CardHeader, CardBody, Button, EnvironmentBadge, WonderIDLogo } from "@/modules/ui";
import { getMyTenantEnvironments } from "@/lib/tenant/environments";
import { environmentFamilyKey } from "@/lib/tenant/environmentFamily";

export default async function OnboardingPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Only auto-redirect a brand-new user with no memberships at all yet
  // (nothing to choose or switch between). A user who already has a
  // tenant and navigates here explicitly — the "Create new organization"
  // link in the topbar's workspace switcher — is here on purpose, to
  // create an *additional* tenant, so this must not bounce them straight
  // back to "/" before they can reach the create-organization form below.
  const ctx = await getTenantContext();
  // FOUNDATION-P0-22 — an organization's own address is for that organization only.
  const host = await getHostTenant();
  if (host.target.kind === "subdomain" || host.target.kind === "invalid") redirect(ctx.tenantId ? "/" : "/no-access");

  // Filtered by user_id for the same reason as getTenantContext(): the
  // tenant_memberships RLS policy is tenant-scoped, so relying on it alone
  // renders one organization button per member of the tenant.
  const { data: memberships } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants(name, slug)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .returns<{ tenant_id: string; tenants: { name: string; slug: string } | null }[]>();

  // FOUNDATION-P0-23 — invitations waiting for this person (their own, by their user id).
  const [invitations, environments] = await Promise.all([listMyInvitations(user.id), getMyTenantEnvironments()]);
  const organizations = groupByOrganization(memberships ?? [], environments);

  if (ctx.tenantId && (!memberships || memberships.length === 0)) {
    // Tenant context resolved but the membership list didn't — treat as
    // transient/inconsistent rather than trusting a stale redirect.
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-6 px-4 py-12">
      <div className="flex flex-col items-center text-center">
        <h1 className="sr-only">WonderID</h1>
        <WonderIDLogo size={52} showTagline priority />
        <p className="mt-3 text-sm text-muted-foreground">AI Identity Governance &amp; Runtime Assurance</p>
      </div>

      {invitations.length > 0 && (
        <Card>
          <CardHeader title="Invitations" description="You have been invited to join these organizations." />
          <CardBody className="space-y-2">
            {invitations.map((i) => (
              <form action={acceptInvitationAction} key={i.tenantId} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <input type="hidden" name="tenantId" value={i.tenantId} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{i.tenantName}</span>
                {/* FOUNDATION-P0-32: an expired invitation cannot be accepted (the server refuses it too). */}
                {i.expired ? (
                  <span className="text-xs text-muted-foreground">Expired: ask for it again</span>
                ) : (
                  <Button type="submit" size="sm">
                    Accept
                  </Button>
                )}
              </form>
            ))}
          </CardBody>
        </Card>
      )}

      {organizations.length > 0 && (
        <Card>
          <CardHeader title="Select an organization" description={`${organizations.length} organization${organizations.length === 1 ? "" : "s"}; choose an environment to open.`} />
          <CardBody className="space-y-4">
            {organizations.map((o) => (
              <section key={o.key} aria-label={o.name} className="space-y-1">
                <h2 className="px-1 text-sm font-semibold text-foreground">{o.name}</h2>
                {o.environments.map((m) => (
                  <form action={selectTenantAction} key={m.tenantId}>
                    <input type="hidden" name="tenantId" value={m.tenantId} />
                    <button
                      type="submit"
                      aria-label={`${o.name}, ${m.environment}`}
                      className={`flex w-full items-center justify-between gap-2 rounded-md py-2 pl-4 pr-3 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                        m.tenantId === ctx.tenantId ? "bg-primary/10 font-medium text-primary" : "text-foreground"
                      }`}
                    >
                      <EnvironmentBadge environment={m.environment} />
                      {m.tenantId === ctx.tenantId && <Check className="size-4 shrink-0" aria-hidden="true" />}
                    </button>
                  </form>
                ))}
              </section>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Create a new organization" description="Sets up a fresh, isolated organization you'll own as its Tenant Administrator." />
        <CardBody>
          <OrganizationSetupForm base={baseAppHost()} />
        </CardBody>
      </Card>
    </div>
  );
}

const ORDER = ["production", "development", "test", "staging", "sandbox"];

/**
 * Owner request (2026-10-13): show organizations, each with its
 * environments under it, rather than every environment as an organization.
 * Only the person's own memberships are grouped (the same rule as the
 * switcher), so this reveals nothing.
 */
function groupByOrganization(
  memberships: { tenant_id: string; tenants: { name: string; slug?: string } | null }[],
  environments: Map<string, { environment: string; parentTenantId: string | null }>,
): { key: string; name: string; environments: { tenantId: string; environment: string }[] }[] {
  const members = memberships.map((m) => ({
    tenantId: m.tenant_id,
    name: m.tenants?.name ?? m.tenant_id,
    slug: m.tenants?.slug ?? "",
    environment: environments.get(m.tenant_id)?.environment ?? "production",
    parentTenantId: environments.get(m.tenant_id)?.parentTenantId ?? null,
  }));
  const groups = new Map<string, typeof members>();
  for (const m of members) {
    const key = environmentFamilyKey(m, members);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      // The organization is the one its environments link to, else production, else the first.
      const root = list.find((m) => !m.parentTenantId && list.some((o) => o.parentTenantId === m.tenantId)) ?? list.find((m) => m.environment === "production") ?? list[0];
      const sorted = [...list].sort((a, b) => (a === root ? -1 : b === root ? 1 : ORDER.indexOf(a.environment) - ORDER.indexOf(b.environment)));
      return { key, name: root.name.replace(/ \((Dev|Test|Staging)\)$/, ""), environments: sorted.map((m) => ({ tenantId: m.tenantId, environment: m.environment })) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
