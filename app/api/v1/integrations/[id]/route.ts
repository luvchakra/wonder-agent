import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIntegration } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { id } = await params;
    const integration = await getIntegration(ctx.tenantId!, id);
    if (!integration) {
      return NextResponse.json({ ok: false, error: { code: "INTEGRATION_NOT_FOUND" } }, { status: 404 });
    }
    // Never include integration_credentials fields — `integration` already
    // carries only the boolean hasCredentials (see modules/integrations/mappers.ts).
    return NextResponse.json({ ok: true, data: integration });
  } catch (err) {
    return errorResponse(err);
  }
}
