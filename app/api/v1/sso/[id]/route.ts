import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setSsoConnectionStatus } from "@/lib/auth/sso";
import { errorResponse } from "@/lib/shared/apiError";
import { ApiError } from "@/lib/shared/types/foundation";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("sso.manage");
    const { id } = await params;
    const body = (await request.json()) as { status?: "active" | "disabled" };
    if (body.status !== "active" && body.status !== "disabled") {
      throw new ApiError(400, "INVALID_STATUS", "status must be 'active' or 'disabled'");
    }
    const connection = await setSsoConnectionStatus(ctx.tenantId!, ctx.userId, id, body.status);
    return NextResponse.json({ ok: true, data: connection });
  } catch (err) {
    return errorResponse(err);
  }
}
