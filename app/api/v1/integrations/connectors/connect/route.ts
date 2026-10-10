import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { connectSystem } from "@/modules/integrations/framework/catalog";
import { errorResponse } from "@/modules/integrations/http";

/**
 * Connects a system with a connector: { origin, key, version?, name, settings, secret? }.
 * The credentials are tested before they are stored; a failed test is
 * reported in `credentialError` and the integration is left without them.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("integration.create");
    const body = await request.json();
    const { integration, credentialError } = await connectSystem(ctx.tenantId!, ctx.userId, body);
    return NextResponse.json({ ok: true, data: { integration, credentialError } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
