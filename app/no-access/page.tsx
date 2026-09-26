import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/session";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { signOutAction } from "@/app/actions/tenant";
import { AuthShell, Button } from "@/modules/ui";

// FOUNDATION-P0-22 — signed in, on an organization's own address, but with
// no access there: the organization is suspended, or the account holds no
// active membership in it. The address never grants access, so there is
// nothing to show but this, and no way to create or switch organizations
// from here.
export const metadata = { title: "No access" };

export default async function NoAccessPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const [ctx, host] = await Promise.all([getTenantContext(), getHostTenant()]);
  if (ctx.tenantId) redirect("/");
  const name = host.tenant?.name ?? "this organization";
  const suspended = host.tenant?.status === "suspended";
  return (
    <AuthShell
      title={suspended ? `${name} is suspended` : `You don't have access to ${name}`}
      subtitle={
        suspended
          ? "Access to this organization is paused. Contact your administrator; nothing in it has been deleted."
          : "Your account is signed in, but it is not an active member of this organization. Ask one of its administrators to invite you."
      }
      footer={<>Signed in as {user.email ?? "your account"}.</>}
    >
      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </AuthShell>
  );
}
