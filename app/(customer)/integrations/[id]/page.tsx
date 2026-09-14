import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIntegration, listMappings, listSyncJobs } from "@/modules/integrations/service";
import {
  createMappingAction,
  setCredentialAction,
  testConnectionAction,
  triggerSyncAction,
} from "@/app/actions/integrations";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody, Badge, Button, EmptyState, TextField, SelectField, type BadgeTone } from "@/modules/ui";

const AUTH_TYPES = ["oauth2", "api_key", "basic", "bearer", "mtls"] as const;

const JOB_STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  running: "info",
  succeeded: "success",
  failed: "danger",
  partial: "warning",
};

export default async function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const integration = await getIntegration(ctx.tenantId!, id);
  if (!integration) notFound();

  const [jobs, mappings] = await Promise.all([listSyncJobs(ctx.tenantId!, id), listMappings(id)]);

  const setCredentialWithId = setCredentialAction.bind(null, id);
  const testConnectionWithId = testConnectionAction.bind(null, id);
  const triggerSyncWithId = triggerSyncAction.bind(null, id);
  const createMappingWithId = createMappingAction.bind(null, id);

  return (
    <div className="space-y-4">
      <Link href="/integrations" className="text-sm text-primary hover:underline">
        ← All integrations
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{integration.name}</h1>
          <Badge tone={integration.status === "connected" ? "success" : integration.status === "error" ? "danger" : "neutral"}>{integration.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Type: {integration.integrationTypeId} · Has credentials: {integration.hasCredentials ? "yes" : "no"} · Last sync:{" "}
          {integration.lastSyncAt ?? "never"}
        </p>
      </div>

      <Card>
        <CardHeader title="Credential" />
        <CardBody>
          <form action={setCredentialWithId} className="flex flex-wrap items-end gap-2">
            <SelectField label="Auth type" name="authType" defaultValue={AUTH_TYPES[3]}>
              {AUTH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectField>
            <div className="flex-1 min-w-[12rem]">
              <TextField label="Secret / token" name="secret" type="password" required />
            </div>
            <Button type="submit" variant="secondary">
              Save credential
            </Button>
          </form>
        </CardBody>
      </Card>

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
          <p className="text-sm text-muted-foreground">Verifies the saved credential can reach the configured base URL.</p>
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

      <Card>
        <CardHeader title="Field mappings" />
        <CardBody className="space-y-3">
          {mappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mappings defined.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {mappings.map((m) => (
                <li key={m.id}>
                  <Badge tone="neutral">{m.objectType}</Badge> <span className="text-foreground">{m.sourceField}</span> → <span className="text-foreground">{m.targetField}</span>
                </li>
              ))}
            </ul>
          )}
          <form action={createMappingWithId} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <SelectField label="Object type" name="objectType">
              <option value="identity">identity</option>
              <option value="account">account</option>
              <option value="application">application</option>
              <option value="entitlement">entitlement</option>
              <option value="access_grant">access_grant</option>
            </SelectField>
            <TextField label="Source field" name="sourceField" placeholder="dot path" required />
            <TextField label="Target field" name="targetField" required />
            <Button type="submit" variant="secondary">
              Add mapping
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
