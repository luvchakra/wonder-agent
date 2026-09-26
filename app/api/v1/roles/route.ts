import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { createRole, listRoles } from "@/lib/rbac/customRoles";

// FOUNDATION-P0-25 — GET the organization's roles (system and custom);
// POST { name, description, permissions[], copyFrom? } creates a custom role.
export async function GET() {
  try {
    const ctx = await requireAnyPermission(["roles.view", "role.manage"]);
    return NextResponse.json({ ok: true, data: await listRoles(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { name?: unknown; description?: unknown; permissions?: unknown; copyFrom?: unknown };
  try {
    const ctx = await requirePermission("roles.create");
    const result = await createRole(ctx.tenantId!, { userId: ctx.userId, permissions: ctx.permissions }, body, typeof body.copyFrom === "string" ? body.copyFrom : null);
    if (!result.ok) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid role", fields: result.errors } }, { status: 400 });
    return NextResponse.json({ ok: true, data: { id: result.roleId } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
