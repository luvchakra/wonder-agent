import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listNotifications } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";

/** OPERATIONS-P0-02.1 — in-app notifications channel, the caller's own targeted rows plus every tenant-wide broadcast. */
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("notification.manage");
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const notifications = await listNotifications(ctx.tenantId!, ctx.userId, unreadOnly);
    return NextResponse.json({ ok: true, data: notifications });
  } catch (err) {
    return errorResponse(err);
  }
}
