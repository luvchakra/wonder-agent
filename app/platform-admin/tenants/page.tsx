import Link from "next/link";
import { listTenants, getSubscription } from "@/modules/platform-admin/service";
import { createTenantAction, suspendTenantAction, activateTenantAction, decommissionTenantAction, createSubscriptionAction } from "@/app/actions/platform";
import { Badge, Button, Card, CardBody, CardHeader, StatusBadge, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { PageHeading } from "../PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const STATUS = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  deprovisioned: { tone: "neutral", label: "Decommissioned" },
} as const;

export default async function PlatformTenantsPage() {
  const tenants = await listTenants();
  const withSubscriptions = await Promise.all(
    tenants.map(async (t) => ({
      tenant: t,
      subscription: await getSubscription(t.tenantId),
    })),
  );

  return (
    <>
      <PageHeading title="Tenants" description={`${tenants.length} organization${tenants.length === 1 ? "" : "s"} on the platform.`} />

      <Card>
        <CardHeader title="Create tenant" />
        <CardBody>
          <form action={createTenantAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
            <div>
              <label htmlFor="tenant-name" className={fieldLabelClass}>
                Name
              </label>
              <input id="tenant-name" name="name" placeholder="Acme Corp" required className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="tenant-slug" className={fieldLabelClass}>
                Slug
              </label>
              <input id="tenant-slug" name="slug" placeholder="acme-corp" required className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="tenant-environment" className={fieldLabelClass}>
                Environment
              </label>
              <select id="tenant-environment" name="environment" defaultValue="production" className={fieldInputClass}>
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </div>
            <Button type="submit">Create</Button>
          </form>
        </CardBody>
      </Card>

      {tenants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tenants yet.</p>
      ) : (
        <Card>
          <TableContainer label="Tenants" bare>
            <Thead>
              <tr>
                <Th>Name</Th>
                <Th hideBelow="lg">Slug</Th>
                <Th>Status</Th>
                <Th hideBelow="xl">Environment</Th>
                <Th>Plan</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </Thead>
            <tbody>
              {withSubscriptions.map(({ tenant, subscription }) => {
                const status = STATUS[tenant.status ?? "active"];
                return (
                  <Tr key={tenant.tenantId}>
                    <Td className="font-medium">{tenant.name}</Td>
                    <Td hideBelow="lg" className="font-mono text-xs text-muted-foreground">
                      {tenant.slug}
                    </Td>
                    <Td>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </Td>
                    <Td hideBelow="xl" className="capitalize">
                      {tenant.environment}
                    </Td>
                    <Td>
                      {subscription?.plan ? (
                        <Badge tone="info" className="capitalize">
                          {subscription.plan}
                        </Badge>
                      ) : (
                        <form action={createSubscriptionAction.bind(null, tenant.tenantId)} className="flex items-center gap-1.5">
                          <select name="plan" defaultValue="free" aria-label={`Plan for ${tenant.name}`} className={cn(fieldInputClass, "w-auto py-1")}>
                            <option value="free">Free</option>
                            <option value="pro">Pro</option>
                            <option value="max">Max</option>
                            <option value="enterprise">Enterprise</option>
                          </select>
                          <Button type="submit" size="sm" variant="outline">
                            Assign
                          </Button>
                        </form>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Link href={`/platform-admin/tenants/${tenant.tenantId}/usage`} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent">
                          Usage
                        </Link>
                        {tenant.status === "suspended" ? (
                          <form action={activateTenantAction.bind(null, tenant.tenantId)}>
                            <Button type="submit" size="sm" variant="ghost">
                              Activate
                            </Button>
                          </form>
                        ) : tenant.status !== "deprovisioned" ? (
                          <form action={suspendTenantAction.bind(null, tenant.tenantId)}>
                            <Button type="submit" size="sm" variant="ghost">
                              Suspend
                            </Button>
                          </form>
                        ) : null}
                        {tenant.status !== "deprovisioned" ? (
                          <form action={decommissionTenantAction.bind(null, tenant.tenantId)}>
                            <Button type="submit" size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                              Decommission
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableContainer>
        </Card>
      )}
    </>
  );
}
