import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { rollbackConfigVersion } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

/** PLATFORM-P0-05.3 — reapplies a prior version's oldValue through the same update/versioning/audit path as any other config change. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    await rollbackConfigVersion(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
