import { NextResponse, after } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createSyncJob, runSyncJob } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/**
 * INTEGRATION-P0-01.3: creates the job (queued) and returns immediately;
 * the actual connector work runs via after() once the response has been
 * sent, never inline in this handler. See
 * modules/integrations/syncJobs.ts's runSyncJob() docblock for why after()
 * rather than a new queue dependency.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("integration.execute");
    const { id } = await params;
    const job = await createSyncJob(ctx.tenantId!, id, "manual");

    after(() => runSyncJob(ctx.tenantId!, job.id));

    return NextResponse.json({ ok: true, data: job }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
