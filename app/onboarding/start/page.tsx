import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/session";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { ensureFirstOrganization } from "@/lib/tenant/firstOrganization";
import { EnterOrganization } from "./EnterOrganization";

export const dynamic = "force-dynamic";

/**
 * Where a signed-in person with no organization is sent (the customer
 * layout, and /auth/callback after a social sign-up). A brand-new account
 * gets its first organization here and goes straight into the product; the
 * old "Create a new organization" screen is skipped.
 *
 * Anyone the database declines to provision — invited people, people with a
 * past membership, platform administrators — or any failure goes on to
 * /onboarding, which still offers invitations and the manual form.
 *
 * A page rather than a route handler: the customer layout redirects here
 * during client-side navigation, which a route handler's redirect does not
 * survive. On success it hands over to a full page load (EnterOrganization)
 * rather than redirect("/"): the client router cache still holds the old
 * "/ → here" redirect and would loop. No tenant cookie is needed — with one
 * membership, getTenantContext() resolves it on the next request.
 *
 * Rendering it has a side effect, deliberately and safely: the only effect
 * is the one the signed-in caller would get anyway — their own first
 * organization, once, decided under a lock in the database — so a
 * cross-site link to it gains an attacker nothing, and nothing links or
 * prefetches it.
 */
export default async function OnboardingStartPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  // FOUNDATION-P0-22 — organizations are created only from the main address.
  const host = await getHostTenant();
  if (host.target.kind !== "none" && host.target.kind !== "base") redirect("/no-access");

  const created = await ensureFirstOrganization();
  if (created) return <EnterOrganization name={created.name} />;
  // Nothing created. Someone who already belongs to an organization (say,
  // a repeated request after the first created it) goes in the same way;
  // anyone else — invitations, no membership — chooses on /onboarding.
  const ctx = await getTenantContext();
  if (ctx.tenantId) return <EnterOrganization name="your organization" />;
  redirect("/onboarding");
}
