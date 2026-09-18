import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, ClipboardCheck, Plus, Search, Siren } from "lucide-react";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { getProfile } from "@/lib/tenant/session";
import { listAgents } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { listRuntimeEvents } from "@/modules/runtime-assurance/service";
import type { Agent } from "@/lib/shared/types/agent-identity";
import { Card, CardHeader, CardBody, KpiCard, SeverityBadge, Badge, EmptyState, Tabs, TabPanel } from "@/modules/ui";
import { TrendChart } from "@/modules/ui/charts.lazy";
import { Greeting } from "./Greeting";
import {
  KpiSkeleton,
  OverdueCertificationsCard,
  PanelSkeleton,
  PendingCertifications,
  PosturePanels,
  UnownedKpi,
} from "./dashboard-panels";

// EXPERIENCE-P0-02 / P0-16. Every number on this page is a real query
// against the owning module's published contract — never a hardcoded
// figure, and never an LLM's guess (CLAUDE.md non-negotiable #9).
//
// Two tiers of data. The first wave — agents, open findings, recent
// events, the greeting's profile — is four parallel queries and drives the
// header, the KPI row, the risk trend and the activity list; the page
// paints as soon as it lands. Everything that then fans out per agent or
// per campaign (governance posture, ownership issues, certification
// items) lives in ./dashboard-panels.tsx behind Suspense boundaries and
// streams in behind a skeleton, so a slow read-model never delays the
// numbers an administrator came for.

const TREND_DAYS = 14;

const APPROVED_STATES = new Set(["APPROVED", "PROVISIONED", "ACTIVE", "CERTIFICATION_DUE"]);
const PENDING_STATES = new Set(["DISCOVERED", "REGISTERED", "ASSESSED"]);

function agentLabel(agent: Agent): string {
  return agent.displayName?.trim() || agent.agentName;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Last N days, oldest first, as {key, label} for the trend chart's x axis. */
function lastDays(today: Date, n: number): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
}

