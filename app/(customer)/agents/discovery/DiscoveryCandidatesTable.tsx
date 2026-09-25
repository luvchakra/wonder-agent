"use client";

import Link from "next/link";
import type { DiscoveryInboxEntry } from "@/lib/shared/types/agent-identity";
import { StatusBadge, type BadgeTone, SimpleDataTable, type DataTableColumn } from "@/modules/ui";

const CONFIDENCE_TONE: Record<string, BadgeTone> = { HIGH: "success", MEDIUM: "warning", LOW: "neutral" };
const CHANGE_TONE: Record<string, BadgeTone> = { NEW: "info", STALE: "warning" };

const STATUS_LABEL: Record<string, string> = {
  new: "New — not yet registered",
  likely_duplicate: "Likely duplicate",
  orphaned_identity: "Orphaned identity",
  shadow_ai: "Shadow AI — unregistered, active at runtime",
};
const STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  likely_duplicate: "warning",
  orphaned_identity: "danger",
  shadow_ai: "danger",
};

function candidateHref(e: DiscoveryInboxEntry): string {
  return `/agents/discovery/${encodeURIComponent(e.integrationId)}/${encodeURIComponent(e.externalId)}`;
}

/**
 * Fully Functional Agent Discovery — the Discovery Inbox's Candidate List
 * (spec §19). Reuses `SimpleDataTable` (search/sort/pagination/responsive
 * card-transform already built by Experience Agent — CLAUDE.md §13) rather
 * than hand-rolling another table, same pattern `IntegrationsTable`/
 * `AgentsTable` already establish.
 */
export function DiscoveryCandidatesTable({ entries }: { entries: DiscoveryInboxEntry[] }) {
  const columns: DataTableColumn<DiscoveryInboxEntry>[] = [
    {
      key: "displayName",
      header: "Agent",
      sortable: true,
      render: (e) => (
        <Link href={candidateHref(e)} className="text-primary hover:underline">
          <div>{e.displayName}</div>
          <div className="text-xs font-normal text-muted-foreground">{e.identityType.replace(/_/g, " ")}</div>
        </Link>
      ),
    },
    {
      key: "confidenceScore",
      header: "Confidence",
      sortable: true,
      render: (e) => (
        <StatusBadge tone={CONFIDENCE_TONE[e.confidenceLevel]}>
          {e.confidenceLevel} · {e.confidenceScore}%
        </StatusBadge>
      ),
    },
    { key: "integrationName", header: "Source", sortable: true, render: (e) => e.integrationName },
    { key: "externalId", header: "Identity", render: (e) => <span className="font-mono text-xs">{e.externalId}</span> },
    { key: "owner", header: "Owner", render: (e) => e.owner ?? "—" },
    {
      key: "lastSeenAt",
      header: "Last Seen",
      sortable: true,
      render: (e) => (e.lastSeenAt ? new Date(e.lastSeenAt).toLocaleString() : "—"),
    },
    {
      key: "changeType",
      header: "Change",
      render: (e) => <StatusBadge tone={CHANGE_TONE[e.changeType]}>{e.changeType === "STALE" ? "Not seen in latest sync" : "New"}</StatusBadge>,
    },
    {
      key: "status",
      header: "Status",
      render: (e) =>
        e.candidateStatus === "ignored" ? (
          <StatusBadge tone="neutral">Ignored</StatusBadge>
        ) : e.candidateStatus === "linked" ? (
          <StatusBadge tone="success">Linked</StatusBadge>
        ) : (
          <StatusBadge tone={STATUS_TONE[e.category]}>{STATUS_LABEL[e.category]}</StatusBadge>
        ),
    },
    {
      key: "action",
      header: "Action",
      cardLabel: "Action",
      render: (e) => (
        <Link href={candidateHref(e)} className="text-primary hover:underline">
          Review →
        </Link>
      ),
    },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={entries}
      getRowId={(e) => `${e.integrationId}::${e.externalId}`}
      getSearchableText={(e) => `${e.displayName} ${e.externalId} ${e.integrationName} ${e.owner ?? ""} ${e.application ?? ""}`}
      getSortValue={(e, key) => {
        if (key === "confidenceScore") return e.confidenceScore;
        if (key === "lastSeenAt") return e.lastSeenAt ?? "";
        return String((e as unknown as Record<string, unknown>)[key] ?? "");
      }}
      paramPrefix="discovery"
      defaultSortKey="confidenceScore"
      emptyTitle="Nothing to review"
      emptyDescription="No candidates match this view."
      filterPlaceholder="Filter by name, identity, source, or owner…"
    />
  );
}
