import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { discoverMcpTools } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.execute");
    const { id } = await params;
    const tools = await discoverMcpTools(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: tools });
  } catch (err) {
    return errorResponse(err);
  }
}
