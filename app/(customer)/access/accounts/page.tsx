import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ACCOUNT_VIEWS, DORMANT_WINDOWS, getAccountSummary, getApplicationDetail, listAccountInventory, parseDormantDays, type AccountView } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Button, Card, EmptyState, KpiCard, LinkButton, SelectField, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_LABEL, CORRELATION_LABEL, IDENTITY_TYPE_LABEL, VIEW_LABEL, when } from "./labels";

// ACCESS-P0-17 — the account inventory: every application account and the
// identity it belongs to, with orphan, ambiguous, dormant, privileged and
// missing-from-source views. URL-driven, paged at the database (§15).

const PAGE_SIZE = 50;

export default async function AccountInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; app?: string; q?: string; days?: string; page?: string }>;
}) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const sp = await searchParams;
  const view = (ACCOUNT_VIEWS as string[]).includes(sp.view ?? "") ? (sp.view as AccountView) : "all";
  const q = (sp.q ?? "").slice(0, 100);
  const days = parseDormantDays(sp.days);
  const applicationId = sp.app || undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [summary, { rows, total }, app] = await Promise.all([
    getAccountSummary(tenantId, { applicationId, dormantDays: days }),
    listAccountInventory(tenantId, { view, applicationId, q, dormantDays: days, page, pageSize: PAGE_SIZE }),
    applicationId ? getApplicationDetail(tenantId, applicationId) : Promise.resolve(null),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (over: { view?: AccountView; page?: number }) => {
    const u = new URLSearchParams();
    const v = over.view ?? view;
    if (v !== "all") u.set("view", v);
    if (applicationId) u.set("app", applicationId);
    if (q) u.set("q", q);
    if (days !== 90) u.set("days", String(days));
    if ((over.page ?? 1) > 1) u.set("page", String(over.page));
    const s = u.toString();
    return `/access/accounts${s ? `?${s}` : ""}`;
  };
  const views: { key: AccountView; count: number }[] = [
    { key: "all", count: summary.total },
    { key: "orphan", count: summary.orphan },
    { key: "ambiguous", count: summary.ambiguous },
    { key: "dormant", count: summary.dormant },
    { key: "privileged", count: summary.privileged },
    { key: "missing", count: summary.missing },
  ];

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        {app ? (
          <nav aria-label="Breadcrumb" className="mb-1 text-xs text-muted-foreground">
            <Link href={`/access/applications/${app.id}`} className="hover:text-foreground hover:underline">
              {app.displayName ?? app.name}
            </Link>
            <span aria-hidden> / </span>
            <span className="text-foreground">Accounts</span>
          </nav>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{app ? `${app.displayName ?? app.name} accounts` : "Accounts"}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every account in a governed application and who it belongs to. An orphan has no owner; a dormant account has not been used in {days} days.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard size="sm" icon="Users" tone="primary" label="Accounts" value={summary.total} href={href({ view: "all" })} />
        <KpiCard size="sm" icon="Link2" tone="success" label="Matched" value={summary.correlated} />
        <KpiCard size="sm" icon="UserX" tone={summary.orphan ? "danger" : "neutral"} label="Orphan" value={summary.orphan} href={href({ view: "orphan" })} />
        <KpiCard size="sm" icon="Clock" tone={summary.dormant ? "warning" : "neutral"} label="Dormant" value={summary.dormant} href={href({ view: "dormant" })} />
        <KpiCard size="sm" icon="KeyRound" tone="violet" label="Privileged" value={summary.privileged} href={href({ view: "privileged" })} />
      </div>

      <Card className="p-4">
        <nav aria-label="Account views" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {views.map((v) => (
            <Link
              key={v.key}
              href={href({ view: v.key })}
              aria-current={v.key === view ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1.5 text-sm",
                v.key === view ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {VIEW_LABEL[v.key]} <span className="tabular-nums text-xs">{v.count}</span>
            </Link>
          ))}
        </nav>

        <form method="get" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
          {applicationId ? <input type="hidden" name="app" value={applicationId} /> : null}
          <div>
            <label htmlFor="q" className={fieldLabelClass}>
              Search
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Account name or identifier" className={fieldInputClass} />
          </div>
          <SelectField label="Dormant after" name="days" defaultValue={String(days)}>
            {DORMANT_WINDOWS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title={view === "all" && !q ? "No accounts yet" : "No accounts match"}
              description={view === "all" && !q ? "Accounts arrive when an onboarded application's connector is reconciled, or from an agent's access." : "Try another view or search."}
            />
          ) : (
            <TableContainer label="Accounts" bare>
              <Thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Belongs to</Th>
                  {app ? null : <Th hideBelow="lg">Application</Th>}
                  <Th hideBelow="xl">Type</Th>
                  <Th hideBelow="lg">Last used</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`/access/accounts/${a.id}`} className="font-medium text-primary hover:underline">
                        {a.accountName ?? a.externalAccountRef}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span className="max-w-[16rem] truncate font-mono">{a.externalAccountRef}</span>
                        {a.status === "disabled" ? <Badge tone="neutral">Disabled</Badge> : null}
                        {a.missingFromSourceAt ? <Badge tone="warning">Missing from source</Badge> : null}
                      </span>
                    </Td>
                    <Td>
                      {a.identityId ? (
                        <span className="text-sm">
                          <Link href={a.agentId ? `/agents/${a.agentId}` : `/identities/${a.identityId}`} className="hover:underline">
                            {a.identityName ?? "Unknown identity"}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {a.identityType ? IDENTITY_TYPE_LABEL[a.identityType] : ""}
                            {a.correlation === "manual" ? " · linked by hand" : ""}
                          </span>
                        </span>
                      ) : (
                        <Badge tone={CORRELATION_LABEL[a.correlation].tone}>{CORRELATION_LABEL[a.correlation].label}</Badge>
                      )}
                    </Td>
                    {app ? null : (
                      <Td hideBelow="lg">
                        <Link href={`/access/applications/${a.applicationId}`} className="hover:underline">
                          {a.applicationName}
                        </Link>
                      </Td>
                    )}
                    <Td hideBelow="xl">
                      {a.accountType === "standard" ? (
                        <span className="text-muted-foreground">Standard</span>
                      ) : (
                        <Badge tone={a.accountType === "privileged" || a.accountType === "shared" ? "warning" : "neutral"}>{ACCOUNT_TYPE_LABEL[a.accountType]}</Badge>
                      )}
                    </Td>
                    <Td hideBelow="lg">
                      <span className={cn("text-sm", a.dormant && a.status === "active" && "text-warning")}>{when(a.lastUsedAt) ?? "Never"}</span>
                      {a.dormant && a.status === "active" ? <span className="block text-xs text-muted-foreground">Dormant</span> : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </div>
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
          <span className="text-muted-foreground">
            {total} {total === 1 ? "account" : "accounts"}
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
    </div>
  );
}
