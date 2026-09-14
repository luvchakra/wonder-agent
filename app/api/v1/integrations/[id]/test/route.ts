import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { testIntegrationConnection } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.execute");
    const { id } = await params;
    const result = await testIntegrationConnection(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return errorResponse(err);
  }
}
