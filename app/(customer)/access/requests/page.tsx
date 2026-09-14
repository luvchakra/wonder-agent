import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAccessRequests } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { decideAccessRequestAction } from "@/app/actions/access";
import { Card, CardHeader, CardBody, Button, Badge, EmptyState, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  fulfilled: "neutral",
};

export default async function AccessRequestsPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const requests = await listAccessRequests(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <Link href="/access" className="text-sm text-primary hover:underline">
        ← Applications
      </Link>
      <h1 className="text-xl font-semibold text-foreground">Access Requests</h1>

      <Card>
        <CardHeader title="Requests" description={`${requests.length} total`} />
        <CardBody>
          {requests.length === 0 ? (
            <EmptyState title="No access requests yet" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Justification</Th>
                  <Th>Status</Th>
                  <Th>Decide</Th>
                </tr>
              </Thead>
              <tbody>
                {requests.map((r) => {
                  const decideWithId = decideAccessRequestAction.bind(null, r.id);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/agents/${r.agentId}`} className="text-primary hover:underline">
                          {r.agentId}
                        </Link>
                      </Td>
                      <Td>{r.justification}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                      </Td>
                      <Td>
                        {r.status === "pending" && (
                          <form action={decideWithId} className="flex gap-2">
                            <Button type="submit" name="decision" value="approved" size="sm">
                              Approve
                            </Button>
                            <Button type="submit" name="decision" value="rejected" variant="destructive" size="sm">
                              Reject
                            </Button>
                          </form>
                        )}
                        {r.status === "approved" && (
                          <form action={decideWithId}>
                            <Button type="submit" name="decision" value="fulfilled" variant="secondary" size="sm">
                              Mark fulfilled
                            </Button>
                          </form>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
