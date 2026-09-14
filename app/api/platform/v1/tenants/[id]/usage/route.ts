import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { getUsageSummary } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

/** PLATFORM-P0-05.1 — usage vs. limit, one tenant at a time. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const usage = await getUsageSummary(id);
    return NextResponse.json({ ok: true, data: usage });
  } catch (err) {
    return errorResponse(err);
  }
}
