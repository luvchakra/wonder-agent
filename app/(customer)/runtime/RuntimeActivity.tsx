"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { ACCESS_VIEWS_COMPARED, Badge, Card, CardHeader, CardBody, EmptyState, Tabs, TabPanel } from "@/modules/ui";
import { SelectField, fieldInputClass } from "@/modules/ui/Field";
import { cn } from "@/lib/utils";
import { eventResult, humanizeEventType } from "./eventLabels";

export type ActivityRow = {
  id: string;
  agentId: string;
  agentName: string;
  eventTime: string;
  source: string;
  action: string;
  application: string | null;
  resource: string | null;
  dataClassification: string | null;
  success: boolean;
  raw: Record<string, unknown>;
  eventType: string;
};

// RUNTIME-P0-16: an observed action succeeded or failed; a gateway
// decision is its own kind. Nothing is "blocked" while the gateway only
// observes (§17.5).
const RESULTS = [
  { value: "all", label: "All results" },
  { value: "success", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "decision", label: "Gateway decisions" },
];

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * RUNTIME — the tenant-wide activity stream, built to the supplied design:
 * a filter row, a dense table, and an "Activity details" panel for the
 * selected event.
 *
 * The rows are the page's already-fetched, server-paginated window
 * (`listRuntimeEvents`, Runtime Agent's published contract). The agent /
 * result / search filters here narrow that window in the browser, which is
 * honest about what the user is looking at — the header states the window
 * — rather than pretending to search all of history without a contract
 * that supports it.
 *
 * The design's third details tab, "Policy Evaluation", is deliberately not
 * built: per-event policy evaluation belongs to the Access Agent and it
 * publishes no per-runtime-event evaluation contract. Inventing one here
 * would be this module claiming another's domain (non-negotiable #18).
 */
export function RuntimeActivity({ rows, windowLabel }: { rows: ActivityRow[]; windowLabel: string }) {
  const [agentId, setAgentId] = useState("all");
  const [result, setResult] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);

  const agentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) if (!seen.has(row.agentId)) seen.set(row.agentId, row.agentName);
    return [{ value: "all", label: "All agents" }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (agentId !== "all" && row.agentId !== agentId) return false;
      const kind = eventResult(row);
      if (result === "success" && (kind.isDecision || !row.success)) return false;
      if (result === "failed" && (kind.isDecision || row.success)) return false;
      if (result === "decision" && !kind.isDecision) return false;
      if (!needle) return true;
      return [row.agentName, row.action, row.application, row.resource]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [rows, agentId, result, query]);

  const selected = filtered.find((row) => row.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <SelectField label="Agent" name="agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agentOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-40">
          <SelectField label="Result" name="result" value={result} onChange={(e) => setResult(e.target.value)}>
            {RESULTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="runtime-search" className="block text-sm font-medium text-muted-foreground">
            Search
          </label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              id="runtime-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Agent, action or resource…"
              className={cn(fieldInputClass, "pl-8")}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Activity" description={`${filtered.length} of ${rows.length} events · ${windowLabel}`} />
          <CardBody className="px-0 py-0">
            {filtered.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No activity matches these filters" />
              </div>
            ) : (
              <ul aria-label="Activity events" className="divide-y divide-border">
                {filtered.map((row) => {
                  const active = selected?.id === row.id;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors",
                          "hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          active && "bg-accent/60",
                        )}
                      >
                        <span className="w-20 shrink-0 tabular-nums text-xs text-muted-foreground">
                          {timeOf(row.eventTime)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.agentName}</span>
                        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          {row.action}
                        </span>
                        {row.resource || row.application ? (
                          <span className="min-w-0 basis-full truncate text-xs text-muted-foreground sm:w-56 sm:basis-auto">
                            {row.resource ?? row.application}
                          </span>
                        ) : (
                          <span className="hidden text-xs text-muted-foreground sm:inline sm:w-56">—</span>
                        )}
                        <Badge tone={eventResult(row).tone}>{eventResult(row).label}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0 self-start px-4 pb-3 pt-1">
          {selected === null ? (
            <div className="py-6">
              <EmptyState title="Select an event to inspect it" />
            </div>
          ) : (
            <Tabs
              ariaLabel="Activity details"
              tabs={[
                { value: "intent", label: "Details" },
                { value: "raw", label: "Raw log" },
              ]}
            >
              <TabPanel value="intent" className="pt-3">
                <dl className="space-y-2.5 text-sm">
                  {[
                    ["Agent", selected.agentName],
                    ["Action", selected.action],
                    ["Application", selected.application ?? "—"],
                    ["Resource", selected.resource ?? "—"],
                    ["Data classification", selected.dataClassification ?? "—"],
                    ["Event type", humanizeEventType(selected.eventType)],
                    ["Source", selected.source],
                    ["Time", new Date(selected.eventTime).toLocaleString()],
                    ["Result", eventResult(selected).label],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline gap-3">
                      <dt className="w-32 shrink-0 text-xs text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
                <Link
                  href={`/runtime/agents/${selected.agentId}`}
                  className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {ACCESS_VIEWS_COMPARED} for this agent
                </Link>
              </TabPanel>

              <TabPanel value="raw" className="pt-3">
                <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                  {JSON.stringify(selected.raw, null, 2)}
                </pre>
              </TabPanel>
            </Tabs>
          )}
        </Card>
      </div>
    </div>
  );
}
