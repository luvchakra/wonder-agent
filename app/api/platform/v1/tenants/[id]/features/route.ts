import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { listTenantFlagOverrides, setFeatureFlag } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const overrides = await listTenantFlagOverrides(id);
    return NextResponse.json({ ok: true, data: overrides });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const body = await request.json();
    if (!body.flagKey || typeof body.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "flagKey and enabled are required" } }, { status: 400 });
    }
    await setFeatureFlag(userId, id, body.flagKey, body.enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
