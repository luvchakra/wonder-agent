import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentity, updateIdentity } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("identity.read");
    const { id } = await params;
    const identity = await getIdentity(ctx.tenantId!, id);
    if (!identity) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such identity" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: identity });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "JSON body required" } }, { status: 400 });
    const identity = await updateIdentity(ctx.tenantId!, ctx.userId, id, body);
    return NextResponse.json({ ok: true, data: identity });
  } catch (err) {
    return errorResponse(err);
  }
}
