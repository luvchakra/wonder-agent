import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listGroups } from "@/lib/users/groups";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { GroupDetailsForm } from "./GroupForms";

// FOUNDATION-P0-26 — Groups (spec §11–12): people grouped to manage access
// at scale. A group's roles apply to every member on their next request.

export const metadata = { title: "Groups" };

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("groups.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const [groups, sp] = await Promise.all([listGroups(ctx.tenantId!), searchParams]);
  const canCreate = ctx.permissions.includes("groups.create");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Groups</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Give roles to a team once instead of person by person. Everyone in a group holds its roles.</p>
      </div>
      {sp.deleted ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          The group was deleted.
        </p>
      ) : null}
      <div className={canCreate ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]" : ""}>
        <Card>
          <CardHeader title={`${groups.length} group${groups.length === 1 ? "" : "s"}`} />
          <CardBody>
            {groups.length === 0 ? (
              <EmptyState title="No groups yet" description="Create a group for a team, then give it roles and add its people." />
            ) : (
              <TableContainer>
                <Thead>
                  <tr>
                    <Th>Group</Th>
                    <Th>Members</Th>
                    <Th hideBelow="lg">Roles</Th>
                  </tr>
                </Thead>
                <tbody>
                  {groups.map((g) => (
                    <Tr key={g.id}>
                      <Td>
                        <Link href={`/settings/groups/${g.id}`} className="font-medium text-foreground hover:text-primary">
                          {g.name}
                        </Link>
                        {g.description ? <span className="block max-w-xl text-xs text-muted-foreground">{g.description}</span> : null}
                      </Td>
                      <Td className="tabular-nums">{g.memberCount}</Td>
                      <Td hideBelow="lg">
                        <div className="flex flex-wrap gap-1">
                          {g.roles.length ? (
                            g.roles.map((r) => (
                              <Badge key={r} tone="accent">
                                {r}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No roles</span>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableContainer>
            )}
          </CardBody>
        </Card>
        {canCreate ? (
          <Card className="h-fit">
            <CardHeader title="New group" />
            <CardBody>
              <GroupDetailsForm submitLabel="Create group" />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
