import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listQuarantinedEvents } from "@/modules/runtime-assurance/service";
import { errorResponse } from "@/modules/runtime-assurance/http";

// RUNTIME-P0-11
export async function GET() {
  try {
    const ctx = await requirePermission("runtime.read");
    const entries = await listQuarantinedEvents(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: entries });
  } catch (err) {
    return errorResponse(err);
  }
}
