import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaigns } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { launchCampaignAction } from "@/app/actions/compliance";
import { Card, CardHeader, CardBody, Badge, Button, EmptyState, TextField, SelectField, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

export default async function CampaignsPage() {
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const campaigns = await listCampaigns(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Certification Campaigns</h1>

      <Card>
        <CardHeader title="Launch a new campaign" />
        <CardBody>
          <form action={launchCampaignAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField label="Campaign name" name="name" required />
            </div>
            <SelectField label="Scope type" name="scopeType" defaultValue="agent">
              <option value="agent">agent</option>
              <option value="application">application</option>
              <option value="entitlement">entitlement</option>
              <option value="privileged_access">privileged_access</option>
              <option value="high_risk_agent">high_risk_agent</option>
            </SelectField>
            <TextField label="Criticality filter" name="criticality" placeholder="e.g. high,critical" />
            <SelectField label="Cadence" name="cadence" defaultValue="one_time">
              <option value="one_time">one_time</option>
              <option value="periodic">periodic</option>
              <option value="event_driven">event_driven</option>
            </SelectField>
            <TextField label="Reviewer" name="reviewerId" placeholder="reviewer user id (uuid, defaults to you)" />
            <div className="sm:col-span-2">
              <Button type="submit">Launch</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Campaigns" description={`${campaigns.length} total`} />
        <CardBody>
          {campaigns.length === 0 ? (
            <EmptyState title="No campaigns yet" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Scope</Th>
                  <Th>Status</Th>
                </tr>
              </Thead>
              <tbody>
                {campaigns.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`/compliance/campaigns/${c.id}`} className="text-primary hover:underline">
                        {c.name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone="neutral">{c.scopeType}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={c.status === "active" ? "success" : c.status === "completed" ? "neutral" : "warning"}>{c.status}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
