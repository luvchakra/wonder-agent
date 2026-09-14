import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAssignableRoles, listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { ApiError } from "@/lib/shared/types/foundation";
import { assignRoleAction, removeRoleAction } from "@/app/actions/roles";
import { Card, CardBody, CardHeader, TableContainer, Thead, Th, Tr, Td, EmptyState, Badge } from "@/modules/ui";

// FOUNDATION-P0-04.3 — bare functional admin page, gated by `role.manage`.
export default async function RolesSettingsPage() {
  let ctx;
  try {
    ctx = await requirePermission("role.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }

  const [members, roles] = await Promise.all([
    listTenantMembersWithRoles(ctx.tenantId!),
    listAssignableRoles(),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-text-primary">Users &amp; Roles</h1>

      <Card>
        <CardHeader title="Tenant members" />
        <CardBody>
          {members.length === 0 ? (
            <EmptyState title="No active members" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>User</Th>
                  <Th>Roles</Th>
                  <Th>Assign</Th>
                </tr>
              </Thead>
              <tbody>
                {members.map((m) => (
                  <Tr key={m.userId}>
                    <Td>{m.displayName ?? m.email}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {m.roles.length === 0 ? (
                          <span className="text-text-muted">No roles</span>
                        ) : (
                          m.roles.map((r) => (
                            <span key={r} className="inline-flex items-center gap-1">
                              <Badge tone="accent">{r}</Badge>
                              <form action={removeRoleAction}>
                                <input type="hidden" name="userId" value={m.userId} />
                                <input type="hidden" name="role" value={r} />
                                <button type="submit" className="text-xs text-danger hover:underline" aria-label={`Remove ${r}`}>
                                  ×
                                </button>
                              </form>
                            </span>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td>
                      <form action={assignRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={m.userId} />
                        <select name="role" required className="rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary">
                          {roles.map((r) => (
                            <option key={r.id} value={r.name}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="text-accent hover:underline text-sm">
                          Assign
                        </button>
                      </form>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
