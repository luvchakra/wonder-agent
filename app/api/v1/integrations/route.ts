import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createIntegration, listIntegrations } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET() {
  try {
    const ctx = await requirePermission("integration.read");
    const integrations = await listIntegrations(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: integrations });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("integration.create");
    const body = await request.json();
    const integration = await createIntegration(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: integration }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
