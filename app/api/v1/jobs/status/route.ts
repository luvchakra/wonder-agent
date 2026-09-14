import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getJobStatusSummary } from "@/modules/operations/service";
import { errorResponse } from "@/modules/operations/http";

/** OPERATIONS-P0-06.1 — connector/sync/job status across every integration in the tenant. */
export async function GET() {
  try {
    const ctx = await requirePermission("integration.read");
    const summary = await getJobStatusSummary(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: summary });
  } catch (err) {
    return errorResponse(err);
  }
}
