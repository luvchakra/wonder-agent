import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { createTenantAction, selectTenantAction } from "@/app/actions/tenant";
import { Card, CardHeader, CardBody, Button, Logo, TextField } from "@/modules/ui";

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

  // Filtered by user_id for the same reason as getTenantContext(): the
  // tenant_memberships RLS policy is tenant-scoped, so relying on it alone
  // renders one organization button per member of the tenant.
  const { data: memberships } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .returns<{ tenant_id: string; tenants: { name: string } | null }[]>();

  if (ctx.tenantId && (!memberships || memberships.length === 0)) {
    // Tenant context resolved but the membership list didn't — treat as
    // transient/inconsistent rather than trusting a stale redirect.
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-6 px-4 py-12">
      <div className="flex flex-col items-center text-center">
        <h1 className="sr-only">WonderID</h1>
        <Logo variant="full" height={56} priority />
        <p className="mt-3 text-sm text-muted-foreground">AI Identity Governance &amp; Runtime Assurance</p>
      </div>

      {memberships && memberships.length > 0 && (
        <Card>
          <CardHeader title="Select an organization" description="Switch to one of your existing organizations." />
          <CardBody className="space-y-1">
            {memberships.map((m) => (
              <form action={selectTenantAction} key={m.tenant_id}>
                <input type="hidden" name="tenantId" value={m.tenant_id} />
                <button
                  type="submit"
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    m.tenant_id === ctx.tenantId ? "bg-primary/10 font-medium text-primary" : "text-foreground"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{m.tenants?.name ?? m.tenant_id}</span>
                  {m.tenant_id === ctx.tenantId && <Check className="size-4 shrink-0" aria-hidden="true" />}
                </button>
              </form>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Create a new organization" description="Sets up a fresh, isolated organization you'll own as Tenant Super Admin." />
        <CardBody>
          <form action={createTenantAction} className="space-y-3">
            <TextField label="Organization name" name="name" required placeholder="Acme Corp" />
            <Button type="submit">Create organization</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
