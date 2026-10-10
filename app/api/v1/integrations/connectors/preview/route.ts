import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { previewConnector } from "@/modules/integrations/framework/catalog";
import { errorResponse } from "@/modules/integrations/http";

/**
 * Runs one resource of a definition against a real system without storing
 * anything: { manifest, settings, secret, resource, limit? }. Audited.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("integration.create");
    const body = await request.json();
    return NextResponse.json({ ok: true, data: await previewConnector(ctx.tenantId!, ctx.userId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
