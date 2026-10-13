import Link from "next/link";
import { notFound } from "next/navigation";
import { ADDABLE_ENVIRONMENTS, getSubscription, getTenant, listTenants, organizationOwners } from "@/modules/platform-admin/service";
import { groupOrganizations } from "@/modules/platform-admin/organizations";
import { activateTenantAction, createTenantEnvironmentAction, decommissionTenantAction, removeTenantEnvironmentAction, suspendTenantAction } from "@/app/actions/platform";
import { baseAppHost, tenantUrl } from "@/lib/tenant/host";
import type { PlatformTenant } from "@/lib/shared/types/platform";
import { Badge, Button, Card, CardBody, CardHeader, EnvironmentBadge, ENVIRONMENT_COLOR, StatusBadge, TableContainer, Td, Th, Thead, Tr, fieldInputClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { PageHeading } from "../../PageHeading";
import { AddressForm, EnvironmentForm, PlanForm } from "./TenantSettingsForms";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const STATUS = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  deprovisioned: { tone: "neutral", label: "Decommissioned" },
} as const;

/** One environment's own settings: address, environment, plan, status. */
async function EnvironmentSettings({ tenant, base }: { tenant: PlatformTenant; base: string | null }) {
  const subscription = await getSubscription(tenant.tenantId);
  const url = tenant.slug ? tenantUrl(tenant.slug, base) : null;
  return (
    <>
      <Card>
        <CardHeader title="Address" description={url ?? undefined} />
        <CardBody>
          <AddressForm tenantId={tenant.tenantId} slug={tenant.slug ?? ""} base={base} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Environment" />
        <CardBody>
          <EnvironmentForm tenantId={tenant.tenantId} environment={tenant.environment} />
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

/**
 * Owner request (2026-10-13): an organization holds its environments. On
 * the organization (its production tenant): its owners, every environment
 * with Manage and Remove, Add environment, then its own settings. On an
 * environment: a way back to its organization, then that environment's
 * settings.
 */
export default async function PlatformTenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) notFound();
  const [tenant, all] = await Promise.all([getTenant(tenantId), listTenants({ includeDecommissioned: true })]);
  if (!tenant) notFound();
  const base = baseAppHost();
  // Decommissioned environments are not part of an organization's current set.
  const orgs = groupOrganizations(all.filter((t) => t.status !== "deprovisioned" || t.tenantId === tenantId));
  const org = orgs.find((o) => o.environments.some((e) => e.tenantId === tenantId))!;
  const isOrganization = org.primary.tenantId === tenantId;

  if (!isOrganization) {
    return (
      <>
        <Link href={`/platform-admin/tenants/${org.id}`} className="text-sm font-medium text-primary hover:underline">
          ← {org.name}
        </Link>
        <PageHeading title={`${org.name} · ${ENVIRONMENT_COLOR[tenant.environment as keyof typeof ENVIRONMENT_COLOR]?.label ?? tenant.environment}`} description={tenant.name}>
          <EnvironmentBadge environment={tenant.environment} />
        </PageHeading>
        <EnvironmentSettings tenant={tenant} base={base} />
      </>
    );
  }

  const [owners, subscriptions] = await Promise.all([organizationOwners([tenantId]), Promise.all(org.environments.map((e) => getSubscription(e.tenantId)))]);
  const ownerList = owners.get(tenantId) ?? [];
  const missing = tenant.status === "active" ? ADDABLE_ENVIRONMENTS.filter((k) => !org.environments.some((e) => e.environment === k && e.status !== "deprovisioned")) : [];

  return (
    <>
      <Link href="/platform-admin/tenants" className="text-sm font-medium text-primary hover:underline">
        ← Organizations
      </Link>
      <PageHeading title={org.name} description={`${org.environments.length} environment${org.environments.length === 1 ? "" : "s"}`} />

      <Card>
        <CardHeader title="Owners" description="The organization's administrators." />
        {ownerList.length ? (
          <ul className="divide-y divide-border">
            {ownerList.map((o) => (
              <li key={o.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="text-sm font-medium text-foreground">{o.name || o.email}</span>
                <a href={`mailto:${o.email}`} className="text-sm text-primary hover:underline">
                  {o.email}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No active administrator.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Environments" description="Each is separate, with its own data, users and address." />
        <TableContainer label="Environments" bare>
          <Thead>
            <tr>
              <Th>Environment</Th>
              <Th>Address</Th>
              <Th hideBelow="lg">Plan</Th>
              <Th>Status</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </Thead>
          <tbody>
            {org.environments.map((e, i) => {
              const url = e.slug && e.status !== "deprovisioned" ? tenantUrl(e.slug, base) : null;
              const status = STATUS[e.status ?? "active"];
              const removable = e.tenantId !== tenantId && Boolean(e.parentTenantId) && e.status !== "deprovisioned";
              return (
                <Tr key={e.tenantId}>
                  <Td>
                    <EnvironmentBadge environment={e.environment} />
                  </Td>
                  <Td className="font-mono text-xs text-muted-foreground">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                        {url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      e.slug
                    )}
                  </Td>
                  <Td hideBelow="lg">{subscriptions[i]?.plan ? <Badge tone="info" className="capitalize">{subscriptions[i]!.plan}</Badge> : <span className="text-xs text-muted-foreground">None</span>}</Td>
                  <Td>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Link href={e.tenantId === tenantId ? "#settings" : `/platform-admin/tenants/${e.tenantId}`} className="whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent">
                        Manage
                      </Link>
                      {removable ? (
                        <details className="relative">
                          <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm font-medium text-destructive hover:bg-accent">Remove…</summary>
                          <form action={removeTenantEnvironmentAction.bind(null, e.tenantId, tenantId)} className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-md border border-border bg-popover p-3 text-left shadow-lg">
                            <p className="text-xs text-muted-foreground">Decommissions this environment (its data is kept, nobody can sign in) and frees its address.</p>
                            <Button type="submit" size="sm" variant="destructive">
                              Remove {ENVIRONMENT_COLOR[e.environment as keyof typeof ENVIRONMENT_COLOR]?.label ?? e.environment}
                            </Button>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableContainer>
        {missing.length ? (
          <CardBody className="border-t border-border">
            <form action={createTenantEnvironmentAction.bind(null, tenantId)} className="flex flex-wrap items-center gap-2">
              <select name="environment" aria-label="Environment to add" className={cn(fieldInputClass, "w-44")}>
                {missing.map((k) => (
                  <option key={k} value={k}>
                    {ENVIRONMENT_COLOR[k].label}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline">
                Add environment
              </Button>
            </form>
          </CardBody>
        ) : null}
      </Card>

      <h2 id="settings" className="scroll-mt-6 pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {ENVIRONMENT_COLOR[tenant.environment as keyof typeof ENVIRONMENT_COLOR]?.label ?? tenant.environment} settings
      </h2>
      <EnvironmentSettings tenant={tenant} base={base} />
    </>
  );
}
