import Link from "next/link";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { listAgents } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { countRuntimeEvents, listRuntimeEvents } from "@/modules/runtime-assurance/service";
import type { Agent, AgentLifecycleState } from "@/lib/shared/types/agent-identity";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  KpiCard,
  PeriodSelect,
  TableContainer,
  Td,
  Th,
  Thead,
  Tr,
} from "@/modules/ui";
import { DonutChart, TrendChart } from "@/modules/ui/charts.lazy";

// EXPERIENCE-P0-02 / P0-16, rebuilt 2026-09-25 to the light-console
// "AI Agent Security Overview" mockup. Every number is a real query
// against the owning module's published contract — never a hardcoded
// figure, never an LLM's guess (non-negotiable #9), and never a metric the
// product cannot actually measure yet (the mockup's "Shadow AI" and
// "Blocked actions" became "Unregistered" and "Failed actions": nothing is
// blocked at runtime until the Runtime Gateway exists — see
// docs/implementation/codebase-map.md §6.1, and CLAUDE.md §17.5).
//
// One parallel wave of five cheap queries, no per-agent fan-out, so the
// page renders in one round trip after the layout's.

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const DEFAULT_RANGE = 30;
const DAY_MS = 86_400_000;

/** Findings that still need someone: everything short of a closing status. */
const CLOSED_FINDING_STATUSES = new Set(["resolved", "false_positive", "exception", "mitigated"]);
const APPROVED_STATES = new Set<AgentLifecycleState>(["APPROVED", "PROVISIONED", "ACTIVE", "CERTIFICATION_DUE"]);

/** The mockup's lifecycle ring, over the ten real lifecycle states. */
const LIFECYCLE_SLICES: Array<{ label: string; states: AgentLifecycleState[]; color: string }> = [
  { label: "Active", states: ["ACTIVE", "CERTIFICATION_DUE"], color: "var(--color-success)" },
  { label: "Onboarding", states: ["REGISTERED", "ASSESSED", "APPROVED", "PROVISIONED"], color: "var(--color-warning)" },
  { label: "Restricted", states: ["RESTRICTED"], color: "var(--color-destructive)" },
  { label: "Suspended", states: ["SUSPENDED"], color: "var(--color-violet)" },
  { label: "Retired", states: ["RETIRED"], color: "var(--color-muted-foreground)" },
  { label: "Discovered", states: ["DISCOVERED"], color: "var(--color-info)" },
];

const SEVERITY_SERIES = [
  { key: "critical", label: "Critical", color: "var(--color-destructive)" },
  { key: "high", label: "High", color: "var(--color-warning)" },
  { key: "medium", label: "Medium", color: "var(--color-violet)" },
  { key: "low", label: "Low", color: "var(--color-info)" },
];

function agentLabel(agent: Agent): string {
  return agent.displayName?.trim() || agent.agentName;
}

function pct(n: number, of: number): string {
  return of === 0 ? "0%" : `${Math.round((n / of) * 100)}%`;
}

