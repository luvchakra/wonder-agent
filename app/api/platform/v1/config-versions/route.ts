import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { listConfigVersions, type ConfigType } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

/** PLATFORM-P0-05.3 — version history, e.g. GET ?type=branding or ?type=feature_flag_default&key=ai_assistant */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
    const url = new URL(request.url);
    const type = url.searchParams.get("type") as ConfigType | null;
    if (!type) return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "type is required" } }, { status: 400 });
    const key = url.searchParams.get("key");
    const versions = await listConfigVersions(type, key);
    return NextResponse.json({ ok: true, data: versions });
  } catch (err) {
    return errorResponse(err);
  }
}
