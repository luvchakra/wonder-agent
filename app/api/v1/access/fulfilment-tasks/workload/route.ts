import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { fulfilmentWorkload } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-42 — tasks still to do per person or group, and unassigned; overdue first.
export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    return NextResponse.json({ ok: true, data: await fulfilmentWorkload(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}
