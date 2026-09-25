"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileDown } from "lucide-react";
import { Badge, StatusBadge, type BadgeTone } from "@/modules/ui/Badge";
import { CountPills } from "@/modules/ui/CountPills";
import { DataTable, useTableState, type DataTableColumn } from "@/modules/ui/DataTable";

// Same mapping as app/(customer)/agents/[id]/page.tsx's LIFECYCLE_TONE —
// kept in sync manually since it's a small, list-vs-detail presentational
// choice, not a shared domain contract.
const LIFECYCLE_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  DISCOVERED: "info",
  REGISTERED: "neutral",
  ASSESSED: "info",
  APPROVED: "info",
  PROVISIONED: "info",
  CERTIFICATION_DUE: "warning",
  RESTRICTED: "warning",
  SUSPENDED: "danger",
  RETIRED: "neutral",
};

const LIFECYCLE_STATES = Object.keys(LIFECYCLE_TONE);
const ENVIRONMENTS = ["production", "staging", "development"];

export type AgentRow = {
  id: string;
  agentName: string;
  displayName: string | null;
  agentType: string;
  sourceSystem: string | null;
  framework: string | null;
  environment: string;
  lifecycleState: string;
  criticality: string;
  /** Risk Agent's deterministic score (agents.risk_score), null until evaluated. */
  riskScore: number | null;
  /** Unresolved findings, from Risk Agent's contract. */
  openFindings: number;
  /** Business owner (or technical owner if none), from Identity's owner assignments. */
  owner: string | null;
  lastSeenAt: string | null;
  /** Has an unresolved critical/high finding. */
  atRisk: boolean;
};

type Segment = "all" | "at_risk" | "unowned" | "discovered";

function inSegment(agent: AgentRow, segment: Segment): boolean {
  switch (segment) {
    case "at_risk":
      return agent.atRisk;
    case "unowned":
      return agent.owner === null;
    case "discovered":
      return agent.lifecycleState === "DISCOVERED";
    default:
      return true;
  }
}

