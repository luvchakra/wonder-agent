import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getConnectionSchedule, getIntegration, setConnectionSchedule } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/** INTEGRATION-P0-20: a connection's sync schedule (manual, daily or hourly), on every connection. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { id } = await params;
    if (!(await getIntegration(ctx.tenantId!, id))) return NextResponse.json({ ok: false, error: { code: "INTEGRATION_NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: { schedule: await getConnectionSchedule(ctx.tenantId!, id) } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Body `{ "schedule": "manual" | "daily" | "hourly" }`. Audited by the service. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.update");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { schedule?: unknown } | null;
    const schedule = await setConnectionSchedule(ctx.tenantId!, ctx.userId, id, body?.schedule);
    return NextResponse.json({ ok: true, data: { schedule } });
  } catch (err) {
    return errorResponse(err);
  }
}
