import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { NewUserWizard } from "./NewUserWizard";

// FOUNDATION-P0-23 — Add New User (spec §7–9, mockups 2–3): basic details,
// roles, review. Inviting needs users.invite, adding now needs
// users.create; granting roles on the way in also needs roles.assign (or role.manage).
// Scope and conditions arrive with FOUNDATION-P0-19's scoped assignments.

export const metadata = { title: "Add user" };

export default async function NewUserPage() {
  let ctx;
  try {
    ctx = await requireAnyPermission(["users.invite", "users.create"]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings/users");
    throw err;
  }
  const roles = await listAssignableRoles(ctx.tenantId!);
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/settings/users" className="hover:text-foreground">
          Users
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">Add user</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Add new user</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Invite someone to your organization, or add them now, and choose the roles they start with.</p>
      </div>
      <NewUserWizard
        roles={roles.map((r) => ({ name: r.name, label: r.displayName, custom: r.custom }))}
        canInvite={ctx.permissions.includes("users.invite")}
        canAdd={ctx.permissions.includes("users.create")}
        canAssignRoles={ctx.permissions.includes("roles.assign") || ctx.permissions.includes("role.manage")}
      />
    </div>
  );
}
