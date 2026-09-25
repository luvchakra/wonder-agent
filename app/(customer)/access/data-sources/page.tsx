import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listApplications, listDataSources, listEntitlementsForTenant } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard, TableContainer, Td, Th, Thead, Tr, type BadgeTone } from "@/modules/ui";
import { CreateDataSourceForm, LinkEntitlementForm, ReclassifyForm } from "./DataSourceForms";

// ACCESS-P0-13 (master P0-11) — where data lives and which agents can
// reach it. "Agents that can reach it" is CAN: agents currently holding
// an entitlement linked to the data source. Three independent reads, in
// parallel (§15).

const SENSITIVE = /restricted|confidential|secret|pii|phi|pci|financial|customer|personal/i;
const KIND_LABEL: Record<string, string> = {
  database: "Database",
  warehouse: "Warehouse",
  object_store: "Object store",
  file_share: "File share",
  saas: "SaaS",
  api: "API",
  other: "Other",
};

function classificationTone(c: string | null): BadgeTone {
  if (!c) return "neutral";
  return SENSITIVE.test(c) ? "danger" : "info";
}

export default async function DataSourcesPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const [sources, applications, entitlements] = await Promise.all([listDataSources(tenantId), listApplications(tenantId), listEntitlementsForTenant(tenantId)]);
  const canManage = ctx.permissions.includes("access.manage");
  const active = sources.filter((s) => s.status === "active");

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access" className="hover:text-foreground hover:underline">
          Access Intelligence
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Data sources</span>
      </nav>

      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Data sources</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Where your data lives, how it is classified, and which agents can technically reach it (CAN) through the entitlements
          that open it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard size="sm" icon="ScrollText" tone="primary" label="Data sources" value={active.length} />
        <KpiCard size="sm" icon="ShieldAlert" tone="danger" label="Sensitive" value={active.filter((s) => s.classification && SENSITIVE.test(s.classification)).length} />
        <KpiCard size="sm" icon="CircleAlert" tone="warning" label="Unclassified" value={active.filter((s) => !s.classification).length} />
        <KpiCard size="sm" icon="Bot" tone="violet" label="Reachable by agents" value={active.filter((s) => s.agentIds.length > 0).length} />
      </div>

      <Card className="p-4">
        {sources.length === 0 ? (
          <EmptyState title="No data sources yet" description="Add the databases, warehouses and stores your agents' entitlements open." />
        ) : (
          <TableContainer label="Data sources" bare>
            <Thead>
              <tr>
                <Th>Data source</Th>
                <Th>Classification</Th>
                <Th>Agents that can reach it</Th>
                <Th hideBelow="lg">Entitlements</Th>
                <Th hideBelow="xl">Application</Th>
                <Th hideBelow="xl">Owner</Th>
              </tr>
            </Thead>
            <tbody>
              {sources.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <span className="block font-medium text-foreground">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {KIND_LABEL[s.kind] ?? s.kind}
                      {s.status === "retired" ? " · retired" : ""}
                    </span>
                  </Td>
                  <Td>
                    {canManage ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {s.classification ? (
                          <Badge tone={classificationTone(s.classification)} className="whitespace-nowrap">
                            {s.classification}
                          </Badge>
                        ) : null}
                        <ReclassifyForm id={s.id} name={s.name} current={s.classification} />
                      </span>
                    ) : s.classification ? (
                      <Badge tone={classificationTone(s.classification)} className="whitespace-nowrap">
                        {s.classification}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">Unclassified</span>
                    )}
                  </Td>
                  <Td>
                    {s.agentIds.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : s.agentIds.length === 1 ? (
                      <Link href={`/access/agents/${s.agentIds[0]}`} className="text-primary hover:underline">
                        1 agent
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{s.agentIds.length} agents</span>
                    )}
                  </Td>
                  <Td hideBelow="lg">{s.entitlementCount}</Td>
                  <Td hideBelow="xl">{s.applicationName ? <span className="md:whitespace-nowrap">{s.applicationName}</span> : <span className="text-muted-foreground">—</span>}</Td>
                  <Td hideBelow="xl">{s.owner ?? <span className="text-muted-foreground">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}
      </Card>

      {canManage ? (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
          <Card>
            <CardHeader title="Add a data source" description="Recorded in the audit log. A data source is retired, never deleted." />
            <CardBody>
              <CreateDataSourceForm applications={applications.map((a) => ({ id: a.id, name: a.name }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Link an entitlement"
              description="Say which data source an entitlement opens. Every agent holding it can then reach that data, and its classification applies."
            />
            <CardBody>
              {active.length === 0 || entitlements.length === 0 ? (
                <EmptyState title="Nothing to link yet" description="You need at least one data source and one entitlement." />
              ) : (
                <LinkEntitlementForm
                  entitlements={entitlements.map((e) => ({ id: e.id, label: `${e.applicationName} · ${e.name}` }))}
                  dataSources={active.map((d) => ({ id: d.id, name: d.name }))}
                />
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
