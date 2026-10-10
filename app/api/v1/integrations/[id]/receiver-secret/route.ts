import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { rotateReceiverSecret } from "@/modules/integrations/framework/receive";
import { errorResponse } from "@/modules/integrations/http";

/**
 * Issues (or replaces) the secret a connection's systems use to send
 * WonderID data. Returned once, here; only an encrypted copy is kept, and
 * the previous secret stops working immediately.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const secret = await rotateReceiverSecret(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: { secret } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
