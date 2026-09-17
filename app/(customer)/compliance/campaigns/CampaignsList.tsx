"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, CountPills, EmptyState } from "@/modules/ui";

export type CampaignRow = {
  id: string;
  name: string;
  scopeType: string;
  status: string;
  pending: number;
  overdue: number;
};

/**
 * The design's "Certification" screen: status count pills over campaign
 * rows, each with its outstanding-item count and a Review action.
 *
 * The overdue count is the campaign's own pending items whose due date has
 * passed, computed on the server against a single instant and passed in —
 * not recomputed per row in the browser, which would drift.
 */
export function CampaignsList({ campaigns }: { campaigns: CampaignRow[] }) {
  const [status, setStatus] = useState("all");

  const pills = useMemo(
    () => [
      { value: "all", label: "All", count: campaigns.length },
      { value: "active", label: "Active", count: campaigns.filter((c) => c.status === "active").length, tone: "success" as const },
      { value: "overdue", label: "Overdue", count: campaigns.filter((c) => c.overdue > 0).length, tone: "danger" as const },
      { value: "completed", label: "Completed", count: campaigns.filter((c) => c.status === "completed").length },
    ],
    [campaigns],
  );

  const visible = campaigns.filter((c) => {
    if (status === "all") return true;
    if (status === "overdue") return c.overdue > 0;
    return c.status === status;
  });

  return (
    <div className="space-y-3">
      <CountPills pills={pills} value={status} onChange={setStatus} ariaLabel="Filter campaigns" />

      {visible.length === 0 ? (
        <EmptyState title="No campaigns match this filter" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border/60 bg-card shadow-md">
          {visible.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.scopeType.replace(/_/g, " ")} ·{" "}
                  {c.pending === 0 ? "nothing outstanding" : `${c.pending} item${c.pending === 1 ? "" : "s"} to review`}
                </span>
              </span>
              {c.overdue > 0 && <Badge tone="danger">{c.overdue} overdue</Badge>}
              <Badge tone={c.status === "active" ? "success" : c.status === "completed" ? "neutral" : "warning"}>
                {c.status}
              </Badge>
              <Link
                href={`/compliance/campaigns/${c.id}`}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Review<span className="sr-only"> {c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
