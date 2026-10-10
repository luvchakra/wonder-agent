import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrations } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody, LinkButton, ObjectActionsMenu } from "@/modules/ui";
import { objectActionsFor } from "@/modules/operations/exportRegistry";
import { IntegrationsTable } from "./IntegrationsTable";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ObjectActionsMenu {...objectActionsFor(ctx.permissions, ["integrations"])} />
          <LinkButton href="/integrations/connectors">+ Connect a system</LinkButton>
        </div>
      </div>

      <Card>
        <CardHeader title="Connected systems" description={`${integrations.length} configured`} />
        <CardBody>
          <IntegrationsTable integrations={integrations} />
        </CardBody>
      </Card>
    </div>
  );
}
