import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getGroup } from "@/lib/users/groups";
import { listUsers } from "@/lib/users/users";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { describeTerms, termsCurrent } from "@/lib/rbac/assignmentRules";
import { loadScopeOptions } from "../../roles/scopeOptions";
import { STATUS_LABEL, type MembershipStatus } from "@/lib/users/userRules";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/modules/ui";
import { STATUS_TONE, formatDate } from "../../users/labels";
import { AddGroupRoleForm, AddMemberForm, DeleteGroupButton, GroupDetailsForm, RemoveGroupRoleButton, RemoveMemberButton } from "../GroupForms";

// FOUNDATION-P0-26 — one group: its people and its roles. Adding someone
// gives them the group's roles; giving the group a role gives it to all of
// them — each on their next request.

export const metadata = { title: "Group" };

export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("groups.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const can = (p: string) => ctx.permissions.includes(p);
  const canAssign = can("roles.assign") || can("role.manage");
  const [group, people, assignable, scope] = await Promise.all([
    getGroup(ctx.tenantId!, id),
    can("groups.manage_members") ? listUsers(ctx.tenantId!, { pageSize: 100 }) : Promise.resolve({ items: [], total: 0 }),
    canAssign ? listAssignableRoles(ctx.tenantId!) : Promise.resolve([]),
    loadScopeOptions(ctx.tenantId!),
  ]);
  if (!group) notFound();
  const inGroup = new Set(group.members.map((m) => m.userId));
  const candidates = people.items
    .filter((p) => !inGroup.has(p.userId) && p.userId !== ctx.userId && (p.status === "active" || p.status === "invited"))
    .map((p) => ({
      userId: p.userId,
      label: p.displayName ? `${p.displayName} (${p.email})` : p.email,
    }));
  // A role the group already carries can be given again to change its terms (FOUNDATION-P0-19).
  const roleOptions = assignable.map((r) => ({ name: r.name, label: group.roleAssignments.some((a) => a.roleId === r.id) ? `${r.displayName} (change terms)` : r.displayName }));
  const scopeName = new Map([...scope.applications, ...scope.agents].map((o) => [o.id, o.label]));
  const now = new Date();

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/settings/groups" className="hover:text-foreground">
          Groups
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{group.name}</span>
      </nav>
      {sp.created ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {group.name} was created. Give it roles and add its people.
        </p>
      ) : null}
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{group.name}</h1>
        {group.description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{group.description}</p> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title={`Roles (${group.roleAssignments.length})`} description="Everyone in the group holds these roles." />
            <CardBody className="space-y-4">
              {group.roleAssignments.length === 0 ? (
                <EmptyState title="No roles yet" description="A group without roles gives its members nothing." />
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {group.roleAssignments.map((r) => (
                    <li key={r.roleId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <span className="min-w-0">
                        <Link href={`/settings/roles/${r.roleId}`} className="font-medium text-foreground hover:text-primary">
                          {r.displayName}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {r.custom ? "Custom" : "System"} · since {formatDate(r.grantedAt)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {describeTerms(r.terms, (v) => scopeName.get(v) ?? "Not found")}
                          {termsCurrent(r.terms, now) ? null : (
                            <Badge tone="warning" className="ml-2">
                              Not in effect
                            </Badge>
                          )}
                        </span>
                      </span>
                      {canAssign ? <RemoveGroupRoleButton groupId={group.id} roleId={r.roleId} /> : null}
                    </li>
                  ))}
                </ul>
              )}
              {canAssign ? <AddGroupRoleForm groupId={group.id} roles={roleOptions} applications={scope.applications} agents={scope.agents} /> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Members (${group.members.length})`} />
            <CardBody className="space-y-4">
              {group.members.length === 0 ? (
                <EmptyState title="No members yet" />
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {group.members.map((m) => (
                    <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <Link href={`/settings/users/${m.userId}`} className="min-w-0 hover:text-primary">
                        <span className="block font-medium text-foreground">{m.name}</span>
                        {m.email && m.email !== m.name ? <span className="block text-xs text-muted-foreground">{m.email}</span> : null}
                      </Link>
                      <span className="flex items-center gap-2">
                        <Badge tone={STATUS_TONE[m.status as MembershipStatus] ?? "neutral"}>{STATUS_LABEL[m.status as MembershipStatus] ?? m.status}</Badge>
                        {can("groups.manage_members") ? <RemoveMemberButton groupId={group.id} userId={m.userId} name={m.name} /> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {can("groups.manage_members") ? <AddMemberForm groupId={group.id} candidates={candidates} /> : null}
            </CardBody>
          </Card>
        </div>

        {can("groups.update") || can("groups.delete") ? (
          <Card className="h-fit">
            <CardHeader title="Group details" />
            <CardBody className="space-y-4">
              {can("groups.update") ? <GroupDetailsForm groupId={group.id} name={group.name} description={group.description} submitLabel="Save" /> : null}
              {can("groups.delete") ? <DeleteGroupButton groupId={group.id} members={group.members.length} /> : null}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
