import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { createAnnouncement, listAnnouncements, type AnnouncementScope, type AnnouncementType } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

/** PLATFORM-P0-05.4 — platform-admin management of maintenance windows/notices. */
export async function GET() {
  try {
    await requirePlatformAdmin();
    const announcements = await listAnnouncements();
    return NextResponse.json({ ok: true, data: announcements });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = await request.json();
    const announcement = await createAnnouncement(userId, {
      scope: body.scope as AnnouncementScope,
      tenantId: body.tenantId,
      type: body.type as AnnouncementType,
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      startsAt: body.startsAt,
      endsAt: body.endsAt,
    });
    return NextResponse.json({ ok: true, data: announcement });
  } catch (err) {
    return errorResponse(err);
  }
}
