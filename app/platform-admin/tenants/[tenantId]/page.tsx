import Link from "next/link";
import { notFound } from "next/navigation";
import { ADDABLE_ENVIRONMENTS, getSubscription, getTenant, listTenants } from "@/modules/platform-admin/service";
import { activateTenantAction, createTenantEnvironmentAction, decommissionTenantAction, suspendTenantAction } from "@/app/actions/platform";
import { baseAppHost, tenantUrl } from "@/lib/tenant/host";
import { Button, Card, CardBody, CardHeader, EnvironmentBadge, ENVIRONMENT_COLOR, fieldInputClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { PageHeading } from "../../PageHeading";
import { AddressForm, EnvironmentForm, PlanForm } from "./TenantSettingsForms";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

/** Owner request 2026-10-13: one organization's address and environment, changed by a platform administrator. */
export default async function PlatformTenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) notFound();
  const [tenant, all, subscription] = await Promise.all([getTenant(tenantId), listTenants(), getSubscription(tenantId)]);
  if (!tenant) notFound();
  const base = baseAppHost();
  const url = tenant.slug ? tenantUrl(tenant.slug, base) : null;
  const parent = tenant.parentTenantId ? all.find((t) => t.tenantId === tenant.parentTenantId) : null;
  const children = all.filter((t) => t.parentTenantId === tenant.tenantId);
  const missing = tenant.environment === "production" && tenant.status === "active" ? ADDABLE_ENVIRONMENTS.filter((e) => !children.some((c) => c.environment === e)) : [];

  return (
    <>
      <Link href="/platform-admin/tenants" className="text-sm font-medium text-primary hover:underline">
        ← Tenants
      </Link>
      <PageHeading title={tenant.name ?? tenant.tenantId}>
        <EnvironmentBadge environment={tenant.environment} />
      </PageHeading>

      <Card>
        <CardHeader title="Address" description={url ?? undefined} />
        <CardBody>
          <AddressForm tenantId={tenant.tenantId} slug={tenant.slug ?? ""} base={base} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Environment" description={parent ? `An environment of ${parent.name}.` : undefined} />
        <CardBody className="space-y-4">
          <EnvironmentForm tenantId={tenant.tenantId} environment={tenant.environment} />
          {children.length ? (
            <ul className="space-y-1">
              {children.map((c) => (
                <li key={c.tenantId} className="flex items-center gap-2 text-sm">
                  <EnvironmentBadge environment={c.environment} />
                  <Link href={`/platform-admin/tenants/${c.tenantId}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {missing.length ? (
            <form action={createTenantEnvironmentAction.bind(null, tenant.tenantId)} className="flex flex-wrap items-center gap-2">
              <select name="environment" aria-label="Environment to add" className={cn(fieldInputClass, "w-44")}>
                {missing.map((e) => (
                  <option key={e} value={e}>
                    {ENVIRONMENT_COLOR[e].label}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline">
                Add environment
              </Button>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Plan" description={subscription ? `${subscription.plan} · ${subscription.provider === "manual" || !subscription.provider ? "assigned by the platform" : `billed through ${subscription.provider}`}` : "No plan yet"} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <PlanForm tenantId={tenant.tenantId} plan={subscription?.plan ?? null} />
          <Link href={`/platform-admin/tenants/${tenant.tenantId}/usage`} className="text-sm font-medium text-primary hover:underline">
            Usage →
          </Link>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Status" description={tenant.status === "deprovisioned" ? "Decommissioned." : tenant.status === "suspended" ? "Suspended: nobody can sign in." : "Active."} />
        {tenant.status !== "deprovisioned" ? (
          <CardBody className="flex flex-wrap gap-2">
            {tenant.status === "suspended" ? (
              <form action={activateTenantAction.bind(null, tenant.tenantId)}>
                <Button type="submit" size="sm" variant="outline">Activate</Button>
              </form>
            ) : (
              <form action={suspendTenantAction.bind(null, tenant.tenantId)}>
                <Button type="submit" size="sm" variant="outline">Suspend</Button>
              </form>
            )}
            <form action={decommissionTenantAction.bind(null, tenant.tenantId)}>
              <Button type="submit" size="sm" variant="ghost" className="text-destructive hover:text-destructive">Decommission</Button>
            </form>
          </CardBody>
        ) : null}
      </Card>
    </>
  );
}
