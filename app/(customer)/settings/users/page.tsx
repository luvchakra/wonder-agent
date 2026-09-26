import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { getUserSummary, listUsers } from "@/lib/users/users";
import { MEMBERSHIP_STATUSES, STATUS_LABEL, roleLabel } from "@/lib/users/userRules";
import { Badge, Card, CardBody, EmptyState, KpiCard, LinkButton, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { STATUS_TONE, initials, relativeTime } from "./labels";

// FOUNDATION-P0-23 — the organization's users (spec §6, mockup 1): who is
// in it, in what state, with which roles, and when they were last active.
// Search and status/role filters run in the database, a page at a time.
// Groups arrive with FOUNDATION-P0-26.

export const metadata = { title: "Users" };

const PAGE_SIZE = 25;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; role?: string; page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("users.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const status = (MEMBERSHIP_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "";
  const role = (sp.role ?? "").slice(0, 60);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [{ items, total }, summary, roles] = await Promise.all([
    listUsers(ctx.tenantId!, { q, status: status || null, role: role || null, page, pageSize: PAGE_SIZE }),
    getUserSummary(ctx.tenantId!),
    listAssignableRoles(ctx.tenantId!),
  ]);
  const canAdd = ctx.permissions.includes("users.invite") || ctx.permissions.includes("users.create");
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) =>
    `/settings/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(role ? { role } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  const filtered = !!(q || status || role);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Users</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">People in your organization, their status and the roles that give them access.</p>
        </div>
        {canAdd ? (
          <LinkButton href="/settings/users/new" size="sm">
            Add user
          </LinkButton>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard size="sm" icon="Users" label="Total users" value={summary.total} tone="primary" />
        <KpiCard size="sm" icon="ShieldCheck" label="Administrators" value={summary.administrators} tone="violet" />
        <KpiCard size="sm" icon="UserPlus" label="Invited" value={summary.invited} tone="neutral" href="/settings/users?status=invited" />
        <KpiCard size="sm" icon="Ban" label="Suspended" value={summary.suspended} tone="warning" href="/settings/users?status=suspended" />
        <KpiCard size="sm" icon="UserX" label="Deactivated" value={summary.deactivated} tone="neutral" href="/settings/users?status=deactivated" />
      </div>

      <Card>
        <CardBody className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter users">
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="q" className={fieldLabelClass}>
                Search
              </label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Name or email" className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="status" className={fieldLabelClass}>
                Status
              </label>
              <select id="status" name="status" defaultValue={status} className={fieldInputClass}>
                <option value="">All but removed</option>
                {MEMBERSHIP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="role" className={fieldLabelClass}>
                Role
              </label>
              <select id="role" name="role" defaultValue={role} className={fieldInputClass}>
                <option value="">All roles</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.displayName}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-9 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-accent">
              Filter
            </button>
            {filtered ? (
              <Link href="/settings/users" className="h-9 px-2 text-sm leading-9 text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            ) : null}
          </form>

          {items.length === 0 ? (
            <EmptyState
              title={filtered ? "No users match" : "No users yet"}
              description={filtered ? "Try another search or filter." : "Add the people who work in this organization."}
            />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Name</Th>
                  <Th hideBelow="lg">Roles</Th>
                  <Th>Status</Th>
                  <Th hideBelow="xl">Last active</Th>
                </tr>
              </Thead>
              <tbody>
                {items.map((u) => {
                  const name = u.displayName || u.email;
                  return (
                    <Tr key={u.userId}>
                      <Td>
                        <Link href={`/settings/users/${u.userId}`} className="flex min-w-0 items-center gap-3 rounded-md hover:text-primary">
                          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {initials(name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {u.email}
                              {u.jobTitle ? ` · ${u.jobTitle}` : ""}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td hideBelow="lg">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length ? (
                            u.roles.map((r) => (
                              <Badge key={r} tone="accent">
                                {roleLabel(r)}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No roles</span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                        {u.accountType === "external" ? <span className="ml-1.5 text-xs text-muted-foreground">External</span> : null}
                      </Td>
                      <Td hideBelow="xl" className="whitespace-nowrap text-muted-foreground">
                        {relativeTime(u.lastSignInAt)}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{total === 0 ? "0 users" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
            {pageCount > 1 ? (
              <nav aria-label="Pages" className="flex gap-1">
                {page > 1 ? (
                  <Link href={href(page - 1)} className="rounded-md px-2.5 py-1 hover:bg-accent hover:text-foreground">
                    Previous
                  </Link>
                ) : null}
                <span className="px-2.5 py-1">
                  Page {page} of {pageCount}
                </span>
                {page < pageCount ? (
                  <Link href={href(page + 1)} className="rounded-md px-2.5 py-1 hover:bg-accent hover:text-foreground">
                    Next
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
