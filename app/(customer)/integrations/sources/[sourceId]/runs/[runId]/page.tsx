import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentitySource, getReconciliationRun } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { RunAutoRefresh } from "../../../SourceForms";
import { RUN_STATUS, TARGET_LABEL } from "../../../labels";

// INTEGRATION-P0-09 — one reconciliation run: what it did, record by record.

const ACTION_LABEL: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  leaver: "Leaver",
  missing: "Missing (reported)",
  pending: "Needs a decision",
  error: "Failed",
  would_create: "Would be created",
  would_compare: "Would be compared and updated",
  would_hold: "Would wait for a decision",
  would_leave: "Would become a leaver",
};

export default async function ReconciliationRunPage({ params }: { params: Promise<{ sourceId: string; runId: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { sourceId, runId } = await params;
  const [source, run] = await Promise.all([getIdentitySource(ctx.tenantId!, sourceId), getReconciliationRun(ctx.tenantId!, runId)]);
  if (!source || !run || run.sourceId !== source.id) notFound();
  const active = run.status === "queued" || run.status === "running";

  return (
    <div className="space-y-5">
      <RunAutoRefresh active={active} />
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/integrations/sources" className="hover:text-foreground hover:underline">
          Identity sources
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/integrations/sources/${source.id}`} className="hover:text-foreground hover:underline">
          {source.name}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Run</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{run.dryRun ? "Reconciliation preview" : "Reconciliation run"}</h1>
        <Badge tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {run.trigger === "upload" ? "File import" : "From the integration"}, {run.mode === "full" ? "full population" : "partial"} · started{" "}
        {new Date(run.startedAt ?? run.createdAt).toLocaleString("en-GB")}
        {run.endedAt ? ` · finished ${new Date(run.endedAt).toLocaleTimeString("en-GB")}` : ""}
      </p>
      {active ? (
        <p role="status" className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          This run is {run.status}. The page refreshes by itself.
        </p>
      ) : null}
      {run.dryRun ? (
        <p role="note" className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          Preview: this run planned what an import would do and changed nothing. &ldquo;Updated&rdquo; counts the records it would compare; only
          fields that differ change in a real run.
        </p>
      ) : null}
      {run.guardTripped ? (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          No leavers were applied: too many linked identities were missing from this run, which usually means an incomplete file. Nobody
          was disabled.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard size="sm" icon="FileText" label="Records" value={run.recordsSeen} />
        <KpiCard size="sm" icon="UserPlus" tone="success" label="Created" value={run.createdCount} />
        <KpiCard size="sm" icon="Users" tone="primary" label="Updated" value={run.updatedCount} />
        <KpiCard size="sm" icon="Clock" label="Unchanged" value={run.unchangedCount} />
        <KpiCard size="sm" icon="UserSearch" tone="warning" label="Pending" value={run.pendingCount} href="/integrations/correlations" />
        <KpiCard size="sm" icon="UserX" tone="danger" label="Leavers" value={run.leaverCount} />
        <KpiCard size="sm" icon="CircleAlert" tone="danger" label="Problems" value={run.recordsInvalid + run.errorCount} />
      </div>

      {run.errors.length ? (
        <Card>
          <CardHeader title="Problems" description="Records that could not be used, and anything that stopped the run." />
          <CardBody>
            <ul className="divide-y divide-border text-sm">
              {run.errors.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-3 py-2">
                  {e.ref ? <span className="font-mono text-xs text-muted-foreground">{e.ref}</span> : null}
                  <span className="text-foreground">{e.message}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Changes" description={run.changes.length >= 500 ? "The first 500 changes." : undefined} />
        <CardBody>
          {run.changes.length === 0 ? (
            <EmptyState title={active ? "Working…" : "No changes"} description={active ? undefined : "Every record matched an identity that was already up to date."} />
          ) : (
            <TableContainer label="Changes" bare>
              <Thead>
                <tr>
                  <Th>Source record</Th>
                  <Th>Result</Th>
                  <Th hideBelow="lg">Fields</Th>
                </tr>
              </Thead>
              <tbody>
                {run.changes.map((c, i) => (
                  <Tr key={`${c.ref}-${i}`}>
                    <Td>
                      {c.identityId ? (
                        <Link href={`/identities/${c.identityId}`} className="font-mono text-xs text-primary hover:underline">
                          {c.ref}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{c.ref}</span>
                      )}
                    </Td>
                    <Td>{ACTION_LABEL[c.action] ?? c.action}</Td>
                    <Td hideBelow="lg">
                      <span className="text-xs text-muted-foreground">{c.changed?.length ? c.changed.map((f) => TARGET_LABEL[f as keyof typeof TARGET_LABEL] ?? (f === "managerIdentityId" ? "Manager" : f)).join(", ") : "—"}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
