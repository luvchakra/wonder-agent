import { Card, CardHeader, CardBody, PendingSubmitButton, SelectField } from "@/modules/ui";
import { getConnectionSchedule, latestConnectorFile } from "@/modules/integrations/service";
import { setConnectionScheduleAction } from "@/app/actions/connectorFiles";

const KIND_LABEL: Record<string, string> = {
  identity: "identities",
  account: "accounts",
  entitlement: "entitlements",
  access_grant: "access",
  application: "applications",
  policy: "policies",
};

/**
 * A file connection's schedule and the last file it received. The page has
 * already checked integration.read for this tenant; both reads below name
 * the tenant explicitly. Changing the schedule needs integration.update.
 */
export async function ConnectorFilesCard({ tenantId, integrationId, uploadUrl }: { tenantId: string; integrationId: string; uploadUrl: string }) {
  const [schedule, file] = await Promise.all([getConnectionSchedule(tenantId, integrationId), latestConnectorFile(tenantId, integrationId)]);
  const save = setConnectionScheduleAction.bind(null, integrationId);
  return (
    <Card>
      <CardHeader title="Files" />
      <CardBody className="space-y-3 text-sm">
        <form action={save} className="flex flex-wrap items-end gap-2">
          <SelectField label="Sync schedule" name="schedule" defaultValue={schedule} hint="Scheduled syncs run once a day on the current plan.">
            <option value="manual">Manual</option>
            <option value="daily">Daily</option>
            <option value="hourly">Hourly</option>
          </SelectField>
          <PendingSubmitButton variant="secondary" pendingLabel="Saving…">
            Save
          </PendingSubmitButton>
        </form>
        <p className="text-muted-foreground">
          {file
            ? `Last file: ${file.filename ?? "unnamed"} (${KIND_LABEL[file.kind] ?? file.kind}, ${file.rowCount.toLocaleString("en-US")} rows), received ${file.receivedAt.slice(0, 16).replace("T", " ")} UTC · ${file.readAt ? "imported" : "waiting for the next sync"}`
            : "No file received yet."}
        </p>
        <details>
          <summary className="cursor-pointer text-muted-foreground">Send files</summary>
          <code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">POST {uploadUrl}</code>
          <p className="mt-1 text-muted-foreground">CSV body, header x-wonderid-kind (identity, account, entitlement, access_grant or application), Bearer receiving secret.</p>
        </details>
      </CardBody>
    </Card>
  );
}
