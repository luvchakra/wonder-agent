import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getRoleDetail } from "@/lib/rbac/customRoles";
import { MODULE_LABEL, listPermissionCatalog } from "@/lib/rbac/permissionCatalog";
import { RoleForm } from "../RoleForm";

// FOUNDATION-P0-25 — Create custom role (spec §15–17, 21; mockups 5–8),
// from scratch or as a copy of any role this organization can see.

export const metadata = { title: "Create role" };

export default async function NewRolePage({ searchParams }: { searchParams: Promise<{ copy?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("roles.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings/roles");
    throw err;
  }
  const sp = await searchParams;
  const [catalog, source] = await Promise.all([listPermissionCatalog(), sp.copy ? getRoleDetail(ctx.tenantId!, sp.copy) : Promise.resolve(null)]);
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/settings/roles" className="hover:text-foreground">
          Roles
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">Create role</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Create custom role</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Name the role, choose its permissions from the catalog, and review before creating it.</p>
      </div>
      <RoleForm
        mode="create"
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
        initial={{
          name: source ? `${source.displayName} (copy)`.slice(0, 60) : "",
          description: source?.description ?? "",
          // A copy starts with the source's permissions that the designer may include.
          permissions: source ? source.permissions.filter((k) => ctx.permissions.includes(k)) : [],
          copyFrom: source ? { id: source.id, name: source.displayName } : null,
        }}
      />
    </div>
  );
}
