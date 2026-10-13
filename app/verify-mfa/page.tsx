import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/session";
import { getMyMemberships, getTenantContext } from "@/lib/tenant/getTenantContext";
import { mfaStepUpNeeded } from "@/lib/tenant/mfaRequired";
import { selectTenantAction, signOutAction } from "@/app/actions/tenant";
import { AuthShell, Button } from "@/modules/ui";
import { MfaStepUp } from "./MfaStepUp";

// FOUNDATION-P0-27 — the organization requires multi-factor authentication
// and this session has not passed it. Nothing of the organization is shown
// or readable until it has (getTenantContext() and, in the database,
// current_tenant_ids()). A member verifies an authenticator app they have,
// or sets one up here. A member whose organization does not require it can
// verify here too (an administrator does, before turning the requirement on).
export const metadata = { title: "Verify it's you" };

export default async function VerifyMfaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const [ctx, memberships] = await Promise.all([getTenantContext(), getMyMemberships()]);
  if (user.aal === "aal2" || (!ctx.mfaStepUp && !ctx.tenantId)) redirect("/");
  const required = ctx.mfaStepUp ?? null;
  const others = required ? memberships.filter((m) => m.tenantId !== required.tenantId && !mfaStepUpNeeded(m, user.aal)) : [];
  return (
    <AuthShell
      title="Verify it's you"
      subtitle={required ? `${required.name} requires multi-factor authentication. Enter a code from your authenticator app.` : "Enter a code from your authenticator app to verify this session."}
      footer={<>Signed in as {user.email ?? "your account"}.</>}
    >
      <div className="space-y-4">
        <MfaStepUp />
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {others.map((m) => (
            <form key={m.tenantId} action={selectTenantAction}>
              <input type="hidden" name="tenantId" value={m.tenantId} />
              <Button type="submit" variant="outline" size="sm">
                Go to {m.name}
              </Button>
            </form>
          ))}
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
