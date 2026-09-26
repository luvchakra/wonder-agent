import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentitySource, updateIdentitySource } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { sourceId } = await params;
    const source = await getIdentitySource(ctx.tenantId!, sourceId);
    if (!source) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such identity source" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: source });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { sourceId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await updateIdentitySource(ctx.tenantId!, ctx.userId, sourceId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
