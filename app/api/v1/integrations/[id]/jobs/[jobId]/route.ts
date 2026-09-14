import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getSyncJob } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  try {
    const ctx = await requirePermission("integration.read");
    const { jobId } = await params;
    const job = await getSyncJob(ctx.tenantId!, jobId);
    if (!job) {
      return NextResponse.json({ ok: false, error: { code: "JOB_NOT_FOUND" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: job });
  } catch (err) {
    return errorResponse(err);
  }
}
