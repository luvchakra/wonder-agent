import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { deleteGroup, getGroup, updateGroup } from "@/lib/users/groups";

// FOUNDATION-P0-26 — one group: GET (members, roles); PATCH { name,
// description? }; DELETE (its members lose its roles on their next request).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("groups.view");
    const group = await getGroup(ctx.tenantId!, (await params).id);
    if (!group)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "No such group in this organization",
          },
        },
        { status: 404 },
      );
    return NextResponse.json({ ok: true, data: group });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = ((await req.json().catch(() => null)) ?? {}) as {
    name?: unknown;
    description?: unknown;
  };
  try {
    const ctx = await requirePermission("groups.update");
    const result = await updateGroup(ctx.tenantId!, ctx.userId, (await params).id, body);
    if (!result.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "Invalid group",
            fields: result.errors,
          },
        },
        { status: 400 },
      );
    return NextResponse.json({ ok: true, data: { id: result.groupId } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("groups.delete");
    await deleteGroup(ctx.tenantId!, ctx.userId, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
