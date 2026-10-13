import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/session";
import { mainAppUrl, urlForTenant } from "@/lib/tenant/hostTenant";
import { getMyManagedOrganizations, type ManagedTenant } from "@/lib/tenant/manage";
import { ENVIRONMENT_KINDS, environmentPrices, testPaymentsAvailable } from "@/modules/billing/environmentOrders";
import { formatMoney, intervalLabel, planLabel } from "@/modules/billing/rules";
import { WonderIDLogo } from "@/modules/ui";
import { ManageOrganizationCard, type ManageOrganization, type ManageRow } from "./ManageOrganizationCard";

export const metadata = { title: "Manage organizations" };
export const dynamic = "force-dynamic";

/**
 * Owner request (2026-10-13): "Manage organizations", opened from the
 * organization switcher. The organizations the signed-in person owns, each
 * with its environments: rename, disable or enable, and add a paid
 * environment. A new organization is free and is created on the main
 * address. Outside the product shell, so an owner can still reach an
 * organization they disabled.
 */
export default async function ManageOrganizationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const [orgs, main] = await Promise.all([getMyManagedOrganizations(), mainAppUrl()]);
  const testPayments = testPaymentsAvailable();

  const row = async (t: ManagedTenant): Promise<ManageRow> => ({
    tenantId: t.tenantId,
    name: t.name,
    environment: t.environment,
    status: t.status,
    disabledByOwner: t.disabledByOwner,
    url: await urlForTenant(t.slug),
  });
  const cards: ManageOrganization[] = await Promise.all(
    orgs.map(async (o) => {
      const taken = new Set([o.environment, ...o.environments.map((e) => e.environment)]);
      const addable = ENVIRONMENT_KINDS.filter((k) => !taken.has(k));
      const prices = addable.length && o.status === "active" ? await environmentPrices(o.tenantId).catch(() => []) : [];
      return {
        ...(await row(o)),
        environments: await Promise.all(o.environments.map(row)),
        addable,
        testPayments,
        prices: prices.map((p) => ({ id: p.id, label: `${planLabel(p.plan)} · ${formatMoney(p.unitAmount, p.currency)} ${intervalLabel(p.interval)}` })),
      };
    }),
  );

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
        <Link href="/" aria-label="WonderID" className="flex w-fit items-center">
          <WonderIDLogo size={40} alt="" />
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Manage organizations</h1>
            <p className="mt-1 text-sm text-muted-foreground">The organizations you own and their environments.</p>
          </div>
          <a href={`${main}/onboarding`} className="text-sm font-medium text-primary hover:underline">
            New organization (free)
          </a>
        </div>
        {cards.length ? (
          cards.map((o) => <ManageOrganizationCard key={o.tenantId} org={o} />)
        ) : (
          <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">You don&apos;t own an organization. Its owner manages it.</p>
        )}
        <p className="text-sm">
          <Link href="/" className="font-medium text-primary hover:underline">
            ← Back
          </Link>
        </p>
      </main>
    </div>
  );
}
