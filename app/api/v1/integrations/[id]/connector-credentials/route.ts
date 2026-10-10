import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setConnectorCredentials } from "@/modules/integrations/framework/catalog";
import { errorResponse } from "@/modules/integrations/http";

/** Saves or rotates a connector integration's credentials: { secret: { <field>: value } }. Tested before stored. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const body = await request.json();
    await setConnectorCredentials(ctx.tenantId!, ctx.userId, id, body?.secret);
    // Never echo the secret back.
    return NextResponse.json({ ok: true, data: null }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
