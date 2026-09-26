import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getRoleDetail } from "@/lib/rbac/customRoles";
import { MODULE_LABEL, PERMISSION_MODULES, listPermissionCatalog } from "@/lib/rbac/permissionCatalog";
import { moduleSummary } from "@/lib/rbac/roleRules";
import { STATUS_LABEL, type MembershipStatus } from "@/lib/users/userRules";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { STATUS_TONE, formatDate } from "../../users/labels";
import { RoleStatusActions } from "./RoleStatusActions";

// FOUNDATION-P0-25 — role details (spec §22, mockup 4): what the role is,
// how much of each product module it covers, exactly which permissions it
// grants, and who holds it. System roles are read-only here; custom roles
// can be edited, deactivated or (when nobody holds them) deleted.

export const metadata = { title: "Role" };

const TABS = [
  { key: "permissions", label: "Permissions" },
  { key: "people", label: "People" },
  { key: "groups", label: "Groups" },
] as const;

export default async function RoleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string }> }) {
  let ctx;
  try {
    ctx = await requireAnyPermission(["roles.view", "role.manage"]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [role, catalog] = await Promise.all([getRoleDetail(ctx.tenantId!, id), listPermissionCatalog()]);
  if (!role) notFound();
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "permissions";
  const summary = moduleSummary(role.permissions, catalog);
  const held = new Set(role.permissions);
  const can = (p: string) => ctx.permissions.includes(p);

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/settings/roles" className="hover:text-foreground">
          Roles
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{role.displayName}</span>
      </nav>

      {sp.saved ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {sp.saved === "created" ? `${role.displayName} was created.` : "Saved. People who hold the role get the change on their next request."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{role.displayName}</h1>
            <Badge tone={role.custom ? "info" : "accent"}>{role.custom ? "Custom role" : "System role"}</Badge>
            {role.custom ? <Badge tone={role.status === "active" ? "success" : "neutral"}>{role.status === "active" ? "Active" : "Inactive"}</Badge> : null}
          </div>
          {role.description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{role.description}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {role.custom ? `Updated ${formatDate(role.updatedAt)}` : "Defined by WonderID; can't be edited."}
            {role.copiedFrom ? (
              <>
                {" "}
                · copied from{" "}
                <Link href={`/settings/roles/${role.copiedFrom.id}`} className="text-primary hover:underline">
                  {role.copiedFrom.displayName}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("roles.create") ? (
            <LinkButton href={`/settings/roles/new?copy=${role.id}`} size="sm" variant="outline">
              Copy role
            </LinkButton>
          ) : null}
          {role.custom && can("roles.update") ? (
            <LinkButton href={`/settings/roles/${role.id}/edit`} size="sm">
              Edit role
            </LinkButton>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="Permission summary" description={`${role.permissions.length} of ${catalog.length} permissions`} />
          <CardBody className="space-y-3">
            {summary.map((m) => (
              <div key={m.module}>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">{MODULE_LABEL[m.module]}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {m.granted} / {m.total}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${m.total ? Math.round((m.granted / m.total) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
            {role.custom && (can("roles.update") || can("roles.delete")) ? (
              <RoleStatusActions
                roleId={role.id}
                status={role.status}
                canUpdate={can("roles.update")}
                canDelete={can("roles.delete") && role.holderCount === 0}
                holders={role.holderCount}
              />
            ) : null}
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-4">
          <nav aria-label="Role sections" className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/settings/roles/${role.id}${t.key === "permissions" ? "" : `?tab=${t.key}`}`}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm",
                  t.key === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {` (${t.key === "people" ? role.holderCount : t.key === "groups" ? role.groups.length : role.permissions.length})`}
              </Link>
            ))}
          </nav>

          {tab === "permissions" ? (
            <Card>
              <CardBody className="space-y-5">
                {PERMISSION_MODULES.filter((m) => catalog.some((p) => p.module === m && held.has(p.key))).map((m) => (
                  <section key={m} aria-labelledby={`perm-${m}`}>
                    <h2 id={`perm-${m}`} className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      {MODULE_LABEL[m]}
                    </h2>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {catalog
                        .filter((p) => p.module === m && held.has(p.key))
                        .map((p) => (
                          <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                            <span className="min-w-0">
                              <span className="block text-foreground">{p.label}</span>
                              <span className="block text-xs text-muted-foreground">{p.description}</span>
                            </span>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{p.key}</code>
                          </li>
                        ))}
                    </ul>
                  </section>
                ))}
                {role.permissions.length === 0 ? <EmptyState title="No permissions" /> : null}
              </CardBody>
            </Card>
          ) : tab === "groups" ? (
            <Card>
              <CardBody>
                {role.groups.length === 0 ? (
                  <EmptyState title="No group carries this role" description="Give it to a group on the Groups page; every member then holds it." />
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {role.groups.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        {can("groups.view") ? (
                          <Link href={`/settings/groups/${g.id}`} className="min-w-0 font-medium text-foreground hover:text-primary">
                            {g.name}
                          </Link>
                        ) : (
                          <span className="min-w-0 font-medium text-foreground">{g.name}</span>
                        )}
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                          {g.status === "active" ? null : <Badge tone="warning">Inactive</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                {role.holders.length === 0 ? (
                  <EmptyState title="Nobody holds this role" description="Assign it from a user's page." />
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {role.holders.map((h) => (
                      <li key={h.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <Link href={`/settings/users/${h.userId}`} className="min-w-0 hover:text-primary">
                          <span className="block font-medium text-foreground">{h.name}</span>
                          {h.name !== h.email ? <span className="block text-xs text-muted-foreground">{h.email}</span> : null}
                        </Link>
                        <Badge tone={STATUS_TONE[h.status as MembershipStatus] ?? "neutral"}>{STATUS_LABEL[h.status as MembershipStatus] ?? h.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
