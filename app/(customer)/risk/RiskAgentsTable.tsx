"use client";

import Link from "next/link";
import { SeverityBadge, SimpleDataTable, type DataTableColumn } from "@/modules/ui";

type RiskAgentRow = { id: string; agentName: string; openFindings: number; worstSeverity: string | null };

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3, "": -1 };

export function RiskAgentsTable({ rows }: { rows: RiskAgentRow[] }) {
  const columns: DataTableColumn<RiskAgentRow>[] = [
    { key: "agentName", header: "Agent", sortable: true, render: (r) => <Link href={`/risk/agents/${r.id}`} className="text-primary hover:underline">{r.agentName}</Link> },
    { key: "openFindings", header: "Open findings", sortable: true, render: (r) => r.openFindings },
    { key: "worstSeverity", header: "Worst severity", sortable: true, render: (r) => (r.worstSeverity ? <SeverityBadge severity={r.worstSeverity} /> : "—") },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getSearchableText={(r) => r.agentName}
      getSortValue={(r, key) =>
        key === "openFindings" ? r.openFindings : key === "worstSeverity" ? SEVERITY_RANK[r.worstSeverity ?? ""] : r.agentName
      }
      paramPrefix="riskAgents"
      defaultSortKey="worstSeverity"
      emptyTitle="No agents registered yet"
      filterPlaceholder="Filter by agent name…"
    />
  );
}
