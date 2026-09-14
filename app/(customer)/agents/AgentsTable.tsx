"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/modules/ui/Badge";
import { DataTable, useTableState, type DataTableColumn } from "@/modules/ui/DataTable";

type AgentRow = {
  id: string;
  agentName: string;
  agentType: string;
  lifecycleState: string;
  criticality: string;
};

/**
 * EXPERIENCE-P0-08 — the first real consumer of the shared DataTable
 * primitive, proving it works end-to-end (sort/filter/paginate/URL-state/
 * responsive card-transform) rather than shipping it unused. `listAgents()`
 * (Identity Agent's published contract) has no pagination/sort parameters
 * of its own yet, so this sorts/filters/paginates the already-fetched full
 * list client-side — a documented stopgap (see the Experience Agent audit
 * log) until Identity Agent publishes a paginated variant per CLAUDE.md
 * §15; not a silent assumption.
 */
export function AgentsTable({ agents }: { agents: AgentRow[] }) {
  const state = useTableState("agents", { sortKey: "agentName", sortDir: "asc", pageSize: 25 });

  const filtered = useMemo(() => {
    const needle = state.filter.trim().toLowerCase();
    return needle ? agents.filter((a) => a.agentName.toLowerCase().includes(needle) || a.agentType.toLowerCase().includes(needle)) : agents;
  }, [agents, state.filter]);

  const sorted = useMemo(() => {
    if (!state.sortKey) return filtered;
    const dir = state.sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = String(a[state.sortKey as keyof AgentRow] ?? "");
      const bv = String(b[state.sortKey as keyof AgentRow] ?? "");
      return av.localeCompare(bv) * dir;
    });
  }, [filtered, state.sortKey, state.sortDir]);

  const pageRows = sorted.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

  const columns: DataTableColumn<AgentRow>[] = [
    { key: "agentName", header: "Name", sortable: true, render: (a) => <Link href={`/agents/${a.id}`}>{a.agentName}</Link> },
    { key: "agentType", header: "Type", sortable: true, render: (a) => a.agentType },
    { key: "lifecycleState", header: "Lifecycle", sortable: true, render: (a) => <Badge tone="info">{a.lifecycleState}</Badge> },
    {
      key: "criticality",
      header: "Criticality",
      sortable: true,
      render: (a) => <Badge tone={a.criticality === "critical" || a.criticality === "high" ? "danger" : "neutral"}>{a.criticality}</Badge>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={pageRows}
      getRowId={(a) => a.id}
      totalCount={sorted.length}
      state={state}
      emptyTitle="No agents match this filter"
      filterPlaceholder="Filter by name or type…"
    />
  );
}
