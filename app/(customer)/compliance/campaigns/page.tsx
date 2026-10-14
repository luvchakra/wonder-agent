import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { campaignItemCounts, listCampaigns, listCampaignTemplates } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { launchCampaignAction } from "@/app/actions/compliance";
import { Card, CardHeader, CardBody, Button, TextField, SelectField, ObjectActionsMenu } from "@/modules/ui";
import { objectActionsFor } from "@/modules/operations/exportRegistry";
import { CampaignsList, type CampaignRow } from "./CampaignsList";
import { CampaignPreviewButton } from "./CampaignPreviewButton";
import { CampaignTemplatesList } from "./CampaignTemplatesList";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ launch?: string }> }) {
  // Access Reviews › Create Campaigns (owner's navigation, 2026-10-13): the launch form first, focused.
  const launching = (await searchParams).launch === "1";
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  // Outstanding/overdue counts per campaign, so the list leads with what
  // still needs a human decision rather than just a status word. Counted in
  // the database in one query (§15), never by reading every item.
  const [campaigns, counts, templates] = await Promise.all([listCampaigns(ctx.tenantId!), campaignItemCounts(ctx.tenantId!), listCampaignTemplates(ctx.tenantId!)]);
  const rows: CampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    ref: c.ref,
    name: c.name,
    scopeType: c.scopeType,
    status: c.buildStatus === "building" ? "building" : c.buildStatus === "failed" ? "failed" : c.status,
    pending: counts.get(c.id)?.pendingItems ?? 0,
    overdue: counts.get(c.id)?.overdueItems ?? 0,
  }));

  const launchForm = (
    <form action={launchCampaignAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextField label="Campaign name" name="name" required autoFocus={launching} />
      </div>
      <SelectField label="Scope type" name="scopeType" defaultValue="agent">
        <option value="agent">agent</option>
        <option value="application">application</option>
        <option value="entitlement">entitlement</option>
        <option value="privileged_access">privileged_access</option>
        <option value="high_risk_agent">high_risk_agent</option>
        <option value="identity_access">people&apos;s access</option>
        <option value="role_assignments">WonderID roles</option>
      </SelectField>
      <TextField label="Criticality filter" name="criticality" placeholder="e.g. high,critical" />
      <SelectField label="Cadence" name="cadence" defaultValue="one_time">
        <option value="one_time">one_time</option>
        <option value="periodic">periodic</option>
        <option value="event_driven">event_driven</option>
      </SelectField>
      <TextField label="Reviewer" name="reviewerId" placeholder="reviewer user id (uuid, defaults to you)" />
      {/* COMPLIANCE-P0-10: for people's access; the reviewer above takes items nobody else fits. */}
      <SelectField label="Reviewed by (people's access)" name="reviewerKind" defaultValue="named">
        <option value="named">the reviewer</option>
        <option value="manager">each person&apos;s manager</option>
        <option value="application_owner">the application&apos;s owner</option>
      </SelectField>
      <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
        <input type="checkbox" name="saveTemplate" /> Also save as a template
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit">Launch</Button>
        {/* COMPLIANCE-P0-14: what it would hold, before launching. */}
        <CampaignPreviewButton />
      </div>
    </form>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Certification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Campaigns that put a named human behind every agent&rsquo;s access.
          </p>
        </div>
        <ObjectActionsMenu
          {...objectActionsFor(ctx.permissions, ["campaigns"])}
          create={launching ? undefined : { label: "Launch campaign…", title: "Launch a new campaign", content: launchForm }}
        />
      </div>

      {launching ? (
        <Card>
          <CardHeader title="Launch a new campaign" />
          <CardBody>{launchForm}</CardBody>
        </Card>
      ) : null}
      {templates.length ? <CampaignTemplatesList templates={templates} /> : null}
      <CampaignsList campaigns={rows} />
    </div>
  );
}
