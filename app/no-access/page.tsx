import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/session";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { signOutAction } from "@/app/actions/tenant";
import { acceptInvitationAction } from "@/app/actions/users";
import { listMyInvitations } from "@/lib/users/users";
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
  // FOUNDATION-P0-23 — invited here and not yet accepted: accepting is the way in.
  const invitation = !suspended && host.tenant ? (await listMyInvitations(user.id)).find((i) => i.tenantId === host.tenant!.tenantId) : undefined;
  if (invitation) {
    return (
      <AuthShell title={`Join ${name}`} subtitle={`You have been invited to ${name} on WonderID. Accept to start using it.`} footer={<>Signed in as {user.email ?? "your account"}.</>}>
        <div className="flex flex-wrap gap-2">
          <form action={acceptInvitationAction}>
            <input type="hidden" name="tenantId" value={invitation.tenantId} />
            <Button type="submit">Accept invitation</Button>
          </form>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </div>
      </AuthShell>
    );
  }
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
