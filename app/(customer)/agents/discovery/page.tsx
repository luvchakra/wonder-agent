import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { buildDiscoveryInbox } from "@/modules/agent-identity/service";
import { listIntegrations } from "@/modules/integrations/service";
import { triggerSyncAction } from "@/app/actions/integrations";
import { ApiError } from "@/lib/shared/types/foundation";
import type { DiscoveryInboxEntry } from "@/lib/shared/types/agent-identity";
import { Card, CardHeader, CardBody, StatCard, StatusBadge, Button, LinkButton, EmptyState, type BadgeTone } from "@/modules/ui";
import { DiscoveryCandidatesTable } from "./DiscoveryCandidatesTable";

const TABS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "needs_review", label: "Needs Review" },
  { key: "duplicates", label: "Potential Duplicates" },
  { key: "changed", label: "Recently Changed" },
  { key: "ignored", label: "Ignored" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function filterByTab(entries: DiscoveryInboxEntry[], tab: TabKey): DiscoveryInboxEntry[] {
  switch (tab) {
    case "new":
      return entries.filter((e) => e.category === "new" && e.candidateStatus === "open");
    case "needs_review":
      return entries.filter((e) => e.candidateStatus === "open" && (e.confidenceLevel !== "HIGH" || e.category === "orphaned_identity"));
    case "duplicates":
      return entries.filter((e) => e.category === "likely_duplicate" && e.candidateStatus === "open");
    case "changed":
      return entries.filter((e) => e.changeType === "STALE" && e.candidateStatus !== "ignored");
    case "ignored":
      return entries.filter((e) => e.candidateStatus === "ignored");
    default:
      return entries.filter((e) => e.candidateStatus !== "ignored");
  }
}

const INTEGRATION_STATUS_TONE: Record<string, BadgeTone> = {
  configured: "neutral",
  connected: "success",
  error: "danger",
  disabled: "neutral",
};

/**
 * Fully Functional Agent Discovery — Discovery Inbox (spec §17-19). Reads
 * through `buildDiscoveryInbox()` (still the sole reconciliation source —
 * IDENTITY-P0-05) and `listIntegrations()` (Integration Agent's own
 * contract, for the Sources panel and "Discover Now" — which invokes the
 * *existing* `triggerSyncAction`/sync-job pipeline, not a second discovery
 * job system, per spec §55's gate). Tabs/metrics are query-string driven,
 * not client-only state, so a filtered view is linkable/shareable like the
 * rest of this codebase's list pages.
 */
export default async function DiscoveryInboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const { tab: rawTab } = await searchParams;
  const tab = (TABS.find((t) => t.key === rawTab)?.key ?? "all") as TabKey;

  const [entries, integrations] = await Promise.all([
    buildDiscoveryInbox(ctx.tenantId!),
    listIntegrations(ctx.tenantId!),
  ]);

  const tabCounts = Object.fromEntries(TABS.map((t) => [t.key, filterByTab(entries, t.key).length])) as Record<TabKey, number>;
  const visible = filterByTab(entries, tab);

  const activeOpen = entries.filter((e) => e.candidateStatus === "open");
  const highConfidenceCount = activeOpen.filter((e) => e.confidenceLevel === "HIGH").length;
  const errorSourceCount = integrations.filter((i) => i.status === "error").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Agent Discovery</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Discover, review, and register AI agents found across enterprise identity and runtime sources. Discovery is
            read-first — it never grants, revokes, or modifies customer IAM access.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="#sources" variant="default">
            Discover Now
          </LinkButton>
          <LinkButton href="/integrations" variant="secondary">
            Configure Sources
          </LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="New Candidates" value={tabCounts.new} href="/agents/discovery?tab=new" />
        <StatCard label="High Confidence" value={highConfidenceCount} />
        <StatCard
          label="Needs Review"
          value={tabCounts.needs_review}
          href="/agents/discovery?tab=needs_review"
          tone={tabCounts.needs_review > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Potential Duplicates"
          value={tabCounts.duplicates}
          href="/agents/discovery?tab=duplicates"
          tone={tabCounts.duplicates > 0 ? "warning" : "neutral"}
        />
        <StatCard label="Recently Changed" value={tabCounts.changed} href="/agents/discovery?tab=changed" />
        <StatCard label="Discovery Errors" value={errorSourceCount} href="/integrations" tone={errorSourceCount > 0 ? "danger" : "neutral"} />
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Discovery inbox views">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/agents/discovery?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            {t.label} <span className="ml-1 text-xs text-muted-foreground">({tabCounts[t.key]})</span>
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader title="Candidates" description={`${visible.length} in this view`} />
        <CardBody>
          {visible.length === 0 ? (
            <EmptyState
              title="Nothing to review"
              description={
                integrations.length === 0
                  ? "Configure an integration below to start discovering AI agents."
                  : "Every discovered identity in this view is already resolved."
              }
            />
          ) : (
            <DiscoveryCandidatesTable entries={visible} />
          )}
        </CardBody>
      </Card>

      <Card className="scroll-mt-20">
        <div id="sources" />
        <CardHeader
          title="Sources"
          description="Configured integrations discovery reads from. Discover Now reuses Integration Agent's existing sync job — not a second discovery job system."
        />
        <CardBody>
          {integrations.length === 0 ? (
            <EmptyState title="No integrations configured yet" description="Connect Saviynt, a generic REST source, or an MCP server first." />
          ) : (
            <ul className="divide-y divide-border">
              {integrations.map((i) => {
                const syncWithId = triggerSyncAction.bind(null, i.id);
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <Link href={`/integrations/${i.id}`} className="text-sm font-medium text-primary hover:underline">
                        {i.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {i.integrationTypeId} · Last sync: {i.lastSyncAt ?? "never"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={INTEGRATION_STATUS_TONE[i.status] ?? "neutral"}>{i.status}</StatusBadge>
                      <form action={syncWithId}>
                        <Button type="submit" variant="secondary" size="sm" disabled={!i.hasCredentials}>
                          Discover Now
                        </Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Link href="/agents" className="text-sm text-primary hover:underline">
        ← Back to agents
      </Link>
    </div>
  );
}
