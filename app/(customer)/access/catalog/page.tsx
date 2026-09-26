import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRequestCatalog } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, LinkButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { RISK_TONE, approvalPreview } from "./labels";

// ACCESS-P0-18 — the request catalog: what can be requested, for how long
// and with whose approval, before anyone fills in a form (spec §11.1).
// Paged at the database by application.

const PAGE_SIZE = 20;

export default async function RequestCatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; all?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const all = sp.all === "1";
  const { items, total } = await listRequestCatalog(ctx.tenantId!, { q, page, pageSize: PAGE_SIZE, requestableOnly: !all });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canRequest = ctx.permissions.includes("access.request");
  const href = (p: number) => `/access/catalog?${new URLSearchParams({ ...(q ? { q } : {}), ...(all ? { all: "1" } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Request access</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Applications you can ask for, with what each entitlement allows, how risky it is and who approves it.
          </p>
        </div>
        <LinkButton href="/access/requests?view=mine" variant="outline" size="sm">
          My requests
        </LinkButton>
      </div>

      <form method="get" className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className={fieldLabelClass}>
            Search
          </label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Application, vendor or description" className={fieldInputClass} />
        </div>
        {all ? <input type="hidden" name="all" value="1" /> : null}
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        {all ? "Every live application, including those no policy makes requestable." : "Applications a request policy makes requestable."}{" "}
        <Link
          href={`/access/catalog?${new URLSearchParams({ ...(q ? { q } : {}), ...(all ? {} : { all: "1" }) }).toString()}`}
          className="font-medium text-primary hover:underline"
        >
          {all ? "Show requestable only" : "Show every live application"}
        </Link>
      </p>

      {items.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title={q ? "Nothing matches" : "Nothing to request yet"}
              description={q ? "Try another search." : "Applications appear here once their onboarding is promoted and a request policy makes them requestable."}
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <Card key={item.applicationId}>
              <CardHeader
                title={item.name}
                description={item.vendor ?? undefined}
                actions={
                  canRequest && item.requestable ? (
                    <LinkButton href={`/access/catalog/${item.applicationId}`} size="sm">
                      Request
                    </LinkButton>
                  ) : (
                    <Badge tone="neutral">Not requestable</Badge>
                  )
                }
              />
              <CardBody className="space-y-3">
                {item.description ? <p className="text-sm text-muted-foreground">{item.description}</p> : null}
                {item.entitlements.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {item.entitlements.slice(0, 8).map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0">
                          {canRequest && e.requestable ? (
                            <Link href={`/access/catalog/${item.applicationId}?entitlement=${e.id}`} className="font-medium text-primary hover:underline">
                              {e.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{e.name}</span>
                          )}
                          <span className="block text-xs text-muted-foreground">{approvalPreview(e.approval, e.risk)}</span>
                        </span>
                        <Badge tone={RISK_TONE[e.risk]} className="shrink-0 whitespace-nowrap">{e.risk} risk</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No entitlements listed; the request is for the application itself.</p>
                )}
                {item.entitlements.length > 8 ? <p className="text-xs text-muted-foreground">And {item.entitlements.length - 8} more on the request form.</p> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
        <span className="text-muted-foreground">
          {total} {total === 1 ? "application" : "applications"}
          {pageCount > 1 ? ` · page ${Math.min(page, pageCount)} of ${pageCount}` : ""}
        </span>
        {pageCount > 1 ? (
          <span className="flex gap-2">
            {page > 1 ? (
              <LinkButton href={href(page - 1)} variant="outline" size="sm">
                Previous
              </LinkButton>
            ) : null}
            {page < pageCount ? (
              <LinkButton href={href(page + 1)} variant="outline" size="sm">
                Next
              </LinkButton>
            ) : null}
          </span>
        ) : null}
      </nav>
    </div>
  );
}
