"use client";

import Link from "next/link";
import { Badge, SeverityBadge, SimpleDataTable, type DataTableColumn } from "@/modules/ui";

type PolicyRow = { id: string; name: string; policyCategory: string; severity: string; action: string; status: string };

export function PoliciesTable({ policies }: { policies: PolicyRow[] }) {
  const columns: DataTableColumn<PolicyRow>[] = [
    { key: "name", header: "Policy", sortable: true, render: (p) => <Link href={`/policies/${p.id}`} className="text-primary hover:underline">{p.name}</Link> },
    { key: "policyCategory", header: "Category", sortable: true, render: (p) => <Badge tone="neutral">{p.policyCategory}</Badge> },
    { key: "severity", header: "Severity", sortable: true, render: (p) => <SeverityBadge severity={p.severity} /> },
    { key: "action", header: "Action", sortable: true, render: (p) => p.action },
    { key: "status", header: "Status", sortable: true, render: (p) => <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status}</Badge> },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={policies}
      getRowId={(p) => p.id}
      getSearchableText={(p) => `${p.name} ${p.policyCategory} ${p.severity} ${p.action}`}
      getSortValue={(p, key) => (p as unknown as Record<string, string>)[key] ?? ""}
      paramPrefix="policies"
      defaultSortKey="name"
      emptyTitle="No policies defined yet"
      filterPlaceholder="Filter by name, category, or severity…"
    />
  );
}
