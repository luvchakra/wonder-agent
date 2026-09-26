import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { addGroupMember, getGroup } from "@/lib/users/groups";

// FOUNDATION-P0-26 — POST { userId } adds a member of this organization to
// the group. A group that carries roles hands them to its members, so
// adding to one also needs role assignment (roles.assign or role.manage).
// Nobody adds themselves (403 SELF_ESCALATION, and the database refuses).
const ASSIGN = ["roles.assign", "role.manage"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = ((await req.json().catch(() => null)) ?? {}) as {
    userId?: unknown;
  };
  try {
    const ctx = await requirePermission("groups.manage_members");
    const groupId = (await params).id;
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId)
      return NextResponse.json(
        {
          ok: false,
          error: { code: "VALIDATION", message: "userId is required" },
        },
        { status: 400 },
      );
    const group = await getGroup(ctx.tenantId!, groupId);
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
    if (group.roleAssignments.length && !ctx.permissions.some((p) => ASSIGN.includes(p))) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "This group carries roles, so adding people to it needs role assignment",
          },
        },
        { status: 403 },
      );
    }
    await addGroupMember(ctx.tenantId!, ctx.userId, groupId, userId);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
