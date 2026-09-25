import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { buildNhiInventory } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { NhiInventoryEntry, NhiStatus } from "@/lib/shared/types/agent-identity";
import { Badge, Card, EmptyState, KpiCard, LinkButton, TableContainer, Td, Th, Thead, Tr, type BadgeTone } from "@/modules/ui";

// IDENTITY-P0-11 (master P0-08) — the non-human identity inventory: every
// service account, workload, OAuth client, API key and MCP server identity
// the tenant's sources know about, linked to an agent or not. Filters and
// paging are URL-driven so a view is linkable. Linking an unlinked identity
// goes through the discovery candidate page, never from here.

const PAGE_SIZE = 50;

const TABS: Array<{ key: "all" | NhiStatus | "likely_agents"; label: string }> = [
  { key: "all", label: "All" },
  { key: "linked", label: "Linked to an agent" },
  { key: "unlinked", label: "Not linked" },
  { key: "likely_agents", label: "Likely AI agents" },
  { key: "orphaned", label: "Orphaned" },
  { key: "ignored", label: "Ignored" },
];
type TabKey = (typeof TABS)[number]["key"];

const LIKELY = new Set(["CONFIRMED_AGENT", "PROBABLE_AGENT"]);

function inTab(e: NhiInventoryEntry, tab: TabKey): boolean {
  if (tab === "all") return e.status !== "ignored";
  if (tab === "likely_agents") return e.status === "unlinked" && LIKELY.has(e.classification ?? "");
  return e.status === tab;
}

const STATUS_BADGE: Record<NhiStatus, { label: string; tone: BadgeTone }> = {
  linked: { label: "Linked", tone: "success" },
  unlinked: { label: "Not linked", tone: "warning" },
  orphaned: { label: "Orphaned", tone: "danger" },
  ignored: { label: "Ignored", tone: "neutral" },
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  CONFIRMED_AGENT: "Confirmed agent",
  PROBABLE_AGENT: "Probable agent",
  POSSIBLE_AGENT: "Possible agent",
  NON_AGENT: "Not an agent",
  UNKNOWN: "Unknown",
};

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function NhiInventoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const params = await searchParams;
  const tab = (TABS.find((t) => t.key === params.tab)?.key ?? "all") as TabKey;
  const entries = await buildNhiInventory(ctx.tenantId!);

  const counts = Object.fromEntries(TABS.map((t) => [t.key, entries.filter((e) => inTab(e, t.key)).length])) as Record<TabKey, number>;
  const visible = entries.filter((e) => inTab(e, tab));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1), pageCount);
  const rows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const href = (t: TabKey, p = 1) => `/agents/identities?tab=${t}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/agents/discovery" className="hover:text-foreground hover:underline">
          Discover
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Non-human identities</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Non-human identities</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Service accounts, workload identities, OAuth clients, API keys and MCP server identities from your connected sources. Most
            are not AI agents; each unlinked identity shows how likely it is to be one.
          </p>
        </div>
        <LinkButton href="/agents/discovery" variant="outline" size="sm">
          Discovery inbox
        </LinkButton>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard size="sm" icon="Fingerprint" tone="primary" label="Non-human identities" value={counts.all} />
        <KpiCard size="sm" icon="Link2" tone="success" label="Linked to an agent" value={counts.linked} href={href("linked")} />
        <KpiCard size="sm" icon="Unlink" tone="warning" label="Not linked" value={counts.unlinked} href={href("unlinked")} />
        <KpiCard size="sm" icon="Bot" tone="violet" label="Likely AI agents" value={counts.likely_agents} href={href("likely_agents")} />
      </div>

      <Card className="p-4">
        <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]" aria-label="Identity views">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label} <span className="ml-1 text-xs text-muted-foreground">({counts[t.key]})</span>
            </Link>
          ))}
        </nav>

        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title="No identities in this view"
              description={entries.length === 0 ? "Connect an identity source under Integrations and run a sync to build the inventory." : "Try another view."}
            />
          ) : (
            <TableContainer label="Non-human identities" bare>
              <Thead>
                <tr>
                  <Th>Identity</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Agent</Th>
                  <Th hideBelow="lg">Agent likelihood</Th>
                  <Th hideBelow="xl">Source</Th>
                  <Th hideBelow="xl">Owner</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((e) => (
                  <Tr key={e.key}>
                    <Td>
                      <Link href={e.href} className="font-medium text-primary hover:underline">
                        {e.displayName}
                      </Link>
                      {e.displayName !== e.externalReference ? (
                        <span className="block truncate font-mono text-xs text-muted-foreground">{e.externalReference}</span>
                      ) : null}
                    </Td>
                    <Td>{humanize(e.identityType)}</Td>
                    <Td>
                      <Badge tone={STATUS_BADGE[e.status].tone}>{STATUS_BADGE[e.status].label}</Badge>
                    </Td>
                    <Td>
                      {e.agent ? (
                        <Link href={`/agents/${e.agent.id}`} className="text-primary hover:underline">
                          {e.agent.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td hideBelow="lg">
                      {e.classification ? (
                        <span>
                          {CLASSIFICATION_LABEL[e.classification] ?? e.classification}
                          {e.confidenceLevel ? <span className="text-muted-foreground"> · {e.confidenceLevel.toLowerCase()} confidence</span> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{e.agent ? "Registered agent" : "—"}</span>
                      )}
                    </Td>
                    <Td hideBelow="xl">{e.sourceName}</Td>
                    <Td hideBelow="xl">{e.owner ?? <span className="text-muted-foreground">Unknown</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </div>

        {pageCount > 1 ? (
          <nav className="mt-3 flex items-center justify-between text-sm" aria-label="Pages">
            <span className="text-muted-foreground">
              Page {page} of {pageCount} · {visible.length} identities
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <LinkButton href={href(tab, page - 1)} variant="outline" size="sm">
                  Previous
                </LinkButton>
              ) : null}
              {page < pageCount ? (
                <LinkButton href={href(tab, page + 1)} variant="outline" size="sm">
                  Next
                </LinkButton>
              ) : null}
            </span>
          </nav>
        ) : null}
      </Card>
    </div>
  );
}
