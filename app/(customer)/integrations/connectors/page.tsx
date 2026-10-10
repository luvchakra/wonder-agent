import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listConnectorDefinitions } from "@/modules/integrations/framework/catalog";
import { CONNECTOR_CATEGORIES } from "@/modules/integrations/framework/types";
import { Badge, Card, CardBody, CardHeader, LinkButton } from "@/modules/ui";
import { CATEGORY_LABEL, connectorSummary } from "./labels";

export default async function ConnectorCatalogPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const definitions = await listConnectorDefinitions(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <Link href="/integrations" className="text-sm text-primary hover:underline">
        ← All integrations
      </Link>
      <h1 className="text-xl font-semibold text-foreground">Connect a system</h1>
      {CONNECTOR_CATEGORIES.map((category) => {
        const items = definitions.filter((d) => d.category === category);
        if (items.length === 0) return null;
        return (
          <Card key={category}>
            <CardHeader title={CATEGORY_LABEL[category]} />
            <CardBody className="p-0">
              <ul className="divide-y divide-border">
                {items.map((d) => (
                  <li key={`${d.origin}:${d.key}`} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{d.name}</span>
                        {d.origin === "custom" ? <Badge tone="info">Your organization · v{d.version}</Badge> : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{connectorSummary(d.resources, d.receives)}</p>
                    </div>
                    <LinkButton href={`/integrations/connectors/${d.origin}/${d.key}`} variant="secondary" className="shrink-0">
                      Connect
                    </LinkButton>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        );
      })}
      <p className="text-sm text-muted-foreground">
        System not listed?{" "}
        <Link href="/integrations/connectors/new" className="text-primary hover:underline">
          Write a connector
        </Link>{" "}
        for it.
      </p>
    </div>
  );
}
