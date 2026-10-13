import Link from "next/link";
import { listTenants, getSubscription, testTenantIds } from "@/modules/platform-admin/service";
import { createTenantAction } from "@/app/actions/platform";
import { baseAppHost, tenantUrl } from "@/lib/tenant/host";
import type { PlatformTenant, Subscription } from "@/lib/shared/types/platform";
import { Badge, Button, Card, CardBody, EnvironmentBadge, StatusBadge, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { PageHeading } from "../PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const STATUS = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  deprovisioned: { tone: "neutral", label: "Decommissioned" },
} as const;

type Row = { tenant: PlatformTenant; subscription: Subscription | null };

/**
 * One row per organization: its name and address, environment, status and
 * plan. Everything you change about it (address, environment, plan, status,
 * environments, usage) is on its Manage page (owner request 2026-10-13: the
 * table was too crowded and a plan could not be changed).
 */
function TenantTable({ rows, base, label }: { rows: Row[]; base: string | null; label: string }) {
  return (
    <TableContainer label={label} bare>
      <Thead>
        <tr>
          <Th>Organization</Th>
          <Th>Environment</Th>
          <Th>Status</Th>
          <Th hideBelow="lg">Plan</Th>
          <Th className="text-right">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </Thead>
      <tbody>
        {rows.map(({ tenant, subscription }) => {
          const status = STATUS[tenant.status ?? "active"];
          const url = base && tenant.slug && tenant.status !== "deprovisioned" ? tenantUrl(tenant.slug, base) : null;
          return (
            <Tr key={tenant.tenantId}>
              <Td className={cn(tenant.parentTenantId && "md:pl-8")}>
                <div className="min-w-0">
                  <Link href={`/platform-admin/tenants/${tenant.tenantId}`} className="font-medium text-foreground hover:text-primary hover:underline">
                    {tenant.name}
                  </Link>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                        {url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      tenant.slug
                    )}
                  </p>
                </div>
              </Td>
              <Td>
                <EnvironmentBadge environment={tenant.environment} />
              </Td>
              <Td>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </Td>
              <Td hideBelow="lg">{subscription?.plan ? <Badge tone="info" className="capitalize">{subscription.plan}</Badge> : <span className="text-xs text-muted-foreground">None</span>}</Td>
              <Td className="md:text-right">
                <Link href={`/platform-admin/tenants/${tenant.tenantId}`} className="whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent">
                  Manage
                </Link>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableContainer>
  );
}

export default async function PlatformTenantsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const showAll = (await searchParams).all === "1";
  const listed = await listTenants({ includeDecommissioned: showAll });
  // Each production organization followed by its environments (migration 0156).
  const childrenOf = (id: string) => listed.filter((t) => t.parentTenantId === id);
  const ordered = listed.filter((t) => !t.parentTenantId || !listed.some((p) => p.tenantId === t.parentTenantId)).flatMap((t) => [t, ...childrenOf(t.tenantId)]);
  const [subscriptions, testIds] = await Promise.all([Promise.all(ordered.map((t) => getSubscription(t.tenantId))), testTenantIds(ordered)]);
  // Organizations the E2E suite and SQL fixtures create, kept apart from real ones (owner request 2026-10-13).
  const isTestOrganization = (t: PlatformTenant) => testIds.has(t.tenantId);
  const rows: Row[] = ordered.map((tenant, i) => ({ tenant, subscription: subscriptions[i] }));
  const real = rows.filter((r) => !isTestOrganization(r.tenant));
  const test = rows.filter((r) => isTestOrganization(r.tenant));
  const base = baseAppHost();

  return (
    <>
      <PageHeading title="Tenants" description={`${real.length} organization${real.length === 1 ? "" : "s"}${showAll ? "" : ", decommissioned ones hidden"}.`}>
        <Link href={showAll ? "/platform-admin/tenants" : "/platform-admin/tenants?all=1"} className="text-sm font-medium text-primary hover:underline">
          {showAll ? "Hide decommissioned" : "Show decommissioned"}
        </Link>
      </PageHeading>

      <Card>{real.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No organizations yet.</p> : <TenantTable rows={real} base={base} label="Organizations" />}</Card>

      {test.length ? (
        <details className="group rounded-xl border border-border/60 bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-card-foreground">Test organizations ({test.length})</summary>
          <div className="border-t border-border">
            <TenantTable rows={test} base={base} label="Test organizations" />
          </div>
        </details>
      ) : null}

      <details className="group rounded-xl border border-border/60 bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-card-foreground">Create an organization</summary>
        <CardBody className="border-t border-border">
          <form action={createTenantAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
            <div>
              <label htmlFor="tenant-name" className={fieldLabelClass}>Name</label>
              <input id="tenant-name" name="name" placeholder="Acme Corp" required className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="tenant-slug" className={fieldLabelClass}>Address prefix</label>
              <input id="tenant-slug" name="slug" placeholder="acme-corp" required className={cn(fieldInputClass, "font-mono")} />
            </div>
            <div>
              <label htmlFor="tenant-environment" className={fieldLabelClass}>Environment</label>
              <select id="tenant-environment" name="environment" defaultValue="production" className={fieldInputClass}>
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </div>
            <Button type="submit">Create</Button>
          </form>
        </CardBody>
      </details>
    </>
  );
}
