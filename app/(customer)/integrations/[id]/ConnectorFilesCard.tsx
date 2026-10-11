import { Card, CardHeader, CardBody } from "@/modules/ui";
import { latestConnectorFile } from "@/modules/integrations/service";

const KIND_LABEL: Record<string, string> = {
  identity: "identities",
  account: "accounts",
  entitlement: "entitlements",
  access_grant: "access",
  application: "applications",
  policy: "policies",
};

/**
 * The last file a file connection received. The page has already checked
 * integration.read for this tenant; the read below names the tenant. The
 * schedule is on the Sync jobs card, as on every connection.
 */
export async function ConnectorFilesCard({ tenantId, integrationId, uploadUrl }: { tenantId: string; integrationId: string; uploadUrl: string }) {
  const file = await latestConnectorFile(tenantId, integrationId);
  return (
    <Card>
      <CardHeader title="Files" />
      <CardBody className="space-y-3 text-sm">
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
