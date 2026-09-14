import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { listFlagCatalog } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const flags = await listFlagCatalog();
    return NextResponse.json({ ok: true, data: flags });
  } catch (err) {
    return errorResponse(err);
  }
}
