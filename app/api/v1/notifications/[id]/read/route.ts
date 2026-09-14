import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { markNotificationRead } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("notification.manage");
    const { id } = await params;
    const notification = await markNotificationRead(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: notification });
  } catch (err) {
    return errorResponse(err);
  }
}
