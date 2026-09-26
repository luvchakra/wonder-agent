import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listRoles, type RoleSummary } from "@/lib/rbac/customRoles";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";

// FOUNDATION-P0-25 — Roles (spec §15, 22; mockups 4–8): the system roles
// WonderID defines, read-only, and this organization's custom roles, with
// how many permissions each grants and how many people hold it. Assigning
// roles to people is on each user's page (FOUNDATION-P0-23).

export const metadata = { title: "Roles" };

function RoleTable({ roles, showStatus }: { roles: RoleSummary[]; showStatus: boolean }) {
  return (
    <TableContainer>
      <Thead>
        <tr>
          <Th>Role</Th>
          <Th hideBelow="lg">Permissions</Th>
          <Th>People</Th>
          {showStatus ? <Th>Status</Th> : null}
        </tr>
      </Thead>
      <tbody>
        {roles.map((r) => (
          <Tr key={r.id}>
            <Td>
              <Link href={`/settings/roles/${r.id}`} className="font-medium text-foreground hover:text-primary">
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
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Roles</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Roles bundle permissions from the{" "}
            <Link href="/settings/permissions" className="text-primary hover:underline">
              permission catalog
            </Link>
            . System roles are defined by WonderID; custom roles are your organization&apos;s own.
          </p>
        </div>
        {ctx.permissions.includes("roles.create") ? (
          <LinkButton href="/settings/roles/new" size="sm">
            Create role
          </LinkButton>
        ) : null}
      </div>

      {sp.deleted ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          The role was deleted.
        </p>
      ) : null}

      <Card>
        <CardHeader title={`Custom roles (${custom.length})`} description="Defined by your organization. Changes apply to everyone who holds them on their next request." />
        <CardBody>
          {custom.length ? (
            <RoleTable roles={custom} showStatus />
          ) : (
            <EmptyState
              title="No custom roles yet"
              description="Create one from scratch, or copy a system role and adjust it."
              action={
                ctx.permissions.includes("roles.create") ? (
                  <LinkButton href="/settings/roles/new" size="sm" variant="outline">
                    Create role
                  </LinkButton>
                ) : undefined
              }
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`System roles (${system.length})`} description="Defined by WonderID. They can't be edited, but can be copied into a custom role." />
        <CardBody>
          <RoleTable roles={system} showStatus={false} />
        </CardBody>
      </Card>
    </div>
  );
}
