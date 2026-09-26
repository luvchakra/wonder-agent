import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getRoleDetail } from "@/lib/rbac/customRoles";
import { MODULE_LABEL, listPermissionCatalog } from "@/lib/rbac/permissionCatalog";
import { RoleForm } from "../../RoleForm";

// FOUNDATION-P0-25 — edit a custom role. System roles are never editable
// (they 404 here; the service and database refuse them too).

export const metadata = { title: "Edit role" };

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("roles.update");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings/roles");
    throw err;
  }
  const { id } = await params;
  const [role, catalog] = await Promise.all([getRoleDetail(ctx.tenantId!, id), listPermissionCatalog()]);
  if (!role || !role.custom) notFound();
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/settings/roles" className="hover:text-foreground">
          Roles
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/settings/roles/${role.id}`} className="hover:text-foreground">
          {role.displayName}
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">Edit</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Edit {role.displayName}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Changes apply to the {role.holderCount} {role.holderCount === 1 ? "person" : "people"} holding this role on their next request.
        </p>
      </div>
      <RoleForm
        mode="edit"
        catalog={catalog.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
          resource: p.resource,
          module: p.module,
          moduleLabel: MODULE_LABEL[p.module],
          sensitivity: p.sensitivity,
        }))}
        actorHolds={ctx.permissions}
        initial={{ roleId: role.id, name: role.displayName, description: role.description ?? "", permissions: role.permissions }}
      />
    </div>
  );
}
