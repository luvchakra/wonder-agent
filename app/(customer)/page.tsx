import Link from "next/link";
import { ArrowRight, ClipboardCheck, Plus, Search, Siren } from "lucide-react";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { listAgents, getOwnershipIssues } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { listCampaigns, listCampaignItems, getGovernancePosture } from "@/modules/certification-compliance/service";
import { listRuntimeEvents } from "@/modules/runtime-assurance/service";
import type { Agent } from "@/lib/shared/types/agent-identity";
import type { GovernanceDimension, GovernancePosture } from "@/lib/shared/types/compliance";
import { Card, CardHeader, CardBody, KpiCard, SeverityBadge, Badge, EmptyState, Tabs, TabPanel } from "@/modules/ui";
import { CoverageBars, DonutChart, TrendChart } from "@/modules/ui/charts";
import { Greeting } from "./Greeting";

// EXPERIENCE-P0-02 / P0-16. Every number on this page is a real query
// against the owning module's published contract — never a hardcoded
// figure, and never an LLM's guess (CLAUDE.md non-negotiable #9).

const TREND_DAYS = 14;

/** The design's posture ring. Maps Compliance's five real statuses onto it. */
const POSTURE_SLICES = [
  { status: "GOVERNED", label: "Compliant", color: "var(--color-success)" },
  { status: "PARTIALLY_GOVERNED", label: "Needs attention", color: "var(--color-warning)" },
  { status: "NON_COMPLIANT", label: "At risk", color: "var(--color-destructive)" },
  { status: "EXCEPTION_APPROVED", label: "Exception approved", color: "var(--color-info)" },
  { status: "SUSPENDED", label: "Suspended", color: "var(--color-muted-foreground)" },
] as const;

