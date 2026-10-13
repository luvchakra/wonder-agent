import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { keepAssignment } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** WID-H09 — keep a mover's birthright package that is under review, so it is not removed at the review date. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await keepAssignment(ctx.tenantId!, ctx.userId, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
