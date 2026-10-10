import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listConnectorTraffic, TRAFFIC_PAGE_SIZE } from "@/modules/integrations/service";
import { Card, CardHeader, CardBody, EmptyState, LinkButton, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";
import { formatBytes, formatCount, formatDuration, last24Hours } from "./format";

/**
 * The Connector Gateway: every connection's traffic, in and out, passes
 * through it (modules/integrations/gateway). This page shows the last 24
 * hours per connection from its ledger (connector_traffic), totalled and
 * paged in the database (§15).
 */
export default async function GatewayPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const params = await searchParams;
  const requested = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const { rows, total } = await listConnectorTraffic(ctx.tenantId!, { since: last24Hours(), page: requested, pageSize: TRAFFIC_PAGE_SIZE });
  // Past the last page there is no row to carry the total: start again from the first.
  if (rows.length === 0 && requested > 1) redirect("/integrations/gateway");
  const pageCount = Math.max(1, Math.ceil(total / TRAFFIC_PAGE_SIZE));
  const href = (p: number) => (p > 1 ? `/integrations/gateway?page=${p}` : "/integrations/gateway");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Gateway</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every connection&apos;s traffic, in and out, passes through the gateway. Last 24 hours.</p>
      </div>

      <Card>
        <CardHeader title="Traffic by connection" />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              title="No traffic in the last 24 hours"
              description="Traffic appears here when a connection syncs, is tested, or receives data."
            />
          ) : (
            <TableContainer label="Traffic by connection" bare>
              <Thead>
                <tr>
                  <Th>Connection</Th>
                  <Th className="text-right">Requests</Th>
                  <Th className="text-right">Errors</Th>
                  <Th className="text-right">Blocked</Th>
                  <Th className="text-right" hideBelow="lg">
                    Data in / out
                  </Th>
                  <Th className="text-right" hideBelow="xl">
                    Avg duration
                  </Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.integrationId ?? "preview"}>
                    <Td>
                      {r.integrationId ? (
                        <Link href={`/integrations/${r.integrationId}`} className="text-primary hover:underline">
                          {r.integrationName ?? "Deleted connection"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Connector previews</span>
                      )}
                    </Td>
                    <Td className="md:text-right tabular-nums">{formatCount(r.requests)}</Td>
                    <Td className={`md:text-right tabular-nums ${r.errors > 0 ? "text-destructive" : ""}`}>{formatCount(r.errors)}</Td>
                    <Td className={`md:text-right tabular-nums ${r.blocked > 0 ? "text-warning" : ""}`}>{formatCount(r.blocked)}</Td>
                    <Td className="md:text-right tabular-nums" hideBelow="lg">
                      {formatBytes(r.bytesIn)} / {formatBytes(r.bytesOut)}
                    </Td>
                    <Td className="md:text-right tabular-nums" hideBelow="xl">
                      {formatDuration(r.avgDurationMs)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}

          {pageCount > 1 ? (
            <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
              <span className="text-muted-foreground">
                {total} connections · page {Math.min(requested, pageCount)} of {pageCount}
              </span>
              <span className="flex gap-2">
                {requested > 1 ? (
                  <LinkButton href={href(requested - 1)} variant="outline" size="sm">
                    Previous
                  </LinkButton>
                ) : null}
                {requested < pageCount ? (
                  <LinkButton href={href(requested + 1)} variant="outline" size="sm">
                    Next
                  </LinkButton>
                ) : null}
              </span>
            </nav>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
