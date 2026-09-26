import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { createGroup, listGroups } from "@/lib/users/groups";

// FOUNDATION-P0-26 — GET the organization's groups (members, roles);
// POST { name, description? } creates one.
export async function GET() {
  try {
    const ctx = await requirePermission("groups.view");
    return NextResponse.json({
      ok: true,
      data: await listGroups(ctx.tenantId!),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as {
    name?: unknown;
    description?: unknown;
  };
  try {
    const ctx = await requirePermission("groups.create");
    const result = await createGroup(ctx.tenantId!, ctx.userId, body);
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
    return NextResponse.json({ ok: true, data: { id: result.groupId } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
