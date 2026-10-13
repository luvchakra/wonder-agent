"use client";

import Link from "next/link";
import { Badge, DataTable, SeverityBadge, useTableState, type DataTableColumn } from "@/modules/ui";
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

/** §15: the page passes one page of items, paged, sorted and filtered in the database; this table keeps that state in the URL. */
export function CampaignItemsTable({ items, totalCount, currentUserId }: { items: CampaignItemRow[]; totalCount: number; currentUserId: string }) {
  const state = useTableState("items", { sortKey: "status", pageSize: 25 });
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
    <DataTable
      columns={columns}
      rows={items}
      getRowId={(i) => i.id}
      totalCount={totalCount}
      state={state}
      emptyTitle="No items match"
      emptyDescription="Filter by pending, decided, keep, review, remove, or an agent id."
      filterPlaceholder="pending, decided, keep, review, remove, or an agent id"
    />
  );
}
