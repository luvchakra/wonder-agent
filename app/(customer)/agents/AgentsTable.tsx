"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge, SeverityBadge, type BadgeTone } from "@/modules/ui/Badge";
import { CountPills } from "@/modules/ui/CountPills";
import { DataTable, useTableState, type DataTableColumn } from "@/modules/ui/DataTable";

// Same mapping as app/(customer)/agents/[id]/page.tsx's LIFECYCLE_TONE —
// kept in sync manually since it's a small, list-vs-detail presentational
// choice, not a shared domain contract.
const LIFECYCLE_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  DISCOVERED: "neutral",
  REGISTERED: "neutral",
  ASSESSED: "info",
  APPROVED: "info",
  PROVISIONED: "info",
  CERTIFICATION_DUE: "warning",
  RESTRICTED: "warning",
  SUSPENDED: "danger",
  RETIRED: "neutral",
};

const APPROVED_STATES = new Set(["APPROVED", "PROVISIONED", "ACTIVE", "CERTIFICATION_DUE"]);
const PENDING_STATES = new Set(["DISCOVERED", "REGISTERED", "ASSESSED"]);

export type AgentRow = {
  id: string;
  agentName: string;
  displayName: string | null;
  agentType: string;
  sourceSystem: string | null;
  lifecycleState: string;
  criticality: string;
  /** Set by the page from Risk Agent's open findings — not a field on Agent. */
  atRisk: boolean;
};

type Segment = "all" | "approved" | "at_risk" | "pending";

function inSegment(agent: AgentRow, segment: Segment): boolean {
  switch (segment) {
    case "approved":
      return APPROVED_STATES.has(agent.lifecycleState);
    case "at_risk":
      return agent.atRisk;
    case "pending":
      return PENDING_STATES.has(agent.lifecycleState);
    default:
      return true;
  }
}

/** The design's two-line identity cell: a source tile, the name, and its origin. */
function AgentCell({ agent }: { agent: AgentRow }) {
  const name = agent.displayName?.trim() || agent.agentName;
  const source = agent.sourceSystem?.trim();
  return (
    <Link href={`/agents/${agent.id}`} className="group flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold uppercase text-muted-foreground"
      >
        {(source ?? name).slice(0, 2)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground group-hover:text-primary">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {source ? `${source} · ${agent.agentType}` : agent.agentType}
        </span>
      </span>
    </Link>
  );
}

/**
 * EXPERIENCE-P0-08, restyled to the supplied design in P0-15: count pills
 * above the list, and a two-line identity cell with the agent's source
 * system rather than a bare name link.
 *
 * `listAgents()` (Identity Agent's published contract) still has no
 * pagination/sort parameters of its own, so the segment, search, sort and
 * page are all applied to the already-fetched list client-side — the same
 * documented stopgap as before (see the Experience Agent audit log), not a
 * new one, and still pending a paginated variant from Identity per
 * CLAUDE.md §15.
 */
export function AgentsTable({ agents }: { agents: AgentRow[] }) {
  const state = useTableState("agents", { sortKey: "agentName", sortDir: "asc", pageSize: 25 });
  const [segment, setSegment] = useState<Segment>("all");

  const pills = useMemo(
    () => [
      { value: "all", label: "All", count: agents.length },
      { value: "approved", label: "Approved", count: agents.filter((a) => inSegment(a, "approved")).length, tone: "success" as const },
      { value: "pending", label: "Pending", count: agents.filter((a) => inSegment(a, "pending")).length, tone: "warning" as const },
      { value: "at_risk", label: "At risk", count: agents.filter((a) => inSegment(a, "at_risk")).length, tone: "danger" as const },
    ],
    [agents],
  );

  const filtered = useMemo(() => {
    const needle = state.filter.trim().toLowerCase();
    return agents.filter((a) => {
      if (!inSegment(a, segment)) return false;
      if (!needle) return true;
      return [a.agentName, a.displayName, a.agentType, a.sourceSystem]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [agents, segment, state.filter]);

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
    { key: "agentName", header: "Agent", sortable: true, render: (a) => <AgentCell agent={a} /> },
    {
      key: "lifecycleState",
      header: "Lifecycle",
      sortable: true,
      render: (a) => <StatusBadge tone={LIFECYCLE_TONE[a.lifecycleState] ?? "neutral"}>{a.lifecycleState}</StatusBadge>,
    },
    { key: "criticality", header: "Criticality", sortable: true, render: (a) => <SeverityBadge severity={a.criticality} /> },
    {
      key: "chevron",
      header: "",
      render: (a) => (
        <Link href={`/agents/${a.id}`} aria-label={`Open ${a.displayName?.trim() || a.agentName}`} className="block text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <CountPills pills={pills} value={segment} onChange={(v) => setSegment(v as Segment)} ariaLabel="Filter agents" />
      <DataTable
        columns={columns}
        rows={pageRows}
        getRowId={(a) => a.id}
        totalCount={sorted.length}
        state={state}
        emptyTitle="No agents match this filter"
        filterPlaceholder="Search agents…"
      />
    </div>
  );
}
