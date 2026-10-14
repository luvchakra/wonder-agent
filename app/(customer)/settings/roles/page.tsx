import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listRoles, type RoleSummary } from "@/lib/rbac/customRoles";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr, ObjectActionsMenu } from "@/modules/ui";
import { objectActionsFor } from "@/modules/operations/exportRegistry";

// FOUNDATION-P0-25 — Roles (spec §15, 22; mockups 4–8): the system roles
// WonderID defines, read-only, and this organization's custom roles, with
// how many permissions each grants and how many people hold it. Assigning
// roles to people is on each user's page (FOUNDATION-P0-23).

// Owner feedback 2026-10-14: these are "ID roles", the roles that manage
// WonderID itself, as opposed to the roles people hold in applications.
export const metadata = { title: "ID Roles" };

function RoleTable({ roles, showStatus }: { roles: RoleSummary[]; showStatus: boolean }) {
  return (
    <TableContainer>
      <Thead>
        <tr>
          <Th>ID role</Th>
          <Th hideBelow="lg">Permissions</Th>
          <Th>People</Th>
          {showStatus ? <Th>Status</Th> : null}
        </tr>
      </Thead>
      <tbody>
        {roles.map((r) => (
          <Tr key={r.id}>
            <Td>
              <Link href={`/settings/roles/${r.ref ?? r.id}`} className="font-medium text-foreground hover:text-primary">
                {r.displayName}
              </Link>
              {r.description ? <span className="block max-w-xl text-xs text-muted-foreground">{r.description}</span> : null}
            </Td>
            <Td hideBelow="lg" className="tabular-nums">
              {r.permissionCount}
            </Td>
            <Td className="tabular-nums">{r.holderCount}</Td>
            {showStatus ? (
              <Td>
                <Badge tone={r.status === "active" ? "success" : "neutral"}>{r.status === "active" ? "Active" : "Inactive"}</Badge>
              </Td>
            ) : null}
          </Tr>
        ))}
      </tbody>
    </TableContainer>
  );
}

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  let ctx;
  try {
    ctx = await requireAnyPermission(["roles.view", "role.manage"]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const [roles, sp] = await Promise.all([listRoles(ctx.tenantId!), searchParams]);
  const system = roles.filter((r) => !r.custom);
  const custom = roles.filter((r) => r.custom);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">ID Roles</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            ID roles decide who can manage WonderID. Each bundles permissions from the{" "}
            <Link href="/settings/permissions" className="text-primary hover:underline">
              permission catalog
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ObjectActionsMenu {...objectActionsFor(ctx.permissions, ["roles"])} />
          {ctx.permissions.includes("roles.create") ? (
            <LinkButton href="/settings/roles/new" size="sm">
              Create ID role
            </LinkButton>
          ) : null}
        </div>
      </div>

      {sp.deleted ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          The ID role was deleted.
        </p>
      ) : null}

      <Card>
        <CardHeader title={`Custom ID roles (${custom.length})`} description="Defined by your organization. Changes apply to everyone who holds them on their next request." />
        <CardBody>
          {custom.length ? (
            <RoleTable roles={custom} showStatus />
          ) : (
            <EmptyState
              title="No custom ID roles yet"
              description="Create one from scratch, or copy a system ID role and adjust it."
              action={
                ctx.permissions.includes("roles.create") ? (
                  <LinkButton href="/settings/roles/new" size="sm" variant="outline">
                    Create ID role
                  </LinkButton>
                ) : undefined
              }
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`System ID roles (${system.length})`} description="Defined by WonderID. They can't be edited, but can be copied into a custom ID role." />
        <CardBody>
          <RoleTable roles={system} showStatus={false} />
        </CardBody>
      </Card>
    </div>
  );
}