/** "5 min ago" — rendered on the server at request time. */
function relativeTime(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Risk-score band, matching the Risk Agent's severity bands (modules/risk/scoring.ts). */
function scoreTone(score: number): "danger" | "warning" | "info" | "neutral" {
  if (score >= 75) return "danger";
  if (score >= 50) return "warning";
  if (score >= 25) return "info";
  return "neutral";
}

/** Day buckets from `from` to today (UTC), for the trend's x axis. */
function dayBuckets(fromMs: number, nowMs: number): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (let t = fromMs; t <= nowMs; t += DAY_MS) {
    const d = new Date(t);
    out.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: rangeParam } = await searchParams;
  const rangeDays = RANGES.some((r) => r.value === rangeParam) ? Number(rangeParam) : DEFAULT_RANGE;

  const ctx = await getTenantContext();
  const tenantId = ctx.tenantId!;

  const nowMs = new Date().getTime();
  const from = new Date(nowMs - rangeDays * DAY_MS).toISOString();
  const previousFrom = new Date(nowMs - 2 * rangeDays * DAY_MS).toISOString();

  const [agents, findings, recent, failed, failedBefore] = await Promise.all([
    listAgents(tenantId),
    getFindings(tenantId),
    listRuntimeEvents(tenantId, { limit: 6 }),
    countRuntimeEvents(tenantId, { from, success: false }),
    countRuntimeEvents(tenantId, { from: previousFrom, to: from, success: false }),
  ]);

  const unresolved = findings.filter((f) => !CLOSED_FINDING_STATUSES.has(f.status));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  // --- Headline metrics ---------------------------------------------------
  const newInRange = agents.filter((a) => a.createdAt >= from).length;
  const priorTotal = agents.length - newInRange;
  const approved = agents.filter((a) => APPROVED_STATES.has(a.lifecycleState)).length;
  const highRiskIds = new Set(
    unresolved.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => f.agentId),
  );
  const unregistered = agents.filter((a) => a.lifecycleState === "DISCOVERED").length;
  const failedChange = failedBefore === 0 ? null : Math.round(((failed - failedBefore) / failedBefore) * 100);

  // --- Lifecycle ring -----------------------------------------------------
  const lifecycleSlices = LIFECYCLE_SLICES.map((s) => ({
    label: s.label,
    value: agents.filter((a) => s.states.includes(a.lifecycleState)).length,
    color: s.color,
  }));

  // --- Risk trend: findings detected per day, by severity -----------------
  const buckets = dayBuckets(Date.parse(from), nowMs);
  const byDay = new Map<string, Record<string, number>>();
  for (const f of findings) {
    if (f.createdAt < from) continue;
    const key = f.createdAt.slice(0, 10);
    const row = byDay.get(key) ?? {};
    row[f.severity] = (row[f.severity] ?? 0) + 1;
    byDay.set(key, row);
  }
  const trendData = buckets.map(({ key, label }) => ({
    label,
    critical: byDay.get(key)?.critical ?? 0,
    high: byDay.get(key)?.high ?? 0,
    medium: byDay.get(key)?.medium ?? 0,
    low: byDay.get(key)?.low ?? 0,
  }));

  // --- Top risky agents ---------------------------------------------------
  const openByAgent = new Map<string, number>();
  for (const f of unresolved) openByAgent.set(f.agentId, (openByAgent.get(f.agentId) ?? 0) + 1);
  const topRisky = agents
    .filter((a) => (a.riskScore ?? 0) > 0)
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">AI Agent Security Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Discover. Understand. Govern. Protect. Assure.</p>
        </div>
        <PeriodSelect options={RANGES} value={String(rangeDays)} label="Reporting period" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          icon="Bot"
          tone="primary"
          label="Total agents"
          value={agents.length}
          delta={
            newInRange > 0 && priorTotal > 0
              ? { direction: "up", text: pct(newInRange, priorTotal), good: true }
              : null
          }
          footnote={`+${newInRange} in the last ${rangeDays} days`}
          href="/agents"
        />
        <KpiCard
          icon="ShieldCheck"
          tone="success"
          label="Approved agents"
          value={approved}
          footnote={`${pct(approved, agents.length)} of total`}
          href="/agents"
        />
        <KpiCard
          icon="TriangleAlert"
          tone="danger"
          emphasis
          label="High-risk agents"
          value={highRiskIds.size}
          footnote={`${pct(highRiskIds.size, agents.length)} of total`}
          href="/risk"
        />
        <KpiCard
          icon="UserSearch"
          tone="violet"
          emphasis
          label="Unregistered agents"
          value={unregistered}
          footnote="Discovered, awaiting registration"
          href="/agents/discovery"
        />
        <KpiCard
          icon="Ban"
          tone="warning"
          emphasis
          label="Failed actions"
          value={failed}
          delta={
            failedChange === null || failedChange === 0
              ? null
              : { direction: failedChange > 0 ? "up" : "down", text: `${Math.abs(failedChange)}%`, good: failedChange < 0 }
          }
          footnote={`vs previous ${rangeDays} days`}
          href="/runtime"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <Card>
          <CardHeader
            title="Agent lifecycle"
            actions={
              <Link href="/agents" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          <CardBody className="flex flex-1 items-center py-5">
            <DonutChart
              slices={lifecycleSlices}
              centerValue={agents.length}
              centerLabel={agents.length === 1 ? "Agent" : "Agents"}
              size={168}
              showCounts
              className="w-full"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Risk trend" description={`Findings detected per day, last ${rangeDays} days`} />
          <CardBody>
            <TrendChart data={trendData} series={SEVERITY_SERIES} variant="stacked-area" height={236} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title="Recent agent activity"
            actions={
              <Link href="/runtime" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          <CardBody className="pt-0">
            {recent.events.length === 0 ? (
              <EmptyState title="No runtime activity recorded yet" />
            ) : (
              <TableContainer label="Recent agent activity" bare>
                <Thead>
                  <tr>
                    <Th>Time</Th>
                    <Th>Agent</Th>
                    <Th>Action</Th>
                    <Th hideBelow="2xl">Resource</Th>
                    <Th>Result</Th>
                  </tr>
                </Thead>
                <tbody>
                  {recent.events.map((e) => {
                    const agent = agentById.get(e.agentId);
                    return (
                      <Tr key={e.id}>
                        <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(e.eventTime, nowMs)}</Td>
                        <Td>
                          <Link href={`/runtime/agents/${e.agentId}`} className="font-medium text-foreground hover:text-primary">
                            {agent ? agentLabel(agent) : "Unknown agent"}
                          </Link>
                        </Td>
                        <Td className="font-mono text-xs">{e.action}</Td>
                        <Td hideBelow="2xl" className="text-muted-foreground">{e.resource ?? e.application ?? e.tool ?? "—"}</Td>
                        <Td>
                          <Badge tone={e.success ? "success" : "danger"}>{e.success ? "Succeeded" : "Failed"}</Badge>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </TableContainer>
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Top risky agents"
            actions={
              <Link href="/risk" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          <CardBody className="pt-0">
            {topRisky.length === 0 ? (
              <EmptyState title="No agent has a risk score yet" description="Scores appear once the risk engine evaluates an agent." />
            ) : (
              <TableContainer label="Top risky agents" bare>
                <Thead>
                  <tr>
                    <Th>Agent</Th>
                    <Th className="text-right">Risk score</Th>
                    <Th className="text-right">Open findings</Th>
                  </tr>
                </Thead>
                <tbody>
                  {topRisky.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <Link href={`/risk/agents/${a.id}`} className="font-medium text-foreground hover:text-primary">
                          {agentLabel(a)}
                        </Link>
                      </Td>
                      <Td className="md:text-right">
                        <Badge tone={scoreTone(a.riskScore ?? 0)} className="tabular-nums">
                          {Math.round(a.riskScore ?? 0)}
                        </Badge>
                      </Td>
                      <Td className="tabular-nums md:text-right">{openByAgent.get(a.id) ?? 0}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableContainer>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
