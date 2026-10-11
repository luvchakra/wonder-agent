import { notFound, redirect } from "next/navigation";
import { getRecordProvenance } from "@/lib/provenance/recordProvenance";
import { headers } from "next/headers";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIntegration, getReceiverStatus, listSyncJobs } from "@/modules/integrations/service";
import { resolveHeldMissingAction, testConnectionAction, triggerSyncAction } from "@/app/actions/integrations";
import { ApiError } from "@/lib/shared/types/foundation";
import { RecordProvenance, Card, CardHeader, CardBody, Badge, Button, EmptyState, type BadgeTone } from "@/modules/ui";
import { parseConnectorConfig } from "@/modules/integrations/framework/engine";
import type { ConnectorDefinition } from "@/modules/integrations/framework/types";
import { connectionTypeOf } from "@/modules/integrations/framework/typeSummary";
import { ConnectorCredentialsForm, ConnectorSettingsForm, ReceiverSecretForm } from "../types/ConnectorForms";
import { getConnectorConfiguration, type ConnectorConfiguration } from "@/modules/integrations/framework/catalog";
import { Suspense } from "react";
import { TrafficCard, TrafficCardSkeleton } from "./TrafficCard";
import { ConnectorFilesCard } from "./ConnectorFilesCard";
import { RunAutoRefresh } from "../sources/SourceForms";
import type { SyncPipelineStep } from "@/lib/shared/types/integrations";

const JOB_STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  running: "info",
  succeeded: "success",
  failed: "danger",
  partial: "warning",
};

/** INTEGRATION-P0-19: how a step after the import ended, in a line. */
function stepLine(step: SyncPipelineStep): string {
  const what = step.kind === "identities" ? `Identities from ${step.name}` : `Accounts of ${step.name}`;
  const c = step.counts ?? {};
  const counts =
    step.kind === "identities"
      ? [`${c.created ?? 0} created`, `${c.updated ?? 0} updated`, c.leavers ? `${c.leavers} leavers` : "", c.pending ? `${c.pending} to review` : ""]
      : [`${c.created ?? 0} new`, `${c.updated ?? 0} updated`, c.orphan ? `${c.orphan} orphan` : "", c.notInSource ? `${c.notInSource} gone from source` : ""];
  const detail = step.status === "succeeded" || step.status === "partial" ? counts.filter(Boolean).join(", ") : (step.reason ?? "");
  return detail ? `${what}: ${detail}` : what;
}

const STEP_TONE: Record<string, BadgeTone> = { ...JOB_STATUS_TONE, pending: "neutral", skipped: "danger" };

/** INTEGRATION-P0-18: the result of approving or discarding a held run. */
const HELD_OUTCOME: Record<string, string> = {
  approved: "Approved: the records gone from the source are now marked missing.",
  discarded: "Discarded: nothing was marked missing.",
  superseded: "Not approved: a newer run has started. Discard this one.",
  decided: "This run was already decided.",
  failed: "The decision could not be saved. Try again.",
};

/** The kinds a held run would mark, e.g. "15 of 25 identity". */
function heldDescription(summary: Record<string, Record<string, unknown>>): string {
  return Object.entries(summary)
    .filter(([, k]) => k.status === "held")
    .map(([kind, k]) => `${k.candidates} of ${k.presentBefore} ${kind}`)
    .join(", ");
}

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
  searchParams: Promise<{ credentials?: string; held?: string }>;
}) {
  const { id } = await params;
  const { credentials, held } = await searchParams;
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
  const needsSecret = Boolean(receive?.runtimeEvents || receive?.webhook || receive?.file);

  const [jobs, receiver, origin, configuration, provenance] = await Promise.all([
    listSyncJobs(ctx.tenantId!, id),
    needsSecret ? getReceiverStatus(ctx.tenantId!, id) : Promise.resolve(null),
    receive ? ownOrigin() : Promise.resolve(""),
    connector ? getConnectorConfiguration(ctx.tenantId!, id).catch(() => null as ConnectorConfiguration | null) : Promise.resolve(null),
    getRecordProvenance(ctx.tenantId!, "integrations", id),
  ]);
  const canEdit = ctx.permissions.includes("integration.update");
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
        <RecordProvenance record={provenance} className="mt-1" />
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

      {connector && configuration ? (
        <Card>
          <CardHeader title="Settings" description={`What this connection was set up with, as ${connector.name} declares it.`} />
          <CardBody>
            <ConnectorSettingsForm integrationId={id} name={configuration.name} settings={connector.settings} values={configuration.settings} canEdit={canEdit} />
          </CardBody>
        </Card>
      ) : null}

      {connector && connector.auth.type !== "none" ? (
        <Card>
          <CardHeader title="Credentials" description="Saved values are shown masked. Enter a value to replace it; leave a field empty to keep it." />
          <CardBody>
            {canEdit ? (
              <ConnectorCredentialsForm integrationId={id} secretFields={connector.auth.fields} saved={configuration?.secrets ?? {}} />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {connector.auth.fields.map((f) => (
                  <div key={f.key}>
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="font-mono text-foreground">{configuration?.secrets[f.key] || <span className="font-sans text-muted-foreground">Not saved</span>}</dd>
                  </div>
                ))}
              </dl>
            )}
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

      {connector?.driver === "file" ? <ConnectorFilesCard tenantId={ctx.tenantId!} integrationId={id} uploadUrl={endpoint("file")} /> : null}

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
              {held && HELD_OUTCOME[held] ? (
                <p role="status" className="mb-3 text-sm text-foreground">
                  {HELD_OUTCOME[held]}
                </p>
              ) : null}
              {jobs
                .filter((j) => j.missingStatus === "held")
                .map((j) => (
                  <div key={j.id} role="alert" className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                    <p>
                      The run of {j.createdAt} found {heldDescription(j.missingSummary)} gone from the source, more than this
                      organization allows at once. Nothing was marked missing.
                    </p>
                    {canEdit ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <form action={resolveHeldMissingAction.bind(null, id, j.id, "approve")}>
                          <Button type="submit">Mark them missing</Button>
                        </form>
                        <form action={resolveHeldMissingAction.bind(null, id, j.id, "discard")}>
                          <Button type="submit" variant="secondary">
                            Discard
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))}
              {jobs.length === 0 ? (
                <EmptyState title="No sync jobs yet" />
              ) : (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <RunAutoRefresh active={jobs.some((j) => j.status === "queued" || j.status === "running" || j.pipelineStatus === "running")} />
                  {jobs.map((j, index) => (
                    <li key={j.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status}</Badge>
                        <span>
                          {j.createdAt}: processed {j.recordsProcessed}, failed {j.recordsFailed}
                          {j.errors.length > 0 ? ` (${j.errors.length} error(s))` : ""}
                        </span>
                        {j.pipelineStatus !== "none" ? (
                          <Badge tone={STEP_TONE[j.pipelineStatus] ?? "neutral"}>then {j.pipelineStatus}</Badge>
                        ) : null}
                      </div>
                      {index === 0 && j.pipeline.length > 0 ? (
                        <ol className="mt-1 space-y-0.5 pl-4">
                          {j.pipeline.map((step, i) => (
                            <li key={`${step.kind}-${step.targetId}-${i}`} className="flex flex-wrap items-center gap-2">
                              <Badge tone={STEP_TONE[step.status] ?? "neutral"}>{step.status}</Badge>
                              <span>{stepLine(step)}</span>
                            </li>
                          ))}
                        </ol>
                      ) : null}
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
