import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getConnectorDefinition } from "@/modules/integrations/framework/catalog";
import { connectionTypeHref, connectorSummary, describeConnectionType } from "@/modules/integrations/framework/typeSummary";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { ConnectForm } from "../../../ConnectorForms";

/** Creates a connection of one type: its settings and credentials, tested before they are stored. */
export default async function CreateConnectionPage({ params }: { params: Promise<{ origin: string; key: string }> }) {
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
  const t = describeConnectionType(def, origin);
  const secretFields = def.auth.type === "none" ? [] : def.auth.fields;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href={connectionTypeHref(origin, def.key)} className="text-sm text-primary hover:underline">
        ← {def.name}
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Connect {def.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.protocol}. Never changes anything in the system.{" "}
          {connectorSummary(
            t.reads.map((r) => r.kind),
            t.receives.map((r) => r.channel),
          )}
          .
        </p>
      </div>
      <Card>
        <CardHeader title="Connection" />
        <CardBody>
          <ConnectForm origin={origin} connectorKey={def.key} version={def.version} defaultName={def.name} settings={def.settings} secretFields={secretFields} />
        </CardBody>
      </Card>
    </div>
  );
}
