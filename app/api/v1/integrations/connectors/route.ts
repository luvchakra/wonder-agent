import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listConnectorDefinitions, saveCustomDefinition } from "@/modules/integrations/framework/catalog";
import { errorResponse } from "@/modules/integrations/http";

/** The connector catalog: built-in definitions plus this organization's own. */
export async function GET() {
  try {
    const ctx = await requirePermission("integration.read");
    return NextResponse.json({ ok: true, data: await listConnectorDefinitions(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Publishes a version of this organization's own connector definition (the request body). */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("integration.create");
    const summary = await saveCustomDefinition(ctx.tenantId!, ctx.userId, await request.json());
    return NextResponse.json({ ok: true, data: summary }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
