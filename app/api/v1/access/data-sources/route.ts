import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createDataSource, listDataSources, validateDataSourceInput } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-13 — the data sources inventory, with each source's reach (CAN). */
export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    return NextResponse.json({ ok: true, data: await listDataSources(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("access.manage");
    const input = validateDataSourceInput(await request.json().catch(() => null));
    return NextResponse.json({ ok: true, data: await createDataSource(ctx.tenantId!, ctx.userId, input) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
