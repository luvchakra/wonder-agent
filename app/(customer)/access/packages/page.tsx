import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listPackages } from "@/modules/access-governance/service";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, LinkButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { APPROVAL, RISK_TONE, STATUS_TONE } from "./labels";

// ACCESS-P0-20 — access packages (spec §12.2): browse what you may request
// — the package's policy decides what you can discover — with what each
// includes, its risk, who approves and for how long; access managers also
// manage every package, drafts and retired ones included. Paged at the
// database.

const PAGE_SIZE = 12;

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string; status?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const sp = await searchParams;
  const canManage = ctx.permissions.includes("access.manage");
  const view = sp.view === "manage" && canManage ? "manage" : "browse";
  const q = (sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const me = view === "browse" ? await getIdentityForUser(ctx.tenantId!, ctx.userId) : null;
  const { items, total } = await listPackages(ctx.tenantId!, {
    q,
    page,
    pageSize: PAGE_SIZE,
    ...(view === "manage" ? { status: sp.status } : { discoverFor: me ? { identityType: me.identityType, department: me.department } : null }),
  });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/access/packages?${new URLSearchParams({ view, ...(q ? { q } : {}), ...(sp.status && view === "manage" ? { status: sp.status } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Access packages</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Bundles of access for a job or a purpose — requested, approved, granted and removed together.</p>
        </div>
        {canManage ? (
          <LinkButton href="/access/packages/new" size="sm">
            New package
          </LinkButton>
        ) : null}
      </div>

      {canManage ? (
        <nav aria-label="Package views" className="flex gap-1">
          {(["browse", "manage"] as const).map((v) => (
            <Link
              key={v}
              href={`/access/packages?view=${v}`}
              aria-current={v === view ? "page" : undefined}
              className={cn("rounded-md px-2.5 py-1.5 text-sm", v === view ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {v === "browse" ? "Available to you" : "Manage"}
            </Link>
          ))}
        </nav>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className={fieldLabelClass}>
            Search
          </label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Package name or purpose" className={fieldInputClass} />
        </div>
        {view === "manage" ? (
          <div>
            <label htmlFor="status" className={fieldLabelClass}>
              Status
            </label>
            <select id="status" name="status" defaultValue={sp.status ?? ""} className={fieldInputClass}>
              <option value="">Any</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </select>
          </div>
        ) : null}
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {items.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title={q ? "Nothing matches" : view === "browse" ? "No packages for you yet" : "No packages yet"}
              description={
                q ? "Try another search." : view === "browse" ? (me ? "A package appears here once it is active and meant for someone like you." : "Your account has no identity in this organization yet.") : "Create one, add what it includes, then activate it."
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((p) => (
            <Card key={p.id}>
              <CardHeader
                title={p.name}
                description={p.description ?? undefined}
                actions={
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {view === "manage" ? (
                      <Badge tone={STATUS_TONE[p.status]} className="whitespace-nowrap">
                        {p.status}
                      </Badge>
                    ) : null}
                    <Badge tone={RISK_TONE[p.risk]} className="whitespace-nowrap">
                      {p.risk} risk
                    </Badge>
                  </div>
                }
              />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {p.resources.slice(0, 4).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-foreground">
                        {r.applicationName}
                        <span className="text-muted-foreground"> · {r.entitlementName ?? "application access"}</span>
                      </span>
                    </li>
                  ))}
                  {p.resourceCount > 4 ? <li className="text-xs text-muted-foreground">and {p.resourceCount - 4} more</li> : null}
                  {p.resourceCount === 0 ? <li className="text-xs text-muted-foreground">Nothing included yet</li> : null}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Approved by {APPROVAL[p.approval]}
                  {p.risk === "critical" ? ", then an access manager" : ""} · {p.maxDurationDays ? `up to ${p.maxDurationDays} days` : "no end date"}
                </p>
                <div className="mt-3">
                  <LinkButton href={`/access/packages/${p.id}`} size="sm" variant={view === "browse" ? "default" : "outline"}>
                    {view === "browse" ? "View and request" : "Open"}
                  </LinkButton>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
        <span className="text-muted-foreground">
          {total} {total === 1 ? "package" : "packages"}
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
