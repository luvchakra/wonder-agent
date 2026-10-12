import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getConnectionWrites, setConnectionWrites } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/** INTEGRATION-P0-13 (D3): what a connection can change in the system, and whether that is turned on. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    return NextResponse.json({ ok: true, data: await getConnectionWrites(ctx.tenantId!, (await params).id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Body `{ "enabled": true | false }`. Audited by the service. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
    return NextResponse.json({ ok: true, data: await setConnectionWrites(ctx.tenantId!, ctx.userId, (await params).id, body?.enabled) });
  } catch (err) {
    return errorResponse(err);
  }
}
