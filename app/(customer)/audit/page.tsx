import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAuditLogs } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, Badge, Button, EmptyState, TextField, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

/** First 8 characters of a UUID-like id, enough to tell rows apart at a glance. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  let ctx;
  try {
    ctx = await requirePermission("audit.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const page = await listAuditLogs(
    ctx.tenantId!,
    { objectType: params.objectType, action: params.action, actorId: params.actorId, from: params.from, to: params.to },
    params.cursor ?? null,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Audit Trail</h1>
        <a href="/api/v1/audit/export?format=csv" className="text-sm text-primary hover:underline">
          Export CSV
        </a>
      </div>

      <Card>
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <TextField label="Object type" name="objectType" defaultValue={params.objectType ?? ""} />
            <TextField label="Action" name="action" defaultValue={params.action ?? ""} />
            <TextField label="Actor ID" name="actorId" defaultValue={params.actorId ?? ""} />
            <TextField label="From" name="from" type="datetime-local" defaultValue={params.from ?? ""} />
            <TextField label="To" name="to" type="datetime-local" defaultValue={params.to ?? ""} />
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {page.entries.length === 0 ? (
            <EmptyState title="No audit entries match this filter" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th hideBelow="lg">Object</Th>
                  <Th>Outcome</Th>
                </tr>
              </Thead>
              <tbody>
                {page.entries.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
                      <time dateTime={e.createdAt} title={e.createdAt}>
                        {e.createdAt.slice(0, 19).replace("T", " ")}
                      </time>
                    </Td>
                    <Td>
                      {/* Ids shortened for the table (full value on hover, in
                          the Actor ID filter and in the CSV export) — full
                          UUIDs made this table scroll sideways below 1440px. */}
                      <span title={e.actorId ?? undefined}>
                        {e.actorType}
                        {e.actorId ? <span className="font-mono text-xs text-muted-foreground"> {shortId(e.actorId)}</span> : null}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">{e.action}</Td>
                    <Td hideBelow="lg">
                      <span title={e.objectId ?? undefined}>
                        {e.objectType}
                        {e.objectId ? <span className="font-mono text-xs text-muted-foreground"> {shortId(e.objectId)}</span> : null}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={e.outcome === "success" ? "success" : "danger"}>{e.outcome}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      {page.nextCursor && (
        <Link
          href={`/audit?${new URLSearchParams(
            Object.fromEntries(
              Object.entries({ ...params, cursor: page.nextCursor }).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
          ).toString()}`}
          className="text-sm text-primary hover:underline"
        >
          Next page →
        </Link>
      )}
    </div>
  );
}
