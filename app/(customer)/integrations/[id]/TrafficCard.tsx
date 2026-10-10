import { listConnectorTraffic } from "@/modules/integrations/service";
import { Card, CardHeader, CardBody } from "@/modules/ui";
import { formatBytes, formatCount, formatDuration, last24Hours } from "../gateway/format";

/** One connection's last 24 hours through the Connector Gateway. Rendered in a Suspense boundary, so it never holds up the page. */
export async function TrafficCard({ tenantId, integrationId }: { tenantId: string; integrationId: string }) {
  let traffic;
  try {
    traffic = (await listConnectorTraffic(tenantId, { since: last24Hours(), integrationId, pageSize: 1 })).rows[0] ?? null;
  } catch {
    traffic = undefined;
  }
  const figures = traffic
    ? [
        ["Requests", formatCount(traffic.requests)],
        ["Errors", formatCount(traffic.errors)],
        ["Blocked", formatCount(traffic.blocked)],
        ["Data in / out", `${formatBytes(traffic.bytesIn)} / ${formatBytes(traffic.bytesOut)}`],
        ["Avg duration", formatDuration(traffic.avgDurationMs)],
      ]
    : [];

  return (
    <Card>
      <CardHeader title="Traffic (24h)" description="Through the connector gateway" />
      <CardBody>
        {traffic === undefined ? (
          <p className="text-sm text-muted-foreground">Unavailable: the traffic could not be read.</p>
        ) : traffic === null ? (
          <p className="text-sm text-muted-foreground">No traffic in the last 24 hours.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {figures.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

export function TrafficCardSkeleton() {
  return <div className="h-28 animate-pulse rounded-xl border border-border bg-muted" aria-label="Loading traffic" />;
}
