import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listOpenAccessFindingsPage } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, EmptyState, LinkButton, SeverityBadge, TableContainer, Thead, Th, Tr, Td } from "@/modules/ui";

export const metadata = { title: "Rogue Accounts" };

const PAGE_SIZE = 50;

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
  const { rows, total } = await listOpenAccessFindingsPage(ctx.tenantId!, { page, pageSize: PAGE_SIZE });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => (p > 1 ? `/risk/rogue-accounts?page=${p}` : "/risk/rogue-accounts");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Rogue Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Access found in a connected system that nothing in WonderID explains.</p>
      </div>
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
                      <Link href={`/access/accounts/${f.accountId}`} className="text-primary hover:underline">
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
