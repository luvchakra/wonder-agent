"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleAlert, ShieldAlert, TriangleAlert, Info } from "lucide-react";
import { CountPills, EmptyState } from "@/modules/ui";
import { cn } from "@/lib/utils";

export type FindingRow = {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  severity: string;
  category: string;
  createdAt: string;
};

const SEVERITY_META: Record<string, { icon: typeof ShieldAlert; className: string; label: string }> = {
  critical: { icon: ShieldAlert, className: "text-destructive", label: "Critical" },
  high: { icon: CircleAlert, className: "text-destructive", label: "High" },
  medium: { icon: TriangleAlert, className: "text-warning", label: "Medium" },
  low: { icon: Info, className: "text-info", label: "Low" },
};

function relative(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * The design's "Risks & Alerts" list: severity count pills over a list
 * whose rows carry a severity icon, the finding, its agent and how long it
 * has been open. Severity is never carried by colour alone — every row has
 * an icon and the severity word (UI-UX-DESIGN-RULES.md §19).
 *
 * `now` is passed in from the server render so the relative timestamps are
 * computed against one instant rather than drifting per row.
 */
export function FindingsList({ findings, now }: { findings: FindingRow[]; now: number }) {
  const [severity, setSeverity] = useState("all");

  const pills = useMemo(
    () => [
      { value: "all", label: "All", count: findings.length },
      { value: "critical", label: "Critical", count: findings.filter((f) => f.severity === "critical").length, tone: "danger" as const },
      { value: "high", label: "High", count: findings.filter((f) => f.severity === "high").length, tone: "danger" as const },
      { value: "medium", label: "Medium", count: findings.filter((f) => f.severity === "medium").length, tone: "warning" as const },
      { value: "low", label: "Low", count: findings.filter((f) => f.severity === "low").length },
    ],
    [findings],
  );

  const visible = severity === "all" ? findings : findings.filter((f) => f.severity === severity);

  return (
    <div className="space-y-3">
      <CountPills pills={pills} value={severity} onChange={setSeverity} ariaLabel="Filter findings by severity" />

      {visible.length === 0 ? (
        <EmptyState title="No open findings at this severity" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border/60 bg-card shadow-md">
          {visible.map((f) => {
            const meta = SEVERITY_META[f.severity] ?? SEVERITY_META.low;
            const Icon = meta.icon;
            return (
              <li key={f.id}>
                <Link
                  href={`/risk/agents/${f.agentId}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{f.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="sr-only">{meta.label} severity. </span>
                      {meta.label} · {f.agentName} · {f.category.replace(/_/g, " ")}
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {relative(f.createdAt, now)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
