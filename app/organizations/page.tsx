import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/session";
import { getHostTenant, urlForTenant } from "@/lib/tenant/hostTenant";
import { TENANT_COOKIE_NAME, getMyMemberships } from "@/lib/tenant/getTenantContext";
import { isPlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";

export const dynamic = "force-dynamic";

/**
 * Owner request (2026-10-13): no list of organizations on the main address.
 * A signed-in person is sent straight to their organization's own address
 * (sessions are per address, so its sign-in): the one they last used,
 * else their first. Someone with no organization creates one; a platform
 * administrator with none goes to the vendor console. Only the person's own
 * active memberships are considered (my_memberships).
 */
export default async function OrganizationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  // On an organization's own address there is nothing to choose.
  const host = await getHostTenant();
  if (host.target.kind === "subdomain") redirect("/");

  const [memberships, admin, cookieStore] = await Promise.all([getMyMemberships(), isPlatformAdmin(), cookies()]);
  const mine = memberships.filter((m) => !m.automation && m.slug);
  if (!mine.length) redirect(admin ? "/platform-admin" : "/onboarding");

  const last = cookieStore.get(TENANT_COOKIE_NAME)?.value;
  const target = mine.find((m) => m.tenantId === last) ?? mine[0];
  const url = await urlForTenant(target.slug);
  // Without organization addresses (local runs), the product is served here.
  redirect(url ? `${url}/sign-in` : "/");
}
