import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listEntitlementInventory } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Button, Card, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";

// Admin › Entitlements (owner request, 2026-10-10): every entitlement in
// the organization, across applications, paged at the database (§15).
// An entitlement is created and changed on its application's page.

const PAGE_SIZE = 50;

export default async function EntitlementsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
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
  const { rows, total } = await listEntitlementInventory(ctx.tenantId!, { q, page, pageSize: PAGE_SIZE });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/access/entitlements${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Entitlements</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Every entitlement in every application. Open the application to change one.</p>
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="q" className={fieldLabelClass}>
              Search
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Entitlement name" className={fieldInputClass} />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title={q ? "No entitlements match" : "No entitlements yet"}
              description={q ? "Try another name." : "Entitlements arrive with an application's connector, a file import, or are added on the application's page."}
            />
          ) : (
            <TableContainer label="Entitlements" bare>
              <Thead>
                <tr>
                  <Th>Entitlement</Th>
                  <Th>Application</Th>
                  <Th hideBelow="lg">Privilege</Th>
                  <Th hideBelow="xl">Data</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <span className="font-medium text-foreground">{e.name}</span>
                    </Td>
                    <Td>
                      <Link href={`/access/applications/${e.applicationId}`} className="text-primary hover:underline">
                        {e.applicationDisplayName ?? e.applicationName}
                      </Link>
                    </Td>
                    <Td hideBelow="lg">
                      {e.privilegeLevel === "standard" ? (
                        <span className="text-muted-foreground">Standard</span>
                      ) : (
                        <Badge tone={e.privilegeLevel === "admin" ? "danger" : "warning"}>{e.privilegeLevel === "admin" ? "Admin" : "Elevated"}</Badge>
                      )}
                    </Td>
                    <Td hideBelow="xl">
                      <span className="text-sm text-muted-foreground">{e.dataClassification ?? "—"}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </div>
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
          <span className="text-muted-foreground">
            {total} {total === 1 ? "entitlement" : "entitlements"}
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
