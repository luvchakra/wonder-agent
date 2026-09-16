import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getJobStatusSummary } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardHeader, CardBody, EmptyState, TableContainer, Thead, Th, Td, Tr, type BadgeTone } from "@/modules/ui";

const STATUS_TONE: Record<string, BadgeTone> = {
  succeeded: "success",
  partial: "warning",
  failed: "danger",
  running: "info",
  queued: "neutral",
};

/**
 * OPERATIONS-P0-06.1 — the customer-facing job-status page this story
 * flagged as a scope cut. Composes Operations' already-published
 * `getJobStatusSummary()` (itself read-only presentation over Integration
 * Agent's `integration_sync_jobs`) — no new data logic here.
 */
export default async function JobStatusPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const summary = await getJobStatusSummary(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Job Status</h1>
        <p className="mt-1 text-sm text-muted-foreground">Connector sync/job health across every integration in this tenant.</p>
      </div>

      <Card>
        <CardHeader title="Integrations" description={`${summary.length} configured`} />
        <CardBody>
          {summary.length === 0 ? (
            <EmptyState title="No integrations configured" description="Connect a system to see its sync job status here." />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Integration</Th>
                  <Th>Last run</Th>
                  <Th>Last successful</Th>
                  <Th>Failures (30d)</Th>
                  <Th>Total retries</Th>
                </tr>
              </Thead>
              <tbody>
                {summary.map((s) => (
                  <Tr key={s.integrationId}>
                    <Td>
                      <Link href={`/integrations/${s.integrationId}`} className="text-primary hover:underline">
                        {s.integrationName}
                      </Link>
                    </Td>
                    <Td>
                      {s.lastRunStatus ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge tone={STATUS_TONE[s.lastRunStatus] ?? "neutral"}>{s.lastRunStatus}</Badge>
                          <span className="text-muted-foreground">{s.lastRunAt ?? "—"}</span>
                        </span>
                      ) : (
                        "Never run"
                      )}
                    </Td>
                    <Td>{s.lastSuccessfulAt ?? "—"}</Td>
                    <Td>
                      {s.failureCountLast30Days > 0 ? <Badge tone="danger">{s.failureCountLast30Days}</Badge> : <span className="text-muted-foreground">0</span>}
                    </Td>
                    <Td>{s.totalRetries}</Td>
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
