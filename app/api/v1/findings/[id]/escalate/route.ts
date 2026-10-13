import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { escalateRogueFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/** RISK-P0-13: escalates a rogue-access finding into a new investigation holding it. `risk.manage`; audited. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const data = await escalateRogueFinding(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
