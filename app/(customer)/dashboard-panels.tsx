import Link from "next/link";
import { cache } from "react";
import { getOwnershipIssues } from "@/modules/agent-identity/service";
import { listCampaigns, listCampaignItems, getGovernancePosture } from "@/modules/certification-compliance/service";
import type { Agent } from "@/lib/shared/types/agent-identity";
import type { CertificationItem, GovernanceDimension, GovernancePosture } from "@/lib/shared/types/compliance";
import { Badge, Card, CardHeader, CardBody, EmptyState, KpiCard } from "@/modules/ui";
import { DonutChart } from "@/modules/ui/charts.lazy";
import { CoverageBars } from "@/modules/ui/CoverageBars";

/**
 * The dashboard's slow half.
 *
 * The page renders its first wave — agents, findings, campaigns, recent
 * events — as soon as those four parallel queries land. Everything in this
 * file depends on that wave AND fans out into further queries per agent or
 * per campaign, so it is rendered inside Suspense boundaries: the KPIs, the
 * trend and the activity list paint first, and these panels stream in
 * behind their own skeletons rather than holding the whole page hostage.
 *
 * Each loader is request-cached so two panels needing the same fan-out
 * (the "Pending approvals" tab and the "Needs attention" card both want
 * the active campaigns' items) trigger it once.
 */

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

// getGovernancePosture() is a genuinely expensive read-model: it consults
// Identity, Access, Runtime and Compliance per agent, ten-odd sequential
// queries each. Fanning it out across the agent list in parallel is
// acceptable at P0 fixture scale; it is the first thing that will need a
// bulk contract from the Compliance Agent as tenants grow — recorded in
// the Experience audit log. Streaming it keeps it off the critical path.
const getPostures = cache(async (tenantId: string, agents: Agent[]) =>
  Promise.all(agents.map((a) => getGovernancePosture(tenantId, a.id).catch(() => null as GovernancePosture | null))),
);

const getOwnershipResults = cache(async (tenantId: string, agents: Agent[]) =>
  Promise.all(agents.map((a) => getOwnershipIssues(tenantId, a.id, a.criticality))),
);

const getActiveCampaignItems = cache(async (tenantId: string): Promise<CertificationItem[]> => {
  const campaigns = await listCampaigns(tenantId);
  const lists = await Promise.all(
    campaigns.filter((c) => c.status === "active").map((c) => listCampaignItems(tenantId, c.id)),
  );
  return lists.flat();
});

function agentLabel(agent: Agent): string {
  return agent.displayName?.trim() || agent.agentName;
}

// --- Skeletons ---------------------------------------------------------------

export function KpiSkeleton() {
  return <div aria-hidden="true" className="h-[7.5rem] animate-pulse rounded-xl border border-border/60 bg-muted" />;
}

export function PanelSkeleton({ title, description }: { title: string; description?: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        <div aria-hidden="true" className="h-40 animate-pulse rounded-lg bg-muted" />
      </CardBody>
    </Card>
  );
}

// --- Streamed panels ---------------------------------------------------------

export async function UnownedKpi({ tenantId, agents }: { tenantId: string; agents: Agent[] }) {
  const ownershipResults = await getOwnershipResults(tenantId, agents);
  const unowned = ownershipResults.filter((issues) => issues.length > 0).length;
  const share = agents.length === 0 ? "—" : `${Math.round((unowned / agents.length) * 100)}% of all agents`;
  return <KpiCard icon="UserX" tone="warning" label="Unowned" value={unowned} footnote={share} href="/agents" />;
}

export async function PosturePanels({
  tenantId,
  agents,
  trendCard,
}: {
  tenantId: string;
  agents: Agent[];
  /** Rendered between the posture ring and the coverage bars, to keep the grid's designed order. */
  trendCard?: React.ReactNode;
}) {
  const postures = await getPostures(tenantId, agents);

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

  return (
    <>
      <Card>
        <CardHeader title="Agent governance posture" description="Every agent, scored across 12 dimensions" />
        <CardBody className="flex flex-1 items-center justify-center py-5">
          <DonutChart
            slices={postureSlices}
            centerValue={agents.length}
            centerLabel={agents.length === 1 ? "agent" : "agents"}
            size={148}
          />
        </CardBody>
      </Card>

      {trendCard}

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
    </>
  );
}

export async function PendingCertifications({
  tenantId,
  agentById,
  nowIso,
}: {
  tenantId: string;
  agentById: Map<string, Agent>;
  nowIso: string;
}) {
  const items = await getActiveCampaignItems(tenantId);
  const pending = items.filter((i) => i.status === "pending");

  if (pending.length === 0) return <EmptyState title="Nothing awaiting review" />;

  return (
    <ul className="divide-y divide-border">
      {pending.slice(0, 6).map((item) => {
        const overdue = !!item.dueDate && item.dueDate < nowIso;
        const agent = agentById.get(item.agentId);
        return (
          <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
            <Link
              href={`/compliance/campaigns/${item.campaignId}`}
              className="min-w-0 flex-1 truncate text-foreground hover:text-primary"
            >
              {agent ? agentLabel(agent) : "Agent review"}
            </Link>
            <Badge tone={overdue ? "danger" : "neutral"}>
              {overdue ? "Overdue" : item.dueDate ? `Due ${item.dueDate.slice(0, 10)}` : "No due date"}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

export async function OverdueCertificationsCard({ tenantId, nowIso }: { tenantId: string; nowIso: string }) {
  const items = await getActiveCampaignItems(tenantId);
  const overdue = items.filter((i) => i.status === "pending" && i.dueDate && i.dueDate < nowIso);
  if (overdue.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Needs attention" />
      <CardBody>
        <p className="text-sm text-muted-foreground">
          {overdue.length} certification item{overdue.length === 1 ? " is" : "s are"} overdue.
        </p>
        <Link href="/compliance/campaigns" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
          Review now
        </Link>
      </CardBody>
    </Card>
  );
}
