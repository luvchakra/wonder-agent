import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assignRole, removeRole } from "@/lib/rbac/roles";

// FOUNDATION-P0-23 — POST { role } assigns, DELETE ?role= removes. Nobody
// assigns themselves a role; the last Tenant Administrator keeps theirs.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => null)) as { role?: unknown } | null;
  if (typeof body?.role !== "string" || !body.role) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "role is required" } }, { status: 400 });
  try {
    const ctx = await requirePermission("role.manage");
    await assignRole(ctx.tenantId!, ctx.userId, (await params).id, body.role);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = new URL(req.url).searchParams.get("role");
  if (!role) return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "role is required" } }, { status: 400 });
  try {
    const ctx = await requirePermission("role.manage");
    await removeRole(ctx.tenantId!, ctx.userId, (await params).id, role);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
