import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaigns, listCampaignItems } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { launchCampaignAction } from "@/app/actions/compliance";
import { Card, CardHeader, CardBody, Button, TextField, SelectField } from "@/modules/ui";
import { CampaignsList, type CampaignRow } from "./CampaignsList";

export default async function CampaignsPage() {
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const campaigns = await listCampaigns(ctx.tenantId!);

  // Outstanding/overdue counts per campaign, so the list leads with what
  // still needs a human decision rather than just a status word. Fanned out
  // in parallel (CLAUDE.md §15) over Compliance's own published contract.
  const nowIso = new Date().toISOString();
  const itemLists = await Promise.all(campaigns.map((c) => listCampaignItems(ctx.tenantId!, c.id)));
  const rows: CampaignRow[] = campaigns.map((c, i) => {
    const pendingItems = itemLists[i].filter((item) => item.status === "pending");
    return {
      id: c.id,
      name: c.name,
      scopeType: c.scopeType,
      status: c.status,
      pending: pendingItems.length,
      overdue: pendingItems.filter((item) => item.dueDate && item.dueDate < nowIso).length,
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Certification</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Campaigns that put a named human behind every agent&rsquo;s access.
        </p>
      </div>

      <CampaignsList campaigns={rows} />

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
    </div>
  );
}