/** The design's "Compliance Coverage" rows, in its order. */
const COVERAGE_DIMENSIONS: Array<{ dimension: GovernanceDimension; label: string }> = [
  { dimension: "identity", label: "Identity & ownership" },
  { dimension: "purpose", label: "Purpose & use case" },
  { dimension: "access", label: "Access governance" },
  { dimension: "runtime_monitoring", label: "Runtime monitoring" },
  { dimension: "certification", label: "Certification" },
  { dimension: "policy_compliance", label: "Policy & controls" },
];

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

  const supabase = await supabaseServer();
  const [agents, openFindings, campaigns, runtimePage, { data: profile }] = await Promise.all([
    listAgents(tenantId),
    getFindings(tenantId, { status: "open" }),
    listCampaigns(tenantId),
    listRuntimeEvents(tenantId, { limit: 100 }),
    supabase.from("users").select("display_name").eq("id", ctx.userId).maybeSingle<{ display_name: string | null }>(),
  ]);

  // Second wave — each of these needs the agent/campaign list above, so it
  // cannot be hoisted into the first Promise.all, but the fan-out itself is
  // parallel rather than a per-agent await chain (CLAUDE.md §15).
  //
  // getGovernancePosture() is a genuinely expensive read-model: it consults
  // Identity, Access, Runtime and this module per agent. Fanning it out
  // across the whole agent list is acceptable at P0 fixture scale and is
  // covered by this route's loading.tsx skeleton, but it is the first thing
  // that will need a bulk contract from the Compliance Agent as tenants
  // grow — recorded in the Experience audit log.
  const [ownershipResults, postures, activeCampaignItemLists] = await Promise.all([
    Promise.all(agents.map((a) => getOwnershipIssues(tenantId, a.id, a.criticality))),
    Promise.all(
      agents.map((a) =>
        getGovernancePosture(tenantId, a.id).catch(() => null as GovernancePosture | null),
      ),
    ),
    Promise.all(campaigns.filter((c) => c.status === "active").map((c) => listCampaignItems(tenantId, c.id))),
  ]);

  const unownedCount = ownershipResults.filter((issues) => issues.length > 0).length;
  const activeCampaignItems = activeCampaignItemLists.flat();
  const now = new Date();
  const nowIso = now.toISOString();
  const pendingCertifications = activeCampaignItems.filter((i) => i.status === "pending");
  const overdueCertifications = pendingCertifications.filter((i) => i.dueDate && i.dueDate < nowIso);

  // --- KPI row ------------------------------------------------------------
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const newThisWeek = agents.filter((a) => a.createdAt >= weekAgo).length;
  const approved = agents.filter((a) => APPROVED_STATES.has(a.lifecycleState)).length;
  const pendingApproval = agents.filter((a) => PENDING_STATES.has(a.lifecycleState)).length;
  const atRiskAgentIds = new Set(
    openFindings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => f.agentId),
  );
  const share = (n: number) => (agents.length === 0 ? "—" : `${Math.round((n / agents.length) * 100)}% of all agents`);

  // --- Governance posture ring -------------------------------------------
  const postureCounts = new Map<string, number>();
  for (const p of postures) {
    if (!p) continue;
    postureCounts.set(p.status, (postureCounts.get(p.status) ?? 0) + 1);
  }
  const postureSlices = POSTURE_SLICES.map((s) => ({
    label: s.label,
    value: postureCounts.get(s.status) ?? 0,
    color: s.color,
  }));

  // --- Compliance coverage ------------------------------------------------
  const coverageRows = COVERAGE_DIMENSIONS.map(({ dimension, label }) => {
    let applicable = 0;
    let governed = 0;
    for (const p of postures) {
      const result = p?.dimensions.find((d) => d.dimension === dimension);
      if (!result || result.status === "not_applicable") continue;
      applicable += 1;
      if (result.status === "governed") governed += 1;
    }
    return { label, percent: applicable === 0 ? 0 : (governed / applicable) * 100 };
  });

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
          <Greeting name={profile?.display_name?.trim() || "there"} />
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
            <KpiCard
              icon="UserX"
              tone="warning"
              label="Unowned"
              value={unownedCount}
              footnote={share(unownedCount)}
              href="/agents"
            />
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
            <Card>
              <CardHeader title="Agent governance posture" description="Every agent, scored across 12 dimensions" />
              <CardBody className="flex items-center justify-center py-5">
                <DonutChart
                  slices={postureSlices}
                  centerValue={agents.length}
                  centerLabel={agents.length === 1 ? "agent" : "agents"}
                  size={148}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Risk trend" description={`Last ${TREND_DAYS} days`} />
              <CardBody>
                <TrendChart
                  data={trendData}
                  series={[
                    { key: "findings", label: "Findings opened", color: "var(--color-primary)" },
                    { key: "severe", label: "Critical & high", color: "var(--color-destructive)" },
                    { key: "agents", label: "Agents registered", color: "var(--color-warning)" },
                  ]}
                />
              </CardBody>
            </Card>

            <Card className="lg:col-span-2 2xl:col-span-1">
              <CardHeader
                title="Compliance coverage"
                description="Share of applicable agents governed on each dimension"
                actions={
                  <Link href="/reports" className="text-xs font-medium text-primary hover:underline">
                    View reports
                  </Link>
                }
              />
              <CardBody>
                <CoverageBars rows={coverageRows} />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card className="min-w-0 px-4 pb-3 pt-1">
              <Tabs
                ariaLabel="Activity"
                tabs={[
                  { value: "activity", label: "Recent activity" },
                  { value: "findings", label: "Open findings", count: openFindings.length },
                  { value: "certifications", label: "Pending approvals", count: pendingCertifications.length },
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
                  {pendingCertifications.length === 0 ? (
                    <EmptyState title="Nothing awaiting review" />
                  ) : (
                    <ul className="divide-y divide-border">
                      {pendingCertifications.slice(0, 6).map((item) => {
                        const overdue = !!item.dueDate && item.dueDate < nowIso;
                        return (
                          <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
                            <Link
                              href={`/compliance/campaigns/${item.campaignId}`}
                              className="min-w-0 flex-1 truncate text-foreground hover:text-primary"
                            >
                              {agentById.get(item.agentId) ? agentLabel(agentById.get(item.agentId)!) : "Agent review"}
                            </Link>
                            <Badge tone={overdue ? "danger" : "neutral"}>
                              {overdue ? "Overdue" : item.dueDate ? `Due ${item.dueDate.slice(0, 10)}` : "No due date"}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
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
          <div className="rounded-xl bg-sidebar p-5 text-sidebar-foreground shadow-md">
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
            <CardBody className="grid grid-cols-2 gap-2 xl:grid-cols-1 2xl:grid-cols-2">
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

          {overdueCertifications.length > 0 && (
            <Card>
              <CardHeader title="Needs attention" />
              <CardBody>
                <p className="text-sm text-muted-foreground">
                  {overdueCertifications.length} certification item
                  {overdueCertifications.length === 1 ? " is" : "s are"} overdue.
                </p>
                <Link
                  href="/compliance/campaigns"
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  Review now
                </Link>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
