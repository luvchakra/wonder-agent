import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIdentities } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { IDENTITY_STATUSES, type IdentityStatus } from "@/lib/shared/types/agent-identity";
import { Badge, Card, EmptyState, LinkButton, SelectField, TableContainer, Td, Th, Thead, Tr, Button } from "@/modules/ui";
import { DIRECTORY_VIEWS, IDENTITY_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, type DirectoryView } from "./labels";
import { DirectorySearch } from "./IdentityForms";

// IDENTITY-P0-17 — one directory table for every identity view. Filters
// and paging are URL-driven and paged at the database (§15).

const PAGE_SIZE = 50;

export async function IdentityDirectory({ view, searchParams }: { view: DirectoryView; searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const canManage = ctx.permissions.includes("identity.manage");
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100);
  const status = (IDENTITY_STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as IdentityStatus) : undefined;
  const requested = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const config = DIRECTORY_VIEWS[view];
  const { rows, total } = await listIdentities(ctx.tenantId!, { types: [...config.types], status, q, page: requested, pageSize: PAGE_SIZE });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return `/identities/${view}${s ? `?${s}` : ""}`;
  };
  const showOwner = view === "machines" || view === "all";
  const showSponsor = view === "external";
  const newType = view === "humans" ? "HUMAN" : view === "external" ? "EXTERNAL" : view === "machines" ? "SERVICE_ACCOUNT" : "HUMAN";

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/identities" className="hover:text-foreground hover:underline">
          Identities
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{config.title}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{config.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{config.description}</p>
        </div>
        {canManage ? (
          <LinkButton href={`/identities/new?type=${newType}`} size="sm">
            New identity
          </LinkButton>
        ) : null}
      </div>

      <Card className="p-4">
        <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <DirectorySearch defaultValue={q} />
          <div className="sm:w-44">
            <SelectField label="Status" name="status" defaultValue={status ?? ""}>
              <option value="">Any status</option>
              {IDENTITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </SelectField>
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title={q || status ? "No identities match" : "No identities here yet"}
              description={q || status ? "Try another search or status." : canManage ? "Create one with New identity." : "An identity administrator can add them."}
            />
          ) : (
            <TableContainer label={config.title} bare>
              <Thead>
                <tr>
                  <Th>Identity</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  {showOwner ? <Th hideBelow="lg">Owner</Th> : null}
                  {showSponsor ? <Th hideBelow="lg">Sponsor</Th> : null}
                  {view === "external" ? <Th hideBelow="xl">Organization</Th> : <Th hideBelow="xl">Department</Th>}
                  {view === "external" ? <Th hideBelow="lg">Ends</Th> : <Th hideBelow="2xl">Source</Th>}
                </tr>
              </Thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/identities/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.displayName}
                      </Link>
                      {r.email ? <span className="block truncate text-xs text-muted-foreground">{r.email}</span> : null}
                    </Td>
                    <Td>
                      <span className="md:whitespace-nowrap">{IDENTITY_TYPE_LABEL[r.identityType]}</span>
                      {r.privileged ? (
                        <Badge tone="warning" className="ml-1.5">
                          Privileged
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </Td>
                    {showOwner ? (
                      <Td hideBelow="lg">
                        {r.owner ? (
                          r.owner.displayName
                        ) : r.identityType === "HUMAN" || r.identityType === "EXTERNAL" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : r.identityType === "AI_AGENT" ? (
                          <span className="text-muted-foreground">See agent</span>
                        ) : (
                          <span className="text-destructive">No owner</span>
                        )}
                      </Td>
                    ) : null}
                    {showSponsor ? <Td hideBelow="lg">{r.sponsor?.displayName ?? <span className="text-destructive">No sponsor</span>}</Td> : null}
                    <Td hideBelow="xl">{(view === "external" ? r.organization : r.department) ?? <span className="text-muted-foreground">—</span>}</Td>
                    {view === "external" ? (
                      <Td hideBelow="lg">
                        <span className="tabular-nums">{r.endDate ?? "—"}</span>
                      </Td>
                    ) : (
                      <Td hideBelow="2xl">{r.sourceSystem === "wonderid" ? "WonderID member" : (r.sourceSystem ?? "—")}</Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </div>

        <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
          <span className="text-muted-foreground">
            {total} {total === 1 ? "identity" : "identities"}
            {pageCount > 1 ? ` · page ${Math.min(requested, pageCount)} of ${pageCount}` : ""}
          </span>
          {pageCount > 1 ? (
            <span className="flex gap-2">
              {requested > 1 ? (
                <LinkButton href={href(requested - 1)} variant="outline" size="sm">
                  Previous
                </LinkButton>
              ) : null}
              {requested < pageCount ? (
                <LinkButton href={href(requested + 1)} variant="outline" size="sm">
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
