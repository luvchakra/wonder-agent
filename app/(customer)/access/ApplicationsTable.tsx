"use client";

import { Badge, SimpleDataTable, type DataTableColumn } from "@/modules/ui";

type ApplicationRow = { id: string; name: string; category: string | null; isExternal: boolean };

export function ApplicationsTable({ applications }: { applications: ApplicationRow[] }) {
  const columns: DataTableColumn<ApplicationRow>[] = [
    { key: "name", header: "Application", sortable: true, render: (a) => a.name },
    { key: "category", header: "Category", sortable: true, render: (a) => (a.category ? <Badge tone="neutral">{a.category}</Badge> : "—") },
    { key: "isExternal", header: "External", sortable: true, render: (a) => (a.isExternal ? <Badge tone="warning">External</Badge> : "—") },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={applications}
      getRowId={(a) => a.id}
      getSearchableText={(a) => `${a.name} ${a.category ?? ""}`}
      getSortValue={(a, key) => (key === "category" ? (a.category ?? "") : key === "isExternal" ? (a.isExternal ? 1 : 0) : a.name)}
      paramPrefix="apps"
      defaultSortKey="name"
      emptyTitle="No applications registered yet"
      filterPlaceholder="Filter by name or category…"
    />
  );
}
