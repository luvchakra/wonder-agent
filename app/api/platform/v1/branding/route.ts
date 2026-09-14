import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { getBranding, updateBranding } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const branding = await getBranding();
    return NextResponse.json({ ok: true, data: branding });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = await request.json();
    const branding = await updateBranding(userId, body);
    return NextResponse.json({ ok: true, data: branding });
  } catch (err) {
    return errorResponse(err);
  }
}
