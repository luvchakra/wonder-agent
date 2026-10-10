import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrations } from "@/modules/integrations/service";
import { connectionTypeOf } from "@/modules/integrations/framework/typeSummary";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, LinkButton, ObjectActionsMenu } from "@/modules/ui";
import { objectActionsFor } from "@/modules/operations/exportRegistry";
import { IntegrationsTable, type ConnectionRow } from "./IntegrationsTable";

/** Connections: the organization's actual systems, each created from a connection type (/integrations/types). */
export default async function ConnectionsPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const integrations = await listIntegrations(ctx.tenantId!);
  const rows: ConnectionRow[] = integrations.map((i) => {
    const type = connectionTypeOf(i);
    return {
      id: i.id,
      name: i.name,
      typeName: type.version ? `${type.name} v${type.version}` : type.name,
      typeHref: type.href,
      status: i.status,
      lastSyncAt: i.lastSyncAt,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Connections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "connection" : "connections"} to your organization&apos;s systems
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ObjectActionsMenu {...objectActionsFor(ctx.permissions, ["integrations"])} />
          <LinkButton href="/integrations/types">New connection</LinkButton>
        </div>
      </div>

      <Card>
        <CardBody>
          <IntegrationsTable rows={rows} />
        </CardBody>
      </Card>
    </div>
  );
}
