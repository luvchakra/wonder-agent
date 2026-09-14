import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, TableContainer, Thead, Th, Tr, Td, EmptyState } from "@/modules/ui";

// Composition-only index over Identity's agents, per EXPERIENCE-P0-03 —
// Runtime Agent owns /runtime/agents/:id itself; this list view is
// Experience Agent's own addition to make that reachable from nav (no
// bare index page existed before this story).
export default async function RuntimeIndexPage() {
  let ctx;
  try {
    ctx = await requirePermission("runtime.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const agents = await listAgents(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Runtime Assurance</h1>
      <Card>
        <CardBody>
          {agents.length === 0 ? (
            <EmptyState title="No agents registered yet" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Type</Th>
                  <Th>Environment</Th>
                </tr>
              </Thead>
              <tbody>
                {agents.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`/runtime/agents/${a.id}`} className="text-primary hover:underline">
                        {a.agentName}
                      </Link>
                    </Td>
                    <Td>{a.agentType}</Td>
                    <Td>{a.environment}</Td>
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
