import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setAttributeDefinitionActive } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// Retire or restore an attribute: { "active": false | true }.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ definitionId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { definitionId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    if (typeof body.active !== "boolean") return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "active: true or false" } }, { status: 400 });
    await setAttributeDefinitionActive(ctx.tenantId!, ctx.userId, definitionId, body.active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
