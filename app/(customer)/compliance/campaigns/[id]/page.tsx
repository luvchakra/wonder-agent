import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaignItems, getCampaignMetrics } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { DecisionForm } from "./DecisionForm";
import { EvidenceTrigger, EvidenceDrawerClient } from "./EvidenceDrawerClient";
import { Card, CardBody, Badge, SeverityBadge, EmptyState, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

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
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Risk</Th>
                  <Th>Usage</Th>
                  <Th>Recommendation</Th>
                  <Th>Status</Th>
                  <Th>Evidence</Th>
                  <Th>Decision</Th>
                </tr>
              </Thead>
              <tbody>
                {items.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <Link href={`/agents/${item.agentId}`} className="text-primary hover:underline">
                        {item.agentId}
                      </Link>
                    </Td>
                    <Td>{item.riskAtReview ? <SeverityBadge severity={item.riskAtReview} /> : "—"}</Td>
                    <Td>{item.usageAtReview ?? "—"}</Td>
                    <Td>
                      {item.recommendation ? (
                        <Badge tone={item.recommendation === "remove" ? "danger" : item.recommendation === "review" ? "warning" : "success"}>
                          {item.recommendation}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <Badge tone={item.status === "pending" ? "warning" : "success"}>{item.status}</Badge>
                    </Td>
                    <Td>
                      <EvidenceTrigger itemId={item.id} />
                    </Td>
                    <Td>
                      {item.status === "pending" && item.reviewerId !== ctx.userId && (
                        <span className="text-xs text-muted-foreground">Assigned reviewer only</span>
                      )}
                      {item.status === "pending" && item.reviewerId === ctx.userId && <DecisionForm itemId={item.id} />}
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
