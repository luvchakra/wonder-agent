import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { getPlatformHealth } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const health = await getPlatformHealth();
    return NextResponse.json({ ok: true, data: health });
  } catch (err) {
    return errorResponse(err);
  }
}
