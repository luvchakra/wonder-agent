import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { grantPlatformAdmin, listPlatformAdmins } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admins = await listPlatformAdmins();
    return NextResponse.json({ ok: true, data: admins });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = await request.json();
    if (!body.targetUserId || typeof body.targetUserId !== "string") {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "targetUserId is required" } }, { status: 400 });
    }
    await grantPlatformAdmin(userId, body.targetUserId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
