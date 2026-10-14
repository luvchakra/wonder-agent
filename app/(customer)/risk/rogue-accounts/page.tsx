import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getRogueAccessTrend, listOpenAccessFindingsPage } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { TrendChart } from "@/modules/ui/charts.lazy";
import { Card, CardBody, CardHeader, EmptyState, LinkButton, SeverityBadge, TableContainer, Thead, Th, Tr, Td } from "@/modules/ui";

export const metadata = { title: "Rogue Accounts" };

const PAGE_SIZE = 50;

const TREND_SERIES = [
  { key: "open", label: "Open", color: "var(--color-destructive)" },
  { key: "found", label: "Found", color: "var(--color-warning)" },
  { key: "resolved", label: "Resolved", color: "var(--color-success)" },
];

/**
 * Risk & Detection › Rogue Accounts (owner's navigation, 2026-10-13): the
 * open rogue-access findings (ACCESS-P0-25), access found in a connected
 * system that no request, package or birthright explains. One ticket per
 * account; each row opens the account, where the finding is decided.
 * Paged in the database (§15).
 */
export default async function RogueAccountsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  // Independent reads, in parallel (§15).
  const [{ rows, total }, trend] = await Promise.all([listOpenAccessFindingsPage(ctx.tenantId!, { page, pageSize: PAGE_SIZE }), getRogueAccessTrend(ctx.tenantId!)]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => (p > 1 ? `/risk/rogue-accounts?page=${p}` : "/risk/rogue-accounts");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Rogue Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Access found in a connected system that nothing in WonderID explains.</p>
      </div>
      {/* RISK-P0-13: the trend, per week. */}
      {trend.some((w) => w.found || w.resolved || w.open) ? (
        <Card>
          <CardHeader title="Last 8 weeks" description="Rogue access found and resolved each week, and how much was open at the week's end." />
          <CardBody>
            <TrendChart data={trend} series={TREND_SERIES} height={200} />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title="No rogue accounts" description="Every account's access is explained by a request, a package or birthright." />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Ticket</Th>
                  <Th>Finding</Th>
                  <Th>Severity</Th>
                  <Th hideBelow="lg">Status</Th>
                  <Th hideBelow="xl">Found</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((f) => (
                  <Tr key={f.id}>
                    <Td className="whitespace-nowrap font-mono text-xs">{f.ticketNumber ?? "—"}</Td>
                    <Td>
                      <Link href={`/risk/rogue-accounts/${f.ref ?? f.id}`} className="text-primary hover:underline">
                        {f.title}
                      </Link>
                    </Td>
                    <Td>
                      <SeverityBadge severity={f.severity} />
                    </Td>
                    <Td hideBelow="lg">{f.status.replace(/_/g, " ")}</Td>
                    <Td hideBelow="xl" className="whitespace-nowrap">{new Date(f.createdAt).toLocaleDateString()}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
      {total > PAGE_SIZE ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {total} open · page {page} of {pageCount}
          </span>
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
        </nav>
      ) : null}
    </div>
  );
}
