"use client";

import Link from "next/link";
import { Badge, SeverityBadge, SimpleDataTable, type DataTableColumn } from "@/modules/ui";
import { DecisionForm } from "./DecisionForm";
import { EvidenceTrigger } from "./EvidenceDrawerClient";
import type { RiskSeverity } from "@/lib/shared/types/risk";

type CampaignItemRow = {
  id: string;
  agentId: string;
  riskAtReview: string | null;
  usageAtReview: string | null;
  recommendation: string | null;
  status: string;
  reviewerId: string | null;
};

export function CampaignItemsTable({ items, currentUserId }: { items: CampaignItemRow[]; currentUserId: string }) {
  const columns: DataTableColumn<CampaignItemRow>[] = [
    { key: "agentId", header: "Agent", sortable: true, render: (i) => <Link href={`/agents/${i.agentId}`} className="text-primary hover:underline">{i.agentId}</Link> },
    { key: "riskAtReview", header: "Risk", sortable: true, render: (i) => (i.riskAtReview ? <SeverityBadge severity={i.riskAtReview as RiskSeverity} /> : "—") },
    { key: "usageAtReview", header: "Usage", render: (i) => i.usageAtReview ?? "—" },
    {
      key: "recommendation",
      header: "Recommendation",
      sortable: true,
      render: (i) =>
        i.recommendation ? (
          <Badge tone={i.recommendation === "remove" ? "danger" : i.recommendation === "review" ? "warning" : "success"}>{i.recommendation}</Badge>
        ) : (
          "—"
        ),
    },
    { key: "status", header: "Status", sortable: true, render: (i) => <Badge tone={i.status === "pending" ? "warning" : "success"}>{i.status}</Badge> },
    { key: "evidence", header: "Evidence", render: (i) => <EvidenceTrigger itemId={i.id} /> },
    {
      key: "decision",
      header: "Decision",
      render: (i) => {
        if (i.status !== "pending") return null;
        if (i.reviewerId !== currentUserId) return <span className="text-xs text-muted-foreground">Assigned reviewer only</span>;
        return <DecisionForm itemId={i.id} />;
      },
    },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={items}
      getRowId={(i) => i.id}
      getSearchableText={(i) => `${i.agentId} ${i.status} ${i.recommendation ?? ""}`}
      getSortValue={(i, key) => (i as unknown as Record<string, string>)[key] ?? ""}
      paramPrefix="items"
      defaultSortKey="status"
      emptyTitle="No items in this campaign"
      filterPlaceholder="Filter by agent, status, or recommendation…"
    />
  );
}
