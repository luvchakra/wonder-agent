import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { DISCOVERY_STATUSES, getDiscoveryCounts, listDiscoveries, listIntegrations, type DiscoveryStatus } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, KpiCard, LinkButton, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { DiscoverFromConnectorForm, SubmitDiscoveryForm } from "./DiscoveryForms";
import { DISCOVERY_SOURCE_LABEL, DISCOVERY_STATUS_LABEL, when } from "./labels";

// INTEGRATION-P0-10 — application discovery: applications found by
// connectors, OpenAPI documents, SCIM metadata or a manual report, and the
// unrecognized ones waiting for a decision. URL-driven, paged at the
// database (§15).

const PAGE_SIZE = 50;

export default async function ApplicationDiscoveryPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const sp = await searchParams;
  const status: DiscoveryStatus | "all" = sp.status === "all" ? "all" : (DISCOVERY_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as DiscoveryStatus) : "UNRECOGNIZED";
  const q = (sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const canUpdate = ctx.permissions.includes("integration.update");
  const [counts, { rows, total }, integrations] = await Promise.all([
    getDiscoveryCounts(tenantId),
    listDiscoveries(tenantId, { status: status === "all" ? undefined : status, q, page, pageSize: PAGE_SIZE }),
    canUpdate ? listIntegrations(tenantId) : Promise.resolve([]),
  ]);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (over: { status?: DiscoveryStatus | "all"; page?: number }) => {
    const u = new URLSearchParams();
    const s = over.status ?? status;
    if (s !== "UNRECOGNIZED") u.set("status", s);
    if (q) u.set("q", q);
    if ((over.page ?? 1) > 1) u.set("page", String(over.page));
    const str = u.toString();
    return `/integrations/discovery${str ? `?${str}` : ""}`;
  };
  const tabs: { key: DiscoveryStatus | "all"; label: string; count: number }[] = [
    { key: "UNRECOGNIZED", label: "Unrecognized", count: counts.UNRECOGNIZED },
    { key: "MATCHED", label: "Matched", count: counts.MATCHED },
    { key: "REGISTERED", label: "Registered", count: counts.REGISTERED },
    { key: "EXCEPTION", label: "Exceptions", count: counts.EXCEPTION },
    { key: "IGNORED", label: "Ignored", count: counts.IGNORED },
    { key: "all", label: "All", count: all },
  ];

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Application discovery</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Applications found by connectors, API documents and people, matched to the catalog. An unrecognized application waits for someone to register it, link it, record an exception or ignore it with a reason.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard size="sm" icon="CircleAlert" tone={counts.UNRECOGNIZED ? "warning" : "neutral"} label="Unrecognized" value={counts.UNRECOGNIZED} href={href({ status: "UNRECOGNIZED" })} />
        <KpiCard size="sm" icon="Link2" tone="success" label="Matched" value={counts.MATCHED} href={href({ status: "MATCHED" })} />
        <KpiCard size="sm" icon="Box" tone="primary" label="Registered" value={counts.REGISTERED} href={href({ status: "REGISTERED" })} />
        <KpiCard size="sm" icon="Ban" tone="neutral" label="Ignored or excepted" value={counts.IGNORED + counts.EXCEPTION} href={href({ status: "IGNORED" })} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <nav aria-label="Discovery status" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={href({ status: t.key })}
                aria-current={t.key === status ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-sm",
                  t.key === status ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {t.label} <span className="tabular-nums text-xs">{t.count}</span>
              </Link>
            ))}
          </nav>
          <form method="get" className="mt-3 flex items-end gap-2">
            {status !== "UNRECOGNIZED" ? <input type="hidden" name="status" value={status} /> : null}
            <div className="min-w-0 flex-1">
              <label htmlFor="q" className={fieldLabelClass}>
                Search
              </label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Name, vendor or address" className={fieldInputClass} />
            </div>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
          <div className="mt-4">
            {rows.length === 0 ? (
              <EmptyState
                title={status === "UNRECOGNIZED" && !q ? "Nothing waiting" : "No discoveries match"}
                description={status === "UNRECOGNIZED" && !q ? "Every discovered application is matched, registered or decided." : "Try another status or search."}
              />
            ) : (
              <TableContainer label="Discovered applications" bare>
                <Thead>
                  <tr>
                    <Th>Application</Th>
                    <Th>Status</Th>
                    <Th hideBelow="lg">Found by</Th>
                    <Th hideBelow="xl">Last seen</Th>
                  </tr>
                </Thead>
                <tbody>
                  {rows.map((d) => (
                    <Tr key={d.id}>
                      <Td>
                        <Link href={`/integrations/discovery/${d.id}`} className="font-medium text-primary hover:underline">
                          {d.name}
                        </Link>
                        <span className="mt-0.5 block max-w-[20rem] truncate text-xs text-muted-foreground">{d.vendor ?? d.url?.replace(/^https:\/\//, "") ?? ""}</span>
                      </Td>
                      <Td>
                        <Badge tone={DISCOVERY_STATUS_LABEL[d.status].tone}>{DISCOVERY_STATUS_LABEL[d.status].label}</Badge>
                        {d.status === "UNRECOGNIZED" && d.suggestedApplicationId ? <span className="mt-0.5 block text-xs text-muted-foreground">Possible match</span> : null}
                      </Td>
                      <Td hideBelow="lg">{DISCOVERY_SOURCE_LABEL[d.source]}</Td>
                      <Td hideBelow="xl">
                        {when(d.lastSeenAt)}
                        {d.sightings > 1 ? <span className="block text-xs text-muted-foreground">Seen {d.sightings} times</span> : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableContainer>
            )}
          </div>
          <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
            <span className="text-muted-foreground">
              {total} {total === 1 ? "discovery" : "discoveries"}
              {pageCount > 1 ? ` · page ${Math.min(page, pageCount)} of ${pageCount}` : ""}
            </span>
            {pageCount > 1 ? (
              <span className="flex gap-2">
                {page > 1 ? (
                  <LinkButton href={href({ page: page - 1 })} variant="outline" size="sm">
                    Previous
                  </LinkButton>
                ) : null}
                {page < pageCount ? (
                  <LinkButton href={href({ page: page + 1 })} variant="outline" size="sm">
                    Next
                  </LinkButton>
                ) : null}
              </span>
            ) : null}
          </nav>
        </Card>

        {canUpdate ? (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Discover from a connector" />
              <CardBody>
                <DiscoverFromConnectorForm integrations={integrations.map((i) => ({ id: i.id, name: i.name }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Add a discovery" description="From an API document, SCIM metadata, or something someone noticed." />
              <CardBody>
                <SubmitDiscoveryForm />
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
