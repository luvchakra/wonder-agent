import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrationTypes } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET() {
  try {
    await requirePermission("integration.read");
    const types = await listIntegrationTypes();
    return NextResponse.json({ ok: true, data: types });
  } catch (err) {
    return errorResponse(err);
  }
}