function humanize(state: string): string {
  const s = state.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nameOf(agent: AgentRow): string {
  return agent.displayName?.trim() || agent.agentName;
}

/** Risk-score band, matching the Risk Agent's severity bands (modules/risk/scoring.ts). */
function RiskCell({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">Not scored</span>;
  const tone: BadgeTone = score >= 75 ? "danger" : score >= 50 ? "warning" : score >= 25 ? "info" : "neutral";
  const label = score >= 75 ? "Critical" : score >= 50 ? "High" : score >= 25 ? "Medium" : "Low";
  return (
    <Badge tone={tone}>
      {label} · <span className="tabular-nums">{Math.round(score)}</span>
    </Badge>
  );
}

function lastSeen(iso: string | null, nowMs: number): string {
  if (!iso) return "Never";
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (mins < 60) return mins <= 1 ? "Just now" : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The two-line identity cell: a source tile, the name, and its type. */
function AgentCell({ agent }: { agent: AgentRow }) {
  const name = nameOf(agent);
  return (
    <Link href={`/agents/${agent.id}`} className="group flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-semibold uppercase text-primary"
      >
        {name.slice(0, 2)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground group-hover:text-primary">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{agent.agentType}</span>
      </span>
    </Link>
  );
}

const selectClass =
  "h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/**
 * EXPERIENCE-P0-08, rebuilt to the 2026-09-25 inventory mockup: underline
 * segment tabs with counts, a search box beside lifecycle and environment
 * filters, and a column per question an administrator asks of an agent
 * (where it runs, who owns it, how risky it is, when it was last seen).
 *
 * `listAgents()` (Identity Agent's published contract) still has no
 * pagination/sort parameters of its own, so segment, filters, search, sort
 * and page are applied to the already-fetched list client-side — the same
 * documented stopgap as before (see the Experience Agent audit log), still
 * pending a paginated variant from Identity per CLAUDE.md §15.
 */
export function AgentsTable({ agents, nowMs }: { agents: AgentRow[]; nowMs: number }) {
  const state = useTableState("agents", { sortKey: "agentName", sortDir: "asc", pageSize: 25 });
  const [segment, setSegment] = useState<Segment>("all");
  const [lifecycle, setLifecycle] = useState("");
  const [environment, setEnvironment] = useState("");

  const pills = useMemo(
    () => [
      { value: "all", label: "All agents", count: agents.length },
      { value: "at_risk", label: "At risk", count: agents.filter((a) => inSegment(a, "at_risk")).length },
      { value: "unowned", label: "Unowned", count: agents.filter((a) => inSegment(a, "unowned")).length },
      { value: "discovered", label: "Discovered", count: agents.filter((a) => inSegment(a, "discovered")).length },
    ],
    [agents],
  );

  const filtered = useMemo(() => {
    const needle = state.filter.trim().toLowerCase();
    return agents.filter((a) => {
      if (!inSegment(a, segment)) return false;
      if (lifecycle && a.lifecycleState !== lifecycle) return false;
      if (environment && a.environment !== environment) return false;
      if (!needle) return true;
      return [a.agentName, a.displayName, a.agentType, a.sourceSystem, a.framework, a.owner]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [agents, segment, lifecycle, environment, state.filter]);

  const sorted = useMemo(() => {
    if (!state.sortKey) return filtered;
    const dir = state.sortDir === "asc" ? 1 : -1;
    const key = state.sortKey as keyof AgentRow;
    return [...filtered].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" || typeof bv === "number") return ((Number(av ?? -1) - Number(bv ?? -1)) || 0) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [filtered, state.sortKey, state.sortDir]);

  const pageRows = sorted.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

  const columns: DataTableColumn<AgentRow>[] = [
    { key: "agentName", header: "Name", sortable: true, render: (a) => <AgentCell agent={a} /> },
    { key: "sourceSystem", header: "Platform", sortable: true, render: (a) => <span className="text-muted-foreground">{a.sourceSystem ?? "—"}</span> },
    { key: "framework", header: "Framework", sortable: true, render: (a) => <span className="text-muted-foreground">{a.framework ?? "—"}</span> },
    { key: "environment", header: "Environment", sortable: true, render: (a) => <span className="text-muted-foreground">{humanize(a.environment)}</span> },
    {
      key: "lifecycleState",
      header: "Status",
      sortable: true,
      render: (a) => <StatusBadge tone={LIFECYCLE_TONE[a.lifecycleState] ?? "neutral"}>{humanize(a.lifecycleState)}</StatusBadge>,
    },
    { key: "riskScore", header: "Risk", sortable: true, render: (a) => <RiskCell score={a.riskScore} /> },
    { key: "openFindings", header: "Findings", sortable: true, render: (a) => <span className="tabular-nums">{a.openFindings}</span> },
    {
      key: "owner",
      header: "Owner",
      sortable: true,
      render: (a) => (a.owner ? <span className="whitespace-nowrap">{a.owner}</span> : <span className="text-muted-foreground">Unassigned</span>),
    },
    {
      key: "lastSeenAt",
      header: "Last seen",
      sortable: true,
      render: (a) => <span className="whitespace-nowrap text-muted-foreground">{lastSeen(a.lastSeenAt, nowMs)}</span>,
    },
    {
      key: "chevron",
      header: "",
      render: (a) => (
        <Link href={`/agents/${a.id}`} aria-label={`Open ${nameOf(a)}`} className="block text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <CountPills variant="tabs" pills={pills} value={segment} onChange={(v) => setSegment(v as Segment)} ariaLabel="Filter agents" />
      <DataTable
        bare
        columns={columns}
        rows={pageRows}
        getRowId={(a) => a.id}
        totalCount={sorted.length}
        state={state}
        emptyTitle="No agents match this filter"
        filterPlaceholder="Search agents…"
        toolbar={
          <>
            <select aria-label="Lifecycle status" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} className={selectClass}>
              <option value="">All statuses</option>
              {LIFECYCLE_STATES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <select aria-label="Environment" value={environment} onChange={(e) => setEnvironment(e.target.value)} className={selectClass}>
              <option value="">All environments</option>
              {ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>
                  {humanize(env)}
                </option>
              ))}
            </select>
            <Link
              href="/reports/agent_inventory"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-primary shadow-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <FileDown className="size-4" aria-hidden="true" />
              Export
            </Link>
          </>
        }
        // Below `md` the generic card transform would stack every column as
        // a label-value pair. The inventory's mobile row is one line — tile,
        // name, source, status, chevron — so supply it.
        renderCard={(a) => (
          <Link
            href={`/agents/${a.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold uppercase text-primary"
            >
              {nameOf(a).slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{nameOf(a)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[a.sourceSystem, a.owner ?? "Unassigned"].filter(Boolean).join(" · ")}
              </span>
            </span>
            <StatusBadge tone={LIFECYCLE_TONE[a.lifecycleState] ?? "neutral"}>{humanize(a.lifecycleState)}</StatusBadge>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        )}
      />
    </div>
  );
}
