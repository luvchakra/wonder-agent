import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrations } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/**
 * Lists the organization's connections. A connection is created only from
 * a connector definition, through POST /api/v1/integrations/connectors/connect
 * (non-negotiable #20), never as a bare integration row.
 */
export async function GET() {
  try {
    const ctx = await requirePermission("integration.read");
    const integrations = await listIntegrations(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: integrations });
  } catch (err) {
    return errorResponse(err);
  }
}
