import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { activateTenant, decommissionTenant, getTenant, suspendTenant } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const tenant = await getTenant(id);
    if (!tenant) return NextResponse.json({ ok: false, error: { code: "TENANT_NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: tenant });
  } catch (err) {
    return errorResponse(err);
  }
}

const ACTIONS = { suspend: suspendTenant, activate: activateTenant, decommission: decommissionTenant } as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const body = await request.json();
    const action = body.action as keyof typeof ACTIONS;
    if (!ACTIONS[action]) {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "action must be one of suspend, activate, decommission" } }, { status: 400 });
    }
    await ACTIONS[action](userId, id);
    const tenant = await getTenant(id);
    return NextResponse.json({ ok: true, data: tenant });
  } catch (err) {
    return errorResponse(err);
  }
}
