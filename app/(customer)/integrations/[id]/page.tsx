import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIntegration, getReceiverStatus, listSyncJobs } from "@/modules/integrations/service";
import { testConnectionAction, triggerSyncAction } from "@/app/actions/integrations";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody, Badge, Button, EmptyState, type BadgeTone } from "@/modules/ui";
import { parseConnectorConfig } from "@/modules/integrations/framework/engine";
import type { ConnectorDefinition } from "@/modules/integrations/framework/types";
import { connectionTypeOf } from "@/modules/integrations/framework/typeSummary";
import { ConnectorCredentialsForm, ReceiverSecretForm } from "../types/ConnectorForms";
import { Suspense } from "react";
import { TrafficCard, TrafficCardSkeleton } from "./TrafficCard";

const JOB_STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  running: "info",
  succeeded: "success",
  failed: "danger",
  partial: "warning",
};

/** The definition a connection runs, or null when its stored definition can no longer be read. */
function connectorDefinition(integration: { integrationTypeId: string; config: Record<string, unknown> }): ConnectorDefinition | null {
  if (integration.integrationTypeId !== "connector") return null;
  try {
    return parseConnectorConfig(integration.config).def;
  } catch {
    return null;
  }
}

/** This deployment's own address, for the receiving endpoints a connection's systems call. */
async function ownOrigin(): Promise<string> {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

export default async function IntegrationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ credentials?: string }>;
}) {
  const { id } = await params;
  const { credentials } = await searchParams;
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  // Not a connection id at all (e.g. /integrations/new): not found, not an error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const integration = await getIntegration(ctx.tenantId!, id);
  if (!integration) notFound();
  const connector = connectorDefinition(integration);
  const receive = connector?.receive;
  const needsSecret = Boolean(receive?.runtimeEvents || receive?.webhook);

  const [jobs, receiver, origin] = await Promise.all([
    listSyncJobs(ctx.tenantId!, id),
    needsSecret ? getReceiverStatus(ctx.tenantId!, id) : Promise.resolve(null),
    receive ? ownOrigin() : Promise.resolve(""),
  ]);
  const reads = connector ? Object.keys(connector.resources).length > 0 : false;
  const type = connectionTypeOf(integration);
  const testConnectionWithId = testConnectionAction.bind(null, id);
  const triggerSyncWithId = triggerSyncAction.bind(null, id);
  const endpoint = (channel: string) => `${origin}/api/connect/v1/${id}/${channel}`;

  return (
    <div className="space-y-4">
      <Link href="/integrations" className="text-sm text-primary hover:underline">
        ← Connections
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{integration.name}</h1>
          <Badge tone={integration.status === "connected" ? "success" : integration.status === "error" ? "danger" : "neutral"}>{integration.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Type:{" "}
          {type.href ? (
            <Link href={type.href} className="text-primary hover:underline">
              {type.version ? `${type.name} v${type.version}` : type.name}
            </Link>
          ) : (
            type.name
          )}
          {reads ? ` · Has credentials: ${integration.hasCredentials ? "yes" : "no"} · Last sync: ${integration.lastSyncAt ?? "never"}` : ""}
        </p>
      </div>

      {!connector ? (
        <p role="alert" className="text-sm text-destructive">
          This connection&apos;s connector definition can no longer be read, so it can neither sync nor receive.
        </p>
      ) : null}

      {credentials === "failed" && !integration.hasCredentials ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          The connection test failed, so the credentials were not saved. Check the address and credentials, then save them again.
        </p>
      ) : null}

      {connector && reads && connector.auth.type !== "none" ? (
        <Card>
          <CardHeader title="Credentials" />
          <CardBody>
            <ConnectorCredentialsForm integrationId={id} secretFields={connector.auth.fields} />
          </CardBody>
        </Card>
      ) : null}

      {receive ? (
        <Card>
          <CardHeader title="Receiving" description="Where this connection's systems send WonderID data" />
          <CardBody className="space-y-3 text-sm">
            <ul className="space-y-2">
              {receive.runtimeEvents ? (
                <li>
                  <span className="text-muted-foreground">Agent activity ({receive.runtimeEvents.auth === "bearer" ? "Bearer secret" : "HMAC-SHA256 signature"})</span>
                  <code className="mt-0.5 block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">POST {endpoint("events")}</code>
                </li>
              ) : null}
              {receive.webhook ? (
                <li>
                  <span className="text-muted-foreground">
                    Webhook ({receive.webhook.auth === "bearer" ? "Bearer secret" : `HMAC-SHA256 hex in ${receive.webhook.signatureHeader ?? "x-wonderid-signature"}`})
                  </span>
                  <code className="mt-0.5 block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">POST {endpoint("webhook")}</code>
                </li>
              ) : null}
              {receive.gateway ? (
                <li>
                  <span className="text-muted-foreground">Runtime Gateway (each agent&apos;s own API key)</span>
                  {receive.gateway.authorize ? (
                    <code className="mt-0.5 block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">POST {endpoint("gateway/authorize")}</code>
                  ) : null}
                  {receive.gateway.toolsFilter ? (
                    <code className="mt-0.5 block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">POST {endpoint("gateway/tools/filter")}</code>
                  ) : null}
                </li>
              ) : null}
            </ul>
            {receiver ? (
              <>
                <p className="text-muted-foreground">
                  {receiver.hasSecret ? `Secret issued ${receiver.rotatedAt?.slice(0, 10) ?? ""}` : "No secret issued yet: nothing is accepted until one is."}
                  {receiver.lastReceivedAt ? ` · Last received ${receiver.lastReceivedAt.slice(0, 16).replace("T", " ")} UTC` : ""}
                </p>
                <ReceiverSecretForm integrationId={id} hasSecret={receiver.hasSecret} />
              </>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {reads ? (
        <>
          <Card>
            <CardHeader
              title="Connection"
              actions={
                <form action={testConnectionWithId}>
                  <Button type="submit" variant="secondary">
                    Test connection
                  </Button>
                </form>
              }
            />
            <CardBody>
              <p className="text-sm text-muted-foreground">Verifies the saved credentials can reach the system.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Sync jobs"
              actions={
                <form action={triggerSyncWithId}>
                  <Button type="submit" variant="secondary">
                    Run sync now
                  </Button>
                </form>
              }
            />
            <CardBody>
              {jobs.length === 0 ? (
                <EmptyState title="No sync jobs yet" />
              ) : (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center gap-2">
                      <Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status}</Badge>
                      <span>
                        {j.createdAt}: processed {j.recordsProcessed}, failed {j.recordsFailed}
                        {j.errors.length > 0 ? ` (${j.errors.length} error(s))` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}

      <Suspense fallback={<TrafficCardSkeleton />}>
        <TrafficCard tenantId={ctx.tenantId!} integrationId={id} />
      </Suspense>
    </div>
  );
}
