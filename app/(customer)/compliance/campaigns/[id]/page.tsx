import { Suspense } from "react";
import { getRecordProvenance } from "@/lib/provenance/recordProvenance";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getCampaign, getCampaignMetrics, listCampaignItemsPage } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { CampaignItemsTable } from "./CampaignItemsTable";
import { EvidenceDrawerClient } from "./EvidenceDrawerClient";
import { RecordProvenance, Card, CardBody, EmptyState } from "@/modules/ui";

type Search = { items_page?: string; items_pageSize?: string; items_sort?: string; items_dir?: string; items_q?: string };

export default async function CampaignItemsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id: campaignId }, sp] = await Promise.all([params, searchParams]);
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  // §15: one page of items from the database, and counts from the database.
  const [campaign, page, metrics, provenance] = await Promise.all([
    getCampaign(ctx.tenantId!, campaignId),
    listCampaignItemsPage(ctx.tenantId!, campaignId, {
      page: Number(sp.items_page) || 1,
      pageSize: Number(sp.items_pageSize) || 25,
      sortKey: sp.items_sort ?? "status",
      sortDir: sp.items_dir === "desc" ? "desc" : "asc",
      q: sp.items_q,
    }),
    getCampaignMetrics(ctx.tenantId!, campaignId),
    getRecordProvenance(ctx.tenantId!, "certification_campaigns", campaignId),
  ]);
  if (!campaign) notFound();
  const items = page.rows;

  return (
    <div className="space-y-4">
      <Link href="/compliance/campaigns" className="text-sm text-primary hover:underline">
        ← Campaigns
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Certification Items</h1>
        <RecordProvenance record={provenance} className="mt-1" />
        <p className="mt-1 text-sm text-muted-foreground">
          {metrics.totalItems} total · {metrics.pendingItems} pending · {metrics.decidedItems} decided · {metrics.overdueItems} overdue ·{" "}
          {metrics.escalatedItems} escalated
        </p>
      </div>

      <Suspense fallback={null}>
        <EvidenceDrawerClient items={items} />
      </Suspense>

      {campaign.buildStatus === "building" ? (
        <p role="status" className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          Building this campaign&rsquo;s items. They appear here when it is ready; reload in a moment.
        </p>
      ) : campaign.buildStatus === "failed" ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This campaign could not be built: {campaign.buildError ?? "the build stopped"}. No items were left half-built; launch it again.
        </p>
      ) : null}

      <Card>
        <CardBody>
          {page.total === 0 && !sp.items_q ? (
            <EmptyState title={campaign.buildStatus === "building" ? "Building…" : "No items in this campaign"} />
          ) : (
            <CampaignItemsTable items={items} totalCount={page.total} currentUserId={ctx.userId} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