export default async function OverviewPage() {
  const ctx = await getTenantContext();
  const tenantId = ctx.tenantId!;

  const [agents, openFindings, runtimePage, profile] = await Promise.all([
    listAgents(tenantId),
    getFindings(tenantId, { status: "open" }),
    listRuntimeEvents(tenantId, { limit: 100 }),
    getProfile(),
  ]);

  const now = new Date();
  const nowIso = now.toISOString();

  // --- KPI row ------------------------------------------------------------
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const newThisWeek = agents.filter((a) => a.createdAt >= weekAgo).length;
  const approved = agents.filter((a) => APPROVED_STATES.has(a.lifecycleState)).length;
  const pendingApproval = agents.filter((a) => PENDING_STATES.has(a.lifecycleState)).length;
  const atRiskAgentIds = new Set(
    openFindings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => f.agentId),
  );
  const share = (n: number) => (agents.length === 0 ? "—" : `${Math.round((n / agents.length) * 100)}% of all agents`);

  // --- Risk trend ---------------------------------------------------------
  const days = lastDays(now, TREND_DAYS);
  const trendData = days.map(({ key, label }) => {
    const findingsThatDay = openFindings.filter((f) => dayKey(f.createdAt) === key);
    return {
      label,
      findings: findingsThatDay.length,
      severe: findingsThatDay.filter((f) => f.severity === "critical" || f.severity === "high").length,
      agents: agents.filter((a) => dayKey(a.createdAt) === key).length,
    };
  });

  // --- Activity panels ----------------------------------------------------
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const events = runtimePage.events;
  const activityByAgent = [...agentById.values()]
    .map((a) => ({ agent: a, count: events.filter((e) => e.agentId === a.id).length }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Greeting name={profile?.displayName?.trim() || "there"} />
          <p className="mt-1 text-sm text-muted-foreground">
            Here&rsquo;s what&rsquo;s happening with your AI agents today.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {agents.length} agent{agents.length === 1 ? "" : "s"} in {ctx.tenantSlug}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              icon="Bot"
              tone="primary"
              label="Total agents"
              value={agents.length}
              delta={newThisWeek > 0 ? { direction: "up", text: `+${newThisWeek} this week` } : null}
              href="/agents"
            />
            <KpiCard
              icon="ShieldCheck"
              tone="success"
              label="Approved"
              value={approved}
              footnote={share(approved)}
              href="/agents"
            />
            <KpiCard
              icon="Clock"
              tone="warning"
              label="Pending approval"
              value={pendingApproval}
              footnote={share(pendingApproval)}
              href="/agents"
            />
            <Suspense fallback={<KpiSkeleton />}>
              <UnownedKpi tenantId={tenantId} agents={agents} />
            </Suspense>
            <KpiCard
              icon="ShieldAlert"
              tone="danger"
              label="At risk"
              value={atRiskAgentIds.size}
              footnote={`${openFindings.length} open finding${openFindings.length === 1 ? "" : "s"}`}
              href="/risk"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {/* Order matters for the grid: posture, trend, coverage. The
                trend card is rendered eagerly between the two streamed
                panels, so the streamed pair is split around it by the
                Suspense boundary's fragment — both halves fill in
                together once the posture fan-out completes. */}
            <Suspense
              fallback={
                <>
                  <PanelSkeleton title="Agent governance posture" description="Every agent, scored across 12 dimensions" />
                  <RiskTrendCard data={trendData} />
                  <PanelSkeleton title="Compliance coverage" description="Share of applicable agents governed on each dimension" />
                </>
              }
            >
              <PosturePanelsWithTrend tenantId={tenantId} agents={agents} trendData={trendData} />
            </Suspense>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card className="min-w-0 px-4 pb-3 pt-1">
              <Tabs
                ariaLabel="Activity"
                tabs={[
                  { value: "activity", label: "Recent activity" },
                  { value: "findings", label: "Open findings", count: openFindings.length },
                  { value: "certifications", label: "Pending approvals" },
                ]}
              >
                <TabPanel value="activity" className="pt-1">
                  {events.length === 0 ? (
                    <EmptyState title="No runtime activity recorded yet" />
                  ) : (
                    <ul className="divide-y divide-border">
                      {events.slice(0, 6).map((e) => (
                        <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                          <span className="w-16 shrink-0 tabular-nums text-xs text-muted-foreground">
                            {new Date(e.eventTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            <Link
                              href={`/runtime/agents/${e.agentId}`}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {agentById.get(e.agentId) ? agentLabel(agentById.get(e.agentId)!) : "Unknown agent"}
                            </Link>
                            <span className="text-muted-foreground"> · {e.resource ?? e.application ?? "—"}</span>
                          </span>
                          <span className="hidden shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground sm:inline">
                            {e.action}
                          </span>
                          <Badge tone={e.success ? "success" : "danger"}>{e.success ? "Allowed" : "Blocked"}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabPanel>

                <TabPanel value="findings" className="pt-1">
                  {openFindings.length === 0 ? (
                    <EmptyState title="No open findings" />
                  ) : (
                    <ul className="divide-y divide-border">
                      {openFindings.slice(0, 6).map((f) => (
                        <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
                          <Link
                            href={`/risk/agents/${f.agentId}`}
                            className="min-w-0 flex-1 truncate text-foreground hover:text-primary"
                          >
                            {f.title}
                          </Link>
                          <SeverityBadge severity={f.severity} />
                        </li>
                      ))}
                    </ul>
                  )}
                </TabPanel>

                <TabPanel value="certifications" className="pt-1">
                  <Suspense fallback={<div aria-hidden="true" className="my-2 h-24 animate-pulse rounded-lg bg-muted" />}>
                    <PendingCertifications tenantId={tenantId} agentById={agentById} nowIso={nowIso} />
                  </Suspense>
                </TabPanel>
              </Tabs>
            </Card>

            <Card className="min-w-0">
              <CardHeader
                title="Top agents by activity"
                description={`Across the last ${events.length} events`}
                actions={
                  <Link href="/runtime" className="text-xs font-medium text-primary hover:underline">
                    View all
                  </Link>
                }
              />
              <CardBody>
                {activityByAgent.length === 0 ? (
                  <EmptyState title="No activity to rank yet" />
                ) : (
                  <ul className="space-y-2.5">
                    {activityByAgent.map(({ agent, count }) => (
                      <li key={agent.id} className="flex items-center gap-3 text-sm">
                        <Link
                          href={`/runtime/agents/${agent.id}`}
                          className="min-w-0 flex-1 truncate text-foreground hover:text-primary"
                        >
                          {agentLabel(agent)}
                        </Link>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        <aside className="space-y-4">
          {/* Uses the rail's own navy in both themes, so it reads as the
              same "product frame" surface rather than another card. In dark
              mode that navy sits close to --card, hence the explicit ring
              to keep it a distinct panel. */}
          <div className="rounded-xl bg-sidebar p-5 text-sidebar-foreground shadow-md ring-1 ring-sidebar-border">
            <h2 className="text-lg font-semibold leading-snug tracking-[-0.01em]">
              Turn AI agents into a force for good.
            </h2>
            <p className="mt-2 text-sm text-sidebar-muted-foreground">Discover. Govern. Monitor. Prove.</p>
            <Link
              href="/welcome#how-it-works"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              See how it works
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>

          <Card>
            <CardHeader title="Quick actions" />
            <CardBody className="grid grid-cols-2 gap-2">
              {[
                { href: "/agents/new", icon: Plus, title: "Register agent", sub: "Onboard and define governance" },
                { href: "/compliance/campaigns", icon: ClipboardCheck, title: "Run certification", sub: "Validate access and ownership" },
                { href: "/agents/discovery", icon: Search, title: "Review discoveries", sub: "Unregistered agents found" },
                { href: "/risk/rogue", icon: Siren, title: "Rogue agents", sub: "Suspend or restrict agents" },
              ].map(({ href, icon: Icon, title, sub }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-3 transition-colors hover:border-ring/50 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  <span className="text-sm font-medium text-card-foreground">{title}</span>
                  <span className="text-xs leading-snug text-muted-foreground">{sub}</span>
                </Link>
              ))}
            </CardBody>
          </Card>

          <Suspense fallback={null}>
            <OverdueCertificationsCard tenantId={tenantId} nowIso={nowIso} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}

function RiskTrendCard({ data }: { data: Array<Record<string, string | number>> }) {
  return (
    <Card>
      <CardHeader title="Risk trend" description={`Last ${TREND_DAYS} days`} />
      <CardBody>
        <TrendChart
          data={data}
          series={[
            { key: "findings", label: "Findings opened", color: "var(--color-primary)" },
            { key: "severe", label: "Critical & high", color: "var(--color-destructive)" },
            { key: "agents", label: "Agents registered", color: "var(--color-warning)" },
          ]}
        />
      </CardBody>
    </Card>
  );
}

/**
 * The posture pair with the trend card slotted between them, so the grid
 * order (posture, trend, coverage) survives the Suspense boundary. The
 * trend card needs nothing beyond the first wave, but rendering it here
 * keeps it in its designed column without a second boundary.
 */
async function PosturePanelsWithTrend({
  tenantId,
  agents,
  trendData,
}: {
  tenantId: string;
  agents: Agent[];
  trendData: Array<Record<string, string | number>>;
}) {
  return (
    <>
      <PosturePanels tenantId={tenantId} agents={agents} trendCard={<RiskTrendCard data={trendData} />} />
    </>
  );
}
