import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setCredential } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const body = await request.json();
    await setCredential(ctx.tenantId!, ctx.userId, id, body.authType, body.secret);
    // Never echo the secret back, not even to confirm it was received.
    return NextResponse.json({ ok: true, data: null }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
