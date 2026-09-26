import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentitySource, listIntegrations, listReconciliationRuns } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { CsvImportForm, IntegrationImportForm, RunAutoRefresh, SourceForm } from "../SourceForms";
import { RUN_STATUS, TEMPLATE_LABEL } from "../labels";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function IdentitySourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { sourceId } = await params;
  const tenantId = ctx.tenantId!;
  const [source, runs, integrations] = await Promise.all([getIdentitySource(tenantId, sourceId), listReconciliationRuns(tenantId, sourceId), listIntegrations(tenantId)]);
  if (!source) notFound();
  const canRun = ctx.permissions.includes("integration.execute") && source.status === "active";
  const canEdit = ctx.permissions.includes("integration.update");
  const integration = integrations.find((i) => i.id === source.integrationId);
  const active = runs.some((r) => r.status === "queued" || r.status === "running");

  return (
    <div className="space-y-5">
      <RunAutoRefresh active={active} />
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/integrations/sources" className="hover:text-foreground hover:underline">
          Identity sources
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{source.name}</span>
      </nav>
      <div>
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">{source.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{TEMPLATE_LABEL[source.template]}</Badge>
          {source.authoritative ? <Badge tone="info">Authoritative · precedence {source.priority}</Badge> : <Badge tone="neutral">Precedence {source.priority}</Badge>}
          {source.status === "paused" ? <Badge tone="warning">Paused</Badge> : null}
          {integration ? (
            <Link href={`/integrations/${integration.id}`} className="text-xs text-primary hover:underline">
              Reads {integration.name}
            </Link>
          ) : null}
        </div>
      </div>

      {canRun ? (
        <Card>
          <CardHeader
            title="Import"
            description="Full: the file or integration holds everyone, so identities missing from it are leavers. Partial: only the records given are touched."
          />
          <CardBody>{source.template === "integration" ? <IntegrationImportForm sourceId={source.id} /> : <CsvImportForm sourceId={source.id} />}</CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Runs" description="The latest 25." />
        <CardBody>
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" description={canRun ? "Import a file or reconcile from the integration to start." : undefined} />
          ) : (
            <TableContainer label="Reconciliation runs" bare>
              <Thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>Updated</Th>
                  <Th hideBelow="lg">Pending</Th>
                  <Th hideBelow="lg">Leavers</Th>
                  <Th hideBelow="xl">Invalid</Th>
                </tr>
              </Thead>
              <tbody>
                {runs.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/integrations/sources/${source.id}/runs/${r.id}`} className="text-primary hover:underline">
                        {when(r.createdAt)}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {r.trigger === "upload" ? "File" : "Integration"} · {r.mode}
                        {r.dryRun ? " · preview" : ""}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{r.createdCount}</span>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{r.updatedCount}</span>
                    </Td>
                    <Td hideBelow="lg">
                      <span className="tabular-nums">{r.pendingCount}</span>
                    </Td>
                    <Td hideBelow="lg">
                      <span className="tabular-nums">{r.leaverCount}</span>
                    </Td>
                    <Td hideBelow="xl">
                      <span className="tabular-nums">{r.recordsInvalid}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader title="Configuration" />
          <CardBody>
            <SourceForm source={source} integrations={[]} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
