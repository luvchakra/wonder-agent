"use client";

import Link from "next/link";
import { StatusBadge, type BadgeTone, SimpleDataTable, type DataTableColumn } from "@/modules/ui";

/** One connection, with the connection type it was created from (linked when the type has a page). */
export type ConnectionRow = { id: string; name: string; typeName: string; typeHref: string | null; status: string; lastSyncAt: string | null };

const STATUS_TONE: Record<string, BadgeTone> = {
  configured: "neutral",
  connected: "success",
  error: "danger",
  disabled: "neutral",
};

export function IntegrationsTable({ rows }: { rows: ConnectionRow[] }) {
  const columns: DataTableColumn<ConnectionRow>[] = [
    { key: "name", header: "Name", sortable: true, render: (i) => <Link href={`/integrations/${i.id}`} className="text-primary hover:underline">{i.name}</Link> },
    {
      key: "typeName",
      header: "Type",
      sortable: true,
      render: (i) =>
        i.typeHref ? (
          <Link href={i.typeHref} className="text-foreground hover:text-primary hover:underline">
            {i.typeName}
          </Link>
        ) : (
          i.typeName
        ),
    },
    { key: "status", header: "Status", sortable: true, render: (i) => <StatusBadge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</StatusBadge> },
    { key: "lastSyncAt", header: "Last sync", sortable: true, render: (i) => i.lastSyncAt ?? "never" },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={rows}
      getRowId={(i) => i.id}
      getSearchableText={(i) => `${i.name} ${i.typeName} ${i.status}`}
      getSortValue={(i, key) => (i as unknown as Record<string, string>)[key] ?? ""}
      paramPrefix="integrations"
      defaultSortKey="name"
      emptyTitle="No connections yet"
      emptyDescription="Choose a connection type to connect your HR system, identity provider, directory or applications."
      filterPlaceholder="Filter by name, type, or status…"
    />
  );
}
