import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { baseAppHost } from "@/lib/tenant/host";
import { OrganizationSetupForm } from "./OrganizationSetupForm";
import { acceptInvitationAction } from "@/app/actions/users";
import { listMyInvitations } from "@/lib/users/users";
import Link from "next/link";
import { Card, CardHeader, CardBody, Button, WonderIDLogo } from "@/modules/ui";

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
  const invitations = await listMyInvitations(user.id);

  if (ctx.tenantId && (!memberships || memberships.length === 0)) {
    // Tenant context resolved but the membership list didn't — treat as
    // transient/inconsistent rather than trusting a stale redirect.
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-6 px-4 py-12">
      {/* Owner request 2026-10-13: a way back; the organization list lives on /organizations. */}
      <Link href="/organizations" className="w-fit text-sm font-medium text-primary hover:underline">
        ← Back
      </Link>
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

      <Card>
        <CardHeader title="Create a new organization" description="Sets up a fresh, isolated organization you'll own as its Tenant Administrator." />
        <CardBody>
          <OrganizationSetupForm base={baseAppHost()} />
        </CardBody>
      </Card>
    </div>
  );
}

