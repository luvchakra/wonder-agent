import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { deleteRole, getRoleDetail, updateRole } from "@/lib/rbac/customRoles";

// FOUNDATION-P0-25 — one role: GET details (permissions, holders); PATCH a
// custom role { name, description, permissions[] }; DELETE a custom role
// nobody holds. System roles: read-only (403 SYSTEM_ROLE_PROTECTED).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAnyPermission(["roles.view", "role.manage"]);
    const role = await getRoleDetail(ctx.tenantId!, (await params).id);
    if (!role) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such role in this organization" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: role });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { name?: unknown; description?: unknown; permissions?: unknown };
  try {
    const ctx = await requirePermission("roles.update");
    const result = await updateRole(ctx.tenantId!, { userId: ctx.userId, permissions: ctx.permissions }, (await params).id, body);
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid role", fields: result.errors } }, { status: 400 });
    return NextResponse.json({ ok: true, data: { id: result.roleId } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("roles.delete");
    await deleteRole(ctx.tenantId!, ctx.userId, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
