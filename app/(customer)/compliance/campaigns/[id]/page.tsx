import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaignItems, getCampaignMetrics } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { CampaignItemsTable } from "./CampaignItemsTable";
import { EvidenceDrawerClient } from "./EvidenceDrawerClient";
import { Card, CardBody, EmptyState } from "@/modules/ui";

export default async function CampaignItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const [items, metrics] = await Promise.all([listCampaignItems(ctx.tenantId!, campaignId), getCampaignMetrics(ctx.tenantId!, campaignId)]);

  return (
    <div className="space-y-4">
      <Link href="/compliance/campaigns" className="text-sm text-primary hover:underline">
        ← Campaigns
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Certification Items</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {metrics.totalItems} total · {metrics.pendingItems} pending · {metrics.decidedItems} decided · {metrics.overdueItems} overdue ·{" "}
          {metrics.escalatedItems} escalated
        </p>
      </div>

      <Suspense fallback={null}>
        <EvidenceDrawerClient items={items} />
      </Suspense>

      <Card>
        <CardBody>
          {items.length === 0 ? (
            <EmptyState title="No items in this campaign" />
          ) : (
            <CampaignItemsTable items={items} currentUserId={ctx.userId} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
