import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrations } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody, Badge, LinkButton, EmptyState, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  configured: "neutral",
  connected: "success",
  error: "danger",
  disabled: "neutral",
};

export default async function IntegrationsPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const integrations = await listIntegrations(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
        <LinkButton href="/integrations/new">+ Add integration</LinkButton>
      </div>

      <Card>
        <CardHeader title="Connected systems" description={`${integrations.length} configured`} />
        <CardBody>
          {integrations.length === 0 ? (
            <EmptyState
              title="No integrations configured yet"
              description="Connect Saviynt, a generic REST source, or an MCP server to start importing AI agent identity and access."
              action={<LinkButton href="/integrations/new" variant="secondary">Add integration</LinkButton>}
            />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Last sync</Th>
                </tr>
              </Thead>
              <tbody>
                {integrations.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link href={`/integrations/${i.id}`} className="text-primary hover:underline">
                        {i.name}
                      </Link>
                    </Td>
                    <Td>{i.integrationTypeId}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Badge>
                    </Td>
                    <Td>{i.lastSyncAt ?? "never"}</Td>
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
