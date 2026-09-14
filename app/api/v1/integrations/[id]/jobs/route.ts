import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listSyncJobs } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { id } = await params;
    const jobs = await listSyncJobs(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: jobs });
  } catch (err) {
    return errorResponse(err);
  }
}
