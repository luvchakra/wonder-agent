import Link from "next/link";
import { listTenants, getSubscription, testTenantIds, organizationOwners } from "@/modules/platform-admin/service";
import { groupOrganizations, type Organization } from "@/modules/platform-admin/organizations";
import { createTenantAction } from "@/app/actions/platform";
import { baseAppHost, tenantUrl } from "@/lib/tenant/host";
import type { Subscription } from "@/lib/shared/types/platform";
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

type Row = { org: Organization; owners: { email: string; name: string | null }[]; subscription: Subscription | null };

/**
 * Owner request (2026-10-13): one row per organization, holding its
 * environments; its owners; its plan and status. Manage opens the
 * organization, where each environment is managed, added or removed.
 */
function OrganizationTable({ rows, base, label }: { rows: Row[]; base: string | null; label: string }) {
  return (
    <TableContainer label={label} bare>
      <Thead>
        <tr>
          <Th>Organization</Th>
          <Th hideBelow="lg">Owner</Th>
          <Th>Environments</Th>
          <Th hideBelow="xl">Plan</Th>
          <Th>Status</Th>
          <Th className="text-right">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </Thead>
      <tbody>
        {rows.map(({ org, owners, subscription }) => {
          const status = STATUS[org.primary.status ?? "active"];
          const url = base && org.primary.slug && org.primary.status !== "deprovisioned" ? tenantUrl(org.primary.slug, base) : null;
          return (
            <Tr key={org.id}>
              <Td>
                <div className="min-w-0">
                  <Link href={`/platform-admin/tenants/${org.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                    {org.name}
                  </Link>
                  <p className="truncate font-mono text-xs text-muted-foreground">{url ? url.replace(/^https?:\/\//, "") : org.primary.slug}</p>
                </div>
              </Td>
              <Td hideBelow="lg">
                {owners.length ? (
                  <span className="text-sm text-foreground" title={owners.map((o) => o.email).join(", ")}>
                    {owners[0].name || owners[0].email}
                    {owners.length > 1 ? <span className="text-muted-foreground"> +{owners.length - 1}</span> : null}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No owner</span>
                )}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {org.environments.map((e) => (
                    <Link key={e.tenantId} href={`/platform-admin/tenants/${e.tenantId}`} title={e.slug}>
                      <EnvironmentBadge environment={e.environment} className={cn(e.status !== "active" && "opacity-50")} />
                    </Link>
                  ))}
                </div>
              </Td>
              <Td hideBelow="xl">{subscription?.plan ? <Badge tone="info" className="capitalize">{subscription.plan}</Badge> : <span className="text-xs text-muted-foreground">None</span>}</Td>
              <Td>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </Td>
              <Td className="md:text-right">
                <Link href={`/platform-admin/tenants/${org.id}`} className="whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent">
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

export default async function PlatformOrganizationsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const showAll = (await searchParams).all === "1";
  const tenants = await listTenants({ includeDecommissioned: showAll });
  const orgs = groupOrganizations(tenants);
  const [subscriptions, testIds, owners] = await Promise.all([Promise.all(orgs.map((o) => getSubscription(o.id))), testTenantIds(orgs.map((o) => o.primary)), organizationOwners(orgs.map((o) => o.id))]);
  const rows: Row[] = orgs.map((org, i) => ({ org, owners: owners.get(org.id) ?? [], subscription: subscriptions[i] }));
  // Organizations the E2E suite and SQL fixtures create, kept apart from real ones.
  const real = rows.filter((r) => !testIds.has(r.org.id));
  const test = rows.filter((r) => testIds.has(r.org.id));
  const base = baseAppHost();

  return (
    <>
      <PageHeading title="Organizations" description={`${real.length} organization${real.length === 1 ? "" : "s"}, each with its environments${showAll ? "" : "; decommissioned ones hidden"}.`}>
        <Link href={showAll ? "/platform-admin/tenants" : "/platform-admin/tenants?all=1"} className="text-sm font-medium text-primary hover:underline">
          {showAll ? "Hide decommissioned" : "Show decommissioned"}
        </Link>
      </PageHeading>

      <Card>{real.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No organizations yet.</p> : <OrganizationTable rows={real} base={base} label="Organizations" />}</Card>

      {test.length ? (
        <details className="group rounded-xl border border-border/60 bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-card-foreground">Test organizations ({test.length})</summary>
          <div className="border-t border-border">
            <OrganizationTable rows={test} base={base} label="Test organizations" />
          </div>
        </details>
      ) : null}

      <details className="group rounded-xl border border-border/60 bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-card-foreground">Create an organization</summary>
        <CardBody className="border-t border-border">
          <form action={createTenantAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="tenant-name" className={fieldLabelClass}>Name</label>
              <input id="tenant-name" name="name" placeholder="Acme Corp" required className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="tenant-slug" className={fieldLabelClass}>Address prefix</label>
              <input id="tenant-slug" name="slug" placeholder="acme-corp" required className={cn(fieldInputClass, "font-mono")} />
            </div>
            <input type="hidden" name="environment" value="production" />
            <Button type="submit">Create</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Created as the production environment; add Dev, Test or Staging from the organization.</p>
        </CardBody>
      </details>
    </>
  );
}
