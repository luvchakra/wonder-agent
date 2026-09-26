import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getCatalogSummary, listApplicationCatalog } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  APPLICATION_ONBOARDING_STATUSES,
  APPLICATION_TYPES,
  CATALOG_LEVELS,
  type ApplicationOnboardingStatus,
  type ApplicationType,
  type CatalogLevel,
} from "@/lib/shared/types/access-governance";
import { Badge, Button, Card, EmptyState, KpiCard, LinkButton, SelectField, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { APP_TYPE_LABEL, LEVEL_TONE, ONBOARDING_LABEL } from "./applications/labels";

// ACCESS-P0-15 — the application catalog and inventory. Filters and paging
// are URL-driven and paged at the database (§15).

const PAGE_SIZE = 50;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function ApplicationInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; risk?: string; owner?: string; page?: string }>;
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
  const q = (sp.q ?? "").slice(0, 100);
  const status = (APPLICATION_ONBOARDING_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as ApplicationOnboardingStatus) : undefined;
  const appType = (APPLICATION_TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as ApplicationType) : undefined;
  const riskLevel = (CATALOG_LEVELS as readonly string[]).includes(sp.risk ?? "") ? (sp.risk as CatalogLevel) : undefined;
  const missingOwner = sp.owner === "missing";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [summary, { rows, total }] = await Promise.all([
    getCatalogSummary(tenantId),
    listApplicationCatalog(tenantId, { q, status, appType, riskLevel, missingOwner, page, pageSize: PAGE_SIZE }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (status) u.set("status", status);
    if (appType) u.set("type", appType);
    if (riskLevel) u.set("risk", riskLevel);
    if (missingOwner) u.set("owner", "missing");
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/access${s ? `?${s}` : ""}`;
  };
  const canManage = ctx.permissions.includes("access.manage");
  const filtered = Boolean(q || status || appType || riskLevel || missingOwner);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Applications</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every application this organization governs access to: who owns it, how sensitive it is, and where it is in onboarding.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/access/requests" variant="outline" size="sm">
            Access requests
          </LinkButton>
          {canManage ? (
            <LinkButton href="/access/applications/new" size="sm">
              Register application
            </LinkButton>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard size="sm" icon="Box" tone="primary" label="Applications" value={summary.total} href="/access" />
        <KpiCard size="sm" icon="ShieldCheck" tone="success" label="Active" value={summary.active} href="/access?status=ACTIVE" />
        <KpiCard size="sm" icon="Clock" tone="neutral" label="Onboarding" value={summary.onboarding} />
        <KpiCard size="sm" icon="UserX" tone="warning" label="Missing an owner" value={summary.missingOwner} href="/access?owner=missing" />
        <KpiCard size="sm" icon="TriangleAlert" tone="danger" label="High risk" value={summary.highRisk} />
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_11rem_9rem_auto] lg:items-end">
          <div>
            <label htmlFor="q" className={fieldLabelClass}>
              Search
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Name, vendor or category" className={fieldInputClass} />
          </div>
          <SelectField label="Status" name="status" defaultValue={status ?? ""}>
            <option value="">Any status</option>
            {APPLICATION_ONBOARDING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ONBOARDING_LABEL[s].label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Type" name="type" defaultValue={appType ?? ""}>
            <option value="">Any type</option>
            {APPLICATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {APP_TYPE_LABEL[t]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Risk" name="risk" defaultValue={riskLevel ?? ""}>
            <option value="">Any risk</option>
            {CATALOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {cap(l)}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {missingOwner ? <input type="hidden" name="owner" value="missing" /> : null}
        </form>

        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title={filtered ? "No applications match" : "No applications yet"}
              description={filtered ? "Try other filters." : canManage ? "Register one, or connect an integration that imports them." : undefined}
            />
          ) : (
            <TableContainer label="Applications" bare>
              <Thead>
                <tr>
                  <Th>Application</Th>
                  <Th>Status</Th>
                  <Th hideBelow="lg">Owners</Th>
                  <Th hideBelow="xl">Type</Th>
                  <Th hideBelow="lg">Risk</Th>
                  <Th hideBelow="2xl">Accounts</Th>
                  <Th hideBelow="2xl">Entitlements</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`/access/applications/${a.id}`} className="font-medium text-primary hover:underline">
                        {a.displayName ?? a.name}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {a.vendor ?? a.category ?? ""}
                        {a.isExternal ? <Badge tone="warning">External</Badge> : null}
                        {a.environment !== "production" ? <Badge tone="neutral">{cap(a.environment)}</Badge> : null}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={ONBOARDING_LABEL[a.onboardingStatus].tone}>{ONBOARDING_LABEL[a.onboardingStatus].label}</Badge>
                    </Td>
                    <Td hideBelow="lg">
                      {a.businessOwnerName || a.technicalOwnerName ? (
                        <span className="text-sm">
                          {a.businessOwnerName ?? <span className="text-warning">No business owner</span>}
                          <span className="block text-xs text-muted-foreground">{a.technicalOwnerName ?? "No technical owner"}</span>
                        </span>
                      ) : (
                        <span className="text-warning">No owners</span>
                      )}
                    </Td>
                    <Td hideBelow="xl">{APP_TYPE_LABEL[a.appType]}</Td>
                    <Td hideBelow="lg">{a.riskLevel ? <Badge tone={LEVEL_TONE[a.riskLevel]}>{cap(a.riskLevel)}</Badge> : <span className="text-muted-foreground">Not assessed</span>}</Td>
                    <Td hideBelow="2xl">
                      <span className="tabular-nums">{a.accountCount}</span>
                    </Td>
                    <Td hideBelow="2xl">
                      <span className="tabular-nums">{a.entitlementCount}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </div>
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
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
      </Card>
    </div>
  );
}
