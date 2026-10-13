import Link from "next/link";
import { ADDABLE_ENVIRONMENTS, listTenants, getSubscription } from "@/modules/platform-admin/service";
import { baseAppHost, tenantUrl } from "@/lib/tenant/host";
import { createTenantAction, createTenantEnvironmentAction, suspendTenantAction, activateTenantAction, decommissionTenantAction, createSubscriptionAction } from "@/app/actions/platform";
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

const ENV_LABEL: Record<string, string> = { production: "Production", development: "Dev", test: "Test", staging: "Staging", sandbox: "Sandbox" };

export default async function PlatformTenantsPage() {
  const listed = await listTenants();
  // Each production organization followed by its environments (migration 0156).
  const childrenOf = (id: string) => listed.filter((t) => t.parentTenantId === id);
  const tenants = [...listed.filter((t) => !t.parentTenantId || !listed.some((p) => p.tenantId === t.parentTenantId)).flatMap((t) => [t, ...childrenOf(t.tenantId)])];
  const base = baseAppHost();
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
                <Th hideBelow="lg">Address</Th>
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
                    <Td className={cn("font-medium", tenant.parentTenantId && "md:pl-8")}>{tenant.name}</Td>
                    <Td hideBelow="lg" className="font-mono text-xs text-muted-foreground">
                      {base && tenant.slug && tenant.status !== "deprovisioned" ? (
                        <a href={tenantUrl(tenant.slug, base) ?? undefined} className="hover:text-primary hover:underline" target="_blank" rel="noreferrer">
                          {tenant.slug}.{base}
                        </a>
                      ) : (
                        tenant.slug
                      )}
                    </Td>
                    <Td>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </Td>
                    <Td hideBelow="xl">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={tenant.environment === "production" ? "success" : "neutral"}>{ENV_LABEL[tenant.environment] ?? tenant.environment}</Badge>
                        {(() => {
                          // Owner request 2026-10-13: add dev, test or staging to an active production organization.
                          const missing = tenant.environment === "production" && tenant.status === "active" ? ADDABLE_ENVIRONMENTS.filter((e) => !childrenOf(tenant.tenantId).some((c) => c.environment === e)) : [];
                          return missing.length ? (
                            <form action={createTenantEnvironmentAction.bind(null, tenant.tenantId)} className="flex items-center gap-1">
                              <select name="environment" aria-label={`Environment to add to ${tenant.name}`} className={cn(fieldInputClass, "w-auto py-0.5 text-xs")}>
                                {missing.map((e) => (
                                  <option key={e} value={e}>
                                    {ENV_LABEL[e]}
                                  </option>
                                ))}
                              </select>
                              <Button type="submit" size="sm" variant="ghost">
                                Add
                              </Button>
                            </form>
                          ) : null;
                        })()}
                      </div>
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
