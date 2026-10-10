import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getConnectorDefinition } from "@/modules/integrations/framework/catalog";
import { RESOURCE_KINDS } from "@/modules/integrations/framework/types";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { ConnectForm } from "../../ConnectorForms";
import { connectorSummary } from "../../labels";

export default async function ConnectPage({ params }: { params: Promise<{ origin: string; key: string }> }) {
  const { origin, key } = await params;
  let ctx;
  try {
    ctx = await requirePermission("integration.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  if (origin !== "builtin" && origin !== "custom") notFound();
  const def = await getConnectorDefinition(ctx.tenantId!, origin, key);
  if (!def) notFound();
  const secretFields = def.auth.type === "none" ? [] : def.auth.fields;
  const summary = connectorSummary(
    RESOURCE_KINDS.filter((k) => def.resources[k]),
    Object.keys(def.receive ?? {}),
  );

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/integrations/connectors" className="text-sm text-primary hover:underline">
        ← All connectors
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Connect {def.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Never changes anything in the system. {summary}.</p>
      </div>
      <Card>
        <CardHeader title="Connection" />
        <CardBody>
          <ConnectForm origin={origin} connectorKey={def.key} version={def.version} defaultName={def.name} settings={def.settings} secretFields={secretFields} />
        </CardBody>
      </Card>
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">About this connector</summary>
        <p className="mt-2">{def.description}</p>
        {def.documentationUrl ? (
          <p className="mt-1">
            API reference:{" "}
            <a href={def.documentationUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
              {def.documentationUrl}
            </a>
          </p>
        ) : null}
        <p className="mt-1">
          Definition {def.key} v{def.version}, {def.driver} driver.{" "}
          <Link href={`/integrations/connectors/new?from=${origin}:${def.key}`} className="text-primary hover:underline">
            Use as a starting point
          </Link>
        </p>
      </details>
    </div>
  );
}
