import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listNotificationPreferences, setNotificationPreference } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";
import type { NotificationType } from "@/lib/shared/types/operations";

/** OPERATIONS-P0-05.1 — per-user notification preferences; mandatory P0 types cannot be suppressed (enforced in setNotificationPreference()). */
export async function GET() {
  try {
    const ctx = await requirePermission("notification.manage");
    const preferences = await listNotificationPreferences(ctx.tenantId!, ctx.userId);
    return NextResponse.json({ ok: true, data: preferences });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requirePermission("notification.manage");
    const body = await request.json();
    const preference = await setNotificationPreference(ctx.tenantId!, ctx.userId, body.type as NotificationType, {
      inAppEnabled: body.inAppEnabled,
      emailEnabled: body.emailEnabled,
    });
    return NextResponse.json({ ok: true, data: preference });
  } catch (err) {
    return errorResponse(err);
  }
}
