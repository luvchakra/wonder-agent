"use client";

import Link from "next/link";
import { Badge, type BadgeTone, SimpleDataTable, type DataTableColumn } from "@/modules/ui";

type IntegrationRow = { id: string; name: string; integrationTypeId: string; status: string; lastSyncAt: string | null };

const STATUS_TONE: Record<string, BadgeTone> = {
  configured: "neutral",
  connected: "success",
  error: "danger",
  disabled: "neutral",
};

export function IntegrationsTable({ integrations }: { integrations: IntegrationRow[] }) {
  const columns: DataTableColumn<IntegrationRow>[] = [
    { key: "name", header: "Name", sortable: true, render: (i) => <Link href={`/integrations/${i.id}`} className="text-primary hover:underline">{i.name}</Link> },
    { key: "integrationTypeId", header: "Type", sortable: true, render: (i) => i.integrationTypeId },
    { key: "status", header: "Status", sortable: true, render: (i) => <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Badge> },
    { key: "lastSyncAt", header: "Last sync", sortable: true, render: (i) => i.lastSyncAt ?? "never" },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={integrations}
      getRowId={(i) => i.id}
      getSearchableText={(i) => `${i.name} ${i.integrationTypeId} ${i.status}`}
      getSortValue={(i, key) => (i as unknown as Record<string, string>)[key] ?? ""}
      paramPrefix="integrations"
      defaultSortKey="name"
      emptyTitle="No integrations configured yet"
      emptyDescription="Connect Saviynt, a generic REST source, or an MCP server to start importing AI agent identity and access."
      filterPlaceholder="Filter by name, type, or status…"
    />
  );
}
